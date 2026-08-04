import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, matchesGlob, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropicApiKey } from '@/config/env';
import * as moduloBudget from '@/domain/generation/budget';
import * as moduloProiezione from '@/domain/generation/projection';
import type { ProjectionProfile } from '@/domain/generation/projection';
import * as moduloSlot from '@/domain/generation/slots';
import * as moduloTool from '@/domain/generation/tool';
import * as moduloPrompt from '@/domain/generation/prompt';
import * as moduloBrief from '@/domain/onboarding/brief';
import * as moduloConfine from '@/data/anthropic';
import configurazioneDeiTest from '../vitest.config';
import {
  USCITA,
  chiaveConfigurata,
  costruisciCampione,
  misuraCampione,
  scriviIlRapporto,
  type ModuliDelProgetto,
  type UsoDelTurno,
} from '../scripts/measure-generation-usage';

// T-225 (macrotask generation-llm, P2) — l'HARNESS DI MISURA REALE DEI TOKEN (P2-D17). Le
// asserzioni derivano dagli acceptance_criteria AC-225-1..5 (03-generation-llm.md).
//
// COSA QUESTO FILE PROVA, e va detto prima di tutto il resto: che l'harness si comporti
// come dichiara QUANDO IL CONFINE E' UN DOPPIO. Non prova alcuna misura — non esiste una
// chiave API, `count_tokens` e' un endpoint, e i numeri di usage qui sotto sono SCRITTI,
// non osservati. Le due proprieta' che valgono davvero fuori da questo file sono quella di
// AC-225-1 (senza chiave l'harness dichiara NON ESEGUITO e non produce alcun verde) e
// quella di AC-225-5 (la directory che lo ospita e' dentro il perimetro dei confini). Il
// resto e' contratto sul nostro lato, e la taratura vera resta rinviata (P2-D17).
//
// CIO' CHE IL CAMPIONE SPEDISCE E' ASSERITO, e non solo la taglia di cio' che torna: la
// verifica avversariale ha misurato cinque mutazioni sopravvissute sul CONTENUTO realmente
// passato al confine (patch non applicate, locale costante, profilo di proiezione e di
// consegna inchiodati a 'home', uno slot su diciassette, system e messages azzerati). Un
// harness cosi' mutato resta verde e produce una taratura ottimista in silenzio, che e'
// esattamente il fallimento che T-225 esiste per impedire.

const radice = process.cwd();
const PERCORSO_DELLO_SCRIPT = resolve(radice, 'scripts/measure-generation-usage.ts');

const BUDGET = moduloBudget.GENERATION_BUDGET;

/** I moduli VERI del progetto: l'unico doppio dell'harness e' il client del confine. */
const MODULI: ModuliDelProgetto = {
  budget: moduloBudget,
  projection: moduloProiezione,
  slots: moduloSlot,
  tool: moduloTool,
  prompt: moduloPrompt,
  brief: moduloBrief,
  confine: moduloConfine,
};

/** Le fasi, DERIVATE dal budget: sono le chiavi dei tetti di uscita, non un elenco nuovo. */
const FASI = Object.keys(BUDGET.max_tokens) as (keyof typeof BUDGET.max_tokens)[];

/**
 * Il profilo di proiezione che ciascuna fase DEVE usare (P2-D13): la fase 1 e' la home su
 * cui il titolare sceglie fra le varianti, la fase 2 sono le pagine interne. E' scritto qui
 * e non letto dall'harness di proposito: se lo leggessimo da li', un profilo inchiodato
 * sarebbe atteso inchiodato.
 */
const PROFILO_ATTESO_DELLA_FASE: Record<(typeof FASI)[number], ProjectionProfile> = {
  phase1: 'home',
  phase2_chunk: 'inner',
};

/** Gli id di TUTTI gli slot del catalogo: e' il caso peggiore su cui l'uscita e' tarata. */
const ID_DEL_CATALOGO = moduloSlot.SLOTS.map((slot) => slot.id);

/** Il tetto di INPUT di un profilo, in token: e' il tetto in code unit col proxy di P2-D17. */
function tettoDiInput(profilo: ProjectionProfile): number {
  return BUDGET.projection[profilo] / BUDGET.code_unit_per_token;
}

// ---------------------------------------------------------------------------
// IL DOPPIO DEL CONFINE. Ritorna una risposta con il blocco `usage` popolato e registra i
// parametri REALMENTE ricevuti: l'harness non costruisce la richiesta da se', la fa
// costruire a runGenerationTurn (T-224), quindi e' su quei parametri che si vede se la
// fase ha davvero raggiunto il confine.
//
// La risposta NON emula un pool valido di proposito: la validita' del ritorno e' l'oracolo
// di T-224, qui si misura il COSTO della richiesta, che esiste identico anche quando il
// modello risponde male.

function rispostaConUso(uso: UsoDelTurno): Anthropic.Message {
  return {
    id: 'msg_test_t225',
    container: null,
    content: [{ type: 'text', text: 'una risposta qualunque', citations: null }],
    model: 'claude-sonnet-5',
    role: 'assistant',
    stop_details: null,
    stop_reason: 'end_turn',
    stop_sequence: null,
    type: 'message',
    usage: {
      ...uso,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
  };
}

/**
 * Il client doppio: consegna l'i-esimo uso all'i-esima chiamata. La CODA e' cio' che rende
 * osservabile l'ordine delle misure — un harness che misurasse due volte la stessa fase
 * riceverebbe usi diversi da quelli che il rapporto poi dichiara.
 */
function clientChe(usi: readonly UsoDelTurno[]) {
  const chiamate: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client = {
    messages: {
      create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
        const uso = usi[chiamate.length];
        chiamate.push(params);
        if (uso === undefined) {
          throw new Error(`chiamata numero ${chiamate.length}: il campione di usi e finito`);
        }
        return Promise.resolve(rispostaConUso(uso));
      },
    },
  };
  return { chiamate, client };
}

