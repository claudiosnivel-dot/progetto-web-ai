import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { GENERATION_BUDGET } from '@/domain/generation/budget';
import { PROJECTION_LIMITS } from '@/domain/generation/projection';
import { DOCUMENT_LIMITS } from '@/domain/generation/document';
import { GENERATION_TIMEOUTS } from '@/domain/generation/timeouts';

// T-223 (macrotask generation-llm, P2) — le costanti di budget in un solo posto. Le
// asserzioni derivano dagli acceptance_criteria AC-223-4 e AC-223-6 (03-generation-llm.md).
//
// COSA QUESTO FILE NON PROVA, e va detto prima di tutto il resto: che le stime siano GIUSTE.
// I numeri di GENERATION_BUDGET sono stime a tavolino dichiarate provvisorie (P2-D17), non
// misure: `count_tokens` e' un endpoint API e senza chiave il proxy in code unit al rapporto
// ~4:1 e' tutto cio' che abbiamo. AC-223-4 asserisce la COERENZA INTERNA del bound — la
// somma dei tetti dichiarati sta sotto il tetto di spesa dichiarato — e nient'altro. La
// misura vera e' T-225, che gira solo con una chiave e altrimenti si dichiara non eseguito.
//
// DUE LIMITI DICHIARATI, misurati e lasciati tali per decisione presa sui fatti.
//  1. IL "VALORE RIPORTATO" NON COMPARE SUL VERDE. AC-223-4 e AC-223-6 chiedono che il test
//     RIPORTI il valore calcolato, e i due `console.log` qui sotto lo fanno — ma il reporter
//     di default di vitest 4.1.10 non stampa lo stdout dei test PASSATI: misurato, su suite
//     verde l'output e' di 9 righe e non ne contiene nessuna con 'AC-223'; la stessa riga
//     compare solo quando il file ha un fallimento (mutando `phase1` a 120_000). Il valore
//     resta dunque leggibile esattamente quando serve — quando il bound si rompe — e il
//     meccanismo NON si cambia qui: e' identico in quattro file gia' checkpointati (fra cui
//     AC-220-4), e cambiarlo in uno solo lo renderebbe incoerente con gli altri tre.
//  2. IL BOUND CONTA COME INPUT LA SOLA PROIEZIONE. Il system prompt e lo schema del tool sono
//     input a OGNI chiamata (quattro per sito nel caso peggiore) e P2-D17 li indica come i
//     primi candidati a crescere, ma non entrano nel conto perche' la formula e' PRESCRITTA
//     dall'AC. Ordine di grandezza misurato: il system prompt 'it' pesa ~1.700 code unit,
//     cioe' il termine mancante vale ~0,02 USD su 1,31 — immateriale oggi, ma il bound si
//     dichiara "caso peggiore" e in senso stretto non lo e'.

const root = process.cwd();

/** Un milione, cioe' l'unita' in cui l'API pubblica i prezzi. */
const TOKEN_PER_MILIONE = 1_000_000;

// ---------------------------------------------------------------------------

