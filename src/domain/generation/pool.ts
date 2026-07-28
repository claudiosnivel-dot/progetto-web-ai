// T-201 (macrotask generation-model, P2) — schema del POOL, cioe' la forma
// dell'uscita del modello: una mappa pagina -> slot -> valore, dove il valore
// rispetta il kind dello slot dichiarato in slots.ts. Dominio PURO: nessun accesso
// al DB, nessun side effect, nessun client Supabase.
//
// E' IL GATE. Il pool e' l'output di un LLM, cioe' input NON FIDATO (OWASP A05:2025
// / ASVS Validation & Business Logic): `parsePool` e' il confine server-side che
// attraversa ogni contenuto prima di raggiungere il DB (writePool, T-204) e prima di
// essere reso (T-231). La colonna generation_pools.content e' jsonb OPACO — il DB non
// valida nulla — quindi questa e' l'unica validazione che esiste.
//
// STRICT PER COSTRUZIONE, non filtrato: nessuno slug di pagina fuori dall'allowlist
// passata al parse, nessuno slot id fuori dal catalogo, nessuna chiave sconosciuta a
// nessun livello. La superficie di cio' che il modello puo' far arrivare a valle e'
// CHIUSA. Ne segue anche che la taglia del pool e' limitata senza bisogno di un tetto
// proprio sul numero di pagine: le pagine sono al piu' quante ne ammette l'allowlist,
// gli slot al piu' quanti ne dichiara il catalogo, e ogni valore ha il suo tetto qui
// sotto.
//
// CHIUSO E' ANCHE IL CANALE DELL'ERRORE (P2-D20): il ramo di rifiuto di `parsePool`
// non e' l'errore di validazione grezzo, ma una struttura DERIVATA e limitata ALLA
// FONTE. Le chiavi di slot fuori catalogo e gli slug sono SCRITTI DAL MODELLO e
// finirebbero verbatim e senza tetto nell'errore — cioe' proprio in cio' che T-204
// traduce in `failure_reason` e che qualcuno logga. Chiudere il canale del DATO e
// lasciare aperto quello dell'ERRORE non chiude niente.
//
// I TETTI VIVONO QUI E NON NELLO SCHEMA DEL TOOL: lo strict tool use esclude
// maxLength/maxItems dal sottoinsieme JSON Schema ammesso (P1-D20), quindi la
// validazione DEVE avvenire dopo il ritorno del modello. Il tool (T-222) li dichiara
// in prosa nella `description`, derivandoli da POOL_LIMITS.
//
// NESSUN TRONCAMENTO: un valore fuori scala e' SCARTATO insieme al pool, mai tagliato
// per farlo entrare — troncare e' corruzione silenziosa, ed e' lo stesso contratto di
// P1-D17. Chi chiama vede un errore, non un contenuto mutilato.

import { z } from 'zod';
import { isPlainObject, limitIssues } from '@/domain/generation/gate';
import { SLOTS, type SlotId } from '@/domain/generation/slots';