/**
 * QUATTRO USI DISCORDANTI, uno per turno (due brief x due fasi), tutti ENTRO le costanti:
 * e' il caso in cui `superamenti` deve restare VUOTO, cioe' il controllo negativo senza il
 * quale un elenco che nomina sempre tutto passerebbe.
 *
 * I DUE TURNI DEL PRIMO BRIEF STANNO ESATTAMENTE SUL TETTO, in entrambe le direzioni
 * (input e uscita, per il profilo 'home' e per quello 'inner'): e' la condizione di CONFINE.
 * Prima nessun valore ci stava sopra — gli input erano 3.100-3.900 contro tetti di 4.000 e
 * 4.250 — e cambiare il confronto da `>` a `>=` non faceva diventare rosso nulla, cioe' il
 * rapporto avrebbe potuto segnalare come superata una costante RAGGIUNTA e non superata.
 *
 * NE SEGUE UN SECONDO CANARINO, e la stretta e' voluta: con questi valori il costo del
 * PRIMO sito vale 1,310 USD contro `max_cost_per_site_usd` = 1,4 (il 94%), mentre la SOMMA
 * dei due siti vale 1,527, cioe' sopra. Quindi un accumulatore che uscisse dal ciclo sui
 * brief — spesa accumulata FRA i siti invece che PER sito — fa segnalare un superamento
 * qui, e cosi' fa un moltiplicatore `phase2_chunks_per_site` troppo grande (1,683). Erano
 * entrambe mutazioni sopravvissute.
 *
 * I due `null` della terza voce non sono un riempitivo: l'API restituisce null quando il
 * caching non e' in gioco, e un rapporto che li appiattisse a zero direbbe "misurati zero
 * token di cache" al posto di "non misurati".
 */
const USI_ENTRO_LE_COSTANTI: readonly UsoDelTurno[] = [
  {
    input_tokens: tettoDiInput('home'),
    output_tokens: BUDGET.max_tokens.phase1,
    cache_creation_input_tokens: 2_400,
    cache_read_input_tokens: 0,
  },
  {
    input_tokens: tettoDiInput('inner'),
    output_tokens: BUDGET.max_tokens.phase2_chunk,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 2_400,
  },
  {
    input_tokens: 3_300,
    output_tokens: 5_100,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
  },
  {
    input_tokens: 3_500,
    output_tokens: 2_200,
    cache_creation_input_tokens: 1_200,
    cache_read_input_tokens: 900,
  },
];

/** La somma di un campo su tutti gli usi, col null contato zero: e' il totale atteso. */
function sommaAttesa(usi: readonly UsoDelTurno[], campo: keyof UsoDelTurno): number {
  return usi.reduce((totale, uso) => totale + (uso[campo] ?? 0), 0);
}

// ---------------------------------------------------------------------------

describe('T-225 harness di misura: senza chiave non esiste alcun verde', () => {
  // LA FORMA PIU' DIRETTA DEL DIVIETO DI FALSO VIA LIBERA (L-COL-006), ed e' asserita
  // ESEGUENDO DAVVERO IL PROCESSO invece che chiamandone una funzione: il codice di uscita
  // e l'assenza del file sono proprieta' del programma, non dell'oggetto in memoria.
  // MUTAZIONE CHE LO FA DIVENTARE ROSSO: far tornare 0 al ramo senza chiave, oppure
  // scrivere il rapporto prima di controllare la chiave, oppure cambiare il 78 in un 1.
  // covers: AC-225-1
  it('senza chiave dichiara NON ESEGUITO, esce con un codice distinto dal successo e non scrive il rapporto', () => {
    const cartella = mkdtempSync(join(tmpdir(), 'belora-t225-'));
    const percorsoDelRapporto = join(cartella, 'rapporto.json');
    try {
      // L'ambiente del figlio e' quello del test MENO la chiave: se una macchina ne avesse
      // una configurata, senza questa riga il caso proverebbe l'opposto di cio' che dice.
      const ambiente = { ...process.env };
      delete ambiente.ANTHROPIC_API_KEY;

      const esito = spawnSync(process.execPath, [PERCORSO_DELLO_SCRIPT, percorsoDelRapporto], {
        cwd: radice,
        env: ambiente,
        encoding: 'utf8',
      });
      const uscita = `${esito.stdout}${esito.stderr}`;

      // Guardia anti-placebo: il processo e' partito davvero e non e' stato ucciso da un
      // segnale — altrimenti "codice diverso dal successo" sarebbe vero per il motivo
      // sbagliato.
      expect(esito.error, `il processo non e partito: ${String(esito.error)}`).toBeUndefined(); // covers: AC-225-1
      expect(esito.signal).toBeNull(); // covers: AC-225-1

      expect(uscita.toLowerCase(), uscita).toContain('non eseguito'); // covers: AC-225-1 — lo dichiara esplicitamente
      expect(uscita, uscita).toContain('ANTHROPIC_API_KEY'); // covers: AC-225-1 — e dice di quale chiave si tratta
      expect(esito.status, uscita).toBe(USCITA.senza_chiave); // covers: AC-225-1
      expect(esito.status).not.toBe(USCITA.eseguita); // covers: AC-225-1 — distinto dal successo
      // IL LETTERALE, ed e' piu' stretto dell'AC di proposito. Confrontare il processo con
      // le costanti dello STESSO modulo lascia passare qualunque valore: cambiare 78 in 1
      // era una mutazione SOPRAVVISSUTA. Il file dichiara pero' una proprieta' piu' forte
      // (righe 71-77): un codice DEDICATO, distinto anche dall'errore generico 1, perche' un
      // 1 direbbe "e' andata male" mentre qui bisogna dire "non e' stata fatta". 78 e'
      // EX_CONFIG nella convenzione sysexits, che un runner di CI sa gia' leggere.
      expect(USCITA.senza_chiave).toBe(78); // covers: AC-225-1 (piu' stretto dell AC: il letterale)
      expect(esito.status, uscita).toBe(78); // covers: AC-225-1 (piu' stretto dell AC: il letterale)
      expect(existsSync(percorsoDelRapporto)).toBe(false); // covers: AC-225-1 — nessun file di rapporto
    } finally {
      rmSync(cartella, { recursive: true, force: true });
    }
  });

  // IL RAMO DEGLI ARGOMENTI, e non discende ne' da un AC ne' dalla definition_of_done: e'
  // comportamento IN PIU' che la verifica avversariale ha trovato non asserito (`USCITA.uso_errato`
  // e la costante `USO`, righe 82 e 87 dell'harness). E' stato deciso di TENERLO — un
  // programma che accetta argomenti sbagliati in silenzio e' peggio di uno che si ferma — e
  // tenerlo obbliga ad asserirlo: un ramo raggiungibile e mai eseguito da alcun oracolo e'
  // codice che nessuno sa se funziona. Le due asserzioni che invece DISCENDONO da AC-225-1
  // sono marcate: qualunque sia il motivo per cui il programma si ferma, non dichiara
  // successo e non scrive alcun rapporto.
  it('senza argomenti stampa l uso e si ferma con il proprio codice, senza scrivere nulla', () => {
    const cartella = mkdtempSync(join(tmpdir(), 'belora-t225-'));
    try {
      const ambiente = { ...process.env };
      delete ambiente.ANTHROPIC_API_KEY;

      const esito = spawnSync(process.execPath, [PERCORSO_DELLO_SCRIPT], {
        cwd: cartella,
        env: ambiente,
        encoding: 'utf8',
      });
      const uscita = `${esito.stdout}${esito.stderr}`;

      expect(esito.error, `il processo non e partito: ${String(esito.error)}`).toBeUndefined();
      expect(esito.signal).toBeNull();
      expect(esito.status, uscita).not.toBe(USCITA.eseguita); // covers: AC-225-1 — nessun verde
      expect(uscita, uscita).toContain('uso:'); // decisione di verifica T-225 — il ramo tenuto dichiara come si usa
      expect(uscita, uscita).toContain('measure-generation-usage'); // decisione di verifica T-225
      expect(esito.status, uscita).toBe(USCITA.uso_errato); // decisione di verifica T-225 — un codice proprio
      expect(USCITA.uso_errato).toBe(64); // decisione di verifica T-225 — EX_USAGE (sysexits), non un 1 generico
      expect(existsSync(join(cartella, 'rapporto.json'))).toBe(false); // covers: AC-225-1 — nessun rapporto
    } finally {
      rmSync(cartella, { recursive: true, force: true });
    }
  });

  // IL VERSO OPPOSTO, e non e' zelo: una guardia che rispondesse SEMPRE "chiave assente"
  // renderebbe verde il caso qui sopra e non misurerebbe MAI nulla — un falso via libera
  // dell'altro segno, che nessuna asserzione sul solo ramo negativo vedrebbe.
  // Il valore finto contiene spazi e nessun prefisso di fornitore: non e una chiave, ed e
  // l'accessor VERO di T-130 a giudicarlo.
  // covers: AC-225-1
  it('la guardia sulla chiave usa l accessor di config e distingue i due casi', () => {
    const valoreFinto = 'valore finto di prova';

    expect(chiaveConfigurata(() => getAnthropicApiKey({}))).toBe(false); // covers: AC-225-1
    // Vuota o di soli spazi = non impostata, come in loadEnv: e l'accessor a deciderlo.
    expect(chiaveConfigurata(() => getAnthropicApiKey({ ANTHROPIC_API_KEY: '   ' }))).toBe(false); // covers: AC-225-1
    expect(chiaveConfigurata(() => getAnthropicApiKey({ ANTHROPIC_API_KEY: valoreFinto }))).toBe(
      true,
    ); // covers: AC-225-1 — anti-vacuita: la guardia non e sempre falsa
  });
});

