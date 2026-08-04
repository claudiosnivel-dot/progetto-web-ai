import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import {
  getAnthropicApiKey,
  getAnthropicGenerationModel,
  getAnthropicOnboardingModel,
} from '@/config/env';
import { GENERATION_BUDGET } from '@/domain/generation/budget';
import { parsePool, type Pool } from '@/domain/generation/pool';
import type { GenerationPayload } from '@/domain/generation/prompt';

// T-131 (macrotask ai-onboarding, P1) — confine UNICO con l'LLM: tutta la parte
// non deterministica del prodotto passa da qui. Vive solo server-side
// ("server-only" fa fallire il build se importato da un contesto client, e una
// regola ESLint vieta l'import da src/ui/**). Nessun segreto nel sorgente:
// chiave e modello arrivano dagli accessor di config/env (T-130).
// Il client e' un parametro iniettabile: i test passano un doppio e gli oracoli
// restano deterministici.

// Superficie minima del client SDK usata dal confine: e' il seam di mock.
type OnboardingLlmClient = {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
};

/**
 * La stessa superficie col SECONDO argomento di `create` (T-224). Nell'SDK 0.115.0
 * `timeout` e `maxRetries` sono REQUEST OPTIONS, cioe' il secondo parametro, e non campi
 * del body: scritti fra i params sarebbero un no-op SILENZIOSO — nessun timeout applicato
 * e i 2 ritentativi di default del client al posto degli zero decisi in GENERATION_BUDGET,
 * cioe' fino a tre generazioni per una richiesta sola. Il seam deve percio' poter
 * registrare ENTRAMBI gli argomenti, ed e' su entrambi che l'oracolo asserisce.
 */
type GenerationLlmClient = {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
      options?: Anthropic.RequestOptions,
    ): Promise<Anthropic.Message>;
  };
};

// Budget di output di un turno di intervista (max_tokens e' obbligatorio nella request).
const ONBOARDING_MAX_TOKENS = 2048;

// Il client reale nasce alla PRIMA chiamata, non all'import: importare questo
// modulo senza il segreto configurato non deve lanciare (lo fa solo chi lo usa).
// E' tipizzato con la superficie PIU' LARGA delle due — quella che dichiara anche le
// request options — perche' un client che accetta il secondo argomento vale anche dove
// ne basta uno: i due turni condividono cosi' una sola istanza e un solo punto di nascita.
let realClient: GenerationLlmClient | undefined;

function getRealClient(): GenerationLlmClient {
  realClient ??= new Anthropic({ apiKey: getAnthropicApiKey() });
  return realClient;
}

/**
 * Esegue un turno dell'intervista di onboarding sul modello configurato.
 * @param turn system prompt, messaggi della conversazione e tool dichiarati.
 * @param client client SDK — iniettabile nei test; default: quello reale (lazy).
 */
export function runOnboardingTurn(
  turn: {
    system: string;
    messages: Anthropic.MessageParam[];
    tools: Anthropic.ToolUnion[];
  },
  client: OnboardingLlmClient = getRealClient(),
): Promise<Anthropic.Message> {
  return client.messages.create({
    model: getAnthropicOnboardingModel(),
    max_tokens: ONBOARDING_MAX_TOKENS,
    system: turn.system,
    messages: turn.messages,
    tools: turn.tools,
  });
}

// ---------------------------------------------------------------------------
// T-224 (macrotask generation-llm, P2) — IL TURNO DI GENERAZIONE, in QUESTO file e non in
// un modulo nuovo (P1-D7): un secondo confine col modello sarebbe un secondo posto da
// sorvegliare, e stando qui eredita "server-only" (la prima riga del file) e la guardia
// ESLint deny-by-default senza che nessuno debba replicarle.
//
// COSA ARRIVA GIA' FATTO, E PERCHE' NON SI RIFA' QUI: il payload lo assembla T-223 a
// partire dalla PROIEZIONE di T-220, che e' l'allowlist in ingresso (P2-D4). Questa
// funzione il brief non lo vede mai — cio' che non entra qui non puo' uscire di qui — e
// l'asserzione anti-fuga e' fatta sull'oggetto REALMENTE passato al confine, che e'
// l'ultimo punto in cui una fuga sarebbe ancora osservabile. Ne eredita il limite
// dichiarato di T-220: e' un match per sottostringa, quindi una fuga TRASFORMATA (base64,
// percent-encoding) le sfuggirebbe.
//
// NON COPERTO, DICHIARATO: non esiste una chiave API, quindi nessun oracolo prova che
// l'API accetti questi parametri ne' che lo schema strict del tool sia valido (P1 §6-bis
// p.2). Ogni prova di questo confine mocka il confine.

