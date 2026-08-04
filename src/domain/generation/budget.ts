// T-223 (macrotask generation-llm, P2) — GENERATION_BUDGET: le costanti di budget della
// generazione, in UN SOLO POSTO. Dominio PURO: nessun accesso al DB, nessuna rete, nessun
// client SDK — qui non si chiama nulla, si dichiara soltanto quanto costa chiamare.
//
// PERCHE' UN SOLO MODULO. Questi numeri governano insieme il COSTO, la LATENZA e cio' che
// il modello puo' produrre, e sono letti da posti diversi: la proiezione (T-220), il
// confine (T-224) e l'harness di misura (T-225). Copie sparse divergerebbero in silenzio, e
// il modo in cui si accorgerebbe qualcuno sarebbe la fattura. AC-223-6 lo impone con un
// oracolo: l'occorrenza LETTERALE di questi valori e' vietata in src/domain/generation/** e
// in src/data/generations.ts, questo modulo escluso.
//
// SONO STIME A TAVOLINO, DICHIARATE PROVVISORIE (P2-D17), non misure. `count_tokens` e' un
// endpoint API e senza chiave non esiste alcun modo di contare i token per davvero: il
// proxy in code unit al rapporto ~4:1 e' tutto cio' che abbiamo. La sede della taratura e'
// T-225, che gira SOLO in presenza di una chiave e altrimenti si dichiara non eseguito, mai
// verde. Di conseguenza AC-223-4 asserisce la COERENZA INTERNA del bound — che la somma dei
// tetti dichiarati stia sotto il tetto di spesa dichiarato — e NON la correttezza delle
// stime: nessun oracolo di questo macrotask puo' dire se 12.000 token bastino davvero.
//
// COSA NON C'E' QUI: i tetti di POOL_LIMITS (pool.ts) e di BRIEF_LIMITS (brief.ts). Sono
// tetti di SICUREZZA applicati dalla validazione, non budget: vivono accanto allo schema che
// li impone. I due tetti della PROIEZIONE invece compaiono, ma DERIVATI da PROJECTION_LIMITS
// (T-220) e non ricopiati — sono il lato input del bound, e l'unico modo di tenerli allineati
// con cio' che il test di T-220 misura davvero e' leggerli da li'.

import type Anthropic from '@anthropic-ai/sdk';
import { DOCUMENT_LIMITS } from '@/domain/generation/document';
import { PROJECTION_LIMITS } from '@/domain/generation/projection';

/**
 * I livelli di `effort` ammessi dall'API, presi dal tipo dell'SDK invece che riscritti: un
 * valore inventato e' cosi' un errore di typecheck qui, e non un 400 alla prima chiamata
 * reale — che e' l'unico posto in cui si vedrebbe, perche' senza chiave nessun oracolo lo
 * puo' osservare (stessa lezione di P1-D20 sul sottoinsieme JSON Schema).
 */
type LivelloDiEffort = NonNullable<Anthropic.OutputConfig['effort']>;

/** Pagine per chunk della fase 2 (P2-D13: le pagine interne si generano "a chunk di ~4"). */
const PAGINE_PER_CHUNK = 4;

