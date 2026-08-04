import { describe, it, expect, afterEach, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runGenerationTurn } from '@/data/anthropic';
import { getAnthropicGenerationModel } from '@/config/env';
import { GENERATION_BUDGET } from '@/domain/generation/budget';
import { POOL_LIMITS } from '@/domain/generation/pool';
import { buildPoolTool } from '@/domain/generation/tool';
import { buildGenerationPayload } from '@/domain/generation/prompt';
import { briefProjection } from '@/domain/generation/projection';
import { applyBriefUpdate, emptyBrief, type Brief } from '@/domain/onboarding/brief';
import type { SlotId } from '@/domain/generation/slots';

// T-224 (macrotask generation-llm, P2) — il TURNO DI GENERAZIONE nel confine unico e le
// guardie TERMINALI sul ritorno. Le asserzioni derivano dagli acceptance_criteria AC-224-1,
// AC-224-2, AC-224-3, AC-224-4, AC-224-6 e AC-224-8 (03-generation-llm.md), piu' le meta' della
// definition_of_done che nessun AC nomina: la cardinalita' delle chiamate, l'allowlist degli
// slug, gli input degeneri della tool-call e il client di default.
//
// OGNI ORACOLO QUI MOCKA IL CONFINE, ed e' il vincolo che governa tutto il macrotask: non
// esiste una chiave API. Cio' che questo file prova e' cosa il confine PASSA e cosa fa di
// cio' che RICEVE; cio' che non prova — e che nessun test puo' provare finche' la chiave non
// esiste — e' che l'API accetti questi parametri, che lo schema strict del tool sia valido
// (P1 §6-bis p.2) e che il modello si comporti come le fixture suppongono. Quelle risposte
// sono SCRITTE QUI, non osservate: valgono come contratto sul nostro lato, non come misura.
//
// Il fatto stesso che questo file importi @/data/anthropic senza chiave Anthropic
// nell'ambiente dimostra che il client reale NON viene istanziato all'import (default lazy) —
// ma quella prova dipende dall'ASSENZA della chiave nell'ambiente, cioe' sparirebbe in silenzio
// in una CI che ne avesse una. L'ultimo caso del file la toglie DENTRO il test e la asserisce.

// ---------------------------------------------------------------------------
// FIXTURE. Ogni collezione ha PIU' DI UN elemento, con valori DISCORDANTI, e almeno una
// chiave che e' PREFISSO di un'altra — 'hero_title' / 'hero_title_kicker' fra gli slot,
// 'menu' / 'menu-di-stagione' fra gli slug: un confronto scritto con startsWith invece che
// con uguaglianza (nell'allowlist delle pagine, nella scelta degli slot) deve poter essere
// osservato mentre sbaglia.
//
// LA COPPIA-PREFISSO DEGLI SLUG HA ORA QUALCOSA DA FAR SBAGLIARE, e prima non l'aveva:
// 'menu' e 'menu-di-stagione' erano ENTRAMBI nell'allowlist e nessun caso pretendeva un
// RIFIUTO per slug, quindi la disciplina era applicata alla lettera e vuota. Misurato in
// verifica avversariale: sostituire `turn.allowedSlugs` con una lista costante, allargare
// l'allowlist ai propri prefissi, o ANNULLARLA aggiungendo gli slug che il modello ha
// scritto, lasciavano tutti e 18 i test verdi — cioe' la sola proprieta' di SICUREZZA di
// questo task non era toccata da alcun oracolo. L'allowlist del turno percio' NON contiene
// piu' 'menu', e la tabella CASI_DELL_ALLOWLIST piu' sotto la fa sbagliare in ENTRAMBI i
// versi del prefisso.

const SLOT_DEL_TURNO: readonly SlotId[] = [
  'hero_title_kicker',
  'hero_title',
  'about_points',
  'faq_items',
];

/**
 * Gli slug ammessi per questa generazione (T-213). 'menu' NON c'e', ed e' PREFISSO di
 * 'menu-di-stagione' che invece c'e': un'allowlist confrontata per prefisso ammetterebbe una
 * pagina che questa generazione non prevede.
 */
const PAGINE_DEL_TURNO: readonly string[] = ['home', 'menu-di-stagione'];

const TOOL_DEL_TURNO = buildPoolTool(SLOT_DEL_TURNO, PAGINE_DEL_TURNO);

/**
 * La fixture passa dallo schema del brief (T-121): una patch SCARTATA produrrebbe un brief
 * senza i campi che il caso deve provare, e il fallimento sarebbe muto. Qui e' rumoroso — e
 * lancia invece di asserire perche' e' costruita in fase di collezione, non dentro un test.
 */
function briefDa(patch: Record<string, unknown>): Brief {
  const { brief, rejected } = applyBriefUpdate(emptyBrief('it'), patch);
  if (rejected.length > 0) throw new Error(`fixture non valida: ${rejected.join(', ')}`);
  return brief;
}

const BRIEF = briefDa({
  business_name: 'Trattoria Nove',
  vertical: 'ristorazione',
  description: 'Cucina di mercato in centro, aperta dal 1953.',
  primary_goal: 'prenota',
  brand_hints: 'Toni caldi, legno e ottone.',
  highlights: ['Forno a legna', 'Terrazza sul fiume'],
  offerings: [
    { name: 'Antipasto della casa', section: 'Antipasti' },
    { name: 'Antipasto della casa speciale', section: 'Antipasti Freddi' },
  ],
});

const PAYLOAD = buildGenerationPayload(briefProjection(BRIEF, 'home'), TOOL_DEL_TURNO, 'home');

/** La fase del turno, DERIVATA dal budget: e' il tipo che il confine dichiara nella firma. */
type FaseDelBudget = keyof (typeof GENERATION_BUDGET)['max_tokens'];

/** Le fasi, DERIVATE dal budget: sono due e portano tetti DIVERSI (vedi l'anti-vacuita'). */
const FASI = Object.keys(GENERATION_BUDGET.max_tokens) as FaseDelBudget[];

