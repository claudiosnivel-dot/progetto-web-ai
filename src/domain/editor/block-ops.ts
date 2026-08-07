// T-314 (macrotask editor-blocks, P3) — LE OPERAZIONI PURE sui blocchi del documento: quali blocchi
// sono AGGIUNGIBILI a una pagina (offerta), dove SORGENTARE l'istanza risolta da aggiungere, e come
// AGGIUNGERLA dietro il gate. Dominio PURO: nessun React, nessun DB, nessun client Supabase, nessun
// I/O. Importa SOLO altro domain (il catalogo dei blocchi e lo schema del documento), mai data/ui/app
// — cosi' rispetta il gate di altitudine repo-wide (T-AH6/T-312: sono vietati domain->ui/data/app).
//
// ALTITUDINE (perche' qui e non nel reducer o in una server action): le funzioni sono PURE sul dominio
// del documento e non conoscono React ne l'I/O. Il cablaggio React (l'azione del reducer) vive in
// src/ui/editor/** (ui->domain lecito); la composizione dell'offerta con brief+baseline+label i18n
// tocca data+ui e vive percio' in src/app/** (app puo' importare tutti gli strati). Qui c'e' solo la
// logica testabile hermetic.
//
// MODEL-FREE (P2-D7: un blocco senza base dati NON ESISTE, niente prosa fabbricata ne segnaposto): il
// blocco aggiunto e' una ISTANZA RISOLTA (content prosa del modello + data del brief + images) presa
// dal documento corrente/baseline della generazione, dove `resolve` (T-214) l'ha gia' prodotta.
// `findResolvedBlock` la estrae; questo modulo NON chiama il modello e NON inventa contenuto.
//
// PRECONDITION VERA, NON RISCRITTA (disciplina trueline: una seconda verita' divergerebbe): l'offerta
// riusa `blocksFor` (T-210) come gate di precondizione+ruolo. La precondition di 'recensioni' e'
// `() => false`, quindi blocksFor la esclude sempre e l'offerta non la propone mai; un brief senza i
// dati di X non offre X. Non c'e' un secondo elenco di precondizioni qui.
//
// SICUREZZA (A05:2025): `addBlock` RIALLINEA `brief_fields_rendered` ai campi effettivamente presenti
// in `data` (il contratto dei campi non fidati che T-231/T-237 sanificano) e poi RI-ATTRAVERSA
// `parseDocument` sul documento risultante — limiti di blocchi per pagina, unicita' slug, tetto di
// byte, forma strict. Un'aggiunta che rompe un invariante e' RIFIUTATA (ritorna null): nulla e'
// mutato e nulla e' persistito. Il match dei blocchi presenti e la sorgente dell'istanza sono per
// UGUAGLIANZA ESATTA dell'id, mai per prefisso.

import type { Brief } from '@/domain/onboarding/brief';
import { blocksFor } from '@/domain/generation/blocks';
import {
  parseDocument,
  type ImageSlot,
  type SiteBlock,
  type SiteDocument,
} from '@/domain/generation/document';

/** Il tipo dell'elemento offerto: la stessa BlockDefinition che `blocksFor` restituisce. */
type OfferedBlock = ReturnType<typeof blocksFor>[number];

/**
 * I blocchi AGGIUNGIBILI a una pagina: i candidati sono `blocksFor(brief, page.role)` (precondizione
 * sui dati + ruolo, RIUSO del gate T-210), MENO i blocchi gia' presenti sulla pagina (per id, per
 * UGUAGLIANZA ESATTA). L'ordine e' quello del catalogo, che `blocksFor` conserva. Una pagina target
 * assente non offre nulla.
 *
 * 'recensioni' resta fuori perche' `blocksFor` la esclude via precondition `() => false`; un brief
 * senza i dati di un blocco non lo offre, uno con i dati si' — la precondizione e' quella VERA.
 */