// UNITA' DI MISURA: sono CODE UNIT UTF-16 (String.prototype.length, cio' che .max()
// conta), non "caratteri" — stessa scelta e stessa avvertenza di BRIEF_LIMITS
// (P1-D17): un'emoji o un carattere fuori dal BMP pesa due.
//
// I tetti stanno in UNA definizione perche' lo schema li referenzia e il tool (T-222)
// li dichiarera' al modello leggendoli da qui: copie divergenti direbbero al modello
// un limite che la validazione non applica.
//
// PERCHE' questi numeri: sono tetti di SICUREZZA (impediscono che un turno del
// modello faccia arrivare al DB e al rendering un testo di taglia arbitraria), non
// linee guida di stile — la guida su quanto scrivere sta nella description del tool.
// Sono dimensionati sul contenuto piu' lungo che ogni kind puo' legittimamente
// ospitare: un paragrafo di introduzione per 'text', una riga per la voce di 'list',
// un paragrafo breve per la risposta di 'qa'. Il numero di voci e di coppie e'
// dimensionato su quante ne regge un blocco senza diventare un elenco infinito.
export const POOL_LIMITS = {
  /** Tetto in code unit di ogni valore di kind 'text'. */
  text: 600,
  /** Tetto in code unit di ogni voce di una 'list'. */
  list_item: 240,
  /** Numero massimo di voci di una 'list'. */
  list_items: 12,
  /** Tetto in code unit della domanda di una coppia 'qa'. */
  qa_question: 180,
  /** Tetto in code unit della risposta di una coppia 'qa'. */
  qa_answer: 800,
  /** Numero massimo di coppie domanda/risposta di uno slot 'qa'. */
  qa_pairs: 10,
  /**
   * Numero massimo di issue che il ramo di errore di `parsePool` riporta. Lo STESSO
   * tetto vale per le liste DENTRO un issue (le chiavi non riconosciute): un solo
   * issue di tipo unrecognized_keys puo' portare tutte le chiavi che il modello ha
   * scritto, quindi limitare il numero di issue senza limitare quelle liste non
   * limiterebbe l'errore.
   */
  error_issues: 24,
  /**
   * Lunghezza massima, in code unit, di OGNI stringa riportata dal ramo di errore:
   * segmenti di path, messaggi e chiavi non riconosciute. E' il tetto che rende
   * l'errore indipendente dalla taglia dell'input.
   */
  error_chars: 120,
} as const;

// Una coppia domanda/risposta: strict, entrambi i campi richiesti (una domanda senza
// risposta non e' una FAQ, e' una domanda).
const QaPairSchema = z
  .object({
    question: z.string().max(POOL_LIMITS.qa_question),
    answer: z.string().max(POOL_LIMITS.qa_answer),
  })
  .strict();

// Lo schema del valore per ciascun kind: e' la sola sede in cui i tetti sono
// applicati, e vi si arriva SEMPRE passando dal `kind` dichiarato nel catalogo.
const VALUE_SCHEMAS = {
  text: z.string().max(POOL_LIMITS.text),
  list: z.array(z.string().max(POOL_LIMITS.list_item)).max(POOL_LIMITS.list_items),
  qa: z.array(QaPairSchema).max(POOL_LIMITS.qa_pairs),
} as const;

// La shape della pagina e' DERIVATA dal catalogo: gli slot sono dichiarati una volta
// sola (slots.ts) e qui si legano al proprio schema attraverso il kind. Una seconda
// lista scritta a mano divergerebbe in silenzio dal catalogo — e uno slot presente
// nel catalogo ma assente dallo schema sarebbe un contenuto che il modello puo'
// nominare e la validazione rifiuta.
// I tipi qui sotto sono il modo di conservare la PRECISIONE che il ciclo perde:
// l'oggetto costruito a runtime ha esattamente questa forma. E la coincidenza fra lo
// schema e il catalogo non e' affidata alla sola costruzione: e' ASSERITA (AC-201-7,
// tests/pool-schema.test.ts) su tre fronti, perche' nessuno dei tre copre gli altri —
// le chiavi di PAGE_SHAPE confrontate per uguaglianza esatta con gli id del catalogo,
// un pool DERIVATO da SLOTS che contiene ogni slot e deve validare per intero, e
// cardinalita', id e kind del catalogo pinnati su una lista scritta a mano. Uno slot
// omesso qui, cancellato dal catalogo o cambiato di kind e' rosso.
type SlotOf<K extends SlotId> = Extract<(typeof SLOTS)[number], { id: K }>;
type PageShape = { [K in SlotId]: z.ZodOptional<(typeof VALUE_SCHEMAS)[SlotOf<K>['kind']]> };

const PAGE_SHAPE = Object.fromEntries(
  SLOTS.map((slot) => [slot.id, VALUE_SCHEMAS[slot.kind].optional()]),
) as PageShape;

// Ogni slot e' OPZIONALE (i blocchi che non esistono non hanno contenuto, P2-D7) ma
// il set delle chiavi e' CHIUSO: uno slot id fuori catalogo fa fallire il parse con
// unrecognized_keys, e non sopravvive nel risultato perche' un parse fallito non
// restituisce dato.
const PageContentSchema = z.object(PAGE_SHAPE).strict();