/** Il turno che tutti i casi eseguono: cambia solo cio' che il doppio del client risponde. */
const TURNO = {
  payload: PAYLOAD,
  phase: FASI[0],
  allowedSlugs: PAGINE_DEL_TURNO,
} as const;

// ---------------------------------------------------------------------------
// IL DOPPIO DEL CLIENT. Registra ENTRAMBI gli argomenti di messages.create, e non e' zelo:
// `timeout` e `maxRetries` sono REQUEST OPTIONS (secondo argomento) e non campi del body,
// quindi un doppio che registrasse i soli params non potrebbe distinguere un timeout
// dichiarato da un timeout mai passato — che e' esattamente il difetto da sorvegliare.

type ChiamataAlConfine = {
  readonly params: Anthropic.MessageCreateParamsNonStreaming;
  readonly options: Anthropic.RequestOptions | undefined;
};

function clientChe(risposta: Anthropic.Message) {
  const chiamate: ChiamataAlConfine[] = [];
  const client = {
    messages: {
      create(
        params: Anthropic.MessageCreateParamsNonStreaming,
        options?: Anthropic.RequestOptions,
      ): Promise<Anthropic.Message> {
        chiamate.push({ params, options });
        return Promise.resolve(risposta);
      },
    },
  };
  return { chiamate, client };
}

/**
 * UNA SOLA chiamata al confine — e va asserito SU OGNI RAMO, non solo su quello che riesce.
 * `max_retries` a zero e' cio' che impedisce il RETRY SILENZIOSO (una seconda generazione che
 * nessuno ha chiesto e, quando esistera' P5, un secondo addebito), ma un ritentativo scritto
 * NOSTRO nel confine passerebbe sopra a quel numero senza toccarlo. Misurato in verifica
 * avversariale: una seconda `messages.create` eseguita quando stop_reason != 'tool_use' —
 * cioe' esattamente sui rami di FALLIMENTO — lasciava tutti e 18 i test verdi, perche' la
 * cardinalita' era asserita solo la' dove un ritentativo non avrebbe avuto senso.
 */
function chiamataUnica(chiamate: readonly ChiamataAlConfine[], dove: string) {
  expect(
    chiamate,
    `chiamate al confine per ${dove}: piu' di una e' un ritentativo che nessuno ha chiesto`,
  ).toHaveLength(1);
}

/** Una risposta del modello, nella forma che l'SDK restituisce davvero. */
function rispostaDelModello(
  content: Anthropic.ContentBlock[],
  stopReason: Anthropic.Message['stop_reason'],
): Anthropic.Message {
  return {
    id: 'msg_test_t224',
    container: null,
    content,
    model: 'claude-sonnet-5',
    role: 'assistant',
    stop_details: null,
    stop_reason: stopReason,
    stop_sequence: null,
    type: 'message',
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      input_tokens: 4200,
      output_tokens: 1100,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
  };
}

function bloccoDiTesto(text: string): Anthropic.ContentBlock {
  return { type: 'text', text, citations: null };
}

/**
 * Il blocco di PENSIERO, che l'API antepone alla tool-call quando `thinking` e' attivo — cioe'
 * SEMPRE, perche' P2-D11 vieta di spegnerlo e AC-224-4 lo asserisce. E' la forma reale di una
 * risposta di questo turno, non un caso di scuola: senza un blocco che PRECEDA la tool-call
 * nessuna fixture distingue `content.find(...)` da `content[0]`, e un confine che leggesse il
 * primo blocco sarebbe verde qui e fallirebbe alla prima chiamata vera con 'tool_use_assente',
 * cioe' nel modo piu' difficile da diagnosticare.
 */
function bloccoDiPensiero(thinking: string): Anthropic.ContentBlock {
  return { type: 'thinking', thinking, signature: 'sig_test_t224' };
}

/** Il blocco tool_use, col NOME che il tool di T-222 dichiara davvero. */
function bloccoToolUse(input: unknown): Anthropic.ContentBlock {
  return bloccoToolUseChiamato(TOOL_DEL_TURNO.name, input);
}

/** Lo stesso blocco con un NOME qualsiasi: il confine riconosce per TIPO, non per nome. */
function bloccoToolUseChiamato(nome: string, input: unknown): Anthropic.ContentBlock {
  return {
    type: 'tool_use',
    id: 'toolu_test_t224',
    caller: { type: 'direct' },
    name: nome,
    input,
  };
}

// I POOL DI PROVA. Il valido porta due pagine con contenuti DISCORDANTI e usa lo slug che ha
// un altro slug ammesso per PREFISSO; quello fuori scala porta un valore oltre il tetto in
// una pagina e un valore SANO e riconoscibile nell'altra — cosi' "nessun contenuto parziale"
// e' osservabile e non solo dichiarato.
const POOL_VALIDO = {
  pages: {
    home: {
      hero_title_kicker: 'Cucina di mercato, a due passi dal fiume',
      hero_title: 'Trattoria Nove',
    },
    'menu-di-stagione': {
      about_points: ['Forno a legna', 'Terrazza sul fiume'],
      faq_items: [{ question: 'Si prenota?', answer: 'Sì, anche per la sera.' }],
    },
  },
};

/**
 * Un SECONDO pool valido, con contenuti diversi dal primo. Serve al caso delle due tool-call:
 * se il confine prendesse l'ULTIMA invece della prima, l'esito sarebbe un pool comunque valido
 * — cioe' la differenza si vede solo confrontando QUALE dei due torna indietro.
 */
const POOL_SECONDARIO = {
  pages: {
    home: {
      hero_title: 'Nove, dal 1953',
      hero_title_kicker: 'La seconda versione della stessa home',
    },
  },
};

/** Il testo SANO del pool fuori scala: se comparisse nell'esito, il gate avrebbe restituito
 *  contenuto parziale invece di scartare il pool intero. */
const TESTO_SANO = 'Vhalorix cucina di mercato';

