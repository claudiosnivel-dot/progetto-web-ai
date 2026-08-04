// T-225 (macrotask generation-llm, P2) — HARNESS DI MISURA REALE DEI TOKEN. E' la sede
// della taratura rinviata da P2-D17: le costanti di GENERATION_BUDGET sono stime a
// tavolino, `count_tokens` e' un endpoint dell'API, e senza chiave non esiste alcun modo
// di contare i token per davvero.
//
// LA REGOLA CHE GOVERNA IL FILE, e che vale piu' di tutto il resto: in ASSENZA di chiave
// lo script dichiara NON ESEGUITO, esce con un codice DEDICATO e non scrive alcun
// rapporto. Un harness che senza chiave uscisse con successo dichiarerebbe MISURATO cio'
// che non e' stato misurato: e' la forma piu' diretta del divieto di falso via libera
// (L-COL-006), ed e' l'unica proprieta' di questo file che un oracolo possa provare oggi.
//
// NON PARTECIPA AL VERDETTO DEL CHECKPOINT. `vitest.config.ts` raccoglie
// 'tests/**/*.test.ts(x)': questo file sta fuori da quel glob, quindi non puo' rendere la
// suite ne' verde ne' rossa da solo (AC-225-4, asserito leggendo la configurazione vera).
//
// PERCHE' MISURA ATTRAVERSO runGenerationTurn invece di costruire la richiesta da se':
// perche' cio' che va misurato e' la richiesta VERA, con i suoi parametri, il suo tool e
// il suo prompt. Un harness che assemblasse una richiesta propria misurerebbe se stesso, e
// il giorno in cui il confine cambiasse un parametro la misura resterebbe verde e falsa.
// L'harness passa quindi al confine un client che REGISTRA le risposte, e legge `usage`
// da li'. Resta un costo dichiarato: per registrare le risposte serve un'istanza del
// client SDK, e questo file e' percio' il secondo posto del repo che ne costruisce una
// (il primo, e l'unico che ne compone i parametri, resta src/data/anthropic.ts — P1-D7).
//
// PERCHE' I MODULI DEL PROGETTO SONO INIETTATI invece che importati. `node` non risolve
// l'alias '@/' di tsconfig, e i moduli del progetto si importano fra loro proprio con
// quell'alias: un import statico non si risolverebbe a runtime. La logica sta percio' in
// funzioni ESPORTATE che ricevono i moduli come parametro — lo stesso principio con cui
// runOnboardingTurn riceve il client — e la parte CLI, dietro la guardia di entry-point in
// fondo, registra un resolve hook e li importa in modo dinamico. Cosi' il test chiama
// quelle funzioni passando i moduli VERI e un solo doppio, senza rete e senza chiave.
//
// COSTO DICHIARATO DELLA FORMA. Il file e' un `.ts` sotto scripts/ e non un `.mjs`: cosi'
// `tsc --noEmit` (che include '**/*.ts') typechecka anche il cablaggio della CLI, che e'
// la sola parte che nessun oracolo esegue. In cambio, per lanciarlo serve un `node` con lo
// stripping dei tipi attivo di default (>= 22.18) — se non c'e', il programma non parte
// affatto: un fallimento rumoroso, non una misura silenziosamente sbagliata.