describe('T-223 GENERATION_BUDGET: le costanti in un solo posto', () => {
  // PIN dei valori: e' l'unico posto in cui sono scritti a mano, tutte le altre asserzioni li
  // derivano dalla costante. Senza, cambiare un tetto (o aggiungerne uno senza deciderlo)
  // resterebbe verde — ed e' proprio il costo di un cambio che questo task esiste per rendere
  // visibile.
  it('ha esattamente le costanti dichiarate dalla definition_of_done, coi valori decisi', () => {
    expect(GENERATION_BUDGET).toEqual({
      projection: { home: 16_000, inner: 17_000 },
      max_tokens: { phase1: 12_000, phase2_chunk: 24_000 },
      pages_per_chunk: 4,
      phase2_chunks_per_site: 3,
      effort: 'medium',
      timeout_ms: 600_000,
      max_retries: 0,
      usd_per_million_tokens: { input: 3, output: 15 },
      code_unit_per_token: 4,
      max_cost_per_site_usd: 1.4,
    }); // DoD T-223 — tetti dei due profili, max_tokens per fase, effort, timeout, maxRetries, prezzi
  });

  // I DUE TETTI DELLA PROIEZIONE SONO DERIVATI, non ricopiati: e' cio' che rende vera la
  // promessa di AC-223-6 (nessun letterale duplicato) e che tiene il lato input del bound
  // agganciato alla costante che il test di T-220 misura davvero su un brief al tetto di
  // P1-D17. Un doppio dei numeri qui direbbe che il budget e' calcolato su una proiezione
  // che nessuno misura.
  it('i tetti di proiezione DERIVANO da PROJECTION_LIMITS e i chunk da DOCUMENT_LIMITS', () => {
    expect(GENERATION_BUDGET.projection.home).toBe(PROJECTION_LIMITS.home); // DoD T-223
    expect(GENERATION_BUDGET.projection.inner).toBe(PROJECTION_LIMITS.inner); // DoD T-223
    // Le pagine interne del caso peggiore sono quelle del documento meno la home, che nasce
    // in fase 1; il numero di chunk e' quello, diviso le pagine per chunk, arrotondato in su.
    expect(GENERATION_BUDGET.phase2_chunks_per_site).toBe(
      Math.ceil((DOCUMENT_LIMITS.max_pages - 1) / GENERATION_BUDGET.pages_per_chunk),
    ); // DoD T-223
    expect(GENERATION_BUDGET.phase2_chunks_per_site).toBeGreaterThan(0); // DoD T-223
  });

  // P2-D11: il pensiero e' adaptive e non si spegne MAI. `effort` e' la leva al suo posto, e
  // qui si pinna soltanto che sia uno dei livelli che l'API accetta — quale sia il livello
  // giusto non e' oracolabile senza chiave.
  it('effort e uno dei livelli ammessi dall API', () => {
    expect(['low', 'medium', 'high', 'xhigh', 'max']).toContain(GENERATION_BUDGET.effort); // DoD T-223
  });

  // NON deriva da un AC: e' l'INVARIANTE DI MONTE che budget.ts dichiara in PROSA (righe
  // 62-68) accanto a `timeout_ms`, cioe' una delle costanti che la definition_of_done vuole
  // qui. Cio' che il modulo dice di quel numero e' che la VITA MASSIMA della chiamata —
  // `timeout_ms x (max_retries + 1)`, perche' l'SDK ritenta anche i timeout — deve stare
  // DENTRO `GENERATION_TIMEOUTS.max_request_lifetime` (13 minuti, T-203). Fuori da quella
  // finestra la richiesta che POSSIEDE la riga 'generating' sopravviverebbe al momento in cui
  // la riconciliazione la dichiara abbandonata (P2-D15), e due scrittori si troverebbero sulla
  // stessa riga — cioe' esattamente cio' che l'indice UNIQUE parziale esiste per impedire.
  //
  // PERCHE' LA RIGA ESISTE, misurato: senza di essa portare `timeout_ms` da 10 a 15 minuti era
  // preso dal SOLO pin di uguaglianza qui sopra, cioe' chi alza il numero aggiorna il pin e
  // non viene avvisato di nulla. E' la stessa forma di difetto che timeouts.ts registra come
  // gia' costata una scoperta in T-203: "l'invariante era dichiarata a parole nel modulo e
  // nulla la imponeva".
  it('la vita massima della chiamata sta DENTRO max_request_lifetime (invariante di P2-D15)', () => {
    const vitaMassima = GENERATION_BUDGET.timeout_ms * (GENERATION_BUDGET.max_retries + 1);

    // Anti-vacuita': con un timeout a zero — o con una finestra a zero — la disuguaglianza
    // sarebbe soddisfatta senza dire nulla, e da un timeout a zero non passerebbe una sola
    // generazione.
    expect(vitaMassima, 'vita massima della chiamata a zero').toBeGreaterThan(0); // DoD T-223
    expect(
      GENERATION_TIMEOUTS.max_request_lifetime,
      'finestra della riconciliazione a zero',
    ).toBeGreaterThan(0); // DoD T-223

    expect(
      vitaMassima,
      `timeout_ms x (max_retries+1) = ${vitaMassima} ms, fuori dalla finestra di ` +
        `${GENERATION_TIMEOUTS.max_request_lifetime} ms: due scrittori sulla stessa riga (P2-D15)`,
    ).toBeLessThan(GENERATION_TIMEOUTS.max_request_lifetime); // DoD T-223
  });
});

