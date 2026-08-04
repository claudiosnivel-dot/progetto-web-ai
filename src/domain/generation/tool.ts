// T-222 (macrotask generation-llm, P2) — il TOOL STRICT con cui il modello consegna il
// POOL. Dominio PURO: nessun accesso al DB, nessuna rete, nessun client SDK — qui nasce
// solo l'OGGETTO che T-224 passera' al confine unico (src/data/anthropic.ts).
//
// SCRITTO A MANO E NON GENERATO DA PoolSchema, ed e' la decisione portante di questo
// modulo: lo strict tool use accetta un SOTTOINSIEME ristretto di JSON Schema (P1-D20),
// che esclude maxLength/maxItems e i vincoli numerici. Un generatore che partisse dallo
// schema zod emetterebbe proprio quelle keyword — sono i tetti di POOL_LIMITS — e la
// loro presenza e' un 400 alla PRIMA chiamata reale: un errore che nessun oracolo puo'
// vedere finche' non esiste una chiave API. I tetti restano quindi dove sono APPLICATI
// (POOL_LIMITS, pool.ts) e qui si DICHIARANO al modello in prosa, derivandoli da li'.
// Copie divergenti direbbero al modello un limite che la validazione non applica.
//
// LO SCHEMA E' CHIUSO SU DUE ASSI, e nessuno dei due e' cosmetico:
// - `additionalProperties: false` E un `required` NON VUOTO su OGNI nodo object,
//   compresa la coppia domanda/risposta annidata due livelli sotto. Il nested
//   additionalProperties:false SENZA required era il rischio DICHIARATO e mai verificato
//   di P1 (§6-bis p.2); qui l'oracolo esiste e cammina ricorsivamente sull'oggetto
//   REALMENTE prodotto (tests/generation-tool-schema.test.ts).
// - NESSUNA LEVA IN USCITA (P2-D4): le sole property sono gli slot del catalogo e ogni
//   foglia e' una stringa. Nessuna property ammette URL, href, src, HTML, nome di
//   blocco, nome di tema o colore — e' cosi' che un'iniezione riuscita nel brief resta
//   senza leve, perche' non c'e' campo in cui depositarle.
//
// LE PAGINE SONO ENUMERATE, non descritte da un pattern: in PoolSchema `pages` e' una
// mappa a chiavi dinamiche (z.record), ma il sottoinsieme strict non ammette
// patternProperties ne' un `additionalProperties` che porti uno schema. L'allowlist
// degli slug di QUESTA generazione (T-213) entra percio' nello schema come elenco di
// property — la stessa allowlist che `parsePool` poi impone sul ritorno.

import type Anthropic from '@anthropic-ai/sdk';
import { POOL_LIMITS } from '@/domain/generation/pool';
import { SLOTS, type SlotId } from '@/domain/generation/slots';

/**
 * Un nodo dello schema, ristretto al SOTTOINSIEME che lo strict tool use accetta
 * (P1-D20). Il tipo e' la prima delle due difese: nessuna keyword fuori sottoinsieme —
 * maxLength, maxItems, minimum, $ref — e' scrivibile qui senza un errore di typecheck.
 * La seconda difesa e' la guardia ricorsiva del test, che guarda l'oggetto prodotto:
 * serve entrambe perche' il tipo non sorveglia cio' che arriva da un cast e non sa dire
 * se un `required` e' vuoto.
 */
type NodoSchema =
  | { readonly type: 'string'; readonly description?: string }
  | { readonly type: 'array'; readonly description?: string; readonly items: NodoSchema }
  | {
      readonly type: 'object';
      readonly description?: string;
      readonly properties: Readonly<Record<string, NodoSchema>>;
      readonly required: readonly string[];
      readonly additionalProperties: false;
    };

type SlotDelCatalogo = (typeof SLOTS)[number];

// La coppia domanda/risposta: e' l'unico oggetto ANNIDATO dello schema, cioe' il nodo
// che in P1 sarebbe rimasto senza `required`. Entrambi i campi sono richiesti per la
// stessa ragione per cui lo sono in QaPairSchema (pool.ts): una domanda senza risposta
// non e' una FAQ, e' una domanda.
const COPPIA_QA: NodoSchema = {
  type: 'object',
  properties: {
    question: { type: 'string', description: 'La domanda, nelle parole di un cliente.' },
    answer: { type: 'string', description: 'La risposta, completa ma breve.' },
  },
  required: ['question', 'answer'],
  additionalProperties: false,
};

// Il valore ammesso per ciascun kind del catalogo. E' una mappa TOTALE sul tipo del
// kind: un kind aggiunto a slots.ts senza il proprio schema qui rompe il typecheck e
// obbliga a decidere, invece di produrre in silenzio uno schema che non lo prevede.
// La `description` viene dal catalogo (slots.ts la scrive senza numeri, apposta): i
// numeri stanno tutti nella description del tool, derivati da POOL_LIMITS.
const VALORE_PER_KIND: Readonly<
  Record<SlotDelCatalogo['kind'], (slot: SlotDelCatalogo) => NodoSchema>