import { registerHooks } from 'node:module';
import { realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import type { Brief } from '@/domain/onboarding/brief';
import type { ProjectionProfile } from '@/domain/generation/projection';

/**
 * I moduli del progetto di cui l'harness ha bisogno, iniettati in blocco (vedi la nota in
 * testa al file). Il tipo li DERIVA dai moduli veri: un export rinominato altrove e' un
 * errore di typecheck qui, non una sorpresa alla prima esecuzione con la chiave.
 */
export type ModuliDelProgetto = {
  readonly budget: typeof import('@/domain/generation/budget');
  readonly projection: typeof import('@/domain/generation/projection');
  readonly slots: typeof import('@/domain/generation/slots');
  readonly tool: typeof import('@/domain/generation/tool');
  readonly prompt: typeof import('@/domain/generation/prompt');
  readonly brief: typeof import('@/domain/onboarding/brief');
  readonly confine: typeof import('@/data/anthropic');
};

type Budget = ModuliDelProgetto['budget']['GENERATION_BUDGET'];

/** La fase del turno: sono le CHIAVI dei tetti di uscita, non un vocabolario nuovo. */
type FaseDiBudget = keyof Budget['max_tokens'];

/** Il client del confine, DERIVATO dalla firma di runGenerationTurn: e' il seam di mock. */
type ClientDelConfine = NonNullable<
  Parameters<ModuliDelProgetto['confine']['runGenerationTurn']>[1]
>;

/**
 * I codici di uscita, nella convenzione sysexits perche' e' quella che un runner di CI sa
 * gia' leggere: 0 e' la misura eseguita, 64 e' un uso sbagliato del comando, 78 e' una
 * configurazione mancante. Cio' che conta per AC-225-1 e' che il ramo SENZA CHIAVE abbia
 * un codice proprio, distinto sia dal successo sia dall'errore generico (1): un 1 direbbe
 * "e' andata male", mentre qui bisogna dire "non e' stata fatta".
 */
export const USCITA = {
  /** La misura e' stata eseguita e il rapporto e' stato scritto. */
  eseguita: 0,
  /** Argomenti sbagliati: manca il percorso del rapporto. */
  uso_errato: 64,
  /** NON ESEGUITA per assenza della chiave. Nessun rapporto scritto. */
  senza_chiave: 78,
} as const;

const USO = 'uso: node scripts/measure-generation-usage.ts <percorso-del-rapporto>';

// Il messaggio nomina la VARIABILE, mai il suo valore: la chiave non compare nell'output
// e non compare nel rapporto (security_notes di T-225).
const MESSAGGIO_SENZA_CHIAVE = [
  'measure-generation-usage: NON ESEGUITO.',
  "Manca ANTHROPIC_API_KEY nell'ambiente. Senza chiave non esiste alcuna misura dei token:",
  "l'harness non scrive alcun rapporto e non dichiara eseguito cio' che non ha eseguito.",
  'La taratura di GENERATION_BUDGET resta rinviata (P2-D17).',
].join('\n');

/**
 * Il profilo di proiezione di ciascuna fase (P2-D13): la fase 1 e' la home su cui il
 * titolare sceglie fra le varianti, la fase 2 sono le pagine interne. Il record e' TOTALE
 * sul tipo della fase: una fase aggiunta a GENERATION_BUDGET senza decidere quale
 * proiezione misurarle rompe il typecheck invece di restare fuori dalla misura in silenzio.
 */
const PROFILO_DELLA_FASE: Record<FaseDiBudget, ProjectionProfile> = {
  phase1: 'home',
  phase2_chunk: 'inner',
};

/**
 * Quante volte ciascuna fase entra nel costo di UN sito: e' la stessa composizione con cui
 * AC-223-4 calcola il bound a tavolino (una fase 1 piu' `phase2_chunks_per_site` chunk).
 * Misurare un chunk solo e moltiplicarlo e' cio' che rende confrontabili misura e stima.
 */
const RIPETIZIONI_PER_SITO: Record<FaseDiBudget, (budget: Budget) => number> = {
  phase1: () => 1,
  phase2_chunk: (budget) => budget.phase2_chunks_per_site,
};

/**
 * Gli slug su cui misurare la fase 2. Sono nomi PLAUSIBILI e non i veri (quelli li decide
 * T-213 sito per sito), e ne servono `pages_per_chunk`: l'elenco e' piu' lungo del chunk
 * di proposito, cosi' alzare `pages_per_chunk` non fa scivolare la misura su meno pagine
 * di quelle dichiarate. Che il conteggio torni davvero e' asserito sul tool passato al
 * confine, non lasciato a questo commento.
 */
const SLUG_DELLE_PAGINE_INTERNE = [
  'menu',
  'menu-di-stagione',
  'orari',
  'contatti',
  'recensioni',
  'domande-frequenti',
] as const;

/** Le pagine richieste da ciascuna fase: la sola home in fase 1, un chunk in fase 2. */
const PAGINE_DELLA_FASE: Record<FaseDiBudget, (budget: Budget) => readonly string[]> = {
  phase1: () => ['home'],
  phase2_chunk: (budget) => SLUG_DELLE_PAGINE_INTERNE.slice(0, budget.pages_per_chunk),
};

/** Un milione, cioe' l'unita' in cui l'API pubblica i prezzi. */
const TOKEN_PER_MILIONE = 1_000_000;

/**
 * I quattro campi di `usage` che T-225 registra. `cache_creation_input_tokens` e
 * `cache_read_input_tokens` restano `number | null` come li da' l'API: appiattirli a zero
 * direbbe "misurati zero token di cache" al posto di "non misurati", e sono proprio quei
 * due a dire se il prefisso cacheabile di T-223 sta colpendo.
 */
export type UsoDelTurno = {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens: number | null;
  readonly cache_read_input_tokens: number | null;
};

// I QUATTRO TIPI CHE SEGUONO SONO LOCALI, e non lo erano: `MisuraDelTurno`,
// `CostanteSuperata`, `RapportoDiMisura` e la voce del campione erano `export` con ZERO usi
// fuori da questo modulo (misurato: grep su src/, tests/, scripts/). Non se n'era accorto
// nessuno perche' il `project` di knip.json era 'src/**' + 'tests/**': l'oracolo dead-code
// non guardava affatto questa directory (P2-D27, chiuso insieme al perimetro di lint).
// Restano tipi di ritorno di funzioni esportate — TypeScript li usa strutturalmente senza
// bisogno del nome, e cio' che il chiamante deve poter NOMINARE e' solo `UsoDelTurno`.

/** Una misura: un brief, una fase, e cio' che quel turno ha consumato davvero. */
type MisuraDelTurno = {
  readonly brief: string;
  readonly fase: FaseDiBudget;
  readonly profilo: ProjectionProfile;
  readonly usage: UsoDelTurno;
};

/**
 * Una costante di GENERATION_BUDGET che la misura ha superato. `costante` e' il NOME
 * completo con cui leggerla nel modulo: il rapporto deve dire QUALE numero rivedere, non
 * che "il budget e' stretto".
 */
type CostanteSuperata = {
  readonly costante: string;
  readonly dichiarato: number;
  readonly misurato: number;
  readonly dove: string;
};

/** Il rapporto: le misure, il loro totale, e le costanti che la realta' ha superato. */
type RapportoDiMisura = {
  readonly misure: readonly MisuraDelTurno[];
  readonly totali: { readonly [Campo in keyof UsoDelTurno]: number };
  readonly superamenti: readonly CostanteSuperata[];
};

/**
 * Una voce del campione: un nome con cui leggerla nel rapporto e il brief da misurare.
 * Si chiama `VoceDaMisurare` e non `VoceDelCampione` perche' quel nome e' gia' preso, con un
 * significato DIVERSO, da src/domain/generation/projection.ts (li' e' una voce del campione
 * delle OFFERTE): due tipi omonimi che parlano di due cose diverse nello stesso sottosistema
 * sono il difetto contro cui mette in guardia il commento in testa a slots.ts.
 */
type VoceDaMisurare = {
  readonly nome: string;
  readonly brief: Brief;
};

/** Una voce del campione PRIMA dello schema: il nome, il locale e la patch da applicare. */
type VoceDiProva = {
  readonly nome: string;
  readonly locale: Brief['locale'];
  readonly patch: object;
};

/**
 * La prosa con cui si riempiono i campi del brief AI TETTI, e la scelta non e' estetica:
 * riempire con una stessa lettera ripetuta ('xxxx...') darebbe la stessa taglia in CODE UNIT
 * e un conteggio di TOKEN molto piu' basso del vero — una lunga corsa dello stesso carattere
 * si comprime in pochissimi token —, cioe' proprio la misura ottimista in silenzio che questo
 * file esiste per impedire. E' testo inventato: nel campione non entrano dati reali di
 * clienti (security_notes di T-225).
 */
const PROSA_DI_RIEMPIMENTO = [
  'El local abre cada manana junto al muelle y la carta cambia con lo que llega del mar.',
  'Los clientes piden mesa fuera cuando amaina el viento y el sol da en la fachada azul.',
].join(' ');

/** Una stringa ESATTAMENTE al tetto passato, riconoscibile dalla testa. */
function alTetto(limite: number, testa: string): string {
  const ripetizioni = Math.ceil(limite / PROSA_DI_RIEMPIMENTO.length) + 1;
  return `${testa} ${PROSA_DI_RIEMPIMENTO.repeat(ripetizioni)}`.slice(0, limite);
}

/**
 * IL CAMPIONE DI PROVA, e non e' un dettaglio di comodo: qui non entrano dati reali di
 * clienti (security_notes di T-225), quindi sono due brief scritti apposta.
 *
 * I DUE SONO DISCORDANTI perche' una misura su un caso solo non dice nulla sulla forbice, e
 * i due estremi della forbice sono proprio questi: uno SCARNO (un brief appena compilato,
 * senza catalogo) e uno AI TETTI DI P1-D17. Locale diverso, quindi system prompt diverso
 * (T-223), e vertical diverso.
 *
 * IL SECONDO E' AI TETTI PER DECISIONE (P2-D31), non per abbondanza. Il campione precedente
 * produceva una proiezione da 296-702 code unit, cioe' l'1,7-4,4% di PROJECTION_LIMITS
 * (16.000/17.000, tarati sul caso peggiore MISURATO di 14.714/14.786): sul lato USCITA
 * l'harness usa deliberatamente tutti e diciassette gli slot del catalogo, mentre sul lato
 * INGRESSO stava al 2-4% del caso peggiore. Con quel campione il superamento che AC-225-3
 * esiste per far scattare non poteva scattare dal lato ingresso, e la taratura di
 * GENERATION_BUDGET.projection.* sarebbe nata strutturalmente muta.
 *
 * OGNI OFFERTA HA UNA SEZIONE DIVERSA: e' la forma piu' pesante del profilo 'inner', dove il
 * campione raggruppato paga il nome della sezione una volta per gruppo e i gruppi sono tanti
 * quante le voci.
 *
 * IL NOME DEL PRIMO E' PREFISSO DEL NOME DEL SECONDO, cosi' un rapporto che attribuisse le
 * misure per prefisso invece che per uguaglianza si vede mentre sbaglia.
 *
 * @param limiti BRIEF_LIMITS (P1-D17), letti dal modulo del Brief e non ricopiati: e' l'unico
 *   modo perche' "ai tetti" resti vero il giorno in cui un tetto cambia.
 */
function campioneDiProva(
  limiti: ModuliDelProgetto['brief']['BRIEF_LIMITS'],
): readonly VoceDiProva[] {
  return [
    {
      nome: 'bar',
      locale: 'it',
      patch: {
        business_name: 'Bar Sole',
        vertical: 'ristorazione',
        description: 'Caffetteria di quartiere, colazioni e aperitivi, aperta dal 1998.',
        primary_goal: 'contatta',
        brand_hints: 'Tono familiare, legno chiaro, niente enfasi.',
        highlights: ['Torte fatte in casa', 'Dehors sulla piazza'],
      },
    },
    {
      nome: 'bar-ai-tetti',
      locale: 'es',
      patch: {
        business_name: alTetto(limiti.business_name, 'Bar del Puerto Grande:'),
        vertical: 'negozio_artigiano',
        description: alTetto(limiti.description, 'Tienda y bar junto al puerto:'),
        primary_goal: 'ordina',
        brand_hints: alTetto(limiti.brand_hints, 'Marinero sin topicos:'),
        highlights: Array.from({ length: limiti.highlights_items }, (_ignorato, indice) =>
          alTetto(limiti.highlight, `Punto ${indice}:`),
        ),
        offerings: Array.from({ length: limiti.offerings_items }, (_ignorato, indice) => ({
          name: alTetto(limiti.offering_name, `Voce ${indice}:`),
          section: alTetto(limiti.offering_section, `Seccion ${indice}:`),
          description: alTetto(limiti.offering_description, `Desc ${indice}:`),
          price: alTetto(limiti.offering_price, `${indice},`),
          photo_ref: alTetto(limiti.offering_photo_ref, `foto-${indice}-`),
        })),
      },
    },
  ];
}

/**
 * Costruisce il campione di misura dai brief di prova, facendoli passare dallo schema del
 * Brief (T-121).
 *
 * @param moduli i moduli del progetto (vedi la nota in testa al file).
 * @returns le voci del campione, nell'ordine dichiarato.
 * @throws se una patch viene SCARTATA: un campione a cui manca un campo misurerebbe una
 *   proiezione piu' leggera del vero, e la taratura ne uscirebbe ottimista in silenzio.
 */
export function costruisciCampione(moduli: ModuliDelProgetto): readonly VoceDaMisurare[] {
  return campioneDiProva(moduli.brief.BRIEF_LIMITS).map((voce) => {
    const { brief, rejected } = moduli.brief.applyBriefUpdate(
      moduli.brief.emptyBrief(voce.locale),
      voce.patch,
    );
    if (rejected.length > 0) {
      throw new Error(`campione '${voce.nome}': campi scartati (${rejected.join(', ')})`);
    }
    return { nome: voce.nome, brief };
  });
}

/**
 * Dice se la chiave e' configurata, SENZA farla uscire da qui: il tipo di ritorno e' un
 * booleano, quindi il valore non puo' finire ne' nell'output ne' nel rapporto.
 *
 * @param leggiLaChiave l'accessor di config (T-130), che lancia nominando la variabile
 *   quando manca o e' vuota. Iniettato perche' anche quel modulo si raggiunge solo con
 *   l'alias '@/', e perche' cosi' i due rami sono provabili senza toccare l'ambiente.
 * @returns true se l'accessor consegna una chiave, false se dichiara che non c'e'.
 */
export function chiaveConfigurata(leggiLaChiave: () => string): boolean {
  try {
    leggiLaChiave();
    return true;
  } catch {
    return false;
  }
}

/**
 * Il client che REGISTRA le risposte del confine, senza toccare la richiesta: e' l'unico
 * modo di leggere `usage` continuando a far comporre la richiesta a runGenerationTurn, che
 * il pool lo restituisce validato e la risposta grezza no.
 */
function clientCheRegistra(client: ClientDelConfine) {
  const risposte: Anthropic.Message[] = [];
  const registratore: ClientDelConfine = {
    messages: {
      async create(params, options) {
        const risposta = await client.messages.create(params, options);
        risposte.push(risposta);
        return risposta;
      },
    },
  };
  return { risposte, registratore };
}

/** I soli quattro campi di `usage` che il rapporto registra (definition_of_done di T-225). */
function usoDelTurno(risposta: Anthropic.Message): UsoDelTurno {
  return {
    input_tokens: risposta.usage.input_tokens,
    output_tokens: risposta.usage.output_tokens,
    cache_creation_input_tokens: risposta.usage.cache_creation_input_tokens,
    cache_read_input_tokens: risposta.usage.cache_read_input_tokens,
  };
}

/**
 * Il costo di un turno, in USD, coi prezzi dichiarati in GENERATION_BUDGET.
 *
 * LIMITE DICHIARATO: i token di cache si pagano ad ALTRE tariffe (la scrittura piu' della
 * lettura, la lettura molto meno dell'input) e GENERATION_BUDGET non le dichiara. Questo
 * costo e' percio' una SOTTOSTIMA quando la cache e' in gioco — cioe' segnala il tetto di
 * spesa superato meno spesso del vero, mai piu' spesso.
 */
function costoInUsd(uso: UsoDelTurno, budget: Budget): number {
  const input = uso.input_tokens * budget.usd_per_million_tokens.input;
  const output = uso.output_tokens * budget.usd_per_million_tokens.output;
  return (input + output) / TOKEN_PER_MILIONE;
}

/** Il totale di un campo su tutte le misure, col null contato zero (non e' un valore). */
function totale(misure: readonly MisuraDelTurno[], campo: keyof UsoDelTurno): number {
  return misure.reduce((somma, misura) => somma + (misura.usage[campo] ?? 0), 0);
}

/**
 * Misura l'uso di token del campione: per ciascun brief e ciascuna fase esegue un turno di
 * generazione VERO (T-224) attraverso il client passato, ne registra `usage`, e confronta
 * la misura con le costanti di GENERATION_BUDGET.
 *
 * @param campione i brief da misurare, con il nome con cui compaiono nel rapporto.
 * @param client il client del confine: quello reale quando c'e' la chiave, un doppio nei
 *   test. E' il solo punto in cui questa funzione tocca il mondo.
 * @param moduli i moduli del progetto (vedi la nota in testa al file).
 * @returns le misure, il loro totale e le costanti che la misura ha superato, NOMINATE.
 */
export async function misuraCampione(
  campione: readonly VoceDaMisurare[],
  client: ClientDelConfine,
  moduli: ModuliDelProgetto,
): Promise<RapportoDiMisura> {
  const budget = moduli.budget.GENERATION_BUDGET;
  // Tutti gli slot del catalogo: e' il caso peggiore su cui i tetti di uscita sono stati
  // stimati (vedi il commento di GENERATION_BUDGET.max_tokens), quindi e' il caso su cui
  // vanno tarati.
  const slotDelCatalogo = moduli.slots.SLOTS.map((slot) => slot.id);
  const fasi = Object.keys(PROFILO_DELLA_FASE) as FaseDiBudget[];
  const misure: MisuraDelTurno[] = [];
  const superamenti: CostanteSuperata[] = [];

  for (const voce of campione) {
    let costoDelSito = 0;

    for (const fase of fasi) {
      const profilo = PROFILO_DELLA_FASE[fase];
      const pagine = PAGINE_DELLA_FASE[fase](budget);
      const tool = moduli.tool.buildPoolTool(slotDelCatalogo, pagine);
      const payload = moduli.prompt.buildGenerationPayload(
        moduli.projection.briefProjection(voce.brief, profilo),
        tool,
        profilo,
      );

      const { risposte, registratore } = clientCheRegistra(client);
      // L'ESITO SI SCARTA di proposito: che il pool sia valido e' l'oracolo di T-224, qui
      // si misura cio' che il turno e' COSTATO — e un turno costa anche quando il modello
      // risponde male. runGenerationTurn chiama `create` una volta sola e attende, quindi
      // dopo l'await il registratore ha esattamente una risposta.
      await moduli.confine.runGenerationTurn(
        { payload, phase: fase, allowedSlugs: pagine },
        registratore,
      );
      const usage = usoDelTurno(risposte[0]);
      misure.push({ brief: voce.nome, fase, profilo, usage });

      // IL TETTO DI PROIEZIONE, letto in token col proxy di P2-D17. Il confronto e' con
      // `input_tokens`, che comprende anche il tool e il system prompt: e' voluto, perche'
      // e' proprio questa costante che AC-223-4 usa come INTERO lato input del bound di
      // costo. Se la misura la supera, il bound e' sottostimato — quale delle tre parti sia
      // cresciuta lo dice il rapporto messo accanto ai tetti di T-220.
      const tettoDellInput = budget.projection[profilo] / budget.code_unit_per_token;
      if (usage.input_tokens > tettoDellInput) {
        superamenti.push({
          costante: `GENERATION_BUDGET.projection.${profilo}`,
          dichiarato: tettoDellInput,
          misurato: usage.input_tokens,
          dove: `${voce.nome} / ${fase}`,
        });
      }

      if (usage.output_tokens > budget.max_tokens[fase]) {
        superamenti.push({
          costante: `GENERATION_BUDGET.max_tokens.${fase}`,
          dichiarato: budget.max_tokens[fase],
          misurato: usage.output_tokens,
          dove: `${voce.nome} / ${fase}`,
        });
      }

      costoDelSito += RIPETIZIONI_PER_SITO[fase](budget) * costoInUsd(usage, budget);
    }

    if (costoDelSito > budget.max_cost_per_site_usd) {
      superamenti.push({
        costante: 'GENERATION_BUDGET.max_cost_per_site_usd',
        dichiarato: budget.max_cost_per_site_usd,
        misurato: costoDelSito,
        dove: voce.nome,
      });
    }
  }

  return {
    misure,
    totali: {
      input_tokens: totale(misure, 'input_tokens'),
      output_tokens: totale(misure, 'output_tokens'),
      cache_creation_input_tokens: totale(misure, 'cache_creation_input_tokens'),
      cache_read_input_tokens: totale(misure, 'cache_read_input_tokens'),
    },
    superamenti,
  };
}

/**
 * Scrive il rapporto nel percorso richiesto: JSON indentato, con l'a-capo finale.
 *
 * E' ESPORTATA, e non era: AC-225-2 parla del report PRODOTTO e la definition_of_done chiede
 * di scriverlo, ma `writeFileSync` e `JSON.stringify` vivevano dentro `main`, che nessun
 * oracolo puo' chiamare — cosi' l'unica parte della DoD che NON richiede una chiave era anche
 * l'unica non esercitata. Qui non si tocca alcun segreto: nel rapporto finiscono soltanto
 * numeri, nomi di costante e i nomi del campione (che sono scritti in questo file).
 *
 * @param percorso il percorso del file da scrivere, deciso da chi lancia il programma.
 * @param rapporto il rapporto restituito da `misuraCampione`.
 */
export function scriviIlRapporto(percorso: string, rapporto: RapportoDiMisura): void {
  writeFileSync(percorso, `${JSON.stringify(rapporto, null, 2)}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// LA PARTE CLI. Da qui in giu' nulla e' esercitato da un oracolo, e non per pigrizia:
// oltre il controllo sulla chiave servirebbe una chiave. E' typecheckata (`tsc --noEmit`
// guarda anche scripts/**/*.ts) ma non eseguita, ed e' il costo dichiarato di T-225.

/** La radice del repo, DERIVATA dalla posizione di questo file: non dipende dal cwd. */
const RADICE = new URL('../', import.meta.url);

const PREFISSO_ALIAS = '@/';

/**
 * Insegna a `node` le due risoluzioni che qui non ci sono e che sotto vitest arrivano da
 * `vitest.config.ts`:
 *  - l'alias '@/' di tsconfig, che node ignora del tutto (`paths` e' roba del typecheck e
 *    dei bundler): senza questo hook nessun modulo del progetto si carica;
 *  - 'server-only', che fuori dalla condizione react-server LANCIA all'import — e il
 *    confine (src/data/anthropic.ts) lo dichiara come prima riga. E' la stessa risoluzione
 *    al suo `empty.js` che i test dichiarano, e per la stessa ragione: quella direttiva
 *    difende il BUNDLE del browser, e qui non c'e' bundle — c'e' un programma che gira
 *    server-side per definizione.
 */
function registraLaRisoluzioneDelProgetto(): void {
  registerHooks({
    resolve(specificatore, contesto, prossimo) {
      if (specificatore.startsWith(PREFISSO_ALIAS)) {
        const percorso = `src/${specificatore.slice(PREFISSO_ALIAS.length)}.ts`;
        return { url: new URL(percorso, RADICE).href, shortCircuit: true };
      }
      if (specificatore === 'server-only') {
        const vuoto = new URL('node_modules/server-only/empty.js', RADICE);
        return { url: vuoto.href, shortCircuit: true };
      }
      return prossimo(specificatore, contesto);
    },
  });
}

/**
 * Il programma: senza chiave dichiara NON ESEGUITO, altrimenti misura il campione e scrive
 * il rapporto nel percorso richiesto.
 *
 * @param argomenti gli argomenti dopo il nome dello script: il primo e' il percorso del
 *   rapporto. Non c'e' un default: dove finisce un artefatto di misura lo decide chi lo
 *   lancia, e un default nel repo sarebbe un file che prima o poi qualcuno committa.
 * @returns il codice di uscita del processo.
 */
async function main(argomenti: readonly string[]): Promise<number> {
  const percorsoDelRapporto = argomenti[0];
  if (percorsoDelRapporto === undefined) {
    process.stderr.write(`${USO}\n`);
    return USCITA.uso_errato;
  }

  registraLaRisoluzioneDelProgetto();
  const config = await import('@/config/env');

  // IL CONTROLLO VIENE PRIMA DI TUTTO IL RESTO, e prima di qualunque scrittura: e' la
  // proprieta' che AC-225-1 asserisce eseguendo davvero il processo.
  if (!chiaveConfigurata(() => config.getAnthropicApiKey())) {
    process.stderr.write(`${MESSAGGIO_SENZA_CHIAVE}\n`);
    return USCITA.senza_chiave;
  }

  const moduli: ModuliDelProgetto = {
    budget: await import('@/domain/generation/budget'),
    projection: await import('@/domain/generation/projection'),
    slots: await import('@/domain/generation/slots'),
    tool: await import('@/domain/generation/tool'),
    prompt: await import('@/domain/generation/prompt'),
    brief: await import('@/domain/onboarding/brief'),
    confine: await import('@/data/anthropic'),
  };

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: config.getAnthropicApiKey() });
  const rapporto = await misuraCampione(costruisciCampione(moduli), client, moduli);

  // Nel rapporto finiscono soltanto numeri e nomi di costante: nessuna chiave, e nessun
  // dato di cliente (il campione e' scritto in questo file).
  scriviIlRapporto(percorsoDelRapporto, rapporto);

  process.stdout.write(`rapporto di misura scritto in ${percorsoDelRapporto}\n`);
  if (rapporto.superamenti.length === 0) {
    process.stdout.write('nessuna costante di GENERATION_BUDGET superata dalla misura\n');
  }
  for (const superamento of rapporto.superamenti) {
    process.stdout.write(
      `SUPERATA ${superamento.costante}: dichiarato ${superamento.dichiarato}, ` +
        `misurato ${superamento.misurato} (${superamento.dove})\n`,
    );
  }
  return USCITA.eseguita;
}

/**
 * Vero quando `node` ha LANCIATO questo file, falso quando un altro modulo lo importa —
 * che e' cio' che fa il test. Serve perche' importarlo non deve registrare alcun hook di
 * risoluzione: sotto vitest il resolver e' quello del runner e va lasciato stare.
 *
 * I DUE PERCORSI SI CONFRONTANO RISOLTI, e non e' pignoleria: dietro un symlink node mette
 * in `argv[1]` il percorso come e' stato scritto e in `import.meta.url` quello reale, e un
 * confronto letterale renderebbe il programma un NO-OP CHE ESCE ZERO — cioe' proprio il
 * falso via libera che questo file esiste per impedire, nella sua forma peggiore.
 */
function eseguitoComeProgramma(): boolean {
  const principale = process.argv[1];
  if (principale === undefined) return false;
  return realpathSync(principale) === realpathSync(fileURLToPath(import.meta.url));
}

if (eseguitoComeProgramma()) {
  process.exitCode = await main(process.argv.slice(2));
}