describe('T-225 il campione: e sul suo contenuto che la taratura sta o cade', () => {
  // AI TETTI DI P1-D17 (P2-D31, emendamento della definition_of_done). Il campione
  // precedente produceva 296-702 code unit, cioe' l'1,7-4,4% di PROJECTION_LIMITS: sul lato
  // USCITA l'harness usa deliberatamente tutti e diciassette gli slot del catalogo, sul lato
  // INGRESSO stava al 2-4% del caso peggiore, e il superamento che AC-225-3 esiste per far
  // scattare non poteva scattare da li'. MISURATO ora: 14.712 code unit per 'home' (92,0%
  // del tetto) e 14.784 per 'inner' (87,0%), cioe' gli stessi valori del caso peggiore che
  // AC-220-4 misura sul brief ai tetti (14.714 / 14.786).
  // La soglia e' l'80% e non il 100%: il tetto NON deve essere superato dal campione (quello
  // sarebbe un brief fuori da P1-D17, che nessun writer applicativo produce), ma nemmeno
  // sfiorato alla lontana.
  // MUTAZIONE CHE LO FA DIVENTARE ROSSO: non applicare le patch (si misurerebbero due brief
  // VUOTI, ~30 code unit), oppure riempire i campi senza arrivare ai tetti.
  it('contiene un brief ai tetti di P1-D17, in ENTRAMBI i profili di proiezione', () => {
    const campione = costruisciCampione(MODULI);
    const QUOTA_MINIMA_DEL_TETTO = 0.8;

    for (const profilo of ['home', 'inner'] as const) {
      const taglie = campione.map(
        (voce) => JSON.stringify(moduloProiezione.briefProjection(voce.brief, profilo)).length,
      );
      const piuPesante = Math.max(...taglie);
      const tetto = moduloProiezione.PROJECTION_LIMITS[profilo];
      const rapporto =
        `[P2-D31] proiezione piu' pesante del campione, profilo '${profilo}': ` +
        `${piuPesante} code unit su un tetto di ${tetto} ` +
        `(${((piuPesante / tetto) * 100).toFixed(1)}%)`;

      expect(piuPesante, rapporto).toBeGreaterThan(tetto * QUOTA_MINIMA_DEL_TETTO); // DoD T-225 (P2-D31)
      expect(piuPesante, rapporto).toBeLessThanOrEqual(tetto); // DoD T-225 (P2-D31)
    }
  });

  // LE DUE PROPRIETA' DELLA FIXTURE CHE RENDONO FALSIFICABILI LE ALTRE ASSERZIONI, e per
  // questo vanno asserite qui invece di restare scritte in un commento dell'harness.
  //  - IL PREFISSO: 'bar' e' prefisso di 'bar-ai-tetti'. E' cio' che rende non equivalenti
  //    `toContain` e `toBe` sull'attribuzione dei superamenti (AC-225-3): senza la coppia,
  //    un rapporto che attribuisse la misura al brief sbagliato passerebbe lo stesso.
  //  - I DUE LOCALE: locale diverso vuol dire system prompt diverso (T-223), quindi la
  //    misura copre due prompt e non due volte lo stesso. Un campione con locale costante
  //    misurerebbe una forbice che non esiste, e nessuna asserzione derivata dal campione
  //    stesso potrebbe vederlo.
  it('ha due brief discordanti, con il nome del primo PREFISSO di quello del secondo', () => {
    const campione = costruisciCampione(MODULI);

    expect(campione).toHaveLength(2); // DoD T-225 — piu' di un caso: una misura sola non dice nulla sulla forbice
    expect(campione[1].nome.startsWith(campione[0].nome)).toBe(true); // DoD T-225
    expect(campione[1].nome).not.toBe(campione[0].nome); // DoD T-225
    expect(new Set(campione.map((voce) => voce.brief.locale)).size).toBe(2); // DoD T-225
    // Uno SCARNO e uno con il catalogo: sono i due estremi della forbice.
    expect(campione[0].brief.content?.offerings ?? []).toHaveLength(0); // DoD T-225
    expect((campione[1].brief.content?.offerings ?? []).length).toBeGreaterThan(
      moduloProiezione.PROJECTION_LIMITS.offering_sample,
    ); // DoD T-225 — il campione delle offerte viene TAGLIATO, non passa intero
  });

  // LA GUARDIA SUI CAMPI SCARTATI, che era codice morto per l'oracolo: la JSDoc di
  // `costruisciCampione` dichiara un `@throws` che nessun caso esercitava, e disattivarla era
  // una mutazione sopravvissuta. E' la guardia che deve accorgersi il giorno in cui un campo
  // del campione uscisse dallo schema del Brief (T-121): senza di lei quel campo sparirebbe
  // in silenzio e la proiezione misurata sarebbe piu' leggera del vero, cioe' la taratura
  // nascerebbe ottimista. Si esercita iniettando un modulo del Brief che DICHIARA lo scarto,
  // che e' il seam gia' previsto dalla firma.
  it('rifiuta il campione se lo schema del Brief SCARTA un campo, nominandolo', () => {
    const moduloCheScarta: ModuliDelProgetto['brief'] = {
      ...moduloBrief,
      applyBriefUpdate: (brief, update) => ({
        brief: moduloBrief.applyBriefUpdate(brief, update).brief,
        rejected: ['description'],
      }),
    };

    expect(() => costruisciCampione({ ...MODULI, brief: moduloCheScarta })).toThrow(
      /campione 'bar'.*description/,
    ); // DoD T-225
    // Anti-vacuita': col modulo VERO lo stesso campione non lancia affatto.
    expect(() => costruisciCampione(MODULI)).not.toThrow(); // DoD T-225
  });
});