const POOL_FUORI_SCALA = {
  pages: {
    home: { hero_title: 'x'.repeat(POOL_LIMITS.text + 1) },
    'menu-di-stagione': { hero_title_kicker: TESTO_SANO },
  },
};

/** Il contenuto che il modello scrive nella pagina NON PREVISTA: riconoscibile, cosi' anche
 *  qui "nessun contenuto parziale" e' osservabile e non solo dichiarato. */
const TESTO_DELLA_PAGINA_NON_PREVISTA = 'Zurbaneto piatti del giorno';

/**
 * L'ALLOWLIST DEGLI SLUG DEL TURNO, fatta sbagliare in ENTRAMBI i versi del prefisso e poi
 * fatta riuscire. La stessa risposta del modello cambia esito al cambiare della SOLA
 * allowlist passata nel turno: e' cio' che rende osservabile che l'allowlist usata sia quella
 * di QUESTA generazione (T-213) e non una lista costante scritta nel confine.
 */
const CASI_DELL_ALLOWLIST = [
  {
    caso: 'lo slug scritto e PREFISSO di uno ammesso',
    allowedSlugs: ['home', 'menu-di-stagione'],
    slugScritto: 'menu',
    coppia: 'menu-di-stagione',
    ammesso: false,
  },
  {
    caso: 'lo slug scritto ESTENDE uno ammesso',
    allowedSlugs: ['home', 'menu'],
    slugScritto: 'menu-di-stagione',
    coppia: 'menu',
    ammesso: false,
  },
  {
    caso: 'lo slug scritto e ammesso per UGUAGLIANZA',
    allowedSlugs: ['home', 'menu', 'menu-di-stagione'],
    slugScritto: 'menu',
    coppia: 'menu-di-stagione',
    ammesso: true,
  },
] as const;

/** Il pool che il modello scrive in un caso dell'allowlist: una pagina sola, quella in ballo. */
function poolConLaPagina(slug: string) {
  return { pages: { [slug]: { hero_title: TESTO_DELLA_PAGINA_NON_PREVISTA } } };
}

/**
 * SPIA NON INVASIVA SUL GATE. Inoltra a `parsePool` vero e registra le OPZIONI ricevute.
 *
 * PERCHE' ESISTE, misurato dall'orchestratore DOPO che la tabella qui sopra era gia' in
 * piedi: le tre righe di `CASI_DELL_ALLOWLIST` provano che una pagina fuori allowlist CADE,
 * ma non possono vedere un'allowlist ALLARGATA con uno slug che nessuna risposta di prova
 * scrive. Con `allowedSlugs: [...turn.allowedSlugs, 'pagina-mai-chiesta']` nel confine, tutti
 * e 133 i test del macrotask restavano verdi — e la forma plausibile non e' quella: e'
 * l'aggiunta "di comodo" di `'home'`, che ogni turno ammette gia' e che nessun caso
 * comportamentale potra' mai distinguere. La proprieta' completa non e' osservabile da alcun
 * esito: va osservata sull'ARGOMENTO, come per i parametri passati al client (AC-224-4).
 */
const spiaDelGate = vi.hoisted(() => ({
  opzioni: [] as { allowedSlugs: readonly string[] }[],
}));

vi.mock('@/domain/generation/pool', async (importaOriginale) => {
  const vero = await importaOriginale<typeof import('@/domain/generation/pool')>();
  return {
    ...vero,
    parsePool: (input: unknown, opzioni: { allowedSlugs: readonly string[] }) => {
      spiaDelGate.opzioni.push(opzioni);
      return vero.parsePool(input, opzioni);
    },
  };
});

/**
 * GLI INPUT DEGENERI della tool-call. `chiamata.input` e' `unknown` e viene dal modello: che
 * sia un oggetto con `pages` non e' un fatto, e' una speranza. Ogni fixture del file passava
 * a `parsePool` un oggetto ben formato, e fondere un default `{ pages: {}, ...input }` nel
 * confine lasciava la suite verde — cioe' un input senza `pages` sarebbe diventato un pool
 * VUOTO ACCETTATO, che e' precisamente cio' che la definition_of_done vieta.
 */
const INPUT_DEGENERI: readonly (readonly [string, unknown])[] = [
  ['una stringa al posto di un oggetto', 'i testi della home sono pronti'],
  ['null', null],
  ['un oggetto SENZA la mappa delle pagine', {}],
  ['la mappa delle pagine scritta con un altro nome', { pagine: { home: { hero_title: 'x' } } }],
];

/**
 * Il fallimento, con la guardia che l'esito NON sia un successo. Senza, un ramo che
 * restituisse un pool passerebbe ogni asserzione sul motivo per assenza di motivo.
 */
function fallimento(esito: Awaited<ReturnType<typeof runGenerationTurn>>) {
  expect(esito.ok, 'il turno ha prodotto un SUCCESSO dove l oracolo attende un fallimento').toBe(
    false,
  );
  if (esito.ok) throw new Error('irraggiungibile: l esito e un successo');
  return esito;
}

/** Il successo, con la guardia speculare: senza, "il pool e' questo" sarebbe muto su un ramo
 *  che fallisce, perche' un esito di fallimento non ha alcun `pool` da confrontare. */
function successo(esito: Awaited<ReturnType<typeof runGenerationTurn>>) {
  expect(esito.ok, `il turno e fallito dove l oracolo attende un successo: ${JSON.stringify(esito)}`).toBe(
    true,
  );
  if (!esito.ok) throw new Error('irraggiungibile: l esito e un fallimento');
  return esito;
}

/**
 * I blocchi del system REALMENTE passato. Il confine lo spedisce come ELENCO DI BLOCCHI e non
 * come stringa perche' e' li' che il breakpoint di cache ha dove stare (AC-224-8): se tornasse
 * a essere una stringa il breakpoint non esisterebbe piu', e questa funzione lo dice invece di
 * lasciare che un `undefined` soddisfi in silenzio le righe che lo cercano.
 */