// ---------------------------------------------------------------------------
// LA DERIVAZIONE di `phase2_chunks_per_site`, contro una TABELLA CALCOLATA A MANO.
//
// PERCHE' NON BASTA RISCRIVERE LA FORMULA, misurato: ai valori odierni (max_pages 10,
// pages_per_chunk 4) la derivazione NON e' distinguibile da un letterale, perche'
// `ceil((10-1)/4)` e `ceil(10/4)` valgono entrambi 3. Sia il letterale `3` al posto della
// formula, sia la sparizione del `- 1` — cioe' la home che torna a contare come pagina
// interna — restavano verdi, e l'unica asserzione che c'era riscriveva la STESSA formula del
// modulo, quindi non poteva che concordare con lui.
//
// Il `- 1` fa differenza solo quando `max_pages ≡ 1 (mod pages_per_chunk)`: le righe 9 e 13
// della tabella sono li' per quello. Il modulo si rigenera contro un DOPPIO di document.ts
// (vi.doMock + vi.resetModules + import dinamico), che e' la stessa tecnica con cui AC-222-3
// distingue una description DERIVATA da una che ripete gli stessi numeri.

/** Coppie `max_pages -> chunk attesi`, calcolate A MANO con `pages_per_chunk` = 4. */
const CHUNK_ATTESI: readonly (readonly [number, number])[] = [
  [9, 2],
  [10, 3],
  [13, 3],
  [14, 4],
];

async function budgetConMaxPages(maxPages: number) {
  vi.resetModules();
  vi.doMock('@/domain/generation/document', () => ({
    DOCUMENT_LIMITS: { ...DOCUMENT_LIMITS, max_pages: maxPages },
  }));
  const { GENERATION_BUDGET: budget } = await import('@/domain/generation/budget');
  return budget;
}

describe('T-223 phase2_chunks_per_site e DERIVATO da DOCUMENT_LIMITS, non un letterale', () => {
  afterEach(() => {
    vi.doUnmock('@/domain/generation/document');
    vi.resetModules();
  });

  // covers: AC-223-4 — il numero di chunk per sito e' il fattore senza il quale "ne sommo il
  // totale PER SITO" non e' calcolabile: se valesse 4 invece di 3, il totale sfonderebbe il
  // tetto. Provarlo derivato e' provare che quel fattore segue il documento invece di essere
  // un numero scritto una volta e dimenticato.
  it('segue max_pages secondo la tabella calcolata a mano', async () => {
    // Anti-vacuita': la tabella e' calcolata su QUESTO valore di pages_per_chunk. Con un altro
    // parlerebbe di un'altra funzione, e concorderebbe col modulo per caso.
    expect(GENERATION_BUDGET.pages_per_chunk, 'la tabella e calcolata su 4 pagine per chunk').toBe(
      4,
    ); // covers: AC-223-4

    for (const [maxPages, attesi] of CHUNK_ATTESI) {
      const budget = await budgetConMaxPages(maxPages);
      expect(
        budget.phase2_chunks_per_site,
        `max_pages=${maxPages}: attesi ${attesi} chunk (la home nasce in fase 1 e non conta)`,
      ).toBe(attesi); // covers: AC-223-4
    }

    // La tabella copre il valore VERO del documento, e il modulo reale vi concorda: senza
    // questa riga la tabella proverebbe una funzione che nessuno usa.
    const rigaVera = CHUNK_ATTESI.find(([maxPages]) => maxPages === DOCUMENT_LIMITS.max_pages);
    expect(rigaVera, `la tabella non copre max_pages=${DOCUMENT_LIMITS.max_pages}`).toBeDefined();
    expect(GENERATION_BUDGET.phase2_chunks_per_site).toBe(rigaVera?.[1]); // covers: AC-223-4
  });
});