describe('T-225 il rapporto di misura', () => {
  // covers: AC-225-2
  it('registra i quattro campi di usage per ciascun brief e ciascuna fase, e riporta il totale', async () => {
    const campione = costruisciCampione(MODULI);
    const { chiamate, client } = clientChe(USI_ENTRO_LE_COSTANTI);

    const rapporto = await misuraCampione(campione, client, MODULI);

    // Guardia anti-vacuita': taglie DICHIARATE separatamente. Il campione ha DUE brief
    // (AC-225-2) e le fasi sono DUE, quindi i turni sono quattro: un harness che ne
    // saltasse uno passerebbe ogni asserzione scritta come "per ogni riga del rapporto".
    expect(campione).toHaveLength(2); // covers: AC-225-2
    expect(FASI).toHaveLength(2); // covers: AC-225-2
    expect(chiamate).toHaveLength(4); // covers: AC-225-2 — il confine e stato raggiunto quattro volte
    expect(rapporto.misure).toHaveLength(4); // covers: AC-225-2

    // PER CIASCUN BRIEF E CIASCUNA FASE. Il confronto sul nome del brief e per UGUAGLIANZA:
    // nel campione 'bar' e PREFISSO di 'bar-ai-tetti', quindi un confronto scritto con
    // startsWith attribuirebbe al primo le misure del secondo.
    for (const voce of campione) {
      for (const fase of FASI) {
        expect(
          rapporto.misure.filter((misura) => misura.brief === voce.nome && misura.fase === fase),
          `manca la misura di ${voce.nome} / ${fase}`,
        ).toHaveLength(1); // covers: AC-225-2
      }
    }

    // I QUATTRO CAMPI, nell'ordine in cui il doppio li ha consegnati: il rapporto riporta
    // cio' che il confine ha detto, senza rimescolare e senza inventare.
    rapporto.misure.forEach((misura, indice) => {
      expect(misura.usage).toEqual(USI_ENTRO_LE_COSTANTI[indice]); // covers: AC-225-2
    });

    // IL TOTALE, derivato dagli usi e non riscritto a mano.
    expect(rapporto.totali).toEqual({
      input_tokens: sommaAttesa(USI_ENTRO_LE_COSTANTI, 'input_tokens'),
      output_tokens: sommaAttesa(USI_ENTRO_LE_COSTANTI, 'output_tokens'),
      cache_creation_input_tokens: sommaAttesa(
        USI_ENTRO_LE_COSTANTI,
        'cache_creation_input_tokens',
      ),
      cache_read_input_tokens: sommaAttesa(USI_ENTRO_LE_COSTANTI, 'cache_read_input_tokens'),
    }); // covers: AC-225-2

    // CIO' CHE E' STATO SPEDITO DAVVERO, turno per turno. Il brief e la fase attesi vengono
    // dalla POSIZIONE del turno (un brief alla volta, le sue due fasi in ordine) e non da
    // cio' che il rapporto dichiara: un rapporto che si sbagliasse sarebbe altrimenti il
    // metro di se stesso.
    rapporto.misure.forEach((misura, indice) => {
      const voce = campione[Math.floor(indice / FASI.length)];
      const fase = FASI[indice % FASI.length];
      const profiloAtteso = PROFILO_ATTESO_DELLA_FASE[fase];
      const dove = `${voce.nome} / ${fase}`;
      const chiamata = chiamate[indice];

      expect(misura.brief, dove).toBe(voce.nome); // covers: AC-225-2
      expect(misura.fase, dove).toBe(fase); // covers: AC-225-2
      expect(misura.profilo, dove).toBe(profiloAtteso); // DoD T-225

      // IL PAYLOAD ATTESO, ricomposto con i moduli VERI dal brief di QUESTA voce e dal
      // profilo di QUESTA fase. E' l'asserzione che fa cadere insieme: patch non applicate
      // (brief vuoti), locale costante (system prompt sbagliato), profilo di proiezione o di
      // consegna inchiodato a 'home' in fase 2, system e messages azzerati.
      expect(chiamata.tools, dove).toHaveLength(1); // DoD T-225
      const atteso = moduloPrompt.buildGenerationPayload(
        moduloProiezione.briefProjection(voce.brief, profiloAtteso),
        chiamata.tools?.[0] as Anthropic.Tool,
        profiloAtteso,
      );
      expect(testoDelSystem(chiamata), `system di ${dove}`).toBe(atteso.system); // DoD T-225
      expect(chiamata.messages, `messages di ${dove}`).toEqual(atteso.messages); // DoD T-225

      // LO SCHEMA DEL TOOL, che e' la parte grossa dell'input: tutti e diciassette gli slot
      // del catalogo, sulle pagine realmente richieste. Con UN solo slot il tool collassa e
      // la misura d'ingresso perde la sua voce piu' pesante.
      expect(chiamata.tools, dove).toEqual([
        moduloTool.buildPoolTool(ID_DEL_CATALOGO, pagineDelTool(chiamata)),
      ]); // DoD T-225
      expect(slotDelTool(chiamata), dove).toHaveLength(moduloSlot.SLOTS.length); // DoD T-225
    });

    // Le due fasi sono DUE FASI DIVERSE e non la stessa misurata due volte: il tetto di
    // uscita realmente passato al confine e quello della fase dichiarata dalla riga, e i
    // due profili di proiezione sono entrambi rappresentati.
    rapporto.misure.forEach((misura, indice) => {
      expect(chiamate[indice].max_tokens).toBe(BUDGET.max_tokens[misura.fase]); // DoD T-225
    });
    expect(new Set(rapporto.misure.map((misura) => misura.profilo)).size).toBe(2); // DoD T-225

    // La fase 1 chiede la SOLA home (P2-D13): uno slug diverso cambierebbe lo schema del
    // tool realmente spedito, quindi la misura, senza che nulla se ne accorga.
    const chiamateDiFase1 = rapporto.misure.flatMap((misura, indice) =>
      misura.fase === 'phase1' ? [chiamate[indice]] : [],
    );
    expect(chiamateDiFase1).toHaveLength(2); // DoD T-225
    for (const chiamata of chiamateDiFase1) {
      expect(pagineDelTool(chiamata)).toEqual(['home']); // DoD T-225
    }

    // La fase 2 misura un CHUNK di pagine interne, cioe' esattamente `pages_per_chunk`
    // pagine (P2-D13): una fase 2 misurata su meno pagine sotto-stimerebbe in silenzio
    // proprio la fase piu' cara.
    const chiamateDiFase2 = rapporto.misure.flatMap((misura, indice) =>
      misura.fase === 'phase2_chunk' ? [chiamate[indice]] : [],
    );
    expect(chiamateDiFase2).toHaveLength(2); // DoD T-225
    for (const chiamata of chiamateDiFase2) {
      expect(pagineDelTool(chiamata)).toHaveLength(BUDGET.pages_per_chunk); // DoD T-225
    }
  });

  // L'ARTEFATTO, non l'oggetto in memoria. AC-225-2 parla del report PRODOTTO e la
  // definition_of_done chiede di scriverlo: finche' la scrittura viveva dentro `main`
  // nessun oracolo poteva toccarla, e l'unica parte della DoD che NON richiede una chiave
  // era anche l'unica non provata.
  // covers: AC-225-2
  it('il rapporto PRODOTTO e un file JSON che si rilegge identico, coi null conservati', async () => {
    const { client } = clientChe(USI_ENTRO_LE_COSTANTI);
    const rapporto = await misuraCampione(costruisciCampione(MODULI), client, MODULI);

    const cartella = mkdtempSync(join(tmpdir(), 'belora-t225-'));
    const percorso = join(cartella, 'rapporto.json');
    try {
      scriviIlRapporto(percorso, rapporto);

      expect(existsSync(percorso)).toBe(true); // covers: AC-225-2
      const testo = readFileSync(percorso, 'utf8');
      const riletto = JSON.parse(testo) as typeof rapporto;

      expect(riletto).toEqual(rapporto); // covers: AC-225-2 — l artefatto porta cio che la misura ha detto
      expect(riletto.misure).toHaveLength(4); // covers: AC-225-2 — anti-vacuita: non e un file vuoto
      // I DUE null SOPRAVVIVONO al giro su disco. Non e' pignoleria: `undefined` sparirebbe
      // da JSON.stringify e il rapporto direbbe "campo assente" al posto di "non misurato",
      // che e' proprio la distinzione per cui quei due campi restano `number | null`.
      expect(riletto.misure[2].usage.cache_creation_input_tokens).toBeNull(); // covers: AC-225-2
      expect(riletto.misure[2].usage.cache_read_input_tokens).toBeNull(); // covers: AC-225-2
      // Leggibile da un umano e con l'a-capo finale: e' un artefatto che qualcuno aprira'.
      expect(testo.endsWith('\n')).toBe(true); // DoD T-225
      expect(testo.split('\n').length).toBeGreaterThan(riletto.misure.length); // DoD T-225 — indentato
    } finally {
      rmSync(cartella, { recursive: true, force: true });
    }
  });

  // covers: AC-225-3
  it('un input_tokens oltre il tetto di proiezione di HOME fa NOMINARE quella costante, e solo quella', async () => {
    // Il primo turno e' la fase 1, cioe' il profilo 'home': l'unico uso alterato e il suo,
    // di UN token sopra il tetto derivato dalla costante.
    const usi = USI_ENTRO_LE_COSTANTI.map((uso, indice) =>
      indice === 0 ? { ...uso, input_tokens: tettoDiInput('home') + 1 } : uso,
    );
    const { client } = clientChe(usi);
    const campione = costruisciCampione(MODULI);

    const rapporto = await misuraCampione(campione, client, MODULI);

    // L'ELENCO INTERO, per uguaglianza: dice insieme che la costante superata e' NOMINATA e
    // che nessun'altra lo e'. Gli altri tre turni stanno esattamente SUL tetto, quindi un
    // confronto scritto `>=` invece che `>` comparirebbe qui.
    const nomi = rapporto.superamenti.map((superamento) => superamento.costante);
    expect(nomi).toEqual(['GENERATION_BUDGET.projection.home']); // covers: AC-225-3

    const superamento = rapporto.superamenti[0];
    expect(superamento.dichiarato).toBe(tettoDiInput('home')); // covers: AC-225-3
    expect(superamento.misurato).toBe(tettoDiInput('home') + 1); // covers: AC-225-3
    // DOVE, per UGUAGLIANZA sull'intera stringa e non per sottostringa: 'bar' e' prefisso di
    // 'bar-ai-tetti', quindi `toContain('bar')` resta vero anche se il superamento venisse
    // attribuito all'altro brief — era una mutazione sopravvissuta.
    expect(superamento.dove).toBe(`${campione[0].nome} / phase1`); // covers: AC-225-3 — dice DOVE, e quale
  });

  // IL CASO SIMMETRICO, e non e' zelo: i due tetti DIFFERISCONO (4.000 e 4.250 token), e
  // finche' nessun caso portava 'inner' sopra il suo, un harness che confrontasse sempre col
  // tetto di 'home' o che scrivesse a mano il nome '...projection.home' restava verde —
  // erano due mutazioni sopravvissute. Un input fra 4.000 e 4.250 in fase 2 non sarebbe
  // stato segnalato da nessuno.
  // covers: AC-225-3
  it('un input_tokens oltre il tetto di proiezione di INNER fa nominare l altra costante', async () => {
    // Il secondo turno e' la fase 2, cioe' il profilo 'inner'.
    const usi = USI_ENTRO_LE_COSTANTI.map((uso, indice) =>
      indice === 1 ? { ...uso, input_tokens: tettoDiInput('inner') + 1 } : uso,
    );
    const { client } = clientChe(usi);
    const campione = costruisciCampione(MODULI);

    const rapporto = await misuraCampione(campione, client, MODULI);

    const nomi = rapporto.superamenti.map((superamento) => superamento.costante);
    expect(nomi).toEqual(['GENERATION_BUDGET.projection.inner']); // covers: AC-225-3

    const superamento = rapporto.superamenti[0];
    expect(superamento.dichiarato).toBe(tettoDiInput('inner')); // covers: AC-225-3
    expect(superamento.dichiarato).not.toBe(tettoDiInput('home')); // covers: AC-225-3 — i due tetti differiscono
    expect(superamento.misurato).toBe(tettoDiInput('inner') + 1); // covers: AC-225-3
    expect(superamento.dove).toBe(`${campione[0].nome} / phase2_chunk`); // covers: AC-225-3
  });

  // IL CONTROLLO NEGATIVO, senza il quale AC-225-3 passerebbe anche con un elenco che
  // nomina sempre ogni costante: con misure ENTRO le costanti, `superamenti` e VUOTO. Due
  // dei quattro turni stanno ESATTAMENTE sul tetto (vedi la nota su USI_ENTRO_LE_COSTANTI):
  // e' qui che si vede la differenza fra `>` e `>=`, fra spesa per SITO e spesa accumulata
  // fra i siti, e fra il moltiplicatore dei chunk giusto e uno troppo grande.
  // covers: AC-225-3
  it('con misure ENTRO le costanti, tetti compresi, non segnala alcun superamento', async () => {
    const { client } = clientChe(USI_ENTRO_LE_COSTANTI);

    const rapporto = await misuraCampione(costruisciCampione(MODULI), client, MODULI);

    expect(rapporto.superamenti).toEqual([]); // covers: AC-225-3
    // Anti-vacuita': i turni ci sono stati davvero, e due di loro stanno sul tetto.
    expect(rapporto.misure).toHaveLength(4); // covers: AC-225-3
    expect(rapporto.misure[0].usage.input_tokens).toBe(tettoDiInput('home')); // covers: AC-225-3
    expect(rapporto.misure[1].usage.input_tokens).toBe(tettoDiInput('inner')); // covers: AC-225-3
  });

  // LE ALTRE DUE COSTANTI CONFRONTATE. Non discende da un AC (AC-225-3 parla del solo tetto
  // di proiezione) ma dalla definition_of_done, che chiede di segnalare OGNI costante
  // superata: senza questo caso, due dei tre confronti sarebbero codice mai eseguito.
  it('un output oltre max_tokens fa nominare anche max_tokens e il tetto di spesa per sito', async () => {
    // Il doppio della fase 2, che entra nel costo del sito `phase2_chunks_per_site` volte:
    // sfonda insieme il tetto di uscita della fase e il tetto di spesa per sito.
    const usi = USI_ENTRO_LE_COSTANTI.map((uso, indice) =>
      indice === 1 ? { ...uso, output_tokens: BUDGET.max_tokens.phase2_chunk * 2 } : uso,
    );
    const { client } = clientChe(usi);
    const campione = costruisciCampione(MODULI);

    const rapporto = await misuraCampione(campione, client, MODULI);

    const nomi = rapporto.superamenti.map((superamento) => superamento.costante);
    expect(nomi).toEqual([
      'GENERATION_BUDGET.max_tokens.phase2_chunk',
      'GENERATION_BUDGET.max_cost_per_site_usd',
    ]); // DoD T-225 — quelle superate, in ordine, e nessun'altra

    const uscita = rapporto.superamenti[0];
    // IL TETTO DICHIARATO E' QUELLO DELLA FASE, non sempre quello della fase 1: i due
    // valgono 12.000 e 24.000, e confrontare l'uscita col tetto sbagliato era una mutazione
    // sopravvissuta perche' nessun caso ne asseriva il `dichiarato`.
    expect(uscita.dichiarato).toBe(BUDGET.max_tokens.phase2_chunk); // DoD T-225
    expect(uscita.misurato).toBe(BUDGET.max_tokens.phase2_chunk * 2); // DoD T-225
    expect(uscita.dove).toBe(`${campione[0].nome} / phase2_chunk`); // DoD T-225

    const spesa = rapporto.superamenti[1];
    expect(spesa.dichiarato).toBe(BUDGET.max_cost_per_site_usd); // DoD T-225
    expect(spesa.misurato).toBeGreaterThan(BUDGET.max_cost_per_site_usd); // DoD T-225
    // PER SITO: l'attribuzione e' al brief, per uguaglianza (di nuovo la coppia-prefisso).
    expect(spesa.dove).toBe(campione[0].nome); // DoD T-225
  });

  // IL CASO SIMMETRICO SULL'USCITA. Tutti e quattro gli usi del controllo negativo stanno
  // sotto ENTRAMBI i tetti di max_tokens, e solo la fase 2 veniva spinta sopra: un nome di
  // costante scritto a mano ('...max_tokens.phase2_chunk') restava percio' vero comunque.
  it('un output oltre max_tokens della FASE 1 nomina la costante della fase 1', async () => {
    const usi = USI_ENTRO_LE_COSTANTI.map((uso, indice) =>
      indice === 0 ? { ...uso, output_tokens: BUDGET.max_tokens.phase1 + 1 } : uso,
    );
    const { client } = clientChe(usi);
    const campione = costruisciCampione(MODULI);

    const rapporto = await misuraCampione(campione, client, MODULI);

    const nomi = rapporto.superamenti.map((superamento) => superamento.costante);
    expect(nomi).toEqual(['GENERATION_BUDGET.max_tokens.phase1']); // DoD T-225

    const superamento = rapporto.superamenti[0];
    expect(superamento.dichiarato).toBe(BUDGET.max_tokens.phase1); // DoD T-225
    expect(superamento.dichiarato).not.toBe(BUDGET.max_tokens.phase2_chunk); // DoD T-225 — i due tetti differiscono
    expect(superamento.misurato).toBe(BUDGET.max_tokens.phase1 + 1); // DoD T-225
    expect(superamento.dove).toBe(`${campione[0].nome} / phase1`); // DoD T-225
  });
});