/**
 * La FASE del turno, cioe' quale tetto di uscita vale. Sono le CHIAVI di
 * GENERATION_BUDGET.max_tokens e non un vocabolario nuovo: un secondo elenco di fasi
 * scritto qui divergerebbe dal budget in silenzio, ed e' il budget il solo posto in cui
 * quei numeri esistono (T-223).
 */
type FaseDiGenerazione = keyof (typeof GENERATION_BUDGET)['max_tokens'];

/** Il ramo di errore di `parsePool`, DERIVATO: qui non si ridichiara la sua forma. */
type ErroreDelPool = Extract<ReturnType<typeof parsePool>, { ok: false }>['error'];

/**
 * L'esito di un turno di generazione. Il fallimento e' TERMINALE e NOMINATO: nessun ramo
 * restituisce un pool parziale o vuoto, perche' un contenuto mutilato che arriva al DB e al
 * rendering e' peggio di una generazione fallita — e' lo stesso contratto con cui P1-D17 e
 * POOL_LIMITS scartano un valore fuori scala invece di tagliarlo.
 *
 * I MOTIVI SONO DISTINTI perche' dicono a chi chiama cose diverse: il troncamento e' un
 * tetto da rivedere (T-225), la tool-call assente e' il modello che ha risposto altrove, lo
 * stop_reason anomalo e' un turno che non si e' chiuso chiamando il tool, il pool non valido
 * e' contenuto fuori contratto. Un motivo unico li appiattirebbe tutti su "riprova".
 */
type GenerationTurnResult =
  | { readonly ok: true; readonly pool: Pool }
  | { readonly ok: false; readonly reason: 'risposta_troncata' }
  | { readonly ok: false; readonly reason: 'tool_use_assente' }
  | {
      readonly ok: false;
      readonly reason: 'stop_reason_anomalo';
      // Lo stop_reason viaggia nell'esito perche' e' un valore dell'ENUM dell'API, non
      // testo scritto dal modello: nominarlo non riapre il canale dell'errore che P2-D20
      // chiude sulle chiavi e sugli slug: quelli il modello li scrive, questo no.
      readonly stop_reason: Anthropic.Message['stop_reason'];
    }
  | { readonly ok: false; readonly reason: 'pool_non_valido'; readonly error: ErroreDelPool };

/**
 * Esegue un turno di GENERAZIONE sul modello configurato e restituisce il pool VALIDATO,
 * oppure il motivo — terminale e nominato — per cui questo turno non ne produce alcuno.
 *
 * @param turn il payload assemblato da T-223, la fase (che sceglie il tetto di uscita) e
 *   l'allowlist degli slug di QUESTA generazione (T-213), che `parsePool` impone sul
 *   ritorno: una pagina non prevista fa cadere l'intero pool.
 * @param client client SDK — iniettabile nei test; default: quello reale (lazy).
 * @returns il pool validato, oppure il fallimento col suo codice di motivo.
 */