describe('T-223 il bound di costo', () => {
  // covers: AC-223-4
  it('il costo massimo per sito, calcolato dalle costanti, sta sotto max_cost_per_site_usd', () => {
    const {
      projection,
      max_tokens,
      phase2_chunks_per_site,
      usd_per_million_tokens,
      code_unit_per_token,
      max_cost_per_site_usd,
    } = GENERATION_BUDGET;

    // Anti-vacuita': con un prezzo o un tetto a zero il bound sarebbe soddisfatto da
    // qualunque cosa, e questo test direbbe che va tutto bene per il motivo sbagliato.
    for (const [nome, valore] of Object.entries({
      input: usd_per_million_tokens.input,
      output: usd_per_million_tokens.output,
      phase1: max_tokens.phase1,
      phase2_chunk: max_tokens.phase2_chunk,
      home: projection.home,
      inner: projection.inner,
      code_unit_per_token,
    })) {
      expect(valore, `${nome} a zero: il bound sarebbe vuoto`).toBeGreaterThan(0); // covers: AC-223-4
    }

    // INPUT: il tetto della proiezione in code unit, convertito in token col proxy ~4:1
    // dichiarato da P2-D17. OUTPUT: il tetto di uscita della fase, speso per intero — il caso
    // peggiore, non quello atteso.
    const costoInput = (codeUnit: number): number =>
      (codeUnit / code_unit_per_token) * (usd_per_million_tokens.input / TOKEN_PER_MILIONE);
    const costoOutput = (token: number): number =>
      token * (usd_per_million_tokens.output / TOKEN_PER_MILIONE);

    const fase1 = costoInput(projection.home) + costoOutput(max_tokens.phase1);
    const chunkFase2 = costoInput(projection.inner) + costoOutput(max_tokens.phase2_chunk);
    const totale = fase1 + chunkFase2 * phase2_chunks_per_site;

    const rapporto =
      `[AC-223-4] costo MASSIMO per sito CALCOLATO dalle costanti di GENERATION_BUDGET ` +
      `(stime P2-D17, non misure): fase 1 ${fase1.toFixed(4)} USD, un chunk di fase 2 ` +
      `${chunkFase2.toFixed(4)} USD x ${phase2_chunks_per_site} chunk = ` +
      `${(chunkFase2 * phase2_chunks_per_site).toFixed(4)} USD, TOTALE ${totale.toFixed(4)} USD ` +
      `su un tetto di ${max_cost_per_site_usd} USD ` +
      `(${((totale / max_cost_per_site_usd) * 100).toFixed(1)}% del budget). ` +
      `L'uscita pesa il ${(((costoOutput(max_tokens.phase1) + costoOutput(max_tokens.phase2_chunk) * phase2_chunks_per_site) / totale) * 100).toFixed(1)}% del totale: ` +
      `il bound e' governato da max_tokens, non dalla proiezione.`;
    console.log(rapporto);

    expect(totale, rapporto).toBeLessThan(max_cost_per_site_usd); // covers: AC-223-4

    // IL CANARY: alzare una costante senza accorgersi del costo deve rendere questo test
    // ROSSO. Si rifa' il conto col doppio di ciascuno dei due max_tokens e si verifica che il
    // tetto SIA sfondato — se non lo fosse, il tetto sarebbe cosi' largo da essere verde
    // qualunque cosa succeda, cioe' non sarebbe un tetto.
    const conFase1Doppia = costoInput(projection.home) + costoOutput(max_tokens.phase1 * 2);
    expect(
      conFase1Doppia + chunkFase2 * phase2_chunks_per_site,
      'il tetto e troppo largo: raddoppiare max_tokens.phase1 non lo sfonda',
    ).toBeGreaterThan(max_cost_per_site_usd); // covers: AC-223-4
    const conChunkDoppio = costoInput(projection.inner) + costoOutput(max_tokens.phase2_chunk * 2);
    expect(
      fase1 + conChunkDoppio * phase2_chunks_per_site,
      'il tetto e troppo largo: raddoppiare max_tokens.phase2_chunk non lo sfonda',
    ).toBeGreaterThan(max_cost_per_site_usd); // covers: AC-223-4

    // COSTO DICHIARATO del canary, misurato e non stimato: i due tetti della PROIEZIONE
    // pesano cosi' poco sul totale che raddoppiarli NON sfonda il tetto (l'input e' ~2,9%
    // della spesa). Il lato input non e' guardato da qui: e' guardato dalla misura di
    // AC-220-4, che confronta la proiezione VERA col suo tetto.
    const conProiezioniDoppie =
      costoInput(projection.home * 2) +
      costoOutput(max_tokens.phase1) +
      (costoInput(projection.inner * 2) + costoOutput(max_tokens.phase2_chunk)) *
        phase2_chunks_per_site;
    expect(conProiezioniDoppie).toBeLessThan(max_cost_per_site_usd); // covers: AC-223-4
  });
});