describe('T-225 lo script sta FUORI dalla suite raccolta dal checkpoint', () => {
  // ASSERITO SULLA CONFIGURAZIONE VERA, importata e non riscritta: lo script vive fuori da
  // tests/, quindi "non e raccolto" e' vero per costruzione — ma darlo per scontato
  // significherebbe non accorgersi del giorno in cui `include` si allarga.
  // covers: AC-225-4
  it('non rientra nel pattern di include di vitest.config.ts, mentre questo file si', () => {
    const include = configurazioneDeiTest.test?.include;
    expect(Array.isArray(include) && include.length > 0).toBe(true); // covers: AC-225-4 — guardia anti-vacuita
    const pattern = include ?? [];

    // Anti-vacuita': lo script esiste davvero. "Non raccolto" di un file inesistente non
    // direbbe nulla.
    expect(existsSync(PERCORSO_DELLO_SCRIPT)).toBe(true); // covers: AC-225-4

    const percorsoDelloScript = relativoAllaRadice(PERCORSO_DELLO_SCRIPT);
    expect(pattern.some((glob) => matchesGlob(percorsoDelloScript, glob))).toBe(false); // covers: AC-225-4

    // CONTROLLO POSITIVO: gli stessi pattern, applicati con lo stesso confronto, RACCOLGONO
    // questo file. Senza, un `matchesGlob` che sbagliasse sempre renderebbe verde la riga
    // qui sopra per il motivo sbagliato.
    const questoFile = relativoAllaRadice(fileURLToPath(import.meta.url));
    expect(pattern.some((glob) => matchesGlob(questoFile, glob))).toBe(true); // covers: AC-225-4
  });
});