function blocchiDiSistema(
  system: Anthropic.MessageCreateParamsNonStreaming['system'],
): Anthropic.TextBlockParam[] {
  if (system === undefined || typeof system === 'string') {
    throw new Error('il system non e un elenco di blocchi: il breakpoint non avrebbe dove stare');
  }
  expect(system, 'il system non e UN blocco solo').toHaveLength(1);
  return system;
}

/**
 * OGNI stop_reason che non sia 'max_tokens' (guardia 1) ne' 'tool_use' (il cammino che
 * riesce). Il Record e' TOTALE sul tipo dell'SDK: un motivo nuovo in una versione nuova rompe
 * il typecheck QUI e obbliga a decidere, invece di finire in silenzio nel ramo 'anomalo' senza
 * che nessuno l'abbia mai guardato — che e' come 'pause_turn' era arrivato a esistere.
 */
type StopReasonAnomalo = Exclude<
  NonNullable<Anthropic.Message['stop_reason']>,
  'max_tokens' | 'tool_use'
>;

const STOP_REASON_ANOMALI: Record<StopReasonAnomalo, true> = {
  end_turn: true,
  stop_sequence: true,
  pause_turn: true,
  refusal: true,
  model_context_window_exceeded: true,
};

const MODELLO_NELL_AMBIENTE = process.env.ANTHROPIC_MODEL_GENERATION;

afterEach(() => {
  if (MODELLO_NELL_AMBIENTE === undefined) delete process.env.ANTHROPIC_MODEL_GENERATION;
  else process.env.ANTHROPIC_MODEL_GENERATION = MODELLO_NELL_AMBIENTE;
});

// ---------------------------------------------------------------------------

