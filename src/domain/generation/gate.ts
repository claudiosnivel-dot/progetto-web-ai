// T-201 / T-202 (macrotask generation-model, P2) — le DUE primitive che i gate su
// input NON FIDATO condividono: `parsePool` (pool.ts) e `parseDocument` (document.ts).
// Dominio PURO: nessun accesso al DB, nessun side effect, nessuno schema.
//
// PERCHE' UN MODULO E NON DUE COPIE: le due funzioni qui sotto sono difese, non
// utilita'. Due copie divergerebbero — ed e' gia' successo: `parsePool` limitava il
// proprio ramo di errore (P2-D20) e `parseDocument` no, mentre T-204 traduce ENTRAMBI
// gli errori nella stessa colonna `failure_reason`. Una difesa scritta due volte e'
// una difesa che a un certo punto vale in un posto solo.
//
// COSA NON C'E' QUI: i TETTI. Restano in POOL_LIMITS e in DOCUMENT_LIMITS, ciascuno
// accanto allo schema che governa, perche' sono parte del contratto di quel modulo (e
// il test di T-201 asserisce l'insieme esatto delle chiavi di POOL_LIMITS). Qui passano
// come parametro: la funzione e' condivisa, i numeri no.
//
// AGGIUNTA IL 2026-07-30, al checkpoint di `generation-engine`: `testoPresente`. Non era
// una primitiva dei gate quando questo file e' nato, ma e' diventata la stessa cosa —
// una DECISIONE SEMANTICA condivisa — ed era scritta TRE VOLTE identica, in blocks.ts
// (T-210), pages.ts (T-213) e resolve.ts (T-214). L'oracolo d'igiene l'ha vista come due
// duplicazioni nuove, e la regola scritta in testa a questo file vale parola per parola
// anche per lei: una difesa scritta tre volte e' una difesa che a un certo punto vale in
// un posto solo.

import { z } from 'zod';

/**
 * Un testo del brief e' "PRESENTE" solo se non e' vuoto DOPO il trim.
 *
 * NON E' UN'UTILITA': e' la soglia che decide se un blocco ESISTE (T-210), quindi se il
 * modello riceve o no gli slot di quella sezione (T-220) — cioe' se ha la POSSIBILITA' di
 * inventarla (P2-D7). Lo stesso predicato decide poi se una PAGINA esiste (T-213) e se un
 * campo entra nel documento congelato (T-214). Se le tre letture divergessero, un blocco
 * esisterebbe per un modulo e non per l'altro, e il difetto si vedrebbe solo nel sito
 * pubblicato.
 *
 * PERCHE' IL TRIM E' PORTANTE: lo schema del brief trima il solo `business_name` (T-121),
 * quindi un `address` di soli spazi e' un valore VALIDO che renderebbe una riga vuota.
 * Presente-e-vuoto e' assente — ed e' la stessa regola con cui `orariUtili` scarta una
 * mappa di orari fatta di sole chiavi.
 */
export function testoPresente(valore: string | undefined): boolean {
  return typeof valore === 'string' && valore.trim().length > 0;
}

/** I due tetti del ramo di errore. Non esportato: chi chiama passa le proprie costanti. */
type ErrorLimits = {
  /** Numero massimo di issue riportati, e di elementi di ogni lista dentro un issue. */
  readonly error_issues: number;
  /** Lunghezza massima, in code unit, di OGNI stringa riportata. */
  readonly error_chars: number;
};

/**
 * Vero solo per un oggetto SEMPLICE, cioe' cio' che JSON.parse produce.
 *
 * E' la GUARDIA DI PROVENIENZA di entrambi i gate, e non e' cerimonia: `z.object` legge
 * `data.pages` e la troverebbe anche sul PROTOTIPO, mentre `strict` guarda le chiavi
 * PROPRIE. Senza questa riga un input potrebbe portare il proprio contenuto per
 * eredita' e attraversare un gate che si crede chiuso. Lo stesso vale un livello piu'
 * sotto per la mappa delle pagine del pool, che `z.record` enumera con for-in.
 *
 * `getPrototypeOf` e' dentro un try: su un Proxy la trappola omonima puo' LANCIARE, e
 * un'eccezione qui uscirebbe dai due gate che promettono entrambi di non lanciare mai.
 * Un valore che non sa nemmeno dire da dove viene non e' un oggetto semplice: e' un
 * rifiuto, non un'eccezione.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  let proto: unknown;
  try {
    proto = Object.getPrototypeOf(value);
  } catch {
    return false;
  }
  return proto === Object.prototype || proto === null;
}

// Ricopia un valore dell'errore troncando OGNI stringa e OGNI lista. E' ricorsivo
// perche' e' annidata l'informazione che l'input controlla: i segmenti di `path` e le
// `keys` di un unrecognized_keys. I valori non stringa (i numeri di `maximum`, gli
// indici di `path`) passano intatti: sono cio' che rende l'errore ancora leggibile.
function limitValue(value: unknown, limits: ErrorLimits): unknown {
  if (typeof value === 'string') return value.slice(0, limits.error_chars);
  if (Array.isArray(value)) {
    return value.slice(0, limits.error_issues).map((nested) => limitValue(nested, limits));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, limitValue(nested, limits)]),
    );
  }
  return value;
}

/**
 * Il ramo di errore LIMITATO ALLA FONTE: al piu' `error_issues` issue, e nessuna
 * stringa — segmento di path, messaggio o chiave non riconosciuta — oltre
 * `error_chars` code unit.
 *
 * E' un TRONCAMENTO, non una riproduzione dell'input: path e codice sopravvivono,
 * quindi ogni issue riportato nomina ancora il campo che l'ha causato, ma gli issue
 * oltre il tetto non compaiono affatto e le chiavi elencate in un unrecognized_keys
 * possono essere meno di quelle scritte dall'input. Dice DOVE, non QUANTE volte.
 *
 * SERVE PERCHE' L'ERRORE TRASPORTA TESTO NON FIDATO: le chiavi sconosciute e gli slug
 * sono scritti dal modello (o da un sito terzo attraverso il brief) e finirebbero
 * verbatim e senza tetto in cio' che T-204 scrive in `failure_reason` e che qualcuno
 * logga. Chiudere il canale del DATO e lasciare aperto quello dell'ERRORE non chiude
 * niente.
 *
 * Il cast e' il solo punto in cui la copia limitata riprende il tipo di partenza:
 * `limitValue` conserva forma, chiavi e valori non stringa, quindi resta un issue
 * valido con le stringhe accorciate.
 */
export function limitIssues(
  issues: readonly z.ZodIssue[],
  limits: ErrorLimits,
): readonly z.ZodIssue[] {
  return issues
    .slice(0, limits.error_issues)
    .map((issue) => limitValue(issue, limits) as z.ZodIssue);
}