// ---------------------------------------------------------------------------
// IL PERIMETRO DEI CONFINI (P2-D27, AC-225-5).
//
// `scripts/**` non compariva ne' fra i blocchi di eslint.config.mjs che vietano i due
// confini privilegiati ne' fra quelli che li spengono: non era aperta per decisione, non era
// mai stata considerata. MISURATO sulla configurazione PRIMA della modifica, con la stessa
// sorgente lintata a percorsi diversi: src/ui/** 6 messaggi, src/app/** 6, scripts/** ZERO.
// E il primo file che ci e' nato — questo harness — costruisce `new Anthropic({ apiKey: ... })`,
// cioe' e' il SECONDO detentore della chiave grezza del repo (P1-D7).
//
// L'ECCEZIONE E' UNA SOLA E STA SCRITTA NELLA CONFIGURAZIONE. L'harness deve costruire il
// client per leggere `usage`, e quel costo lo dichiara in testa a se stesso; ogni altro file
// sotto scripts/ resta soggetto. E l'eccezione e' STRETTA: cade il solo confine LLM, mentre
// il client service_role (che bypassa la RLS) resta vietato anche qui — in flat config le
// opzioni della stessa regola si sostituiscono invece di sommarsi, quindi ridichiararlo e'
// cio' che impedisce all'eccezione di aprire in silenzio anche l'altro confine.