/**
 * TUTTE le costanti di budget della generazione.
 *
 * COME SONO SCELTI I NUMERI, uno per uno — sono stime, ma non arbitrarie:
 *
 * - `max_tokens.phase1`: il pool della HOME. Il caso peggiore AMMESSO da POOL_LIMITS per una
 *   pagina con tutti e diciassette gli slot del catalogo e' ~21.700 code unit di JSON, cioe'
 *   ~5.400 token col proxy ~4:1. Il resto del tetto e' per il PENSIERO, che su Sonnet 5 e'
 *   adaptive e non si spegne mai (P2-D11) e che `max_tokens` conta insieme all'uscita.
 * - `max_tokens.phase2_chunk`: un chunk di `pages_per_chunk` pagine interne. Lo schema del
 *   tool chiede gli stessi slot per OGNI pagina del chunk (T-222), quindi il caso peggiore
 *   cresce con le pagine e non con le sezioni: ~14.000 token di uscita piu' il pensiero.
 * - Un tetto SFONDATO non produce contenuto tagliato: la risposta torna con
 *   stop_reason 'max_tokens' e T-224 la rifiuta con un codice di motivo. Il costo di una
 *   stima troppo bassa e' una generazione fallita e nominata, non un sito mutilato.
 * - `effort`: 'medium' e' la LEVA di P2-D11 al posto del pensiero spento, che qui e' vietato
 *   (su Sonnet 5 il pensiero disattivato riduce la propensione a usare i tool, e il nostro
 *   pool E' una tool-call). Il default dell'API e' 'high': scendere di un gradino toglie
 *   token di pensiero a un compito che e' prosa breve dentro uno schema chiuso, non
 *   ragionamento. E' la stima piu' fragile di tutte, perche' il suo effetto sulla QUALITA'
 *   del copy non e' osservabile senza chiave: T-225.
 * - `timeout_ms`: 10 minuti. Vincolo DI MONTE, gia' scritto in timeouts.ts (righe 28-35): il
 *   timeout del client del modello deve stare DENTRO GENERATION_TIMEOUTS.max_request_lifetime
 *   (13 minuti), altrimenti la richiesta che POSSIEDE la riga 'generating' sopravviverebbe
 *   alla finestra oltre la quale la riconciliazione la dichiara abbandonata (P2-D15), e due
 *   scrittori si troverebbero sulla stessa riga. La vita massima della chiamata non e' pero'
 *   il solo `timeout`: l'SDK RITENTA anche i timeout, quindi vale timeout x (max_retries+1)
 *   — con zero ritentativi (qui sotto) coincide col timeout, e 10 < 13 regge.
 * - `max_retries`: ZERO, ed e' una scelta e non un default. Un ritentativo automatico e' una
 *   seconda generazione che nessuno ha chiesto — quando esistera' P5, un secondo addebito —
 *   e su un turno che puo' essere gia' costato minuti raddoppierebbe anche la finestra di
 *   cui sopra. Il fallimento resta TERMINALE e nominato (T-224), che e' la stessa regola con
 *   cui il pool fuori scala viene scartato invece che tagliato.
 * - `usd_per_million_tokens`: i prezzi di listino di Sonnet 5 (3 / 15 USD per milione di
 *   token). Deliberatamente NON il prezzo introduttivo (2 / 10, in vigore fino al
 *   2026-08-31, cioe' un mese): un bound calcolato sullo sconto diventerebbe falso il giorno
 *   in cui lo sconto scade, e sarebbe falso in silenzio.
 * - `max_cost_per_site_usd`: il tetto del CASO PEGGIORE per sito, non della spesa attesa —
 *   presuppone che ogni chiamata esaurisca il proprio `max_tokens`, cosa che non succede
 *   quasi mai. Sta ~7% sopra il caso peggiore calcolato: abbastanza stretto perche'
 *   raddoppiare uno dei due `max_tokens` lo sfondi (il canary di AC-223-4 lo misura),
 *   abbastanza largo da non diventare rosso per un arrotondamento. La taratura di crediti e
 *   prezzi NON si decide su questo numero: e' P5, e attende la misura di T-225.
 */
export const GENERATION_BUDGET = {
  /**
   * I tetti in code unit delle due proiezioni (T-220), lato INPUT del bound. DERIVATI da
   * PROJECTION_LIMITS: sono la stessa costante che il test di T-220 misura contro un brief
   * al tetto di P1-D17, e riscriverli qui vorrebbe dire calcolare il budget su un numero che
   * nessuno misura.
   */
  projection: {
    home: PROJECTION_LIMITS.home,
    inner: PROJECTION_LIMITS.inner,
  },
  /** Tetto di uscita (pensiero compreso) per fase. */
  max_tokens: {
    /** Fase 1: la singola chiamata che produce il pool della home (P2-D2/D6). */
    phase1: 12_000,
    /** Fase 2: UN chunk di pagine interne, dopo la scelta della variante (P2-D13). */
    phase2_chunk: 24_000,
  },
  /** Pagine interne per chunk della fase 2 (P2-D13). */
  pages_per_chunk: PAGINE_PER_CHUNK,
  /**
   * Quanti chunk di fase 2 puo' costare un sito nel caso peggiore: tutte le pagine ammesse
   * dal documento (T-202) meno la home, che nasce in fase 1. DERIVATO da DOCUMENT_LIMITS
   * perche' e' quello il tetto che il documento impone davvero; e' il moltiplicatore senza
   * il quale "il totale per sito" di AC-223-4 non e' calcolabile.
   */
  phase2_chunks_per_site: Math.ceil((DOCUMENT_LIMITS.max_pages - 1) / PAGINE_PER_CHUNK),
  /** La leva sul pensiero (P2-D11). Mai `thinking: disabled`: quello e' vietato, non tarato. */
  effort: 'medium' satisfies LivelloDiEffort,
  /** Timeout del client del modello, in MILLISECONDI. Dentro GENERATION_TIMEOUTS.max_request_lifetime. */
  timeout_ms: 600_000,
  /** Ritentativi automatici del client SDK. Zero: nessuna seconda generazione non chiesta. */
  max_retries: 0,
  /** Prezzi di listino, in USD per MILIONE di token. */
  usd_per_million_tokens: {
    input: 3,
    output: 15,
  },
  /**
   * Il proxy dichiarato da P2-D17: ~4 code unit UTF-16 per token. Non e' una misura — e'
   * cio' che resta quando `count_tokens` non e' raggiungibile.
   */
  code_unit_per_token: 4,
  /** Tetto di spesa del CASO PEGGIORE per sito, in USD. Provvisorio come tutto il resto. */
  max_cost_per_site_usd: 1.4,
} as const;