describe('T-224 runGenerationTurn: guardie terminali sul ritorno', () => {
  // ANTI-VACUITA' DI TUTTO IL FILE: il cammino che RIESCE riesce davvero. Senza questa riga
  // un'implementazione che fallisse sempre soddisferebbe ogni asserzione di fallimento qui
  // sotto, e le guardie sarebbero indistinguibili da un confine rotto.
  it('con stop_reason tool_use e un pool valido restituisce il pool VALIDATO', async () => {
    const { chiamate, client } = clientChe(
      rispostaDelModello([bloccoToolUse(POOL_VALIDO)], 'tool_use'),
    );

    const esito = await runGenerationTurn(TURNO, client);

    expect(esito).toEqual({ ok: true, pool: POOL_VALIDO }); // DoD T-224 — il pool validato, per intero
    // IL POOL E' QUELLO VALIDATO, non l'input grezzo del modello. Oggi le due cose sono
    // profondamente uguali (PageContentSchema e' `.strict()`, quindi zod non aggiunge e non
    // toglie nulla a un pool valido) e restituire `chiamata.input` restava verde: e'
    // l'IDENTITA' a distinguerli, ed e' la riga che diventa indispensabile il giorno in cui
    // lo schema acquisisse un default o una coercizione.
    expect(successo(esito).pool).not.toBe(POOL_VALIDO); // DoD T-224
    // UNA sola chiamata: nessun ritentativo NOSTRO sopra a quello dell'SDK, che e' gia'
    // azzerato dalle request options (GENERATION_BUDGET.max_retries).
    expect(chiamate).toHaveLength(1); // DoD T-224
  });

  // covers: AC-224-1
  // DUE forme di troncamento, discordanti: la risposta tagliata PRIMA della tool-call e
  // quella tagliata DENTRO la tool-call (il pool arriva a meta'). Con una sola delle due
  // l'ordine delle guardie non sarebbe osservabile: e' la seconda che pretende che il
  // troncamento sia nominato PRIMA di ogni altra cosa, invece che scambiato per un pool
  // invalido — cioe' che l'esito mandi a guardare il budget e non il contratto.
  for (const [forma, contenuto] of [
    ['tagliata prima della tool-call', [bloccoDiTesto('Sto scrivendo i testi della home')]],
    [
      'tagliata DENTRO la tool-call',
      [bloccoToolUse({ pages: { home: { hero_title: 'Trattoria N' } } })],
    ],
  ] as const) {
    it(`stop_reason max_tokens (${forma}): errore di TRONCAMENTO e nessun pool`, async () => {
      const { chiamate, client } = clientChe(rispostaDelModello([...contenuto], 'max_tokens'));

      const esito = await runGenerationTurn(TURNO, client);

      // L'uguaglianza ESATTA dice due cose in una riga: il motivo e' quello del
      // troncamento, e nell'esito non c'e' altro — nessun pool, nemmeno vuoto.
      expect(esito).toEqual({ ok: false, reason: 'risposta_troncata' }); // covers: AC-224-1
      expect('pool' in esito).toBe(false); // covers: AC-224-1
      chiamataUnica(chiamate, forma); // DoD T-224
    });
  }

  // covers: AC-224-2
  // IL MODO DI FALLIRE IN CUI IL TURNO RIESCE E IL POOL NON ESISTE. Il secondo caso non e'
  // teorico: su Opus 5 — attivabile con una env — e' documentato che la tool-call possa
  // arrivare come TESTO VISIBILE, cioe' il JSON del pool dentro un blocco di testo con
  // stop_reason 'end_turn'. Un confine che guardasse il solo stop_reason lo chiamerebbe
  // successo, e a valle arriverebbe un pool inesistente.
  for (const [forma, contenuto] of [
    [
      'due blocchi di solo testo',
      [bloccoDiTesto('Ecco i testi che ho preparato.'), bloccoDiTesto('Fammi sapere se vanno bene.')],
    ],
    ['il pool scritto come TESTO VISIBILE', [bloccoDiTesto(JSON.stringify(POOL_VALIDO))]],
  ] as const) {
    it(`stop_reason end_turn e nessun blocco tool_use (${forma}): errore di TOOL-CALL ASSENTE`, async () => {
      const { chiamate, client } = clientChe(rispostaDelModello([...contenuto], 'end_turn'));

      const esito = await runGenerationTurn(TURNO, client);

      expect(esito).toEqual({ ok: false, reason: 'tool_use_assente' }); // covers: AC-224-2
      expect('pool' in esito).toBe(false); // covers: AC-224-2
      chiamataUnica(chiamate, forma); // DoD T-224
      // Il pool scritto come testo NON viene ripescato dal testo: se comparisse nell'esito,
      // il confine avrebbe accettato per una via che nessuno schema strict sorveglia.
      expect(JSON.stringify(esito)).not.toContain('hero_title'); // covers: AC-224-2
    });
  }

  // NON deriva da un AC: e' la definition_of_done, che parla dell'"input della tool-call"
  // dando per scontato QUALE blocco sia. In ogni fixture di questo file il tool_use era il
  // PRIMO del content, quindi `content.find(...)` e `content[0]` erano indistinguibili — e la
  // prima riga della tabella dice perche' non lo sono nella realta': con `thinking` attivo
  // (P2-D11, mai disabled, asserito da AC-224-4) l'API ANTEPONE un blocco di pensiero, quindi
  // un confine che leggesse il primo blocco fallirebbe alla prima chiamata vera con
  // 'tool_use_assente', cioe' accusando il prompt di un difetto che sta nel lettore.
  for (const [forma, contenuto, atteso] of [
    [
      'un blocco di PENSIERO e uno di testo prima della tool-call',
      [
        bloccoDiPensiero('Scelgo il taglio della home e poi compilo gli slot.'),
        bloccoDiTesto('Ecco i testi che ho preparato.'),
        bloccoToolUse(POOL_VALIDO),
      ],
      POOL_VALIDO,
    ],
    [
      'un blocco di testo prima della tool-call',
      [bloccoDiTesto('Ecco i testi che ho preparato.'), bloccoToolUse(POOL_VALIDO)],
      POOL_VALIDO,
    ],
    [
      'DUE tool_use: vale la PRIMA',
      [bloccoToolUse(POOL_VALIDO), bloccoToolUse(POOL_SECONDARIO)],
      POOL_VALIDO,
    ],
  ] as const) {
    it(`la tool-call si trova per TIPO ovunque stia nel content (${forma})`, async () => {
      // Anti-vacuita' della terza riga: i due pool sono DIVERSI, altrimenti "vale la prima"
      // sarebbe soddisfatto anche prendendo la seconda.
      expect(POOL_SECONDARIO).not.toEqual(POOL_VALIDO); // DoD T-224

      const { chiamate, client } = clientChe(rispostaDelModello([...contenuto], 'tool_use'));

      const esito = await runGenerationTurn(TURNO, client);

      expect(successo(esito).pool).toEqual(atteso); // DoD T-224
      chiamataUnica(chiamate, forma); // DoD T-224
    });
  }

  // NON deriva da un AC. Il modulo riconosce il blocco dal TIPO e non dal NOME, e fino a oggi
  // lo giustificava scrivendo che "un tool_use con un nome diverso cadrebbe comunque un passo
  // piu' sotto, dove l'input non validerebbe": e' FALSO in generale — un nome diverso con un
  // input di forma valida viene accettato, ed e' quello che questa riga misura. Il commento
  // del modulo e' stato corretto insieme a questo caso: o si asserisce, o non lo si afferma.
  // Il riconoscimento per tipo resta la scelta giusta (la richiesta dichiara UN tool solo),
  // ma ora e' una scelta OSSERVABILE invece di un'affermazione.
  it('un tool_use con un NOME diverso e comunque la tool-call: si riconosce per TIPO', async () => {
    const { chiamate, client } = clientChe(
      rispostaDelModello([bloccoToolUseChiamato('un_altro_tool', POOL_VALIDO)], 'tool_use'),
    );

    const esito = await runGenerationTurn(TURNO, client);

    expect(successo(esito).pool).toEqual(POOL_VALIDO); // DoD T-224
    chiamataUnica(chiamate, 'tool_use con un altro nome'); // DoD T-224
  });

  // covers: AC-224-3
  it('un pool con uno slot oltre il tetto di POOL_LIMITS: errore di validazione che NOMINA lo slot', async () => {
    const { chiamate, client } = clientChe(
      rispostaDelModello([bloccoToolUse(POOL_FUORI_SCALA)], 'tool_use'),
    );

    const esito = await runGenerationTurn(TURNO, client);
    const caduta = fallimento(esito);
    chiamataUnica(chiamate, 'pool fuori scala'); // DoD T-224

    expect(caduta.reason).toBe('pool_non_valido'); // covers: AC-224-3
    const issues = caduta.reason === 'pool_non_valido' ? caduta.error.issues : [];
    // Il PATH nomina lo slot fuori scala per UGUAGLIANZA di segmento: 'hero_title' e
    // 'hero_title_kicker' sono due slot e uno e' prefisso dell'altro, quindi un errore che
    // nominasse il secondo qui sarebbe sbagliato e visibile.
    expect(issues.some((issue) => issue.path.includes('hero_title'))).toBe(true); // covers: AC-224-3
    expect(issues.some((issue) => issue.path.includes('hero_title_kicker'))).toBe(false); // covers: AC-224-3

    // NESSUN CONTENUTO PARZIALE: ne' il pool, ne' il valore sano dell'altra pagina, ne' il
    // valore fuori scala (che nell'errore sarebbe anche un canale senza tetto, P2-D20).
    expect('pool' in esito).toBe(false); // covers: AC-224-3
    const esitoSerializzato = JSON.stringify(esito);
    expect(esitoSerializzato).not.toContain(TESTO_SANO); // covers: AC-224-3
    expect(esitoSerializzato).not.toContain('xxxxxxxxxx'); // covers: AC-224-3
  });

  // NON deriva da un AC: e' cio' che la firma di `runGenerationTurn` promette in JSDoc —
  // "l'allowlist degli slug di QUESTA generazione (T-213), che parsePool impone sul ritorno:
  // una pagina non prevista fa cadere l'intero pool" — ed e' l'unica proprieta' di SICUREZZA
  // del task. Fino a oggi nessun pool di prova conteneva una pagina FUORI allowlist, quindi
  // era intoccata da qualunque oracolo: misurato in verifica, si poteva passare a `parsePool`
  // una lista costante, allargare l'allowlist ai propri prefissi o annullarla del tutto
  // aggiungendo gli slug scritti dal modello, e la suite restava a 18/18.
  //
  // LA TABELLA CAMBIA SOLO L'ALLOWLIST: la risposta del modello e' la stessa in tutte e tre le
  // righe, quindi l'esito che cambia non puo' venire da nient'altro che dal turno. Ed e' anche
  // il punto in cui la coppia-prefisso degli slug smette di essere disciplina a vuoto: 'menu'
  // e 'menu-di-stagione' si fanno sbagliare nei due versi, e la terza riga impedisce che
  // l'oracolo sia soddisfatto da un confine che rifiuti sempre.
  for (const { caso, allowedSlugs, slugScritto, coppia, ammesso } of CASI_DELL_ALLOWLIST) {
    it(`allowlist degli slug (${caso}): la pagina e ${ammesso ? 'AMMESSA' : 'RIFIUTATA'}`, async () => {
      // Anti-vacuita' della riga: i due slug sono davvero una coppia-prefisso, e sono due.
      expect(slugScritto).not.toBe(coppia); // DoD T-224
      expect(coppia.startsWith(slugScritto) || slugScritto.startsWith(coppia)).toBe(true); // DoD T-224

      const { chiamate, client } = clientChe(
        rispostaDelModello([bloccoToolUse(poolConLaPagina(slugScritto))], 'tool_use'),
      );

      const esito = await runGenerationTurn({ ...TURNO, allowedSlugs }, client);
      chiamataUnica(chiamate, caso); // DoD T-224

      if (ammesso) {
        expect(successo(esito).pool).toEqual(poolConLaPagina(slugScritto)); // DoD T-224
        return;
      }

      const caduta = fallimento(esito);
      expect(caduta.reason).toBe('pool_non_valido'); // DoD T-224
      const issues = caduta.reason === 'pool_non_valido' ? caduta.error.issues : [];
      // Il path nomina lo slug RIFIUTATO per uguaglianza di segmento, e non l'altro della
      // coppia: un errore che nominasse il vicino manderebbe a cercare la pagina sbagliata.
      expect(issues.some((issue) => issue.path.includes(slugScritto))).toBe(true); // DoD T-224
      expect(issues.some((issue) => issue.path.includes(coppia))).toBe(false); // DoD T-224
      // NESSUN CONTENUTO PARZIALE: la pagina non prevista cade INTERA, testo compreso.
      expect('pool' in esito).toBe(false); // DoD T-224
      expect(JSON.stringify(esito)).not.toContain(TESTO_DELLA_PAGINA_NON_PREVISTA); // DoD T-224
    });
  }

  // IL VERSO CHE NESSUNA RISPOSTA DI PROVA PUO' OSSERVARE (vedi `spiaDelGate`). La tabella qui
  // sopra prova che una pagina fuori allowlist cade; questa prova che l'allowlist imposta al
  // gate e' ESATTAMENTE quella del turno, senza aggiunte — cioe' che il confine non allarga
  // per proprio conto la superficie che T-213 ha deciso.
  // MUTAZIONE CHE LO FA DIVENTARE ROSSO: in src/data/anthropic.ts,
  // `allowedSlugs: [...turn.allowedSlugs, 'pagina-mai-chiesta']` (o con 'home', che e'
  // l'aggiunta di comodo plausibile). Prima di questa riga: 133 verdi su 133.
  it("l'allowlist imposta al gate e ESATTAMENTE quella del turno, senza aggiunte", async () => {
    spiaDelGate.opzioni.length = 0;
    const allowedSlugs = ['home', 'menu-di-stagione'];
    const { client } = clientChe(
      rispostaDelModello([bloccoToolUse(poolConLaPagina('home'))], 'tool_use'),
    );

    await runGenerationTurn({ ...TURNO, allowedSlugs }, client);

    // Anti-vacuita': senza questa riga, un confine che non chiamasse affatto il gate passerebbe.
    expect(spiaDelGate.opzioni).toHaveLength(1); // DoD T-224
    expect(spiaDelGate.opzioni[0].allowedSlugs).toEqual(allowedSlugs); // DoD T-224
  });

  // NON deriva da un AC: e' la definition_of_done ("Nessuna guardia ritorna un pool parziale o
  // vuoto"). `chiamata.input` e' `unknown` e viene dal modello, ma ogni fixture del file gli
  // passava un oggetto ben formato: misurato, fondere un default `{ pages: {}, ...input }` nel
  // confine lasciava la suite verde, cioe' un input degenere sarebbe diventato un pool VUOTO
  // ACCETTATO — un successo senza contenuto, che e' la cosa che la DoD vieta per nome.
  // `parsePool` da solo si difende (T-213 lo prova); qui si prova il CABLAGGIO.
  for (const [forma, input] of INPUT_DEGENERI) {
    it(`input della tool-call degenere (${forma}): fallimento nominato, nessun pool`, async () => {
      const { chiamate, client } = clientChe(rispostaDelModello([bloccoToolUse(input)], 'tool_use'));

      const esito = await runGenerationTurn(TURNO, client);
      const caduta = fallimento(esito);

      expect(caduta.reason).toBe('pool_non_valido'); // DoD T-224
      expect('pool' in esito).toBe(false); // DoD T-224
      // L'errore dice DOVE, altrimenti "pool non valido" sarebbe un motivo senza contenuto.
      const issues = caduta.reason === 'pool_non_valido' ? caduta.error.issues : [];
      expect(issues.length).toBeGreaterThan(0); // DoD T-224
      chiamataUnica(chiamate, forma); // DoD T-224
    });
  }

  // NON deriva da un AC: e' la definition_of_done ("stop_reason diverso da tool_use ->
  // errore con codice"), nella meta' che gli AC non nominano — un turno che si e' fermato
  // per altro pur avendo prodotto un blocco tool_use. Prenderlo per buono vorrebbe dire
  // accettare la tool-call di un turno che non si e' chiuso chiamando il tool.
  //
  // IL CICLO E' TOTALE SUL TIPO DELL'SDK e non un campione di due: prima girava su
  // 'pause_turn' e 'refusal', cioe' sui due motivi a cui qualcuno aveva pensato, mentre
  // 'stop_sequence' e 'model_context_window_exceeded' — che e' il modo in cui un turno muore
  // per input troppo grande — non erano provati da nulla. `null` chiude la lista: il tipo
  // dell'SDK lo ammette, e un ritorno senza motivo non deve diventare un successo.
  for (const stopReason of [...(Object.keys(STOP_REASON_ANOMALI) as StopReasonAnomalo[]), null]) {
    it(`stop_reason ${String(stopReason)} con un blocco tool_use presente: errore nominato, nessun pool`, async () => {
      const { chiamate, client } = clientChe(
        rispostaDelModello([bloccoToolUse(POOL_VALIDO)], stopReason),
      );

      const esito = await runGenerationTurn(TURNO, client);

      expect(esito).toEqual({ ok: false, reason: 'stop_reason_anomalo', stop_reason: stopReason }); // DoD T-224
      expect('pool' in esito).toBe(false); // DoD T-224
      chiamataUnica(chiamate, `stop_reason ${String(stopReason)}`); // DoD T-224

      // IL CANALE E' LIMITATO PERCHE' IL VOCABOLARIO LO E'. `stop_reason` e' l'unica cosa che
      // viaggia nell'esito senza passare da un tetto, e il modulo lo argomenta: e' un valore
      // dell'ENUM dell'API, non testo scritto dal modello, quindi P2-D20 non si applica. Qui
      // l'argomento smette di essere un commento e diventa una misura — ogni motivo ammesso
      // sta sotto lo stesso tetto che vale per le stringhe che il modello scrive.
      expect(String(stopReason).length).toBeLessThanOrEqual(POOL_LIMITS.error_chars); // DoD T-224
    });
  }

  // covers: AC-224-4
  it('i parametri REALMENTE passati vengono da GENERATION_BUDGET, e il pensiero non e mai disabilitato', async () => {
    // ANTI-VACUITA' sulle fasi: sono piu' di una e i loro tetti sono DISCORDANTI. Con un
    // tetto solo (o due uguali) un confine che ignorasse la fase resterebbe verde.
    expect(FASI.length, 'meno di due fasi: il tetto per fase non sarebbe osservabile').toBeGreaterThan(1); // covers: AC-224-4
    expect(new Set(Object.values(GENERATION_BUDGET.max_tokens)).size).toBe(FASI.length); // covers: AC-224-4

    for (const fase of FASI) {
      const { chiamate, client } = clientChe(
        rispostaDelModello([bloccoToolUse(POOL_VALIDO)], 'tool_use'),
      );

      await runGenerationTurn({ ...TURNO, phase: fase }, client);

      chiamataUnica(chiamate, `fase ${fase}`); // covers: AC-224-4
      const { params, options } = chiamate[0];

      // IL SET DELLE CHIAVI, non i soli valori: ogni altra riga di questo file dice "questo
      // campo vale X" e nessuna dice "e non c'e' nient'altro". Misurato in verifica: un
      // `metadata` aggiunto al body lasciava la suite a 18/18, perche' l'oracolo anti-fuga
      // cerca i marcatori del BRIEF e un campo aggiunto DAL CONFINE gli e' invisibile per
      // costruzione. Le due liste sono ordinate per poterle confrontare in blocco.
      expect(Object.keys(params).sort()).toEqual([
        'max_tokens',
        'messages',
        'model',
        'output_config',
        'system',
        'thinking',
        'tools',
      ]); // DoD T-224
      expect(Object.keys(options ?? {}).sort()).toEqual(['maxRetries', 'timeout']); // DoD T-224

      expect(params.max_tokens, fase).toBe(GENERATION_BUDGET.max_tokens[fase]); // covers: AC-224-4
      // Le request options: se fossero finite nel BODY questa riga sarebbe rossa, ed e' il
      // solo posto in cui la differenza fra un timeout dichiarato e uno applicato si vede.
      expect(options?.timeout, fase).toBe(GENERATION_BUDGET.timeout_ms); // covers: AC-224-4
      expect(options?.maxRetries, fase).toBe(GENERATION_BUDGET.max_retries); // covers: AC-224-4
      expect('timeout' in params, 'timeout finito nel BODY invece che fra le request options').toBe(
        false,
      ); // covers: AC-224-4
      expect('maxRetries' in params, 'maxRetries finito nel BODY').toBe(false); // covers: AC-224-4

      // Il pensiero: adaptive, e per UGUAGLIANZA ESATTA dell'oggetto — cosi' non solo
      // 'disabled' e' escluso, ma anche un budget di pensiero fissato di nascosto (P2-D11).
      expect(params.thinking, fase).toEqual({ type: 'adaptive' }); // covers: AC-224-4
      expect(JSON.stringify(params.thinking)).not.toContain('disabled'); // covers: AC-224-4
      // L'effort e' l'altra meta' della stessa decisione (definition_of_done): e' la leva
      // che sostituisce il pensiero spento, quindi viene dal budget e non da un letterale.
      expect(params.output_config?.effort, fase).toBe(GENERATION_BUDGET.effort); // DoD T-224

      // Il payload assemblato da T-223 arriva al confine INTATTO: un confine che
      // rimontasse system, tool o messaggi riaprirebbe cio' che la proiezione ha chiuso.
      // Il system viaggia come UN blocco di testo perche' e' li' che sta il breakpoint di
      // cache (AC-224-8), ma il TESTO e' quello di T-223 senza un byte di differenza: e' la
      // condizione che AC-223-2 pinna, e un system riscritto qui la annullerebbe.
      expect(blocchiDiSistema(params.system)[0].text, fase).toBe(PAYLOAD.system); // DoD T-224
      expect(params.tools).toEqual(PAYLOAD.tools); // DoD T-224
      expect(params.messages).toEqual(PAYLOAD.messages); // DoD T-224
    }
  });

  // covers: AC-224-8
  // P2-D29 — IL BREAKPOINT DI CACHE. Senza di esso il prefisso identico byte per byte che
  // AC-223-2 pinna "perche' il prompt caching possa colpire" e' una proprieta' SENZA EFFETTO
  // (il colpo non avviene mai), e i due campi di cache di `usage` che la definition_of_done di
  // T-225 chiede di misurare restano costantemente nulli: la taratura di P2-D17 nascerebbe
  // cieca proprio sulla voce di costo che l'ordine cache-friendly del payload esiste per
  // abbattere. Il breakpoint sta in CODA alla parte stabile perche' un breakpoint copre tutto
  // cio' che lo PRECEDE, e l'API rende il prompt nell'ordine tools -> system -> messages.
  it('il breakpoint cache_control sta sulla coda della parte STABILE e su nessun blocco volatile', async () => {
    const { chiamate, client } = clientChe(
      rispostaDelModello([bloccoToolUse(POOL_VALIDO)], 'tool_use'),
    );

    await runGenerationTurn(TURNO, client);

    const { params } = chiamate[0];
    const blocchi = blocchiDiSistema(params.system);
    const coda = blocchi[blocchi.length - 1];

    expect(coda.cache_control).toEqual({ type: 'ephemeral' }); // covers: AC-224-8
    // La coda della parte stabile e' il system, e il suo testo e' quello di T-223: un
    // breakpoint su un system riscritto dal confine cacherebbe un prefisso che nessun altro
    // turno produce, cioe' pagherebbe la scrittura e non rileggerebbe mai.
    expect(coda.text).toBe(PAYLOAD.system); // covers: AC-224-8

    // NESSUNO SULLA PARTE VOLATILE: quella cambia a ogni cliente, e un breakpoint li'
    // sarebbe una scrittura di cache pagata e mai riletta.
    expect(JSON.stringify(params.messages)).not.toContain('cache_control'); // covers: AC-224-8
    // E UNO SOLO IN TUTTA LA RICHIESTA: ogni breakpoint in piu' e' una scrittura in piu'.
    // Il conto e' sulla richiesta INTERA, quindi vale anche per il tool (che oggi non ne
    // porta) e prende sia il breakpoint mancante sia quello di troppo.
    expect(JSON.stringify(params).match(/cache_control/g)).toHaveLength(1); // covers: AC-224-8
  });

  // covers: AC-224-6
  it('il modello e il default dichiarato senza env, e il valore della env quando e impostata', async () => {
    delete process.env.ANTHROPIC_MODEL_GENERATION;
    const senzaEnv = clientChe(rispostaDelModello([bloccoToolUse(POOL_VALIDO)], 'tool_use'));

    await runGenerationTurn(TURNO, senzaEnv.client);

    expect(senzaEnv.chiamate[0].params.model).toBe('claude-sonnet-5'); // covers: AC-224-6
    expect(senzaEnv.chiamate[0].params.model).toBe(getAnthropicGenerationModel()); // covers: AC-224-6

    // Il secondo valore e DIVERSO dal default e non e' scelto a caso: e' il modello che le
    // security_notes di T-224 nominano come attivabile con una env.
    process.env.ANTHROPIC_MODEL_GENERATION = 'claude-opus-5';
    const conEnv = clientChe(rispostaDelModello([bloccoToolUse(POOL_VALIDO)], 'tool_use'));

    await runGenerationTurn(TURNO, conEnv.client);

    expect(conEnv.chiamate[0].params.model).toBe('claude-opus-5'); // covers: AC-224-6
    expect(conEnv.chiamate[0].params.model).toBe(getAnthropicGenerationModel()); // covers: AC-224-6
    // I due valori sono DIVERSI: senza questa riga un accessor che ignorasse l'ambiente
    // (o un default uguale al valore impostato) passerebbe entrambe le letture.
    expect(conEnv.chiamate[0].params.model).not.toBe(senzaEnv.chiamate[0].params.model); // covers: AC-224-6
  });

  // NON deriva da un AC: e' la definition_of_done ("Il client SDK e' un parametro iniettabile
  // con default lazy, come runOnboardingTurn"). Finora la lazy-ness era affermata in un
  // COMMENTO in testa al file — "il fatto stesso che questo file importi @/data/anthropic
  // senza chiave dimostra che il client non nasce all'import" — e quella prova dipende
  // dall'ASSENZA della chiave nell'ambiente: in una CI con ANTHROPIC_API_KEY configurata
  // sparirebbe in silenzio. Qui la chiave viene tolta DENTRO il caso, quindi la prova vale in
  // entrambi gli ambienti, e dice anche la meta' che il commento non diceva: il client di
  // default nasce alla PRIMA CHIAMATA e fallisce li', nominando cio' che manca.
  it('senza client iniettato il confine costruisce il suo alla PRIMA chiamata (default lazy)', async () => {
    const chiaveNellAmbiente = process.env.ANTHROPIC_API_KEY;
    try {
      delete process.env.ANTHROPIC_API_KEY;
      await expect(async () => {
        await runGenerationTurn(TURNO);
      }).rejects.toThrowError(/ANTHROPIC_API_KEY/); // DoD T-224
    } finally {
      if (chiaveNellAmbiente !== undefined) process.env.ANTHROPIC_API_KEY = chiaveNellAmbiente;
    }
  });
});