export function addableBlocks(
  brief: Brief,
  document: SiteDocument,
  pageSlug: string,
): readonly OfferedBlock[] {
  const page = document.pages.find((candidate) => candidate.slug === pageSlug);
  if (page === undefined) return [];
  // Insieme dei blocchi gia' presenti, per id ESATTO: 'orari-estivi' presente non esclude 'orari'.
  const present = new Set(page.blocks.map((block) => block.id));
  return blocksFor(brief, page.role).filter((candidate) => !present.has(candidate.id));
}

/**
 * L'ISTANZA RISOLTA di un blocco nel documento sorgente (corrente/baseline della generazione), o
 * `null` se il documento non la contiene. Cerca la PRIMA proprieta' propria con id UGUALE (mai per
 * prefisso: 'orari' non e' 'orari-estivi'), scorrendo le pagine nell'ordine del documento.
 *
 * E' la sorgente MODEL-FREE dell'aggiunta: se un blocco offerto non ha un'istanza risolta nel
 * documento, non lo si puo' aggiungere senza fabbricare prosa — e per P2-D7 non lo si aggiunge.
 */
export function findResolvedBlock(sourceDocument: SiteDocument, blockId: string): SiteBlock | null {
  for (const page of sourceDocument.pages) {
    const found = page.blocks.find((block) => block.id === blockId);
    if (found !== undefined) return found;
  }
  return null;
}

/**
 * Aggiunge un blocco RISOLTO in coda alla pagina indicata (modello a lista) e ritorna la COPIA
 * VALIDATA del documento, oppure `null` se l'aggiunta e' rifiutata (pagina assente, oltre i limiti,
 * o qualunque invariante rotto). Puro: non muta il documento in ingresso.
 *
 * Due passi, nell'ordine:
 *  1. RIALLINEA `brief_fields_rendered = Object.keys(block.data)` — la stessa invariante che `resolve`
 *     mantiene alla nascita del documento e che `saveRevision` ristabilisce in scrittura: il contratto
 *     dei campi non fidati resi resta onesto.
 *  2. GATE `parseDocument` sul documento risultante. Passa -> ritorna `parsed.document` (la copia che
 *     lo schema ha benedetto, mai l'input). Non passa (es. >12 blocchi/pagina) -> `null`: RIFIUTO,
 *     nulla di mutato.
 */
export function addBlock(
  document: SiteDocument,
  pageSlug: string,
  block: SiteBlock,
): SiteDocument | null {
  const pageIndex = document.pages.findIndex((candidate) => candidate.slug === pageSlug);
  if (pageIndex === -1) return null;

  // DIFESA IN PROFONDITA': il mutatore AUTOCONTIENE l'invariante "niente id di blocco duplicato sulla
  // pagina". `parseDocument` NON impone l'unicita' degli id di blocco in una pagina (solo slug unici e
  // la home), quindi un id gia' presente passerebbe il gate e la pagina si ritroverebbe due sezioni con
  // lo stesso `data-block-id`. L'OFFERTA esclude gia' i presenti (addableBlocks), ma delegarle TUTTO
  // l'invariante lascerebbe un varco a un chiamante futuro che dispacciasse `addBlock` fuori dall'offerta.
  // Uguaglianza ESATTA dell'id, mai per prefisso: 'orari' presente non blocca 'orari-estivi'.
  if (document.pages[pageIndex].blocks.some((existing) => existing.id === block.id)) return null;

  // Il blocco aggiunto porta il contratto dei campi resi RIALLINEATO ai `data` realmente presenti. Le
  // chiavi di `data` sono per costruzione entro il vocabolario di `brief_fields_rendered` (entrambi
  // derivano da BRIEF_FIELD_NAMES in document.ts), quindi il cast e' sano; il gate lo riverifica.
  const realigned: SiteBlock = {
    ...block,
    brief_fields_rendered: Object.keys(block.data) as SiteBlock['brief_fields_rendered'],
  };

  const page = document.pages[pageIndex];
  const nextPage = { ...page, blocks: [...page.blocks, realigned] };
  const candidate: SiteDocument = {
    ...document,
    pages: document.pages.map((current, index) => (index === pageIndex ? nextPage : current)),
  };

  const parsed = parseDocument(candidate);
  return parsed.ok ? parsed.document : null;
}