const REGOLE_DEL_CONFINE = ['no-restricted-imports', 'no-restricted-syntax'];

const eslintDelPerimetro = new ESLint({ cwd: radice });

/**
 * Gli errori delle regole di confine su un sorgente lintato a un certo percorso.
 *
 * GUARDIA ANTI-PLACEBO: un errore di PARSING avrebbe `ruleId` null e svuoterebbe il filtro,
 * quindi ogni ramo negativo passerebbe per un fixture che non compila invece che per una
 * regola mirata. E' lo stesso `erroriDelConfine` di tests/anthropic-boundary.test.ts.
 */
async function erroriDelConfine(source: string, percorso: string) {
  const [risultato] = await eslintDelPerimetro.lintText(source, {
    filePath: resolve(radice, percorso),
  });
  expect(
    risultato.messages.filter((messaggio) => messaggio.fatal === true),
    `errore di parsing sul fixture di ${percorso}`,
  ).toEqual([]);
  return risultato.messages.filter(
    (messaggio) => messaggio.ruleId !== null && REGOLE_DEL_CONFINE.includes(messaggio.ruleId),
  );
}

/**
 * L'impronta di un elenco di errori: quale REGOLA li ha presi e QUALE confine ha nominato,
 * ordinata. E' cio' che rende confrontabili due percorsi diversi senza dipendere dall'ordine
 * in cui ESLint riporta i messaggi.
 */
function improntaDelConfine(errori: Awaited<ReturnType<typeof erroriDelConfine>>): string[] {
  return errori
    .map((errore) => {
      const quale = errore.message.includes('supabase-admin') ? 'service_role' : 'confine LLM';
      return `${errore.ruleId} / ${quale}`;
    })
    .sort();
}

/** La sorgente che viola ENTRAMBI i confini, in forma statica E dinamica. */
const SORGENTE_CHE_VIOLA = [
  "import { runGenerationTurn } from '@/data/anthropic';",
  "import { supabaseAdmin } from '@/data/supabase-admin';",
  "export const caricaConfine = () => import('@/data/anthropic');",
  "export const caricaAdmin = () => import('@/data/supabase-admin');",
  'export const seam = [runGenerationTurn, supabaseAdmin, caricaConfine, caricaAdmin];',
].join('\n');