// Forma dello slug di pagina: minuscole, cifre e trattini singoli. NON e' l'allowlist
// (quella la impone parsePool, per uguaglianza esatta): serve a escludere per FORMA
// le chiavi speciali di JavaScript — '__proto__' su tutte — da una mappa a chiavi
// dinamiche che nasce da JSON non fidato, dove sono proprieta' PROPRIE e non
// verrebbero notate.
const PageSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/**
 * La FORMA del pool: `{ pages: { <slug>: { <slotId>: valore } } }`, strict a ogni
 * livello. NON E' IL GATE, malgrado il nome: non conosce l'allowlist degli slug —
 * quella dipende dal set di pagine derivato per quel sito (T-213) e arriva a
 * `parsePool` — non impone la guardia di provenienza sull'input e restituisce
 * l'errore di validazione grezzo, senza tetto.
 *
 * Usato DA SOLO accetta quindi qualunque slug ben formato, comprese pagine che questa
 * generazione non prevede e comprese quelle che la mappa porta dal proprio prototipo
 * (`z.record` enumera con for-in). Il solo punto d'ingresso per l'uscita del modello e'
 * `parsePool`: questo schema e' esportato perche' e' la forma condivisa (T-222 ne
 * deriva il tool), non perche' sia una seconda porta.
 */
export const PoolSchema = z
  .object({
    pages: z.record(PageSlugSchema, PageContentSchema),
  })
  .strict();

export type Pool = z.infer<typeof PoolSchema>;

/**
 * Il ramo di errore di `parsePool`. NON e' la ZodError originale: e' una struttura
 * DERIVATA e LIMITATA ALLA FONTE, e i suoi due soli invarianti sono che gli issue
 * riportati sono al piu' `POOL_LIMITS.error_issues` e che NESSUNA stringa che vi
 * compare — segmento di path, messaggio o chiave non riconosciuta — supera
 * `POOL_LIMITS.error_chars` code unit.
 *
 * Ne segue che e' un TRONCAMENTO, non una riproduzione dell'input: path e codice
 * sopravvivono, quindi ogni issue riportato nomina ancora lo slot o lo slug che l'ha
 * causato, ma gli issue oltre il tetto non compaiono affatto e le chiavi elencate in
 * un unrecognized_keys possono essere meno di quelle scritte dal modello. Dice DOVE,
 * non QUANTE volte.
 */
type PoolValidationError = { readonly issues: readonly z.ZodIssue[] };

type ParsePoolResult =
  | { readonly ok: true; readonly pool: Pool }
  | { readonly ok: false; readonly error: PoolValidationError };

// LA GUARDIA DI PROVENIENZA e IL LIMITATORE DELL'ERRORE vivono in gate.ts e sono gli
// STESSI che usa `parseDocument` (T-202): due copie divergerebbero, ed e' gia' successo
// una volta — questo modulo limitava il proprio errore e il documento no, mentre T-204
// traduce entrambi nella stessa colonna `failure_reason`. Cio' che resta qui sono i
// TETTI (POOL_LIMITS), che sono il contratto di questo modulo e non della funzione.

// L'unico costruttore del ramo di errore: nessuna via che non passi di qui, altrimenti
// il tetto dipenderebbe da chi scrive il return.
function limitedFailure(issues: readonly z.ZodIssue[]): ParsePoolResult {
  return { ok: false, error: { issues: limitIssues(issues, POOL_LIMITS) } };
}