// ---------------------------------------------------------------------------
// AC-223-6 — NESSUN LETTERALE DUPLICATO.
//
// La ricerca e' deliberatamente limitata ai percorsi dell'AC (src/domain/generation/**,
// src/data/generations.ts e src/data/anthropic.ts) e ai valori ESATTI, per non produrre falsi
// positivi su numeri usati per altro. Il confronto e' per VALORE su ogni letterale numerico
// del sorgente, non per sottostringa: '2400' non deve combaciare con '24000', e '24_000' e
// '24000' sono lo stesso numero scritto in due modi.
//
// IL PERIMETRO COMPRENDE src/data/anthropic.ts PER EMENDAMENTO P2-D30, e non e' una rifinitura
// di simmetria: e' il file che CONSUMA davvero timeout, maxRetries, effort e i due max_tokens,
// cioe' l'unico posto in cui una copia di quei numeri costerebbe qualcosa. Misurato prima
// dell'emendamento: riscrivere `max_tokens: turn.phase === 'phase1' ? 12000 : 24000` con i
// letterali lasciava la suite a 18/18, perche' l'oracolo di T-224 confronta i VALORI e un
// letterale con lo stesso valore e' indistinguibile da una lettura di GENERATION_BUDGET. Il
// perimetro resta comunque ristretto (non tutto src/) per la ragione che l'AC dichiara.
//
// LIMITE DICHIARATO, e il buco e' UNILATERALE: lo scanner vede solo LETTERALI SINGOLI. Un
// valore riscritto come ESPRESSIONE in un file NON dichiarante gli sfugge — misurato, un
// `600 * 1000` messo in prompt.ts (cioe' `timeout_ms` duplicato) SOPRAVVIVE. La stessa
// evasione DENTRO il file dichiarante e' invece PRESA, perche' il canary qui sotto pretende
// che il letterale ci sia. Chiuderlo vorrebbe dire valutare le espressioni del sorgente, cioe'
// un parser al posto di una regex: la ricerca resta per letterale e il buco e' dichiarato
// invece che dimenticato.

/**
 * I file sorvegliati: tutto il dominio della generazione, piu' i due moduli dati che quei
 * numeri li consumano (src/data/generations.ts e — P2-D30 — il confine LLM).
 */