/**
 * SOSTITUISCE (T-316) il blocco all'indice `blockIndex` di una pagina con `newBlock` (un'istanza
 * RISOLTA, come l'aggiunta) e ritorna la COPIA VALIDATA del documento, oppure `null` se la
 * sostituzione e' rifiutata (pagina assente, indice non canonico o fuori range, id duplicato con un
 * altro blocco, o qualunque invariante rotto dal gate). Puro: non muta il documento in ingresso.
 *
 * Due passi, nell'ordine (gli stessi di `addBlock`, applicati a una posizione esistente invece che
 * alla coda):
 *  1. RIALLINEA `newBlock.brief_fields_rendered = Object.keys(newBlock.data)` — la stessa
 *     riconciliazione del contratto dei campi non fidati (OWASP A05:2025) che `resolve`/`saveRevision`
 *     mantengono: il blocco entrante dichiara ESATTAMENTE i campi del brief che rende davvero.
 *  2. GATE `parseDocument` sul documento risultante. Passa -> ritorna `parsed.document` (la copia che
 *     lo schema ha benedetto, mai l'input); non passa -> `null`, rifiuto e nulla di mutato.
 *
 * DIFESA IN PROFONDITA' (come `addBlock`): `parseDocument` NON impone l'unicita' degli id di blocco
 * in una pagina, quindi sostituire un blocco con l'id di un ALTRO gia' presente lascerebbe due sezioni
 * con lo stesso `data-block-id`. Si rifiuta percio' un id gia' presente ALTROVE sulla pagina, per
 * UGUAGLIANZA ESATTA — escludendo pero' il blocco che si sta sostituendo, cosi' rimpiazzarlo con una
 * nuova istanza dello stesso id resta lecito. L'offerta esclude gia' i presenti (addableBlocks), ma
 * delegarle tutto l'invariante lascerebbe un varco a un chiamante che dispacciasse `replaceBlock`
 * fuori dall'offerta.
 */
export function replaceBlock(
  document: SiteDocument,
  pageSlug: string,
  blockIndex: number,
  newBlock: SiteBlock,
): SiteDocument | null {
  const pageIndex = document.pages.findIndex((candidate) => candidate.slug === pageSlug);
  if (pageIndex === -1) return null;

  const page = document.pages[pageIndex];
  // Indice VALIDATO: intero canonico entro il range di `page.blocks`. Fuori range o non intero ->
  // rifiuto, nulla di mutato.
  if (!isCanonicalIndex(blockIndex, page.blocks.length)) return null;

  // Nessun id duplicato con un ALTRO blocco (uguaglianza esatta, mai per prefisso): il blocco a
  // `blockIndex` e' escluso, cosi' una sostituzione con lo stesso id e' ammessa.
  if (page.blocks.some((existing, index) => index !== blockIndex && existing.id === newBlock.id)) {
    return null;
  }

  // Il blocco entrante porta il contratto dei campi resi RIALLINEATO ai `data` realmente presenti,
  // come in `addBlock`; il gate lo riverifica.
  const realigned: SiteBlock = {
    ...newBlock,
    brief_fields_rendered: Object.keys(newBlock.data) as SiteBlock['brief_fields_rendered'],
  };

  const nextBlocks = page.blocks.map((current, index) => (index === blockIndex ? realigned : current));
  const nextPage = { ...page, blocks: nextBlocks };
  const candidate: SiteDocument = {
    ...document,
    pages: document.pages.map((current, index) => (index === pageIndex ? nextPage : current)),
  };

  const parsed = parseDocument(candidate);
  return parsed.ok ? parsed.document : null;
}