/**
 * IL GATE sull'uscita del modello — il solo da chiamare su input non fidato. Non
 * LANCIA mai: restituisce il pool tipizzato oppure l'errore limitato, e chi chiama
 * deve scegliere cosa farne (T-204 lo traduce in una generazione 'failed', senza
 * scrivere nulla).
 *
 * `allowedSlugs` e' l'allowlist delle pagine ammesse per QUESTA generazione: uno
 * slug che non vi compare fa fallire l'intero parse, quindi nessun contenuto di una
 * pagina non prevista puo' raggiungere il DB o il rendering.
 *
 * COSA IL GATE NON GARANTISCE, e chi consuma non deve dedurre:
 * - `ok: true` NON significa "c'e' contenuto": un pool VUOTO (`{ pages: {} }`, o una
 *   pagina senza alcuno slot) e' accettato. Quali slot debbano esistere perche' un
 *   blocco sia renderizzabile e' una precondizione dei BLOCCHI (T-210), che qui non
 *   sono noti; imporla qui la scriverebbe due volte e nel posto sbagliato.
 * - l'errore NON e' l'errore di validazione grezzo ne un elenco completo: e' troncato
 *   nel numero di issue e nella lunghezza di ogni stringa (vedi
 *   `PoolValidationError`), quindi va bene per dire QUALE slot o slug ha rotto il
 *   parse, non per contare i problemi ne per ricostruire l'input.
 */
export function parsePool(
  input: unknown,
  options: { readonly allowedSlugs: readonly string[] },
): ParsePoolResult {
  // GUARDIA DI PROVENIENZA, prima di ogni lettura: solo un oggetto semplice.
  if (!isPlainObject(input)) {
    return limitedFailure([
      { code: z.ZodIssueCode.custom, path: [], message: 'il pool non e un oggetto semplice' },
    ]);
  }

  // ALLOWLIST SULLE CHIAVI GREZZE, PRIMA DELLA FORMA: se aspettasse il parse di forma,
  // una pagina non ammessa che porta ANCHE un errore di tipo farebbe abortire zod
  // prima, e l'errore non nominerebbe piu' lo slug fuori allowlist — T-204 ne
  // dedurrebbe la ragione sbagliata. Il pool resta rifiutato in entrambi gli ordini:
  // cio' che cambia e' se l'errore dice la verita' su chi l'ha causato.
  const allowed = new Set<string>(options.allowedSlugs);
  const pages: unknown = input.pages;
  if (typeof pages === 'object' && pages !== null) {
    // LA GUARDIA VALE ANCHE PER LA MAPPA DELLE PAGINE, e non e' cerimonia: z.record
    // enumera le chiavi con for-in, cioe' vede anche quelle EREDITATE, mentre
    // l'allowlist qui sopra guarda le chiavi PROPRIE. Senza questa riga uno slug non
    // ammesso, portato dal prototipo della mappa, passerebbe il controllo (che non lo
    // vede) e verrebbe poi accettato dalla forma (che lo vede): il gate direbbe ok su
    // una pagina fuori allowlist. O la mappa e' un oggetto semplice, o il pool cade.
    if (!isPlainObject(pages)) {
      return limitedFailure([
        {
          code: z.ZodIssueCode.custom,
          path: ['pages'],
          message: 'la mappa delle pagine non e un oggetto semplice',
        },
      ]);
    }
    // UGUAGLIANZA ESATTA, mai startsWith/includes: 'offerte' non ammette
    // 'offerte-speciali' e viceversa. Un confronto per prefisso qui aprirebbe
    // l'allowlist a tutte le pagine che iniziano con un nome ammesso.
    const fuoriAllowlist = Object.keys(pages).filter((slug) => !allowed.has(slug));
    if (fuoriAllowlist.length > 0) {
      return limitedFailure(
        fuoriAllowlist.map((slug) => ({
          code: z.ZodIssueCode.custom,
          // Lo slug viaggia nel PATH e non nel testo del messaggio: qui e' ancora una
          // chiave GREZZA, cioe' scritta dal modello e non ancora passata dalla forma
          // di PageSlugSchema. Nel path il limitatore lo tronca; un messaggio composto
          // per interpolazione lo troncherebbe altrettanto, ma nasconderebbe dentro
          // una frase che il testo e' d'origine ostile.
          path: ['pages', slug],
          message: 'slug di pagina fuori allowlist',
        })),
      );
    }
  }

  const parsed = PoolSchema.safeParse(input);
  return parsed.success ? { ok: true, pool: parsed.data } : limitedFailure(parsed.error.issues);
}