const FILE_SORVEGLIATI: readonly string[] = [
  ...readdirSync(resolve(root, 'src/domain/generation'))
    .filter((nome) => nome.endsWith('.ts'))
    .map((nome) => `src/domain/generation/${nome}`),
  'src/data/generations.ts',
  'src/data/anthropic.ts',
];

type ValoreSorvegliato = {
  readonly nome: string;
  readonly valore: number;
  /** Il SOLO modulo in cui quel letterale e' lecito, perche' e' li' che il valore nasce. */
  readonly dichiaratoIn: string;
};

const SORVEGLIATI: readonly ValoreSorvegliato[] = [
  {
    nome: 'max_tokens.phase1',
    valore: GENERATION_BUDGET.max_tokens.phase1,
    dichiaratoIn: 'src/domain/generation/budget.ts',
  },
  {
    nome: 'max_tokens.phase2_chunk',
    valore: GENERATION_BUDGET.max_tokens.phase2_chunk,
    dichiaratoIn: 'src/domain/generation/budget.ts',
  },
  {
    nome: 'timeout_ms',
    valore: GENERATION_BUDGET.timeout_ms,
    dichiaratoIn: 'src/domain/generation/budget.ts',
  },
  // I DUE TETTI DELLA PROIEZIONE nascono in T-220 e GENERATION_BUDGET li DERIVA: il modulo
  // che li dichiara e' projection.ts, non budget.ts. Escludere quel file per questi due
  // valori non e' un'attenuazione dell'AC — e' il modo in cui l'AC e' soddisfatto nel verso
  // giusto: il letterale esiste una volta sola, e budget.ts lo legge.
  {
    nome: 'projection.home',
    valore: GENERATION_BUDGET.projection.home,
    dichiaratoIn: 'src/domain/generation/projection.ts',
  },
  {
    nome: 'projection.inner',
    valore: GENERATION_BUDGET.projection.inner,
    dichiaratoIn: 'src/domain/generation/projection.ts',
  },
];

/** Ogni letterale numerico del sorgente, come NUMERO (gli underscore non contano). */
function letteraliNumerici(sorgente: string): readonly number[] {
  return [...sorgente.matchAll(/(?<![\w.])\d[\d_]*(?![\w.])/g)].map((trovato) =>
    Number(trovato[0].replace(/_/g, '')),
  );
}

function sorgenteDi(percorso: string): string {
  return readFileSync(resolve(root, percorso), 'utf8');
}