/** Il layer client di riferimento: e' quello che AC-225-5 nomina per il confronto. */
const PERCORSO_DI_RIFERIMENTO = 'src/ui/onboarding/ChatPanel.tsx';

describe('T-225 la directory degli script e dentro il perimetro dei confini (P2-D27)', () => {
  // MUTAZIONE CHE LO FA DIVENTARE ROSSO: togliere il blocco 'scripts/**' da
  // eslint.config.mjs (l'impronta di scripts/ torna vuota), oppure allargare l'eccezione
  // dell'harness da 'scripts/measure-generation-usage.ts' a tutto 'scripts/**'.
  // covers: AC-225-5
  it('un file NUOVO sotto scripts/ e trattato come src/ui/**, in entrambe le forme dell import', async () => {
    expect(existsSync(resolve(radice, PERCORSO_DI_RIFERIMENTO))).toBe(true); // covers: AC-225-5 — il riferimento e un file VERO

    const suRiferimento = await erroriDelConfine(SORGENTE_CHE_VIOLA, PERCORSO_DI_RIFERIMENTO);
    const suScript = await erroriDelConfine(SORGENTE_CHE_VIOLA, 'scripts/sonda.ts');

    // Anti-vacuita': il riferimento prende davvero qualcosa, e prende entrambe le regole —
    // altrimenti "uguale al riferimento" sarebbe vero per due elenchi vuoti.
    expect(suRiferimento.length).toBeGreaterThan(0); // covers: AC-225-5
    expect(new Set(suRiferimento.map((errore) => errore.ruleId))).toEqual(
      new Set(REGOLE_DEL_CONFINE),
    ); // covers: AC-225-5 — statica E dinamica
    expect(improntaDelConfine(suRiferimento)).toContain('no-restricted-syntax / confine LLM'); // covers: AC-225-5

    expect(improntaDelConfine(suScript)).toEqual(improntaDelConfine(suRiferimento)); // covers: AC-225-5
    expect(
      suScript.every((errore) => errore.severity === 2),
      'warning invece di error sotto scripts/',
    ).toBe(true); // covers: AC-225-5
  });

  // L'ECCEZIONE, e il suo essere UNA SOLA e STRETTA. Un'eccezione ottenuta col silenzio —
  // cioe' una directory fuori da ogni blocco — non si distingue da una dimenticanza: qui si
  // asserisce sia cio' che l'eccezione apre sia cio' che continua a chiudere.
  // covers: AC-225-5
  it('l harness di misura e l UNICA eccezione, e vale per il solo confine LLM', async () => {
    const suoPercorso = 'scripts/measure-generation-usage.ts';
    const suHarness = await erroriDelConfine(SORGENTE_CHE_VIOLA, suoPercorso);

    // APERTO: il confine LLM, perche' l'harness deve costruire il client per leggere `usage`.
    expect(suHarness.some((errore) => errore.message.includes('src/data/anthropic'))).toBe(false); // covers: AC-225-5
    // CHIUSO: il client service_role, in entrambe le meta'. Un harness di misura dei token
    // non ha alcun motivo di bypassare la RLS.
    expect(improntaDelConfine(suHarness)).toEqual([
      'no-restricted-imports / service_role',
      'no-restricted-imports / service_role',
      'no-restricted-syntax / service_role',
    ]); // covers: AC-225-5

    // E il file VERO, con la sua sorgente vera, lintato al suo percorso: zero errori di
    // confine. E' la parte operativa — `eslint .` e' un gate della CI — e diventerebbe rossa
    // il giorno in cui l'harness importasse il client service_role.
    const sorgenteVera = readFileSync(PERCORSO_DELLO_SCRIPT, 'utf8');
    expect(sorgenteVera).toContain("import('@/data/anthropic')"); // covers: AC-225-5 — anti-vacuita: l import c e davvero
    expect(await erroriDelConfine(sorgenteVera, suoPercorso)).toEqual([]); // covers: AC-225-5
  });
});

// ---------------------------------------------------------------------------

/** Il percorso relativo alla radice, con le barre in avanti: i glob non parlano windows. */
function relativoAllaRadice(percorso: string): string {
  return relative(radice, percorso).replace(/\\/g, '/');
}

/**
 * Il testo del system prompt REALMENTE passato al confine. Dal breakpoint di cache di
 * P2-D29 il system e' UN blocco di testo invece di una stringa (e' la sola forma in cui
 * `cache_control` ha dove stare): che sia l'una o l'altra e' materia di AC-224-8, qui conta
 * il TESTO, cioe' che sia il prompt del locale di QUESTO brief.
 */
function testoDelSystem(chiamata: Anthropic.MessageCreateParamsNonStreaming): string {
  const system = chiamata.system;
  if (typeof system === 'string') return system;
  return (system ?? []).map((blocco) => blocco.text).join('');
}

/**
 * Gli slug di pagina enumerati dallo schema del tool REALMENTE passato al confine. Lo
 * schema e' `unknown` nel tipo dell'SDK (input_schema.properties non e tipizzato), quindi
 * la lettura passa da un cast dichiarato: cio' che conta e' che il conteggio venga
 * dall'oggetto passato e non da una costante di questo file.
 */
function pagineDelTool(chiamata: Anthropic.MessageCreateParamsNonStreaming): string[] {
  return Object.keys(pagineDelloSchema(chiamata));
}

/** Gli id di slot enumerati dalla PRIMA pagina dello schema del tool realmente passato. */
function slotDelTool(chiamata: Anthropic.MessageCreateParamsNonStreaming): string[] {
  const primaPagina = Object.values(pagineDelloSchema(chiamata))[0];
  return Object.keys(primaPagina?.properties ?? {});
}

type SchemaDellaPagina = { properties?: Record<string, unknown> };

function pagineDelloSchema(
  chiamata: Anthropic.MessageCreateParamsNonStreaming,
): Record<string, SchemaDellaPagina> {
  const tool = chiamata.tools?.[0] as Anthropic.Tool | undefined;
  const proprieta = tool?.input_schema.properties as
    | { pages?: { properties?: Record<string, SchemaDellaPagina> } }
    | undefined;
  return proprieta?.pages?.properties ?? {};
}