/**
 * SETTA (T-416, macrotask media-editor-render, P4) lo slot immagine all'indice `imageIndex` del
 * blocco con id `blockId` (UGUAGLIANZA ESATTA, mai per prefisso: 'orari' non e' 'orari-estivi') alla
 * variante `uploaded` che nomina l'asset caricato per `assetId`. Ritorna la COPIA del documento con
 * il solo slot indirizzato cambiato, oppure `null` se il set e' rifiutato (blocco assente, indice non
 * canonico o fuori range, o qualunque invariante rotto dal gate — es. `assetId` non e' un uuid).
 * Puro: non muta il documento in ingresso.
 *
 * DOVE STA LA COORDINATA (come `editSlot`, T-307, non come `replaceBlock`): l'indirizzo e' (blockId
 * esatto + imageIndex), risolto SCORRENDO le pagine — non (pageSlug + blockIndex). L'affordance
 * dell'editor conosce lo slot per il suo blocco e la sua posizione, non per la pagina, e la libreria
 * dei blocchi impedisce id di blocco duplicati sulla pagina (addBlock/replaceBlock), quindi l'id
 * ESATTO indirizza un solo blocco.
 *
 * COSA RESTITUISCE, E PERCHE' NON `parsed.document` (differenza deliberata da addBlock/replaceBlock):
 * `parseDocument` qui e' il GATE (un controllo booleano), non la sorgente del valore restituito. Si
 * ritorna il CANDIDATO a structural sharing — cosi' gli slot/blocchi/rami NON toccati restano la
 * STESSA reference (AC-416-2: nessun re-render spurio, nessuna voce di storia falsa) — mentre
 * addBlock/replaceBlock tornano la copia dello schema perche' inseriscono un blocco RISOLTO intero
 * (potenzialmente con chiavi da normalizzare). Qui l'unico dato nuovo e' un oggetto che COSTRUIAMO
 * NOI con esattamente due chiavi (`source`, `asset_id`), senza spread di input non fidato: il gate
 * verifica che `assetId` sia un uuid e che il documento resti valido; se passa, il candidato non
 * porta alcuna chiave non ammessa. E' la stessa disciplina di `applySlotEdit`, che depone una
 * stringa piana validata in un leaf esistente e restituisce la copia condivisa.
 *
 * IMMUTABILE: gli altri slot dello stesso blocco, gli altri blocchi, e content/data del blocco
 * toccato restano la stessa reference (solo `images` del blocco indirizzato viene ricostruito, e solo
 * allo slot `imageIndex`).
 */