describe('T-223 nessun valore di GENERATION_BUDGET duplicato altrove', () => {
  // covers: AC-223-6
  it('i file sorvegliati sono quelli dell AC, e sono davvero letti', () => {
    // Anti-vacuita': un elenco vuoto o un glob che non prende nulla renderebbe verde tutto
    // cio' che segue senza guardare una riga.
    expect(FILE_SORVEGLIATI.length).toBeGreaterThan(10); // covers: AC-223-6
    for (const atteso of [
      'src/domain/generation/budget.ts',
      'src/domain/generation/prompt.ts',
      'src/domain/generation/projection.ts',
      'src/domain/generation/tool.ts',
      'src/data/generations.ts',
      // P2-D30: il file che consuma timeout, maxRetries, effort e i due max_tokens. Se
      // l'elenco tornasse senza di lui, la provenienza sarebbe asserita ovunque tranne che nel
      // solo posto in cui quei numeri vengono spesi.
      'src/data/anthropic.ts',
    ]) {
      expect(FILE_SORVEGLIATI, `manca dai sorvegliati: ${atteso}`).toContain(atteso); // covers: AC-223-6
    }
    for (const percorso of FILE_SORVEGLIATI) {
      expect(sorgenteDi(percorso).length, `sorgente vuoto: ${percorso}`).toBeGreaterThan(0); // covers: AC-223-6
    }
  });

  // covers: AC-223-6
  it('ogni valore sorvegliato compare come letterale SOLO nel modulo che lo dichiara', () => {
    expect(SORVEGLIATI).toHaveLength(5); // covers: AC-223-6 — i cinque valori nominati dall AC

    for (const { nome, valore, dichiaratoIn } of SORVEGLIATI) {
      // CANARY dello scanner: il letterale c'e' davvero nel modulo che lo dichiara. Senza
      // questa riga uno scanner cieco — regex sbagliata, file non letti — direbbe "nessuna
      // occorrenza" ovunque e il test sarebbe verde per il motivo opposto.
      expect(
        letteraliNumerici(sorgenteDi(dichiaratoIn)),
        `${nome}=${valore} non compare in ${dichiaratoIn}: lo scanner non vede i letterali`,
      ).toContain(valore); // covers: AC-223-6

      for (const percorso of FILE_SORVEGLIATI) {
        if (percorso === dichiaratoIn) continue;
        const occorrenze = letteraliNumerici(sorgenteDi(percorso)).filter(
          (letterale) => letterale === valore,
        );
        expect(
          occorrenze,
          `${nome}=${valore} duplicato in ${percorso}: ogni uso deve passare da GENERATION_BUDGET`,
        ).toEqual([]); // covers: AC-223-6
      }
    }
  });

  // covers: AC-223-6 (voce `maxRetries`, con una DEVIAZIONE DICHIARATA sul come)
  //
  // `max_retries` vale 0, e un numero di UNA CIFRA non e' cercabile per VALORE: '0' e '1'
  // compaiono per mestiere in ogni modulo (indici, `slice`, confronti di lunghezza) e non
  // hanno nulla a che vedere col retry. Il conteggio qui sotto e' MISURATO a ogni esecuzione
  // e stampato: e' la ragione per cui questa voce e' sorvegliata per NOME invece che per
  // valore. L'ancoraggio al nome dice comunque cio' che l'AC vuole — che nessun altro modulo
  // scriva il proprio numero di ritentativi invece di leggerlo da GENERATION_BUDGET.
  it('nessun altro modulo assegna un maxRetries proprio', () => {
    const assegnazione = /(?:max_retries|maxRetries)\s*[:=]\s*\d/;
    const dichiaratoIn = 'src/domain/generation/budget.ts';

    // Positivo: l'assegnazione esiste davvero, e la regex la vede.
    expect(assegnazione.test(sorgenteDi(dichiaratoIn))).toBe(true); // covers: AC-223-6

    const colpiti = FILE_SORVEGLIATI.filter(
      (percorso) => percorso !== dichiaratoIn && assegnazione.test(sorgenteDi(percorso)),
    );
    expect(colpiti, 'un modulo dichiara un proprio numero di ritentativi').toEqual([]); // covers: AC-223-6

    // La MISURA che giustifica la deviazione, e il suo pin: se un giorno il valore di
    // max_retries smettesse di collidere con i numeri usati per altro, questa riga diventa
    // rossa e la ricerca per VALORE va estesa anche a lui.
    const collisioni = FILE_SORVEGLIATI.filter((percorso) => percorso !== dichiaratoIn).flatMap(
      (percorso) =>
        letteraliNumerici(sorgenteDi(percorso)).filter(
          (letterale) => letterale === GENERATION_BUDGET.max_retries,
        ),
    ).length;
    console.log(
      `[AC-223-6] max_retries=${GENERATION_BUDGET.max_retries} e' sorvegliato per NOME e non ` +
        `per valore: il suo letterale compare ${collisioni} volte nei file sorvegliati per ` +
        `ragioni che non hanno nulla a che vedere col retry.`,
    );
    expect(
      collisioni,
      'max_retries non collide piu con altri numeri: la ricerca per valore e ora possibile',
    ).toBeGreaterThan(0);
  });
});