> = {
  text: (slot) => ({ type: 'string', description: slot.description }),
  list: (slot) => ({ type: 'array', description: slot.description, items: { type: 'string' } }),
  qa: (slot) => ({ type: 'array', description: slot.description, items: COPPIA_QA }),
};

/** Il nome con cui il modello invoca il tool, e con cui T-224 riconosce il blocco tool_use. */
const NOME_DEL_TOOL = 'emit_pool';

// I TETTI DETTI AL MODELLO, DERIVATI. Non sono un vincolo dello schema (il sottoinsieme
// strict non li ammette) ma una richiesta in prosa: la validazione vera resta parsePool.
// Sono interpolati da POOL_LIMITS e non riscritti a mano perche' un letterale duplicato
// qui direbbe al modello un limite diverso da quello che poi scarta la sua risposta —
// e la divergenza sarebbe silenziosa fino alla prima generazione rifiutata.
const DESCRIZIONE_DEL_TOOL = [
  'Consegna il contenuto testuale del sito: una voce per ogni pagina richiesta e, dentro',
  'ciascuna, una voce per ogni slot richiesto. Scrivi solo cio che il brief dichiara: non',
  'inventare fatti, recapiti, orari, prezzi ne citazioni.',
  `TETTI, in caratteri: ogni testo al massimo ${POOL_LIMITS.text};`,
  `ogni voce di elenco al massimo ${POOL_LIMITS.list_item},`,
  `e al massimo ${POOL_LIMITS.list_items} voci per elenco;`,
  `ogni domanda al massimo ${POOL_LIMITS.qa_question}`,
  `e ogni risposta al massimo ${POOL_LIMITS.qa_answer},`,
  `con al massimo ${POOL_LIMITS.qa_pairs} coppie.`,
  'Un valore oltre il tetto fa scartare la risposta INTERA: non viene tagliato.',
].join(' ');

/**
 * Costruisce il tool strict del pool per UN turno di generazione: enumera esattamente
 * gli slot e le pagine richieste, e nient'altro del catalogo.
 *
 * @param slotIds gli id di slot che questo turno deve far scrivere al modello. Il
 *   confronto col catalogo e' per UGUAGLIANZA ESATTA (mai per prefisso): `hero_title` e
 *   `hero_title_kicker` sono due slot diversi, e uno e' prefisso dell'altro.
 * @param pageSlugs gli slug delle pagine di questa generazione (T-213). Sono l'allowlist
 *   che entra nello schema; i duplicati collassano, perche' una property e' una sola.
 * @returns l'oggetto tool con `strict: true`, pronto per `messages.create`.
 * @throws se non resta alcuno slot del catalogo o alcuna pagina: uno schema con
 *   `properties` vuoto avrebbe un `required` vuoto, cioe' violerebbe l'invariante che
 *   questo modulo dichiara, e sarebbe comunque una richiesta senza contenuto.
 */
export function buildPoolTool(
  slotIds: readonly SlotId[],
  pageSlugs: readonly string[],
): Anthropic.Tool {
  const richiesti = new Set<string>(slotIds);
  // DERIVATO DAL CATALOGO, non ricostruito: gli slot mantengono l'ordine e la
  // descrizione di slots.ts, che e' la sola sede in cui esistono.
  const slotRichiesti = SLOTS.filter((slot) => richiesti.has(slot.id));
  const slugUnici = [...new Set(pageSlugs)];

  if (slotRichiesti.length === 0 || slugUnici.length === 0) {
    throw new Error('buildPoolTool: servono almeno uno slot del catalogo e almeno una pagina');
  }

  // Una pagina: gli slot richiesti, tutti obbligatori. Sono obbligatori perche' il turno
  // chiede ESATTAMENTE quelli — la scelta di quali slot esistano per un sito la fanno i
  // blocchi (T-210) e le pagine (T-213), prima di arrivare qui.
  const schemaDellaPagina: NodoSchema = {
    type: 'object',
    properties: Object.fromEntries(
      slotRichiesti.map((slot) => [slot.id, VALORE_PER_KIND[slot.kind](slot)]),
    ),
    required: slotRichiesti.map((slot) => slot.id),
    additionalProperties: false,
  };

  const schemaDellePagine: NodoSchema = {
    type: 'object',
    description: 'Una voce per ogni pagina richiesta, con la chiave uguale allo slug della pagina.',
    properties: Object.fromEntries(slugUnici.map((slug) => [slug, schemaDellaPagina])),
    required: slugUnici,
    additionalProperties: false,
  };

  return {
    name: NOME_DEL_TOOL,
    description: DESCRIZIONE_DEL_TOOL,
    strict: true,
    input_schema: {
      type: 'object',
      properties: { pages: schemaDellePagine },
      required: ['pages'],
      additionalProperties: false,
    },
  };
}