export function setUploadedImage(
  document: SiteDocument,
  blockId: string,
  imageIndex: number,
  assetId: string,
): SiteDocument | null {
  // Lo slot entrante lo COSTRUIAMO noi: esattamente due chiavi, nessuno spread di input non fidato.
  // `assetId` e' l'unico dato esterno, e il gate lo verifica (deve essere un uuid).
  const uploaded: ImageSlot = { source: 'uploaded', asset_id: assetId };

  let changed = false;
  const pages = document.pages.map((page) => {
    let pageChanged = false;
    const blocks = page.blocks.map((block) => {
      // MATCH DEL BLOCCO PER UGUAGLIANZA ESATTA, mai per prefisso.
      if (block.id !== blockId) return block;
      // Indice VALIDATO: intero canonico entro il range degli slot del blocco. Fuori range o non
      // intero -> nessun tocco (il blocco resta la stessa reference); se nessun blocco cambia, il
      // set complessivo e' un rifiuto (null piu' sotto).
      if (!isCanonicalIndex(imageIndex, block.images.length)) return block;
      const nextImages = block.images.map((image, index) => (index === imageIndex ? uploaded : image));
      pageChanged = true;
      // Solo `images` cambia; content/data e gli altri campi del blocco restano la stessa reference.
      return { ...block, images: nextImages };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, blocks };
  });

  // Nessun blocco toccato (id assente o indice fuori range): rifiuto, nulla di mutato.
  if (!changed) return null;

  const candidate: SiteDocument = { ...document, pages };

  // GATE: il candidato deve passare parseDocument (assetId uuid valido, invarianti intatti). Passa ->
  // si ritorna il CANDIDATO a structural sharing (non la copia dello schema); non passa -> null.
  return parseDocument(candidate).ok ? candidate : null;
}

/** Un indice di posizione CANONICO: un intero non negativo entro `[0, count)`. */
function isCanonicalIndex(value: number, count: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < count;
}

/**
 * RIORDINA (T-315) un blocco entro una pagina spostandolo da `fromIndex` a `toIndex` (modello a
 * LISTA, nessun drag pixel-libero). Ritorna la COPIA VALIDATA del documento, oppure `null` se il
 * riordino e' rifiutato (pagina assente, indici non canonici o fuori range, `fromIndex === toIndex`,
 * o qualunque invariante rotto dal gate). Puro: non muta il documento in ingresso.
 *
 * NO-OP -> null (non "documento invariato"): un `fromIndex === toIndex` o un indice invalido NON
 * sono un movimento, quindi si rifiuta come `addBlock` fa col proprio rifiuto — cosi' il reducer
 * (che tratta `null` come stessa reference) non spinge una voce di storia spuria. Su input invalido
 * NON si muta nulla e non si costruisce alcun candidato.
 *
 * Due passi, nell'ordine:
 *  1. SPLICE IMMUTABILE entro `page.blocks`: si rimuove il blocco a `fromIndex` e lo si reinserisce
 *     a `toIndex` su una COPIA dell'array. NEL CANDIDATO INTERMEDIO gli altri blocchi restano la
 *     stessa reference e lo spostato e' lo stesso oggetto (non ricostruito): cambia l'ORDINE, mai il
 *     contenuto (AC-315-1).
 *  2. GATE `parseDocument` sul documento risultante. Passa -> ritorna `parsed.document` (la copia che
 *     lo schema ha benedetto, mai l'input): come in `addBlock`, il valore RESTITUITO e' la copia
 *     validata, quindi il CONTENUTO e' invariato ma le reference dei blocchi non sono piu' quelle in
 *     ingresso. Una home resta una home e i limiti sono preservati (AC-315-3). Non passa -> `null`:
 *     rifiuto, nulla di mutato.
 */
export function reorderBlock(
  document: SiteDocument,
  pageSlug: string,
  fromIndex: number,
  toIndex: number,
): SiteDocument | null {
  const pageIndex = document.pages.findIndex((candidate) => candidate.slug === pageSlug);
  if (pageIndex === -1) return null;

  const page = document.pages[pageIndex];
  const count = page.blocks.length;
  // Indici VALIDATI: interi canonici, entrambi in range di `page.blocks`. Un input invalido o un
  // movimento nullo (stessa posizione) e' un no-op rifiutato.
  if (!isCanonicalIndex(fromIndex, count) || !isCanonicalIndex(toIndex, count)) return null;
  if (fromIndex === toIndex) return null;

  // Splice immutabile su una copia: rimuovi da `fromIndex`, reinserisci a `toIndex`. I blocchi non
  // toccati conservano la loro reference — solo la sequenza cambia.
  const blocks = page.blocks.slice();
  const [moved] = blocks.splice(fromIndex, 1);
  blocks.splice(toIndex, 0, moved);

  const nextPage = { ...page, blocks };
  const candidate: SiteDocument = {
    ...document,
    pages: document.pages.map((current, index) => (index === pageIndex ? nextPage : current)),
  };

  const parsed = parseDocument(candidate);
  return parsed.ok ? parsed.document : null;
}