export async function runGenerationTurn(
  turn: {
    readonly payload: GenerationPayload;
    readonly phase: FaseDiGenerazione;
    readonly allowedSlugs: readonly string[];
  },
  client: GenerationLlmClient = getRealClient(),
): Promise<GenerationTurnResult> {
  const risposta = await client.messages.create(
    {
      model: getAnthropicGenerationModel(),
      max_tokens: GENERATION_BUDGET.max_tokens[turn.phase],
      // P2-D29 — IL BREAKPOINT DI CACHE, in CODA ALLA PARTE STABILE. L'API rende il prompt
      // nell'ordine tools -> system -> messages e il prompt caching e' un confronto di
      // PREFISSO: un breakpoint qui copre il tool E il system, cioe' esattamente cio' che
      // AC-223-2 pinna identico byte per byte fra due generazioni diverse. Senza di esso quel
      // prefisso e' una proprieta' senza effetto — il colpo di cache non avviene mai — e i due
      // campi di cache di `usage` che T-225 deve misurare restano costantemente nulli, cioe'
      // la taratura di P2-D17 nascerebbe cieca sulla voce di costo che l'ordine cache-friendly
      // del payload esiste per abbattere. Il system diventa percio' UN blocco di testo invece
      // di una stringa: e' la sola forma in cui il breakpoint ha dove stare, e il testo che
      // porta e' quello di T-223 senza un byte di differenza. UNO SOLO: ogni breakpoint in
      // piu' e' una scrittura di cache in piu', e sulla parte VOLATILE non ne va nessuno
      // (quella cambia a ogni cliente: ci sarebbe solo da pagare la scrittura).
      system: [
        { type: 'text', text: turn.payload.system, cache_control: { type: 'ephemeral' } },
      ],
      messages: turn.payload.messages,
      tools: turn.payload.tools,
      // P2-D11: il pensiero non si spegne MAI. Su Sonnet 5 il pensiero disattivato riduce
      // la propensione a usare i tool, e il nostro pool E' una tool-call: spegnerlo qui
      // vorrebbe dire chiedere al modello proprio la cosa che smetterebbe di fare. La leva
      // e' l'effort dichiarato nel budget, non l'interruttore.
      thinking: { type: 'adaptive' },
      output_config: { effort: GENERATION_BUDGET.effort },
    },
    {
      // REQUEST OPTIONS, non body (vedi il tipo del seam qui sopra). `maxRetries` a zero
      // e' cio' che impedisce il RETRY SILENZIOSO: una seconda generazione che nessuno ha
      // chiesto e — quando esistera' P5 — un secondo addebito.
      timeout: GENERATION_BUDGET.timeout_ms,
      maxRetries: GENERATION_BUDGET.max_retries,
    },
  );

  // LE GUARDIE, NELL'ORDINE IN CUI DEVONO STARE — l'ordine E' il contenuto, perche' un
  // fallimento puo' soddisfare piu' di una condizione e il motivo riportato dev'essere la
  // CAUSA, non il primo sintomo che si incontra.
  //
  // 1. IL TRONCAMENTO PER PRIMO. Una risposta tagliata dal tetto e' incompleta per
  //    definizione: qualunque cosa porti nel content non e' la risposta finita del modello.
  //    Dire "tool-call assente" di una risposta TAGLIATA nominerebbe il sintomo e manderebbe
  //    a cercare il difetto nel prompt invece che nel budget (T-225, dove il tetto si tara).
  if (risposta.stop_reason === 'max_tokens') return { ok: false, reason: 'risposta_troncata' };

  // 2. POI L'ASSENZA DELLA TOOL-CALL, e prima del controllo generico sullo stop_reason: e'
  //    il modo di fallire in cui IL TURNO RIESCE E IL POOL NON ESISTE — su Opus 5 e'
  //    documentato che la tool-call possa arrivare come testo visibile, con stop_reason
  //    'end_turn'. Se il controllo generico venisse prima, quel caso si presenterebbe come
  //    stop_reason inatteso e nasconderebbe la cosa da guardare. Il blocco si riconosce dal
  //    TIPO e non dal nome, e il PRIMO che si incontra e' quello: la richiesta dichiara UN
  //    tool solo, quindi ogni blocco tool_use della risposta e' quello. Il nome NON e' un
  //    secondo controllo — qui prima stava scritto che "un tool_use con un nome diverso
  //    cadrebbe comunque un passo piu' sotto, dove l'input non validerebbe", ed e' FALSO in
  //    generale: un nome diverso con un input di forma valida verrebbe accettato. Cio' che il
  //    confine fa davvero e' asserito dall'oracolo, non affidato a questo commento.
  const chiamata = risposta.content.find(
    (blocco): blocco is Anthropic.ToolUseBlock => blocco.type === 'tool_use',
  );
  if (chiamata === undefined) return { ok: false, reason: 'tool_use_assente' };

  // 3. POI OGNI ALTRO stop_reason diverso da 'tool_use' (pause_turn, refusal, ...): il turno
  //    non si e' chiuso CHIAMANDO il tool, quindi la tool-call che c'e' non e' quella con cui
  //    il modello ha finito, e prenderla per buona sarebbe accettare un contenuto a meta'.
  if (risposta.stop_reason !== 'tool_use') {
    return { ok: false, reason: 'stop_reason_anomalo', stop_reason: risposta.stop_reason };
  }

  // 4. INFINE IL GATE sull'uscita del modello (T-201): l'input della tool-call e' input NON
  //    FIDATO come ogni altro, e i tetti degli slot non stanno nello schema strict (P1-D20),
  //    quindi e' QUI che vengono applicati. Un pool fuori contratto e' scartato INTERO.
  const esito = parsePool(chiamata.input, { allowedSlugs: turn.allowedSlugs });
  if (!esito.ok) return { ok: false, reason: 'pool_non_valido', error: esito.error };
  return { ok: true, pool: esito.pool };
}
