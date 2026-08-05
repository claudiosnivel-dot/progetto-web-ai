// T-307 (macrotask editor-core, P3) — IL REDUCER PURO dello stato draft dell'editor + lo stack
// undo/redo in memoria. Dominio dell'editor, PURO: nessun React, nessun DB, nessun client
// Supabase, nessun side effect — cosi' e' testabile hermetic e vive sotto lo stesso hook
// (useEditorDraft) senza che la logica sappia di React.
//
// COSA TIENE: il SiteDocument DI LAVORO in stato client (P3-D2/D5). Una edit inline di uno slot
// di testo aggiorna SOLO quel campo del draft, immutabilmente (structural sharing: cambia il
// leaf indirizzato e i suoi antenati, tutto il resto resta la stessa REFERENCE). Le modifiche si
// riflettono nell'anteprima perche' le isole <EditableText> del renderer UNICO (SiteView, P2-D8)
// rileggono `document` — nessun round-trip server per il testo.
//
// SICUREZZA (security_note T-307): il draft resta STRUTTURA DATI/TESTO, mai HTML serializzato.
// Una edit porta una STRINGA PIANA e la depone in un leaf che era GIA' una stringa; non si
// costruisce mai markup, non si trasforma una struttura in testo, non si crea un campo assente.
// Un WYSIWYG che memorizzasse HTML avvelenerebbe il documento congelato e riaprirebbe l'XSS che
// P2 chiude: qui e' escluso per costruzione.
//
// LO STACK undo/redo tiene SNAPSHOT del documento (non diff): grazie allo structural sharing uno
// snapshot condivide in memoria tutto cio' che non e' cambiato, quindi e' economico. undo sposta
// il corrente nel futuro e riprende l'ultimo passato; redo fa l'inverso; una nuova edit AZZERA
// il futuro (il ramo redo diverge). E' lo stack in-memoria di P3-D2 ("fine, istantaneo"): la
// persistenza a revisioni e' un'altra cosa (save-point, T-309), non questo modulo.

import type { SiteBlock, SiteDocument } from '@/domain/generation/document';
import { addBlock, reorderBlock, replaceBlock } from '@/domain/editor/block-ops';

/**
 * Una modifica inline di uno slot di testo. `path` e' la coordinata STRUTTURATA che l'isola
 * <EditableText> espone: un ARRAY di segmenti (mai una stringa puntata), col primo elemento che
 * sceglie il ramo del blocco ('content' | 'data') e i restanti che indirizzano il campo DENTRO
 * quel ramo, nella stessa forma che i blocchi passano a <SiteText> (src/ui/site/blocks/**):
 *   ['content', '<slotId>']                          (uno slot testuale)
 *   ['content', '<slotId>', '<i>']                   (una voce di lista, es. about_points)
 *   ['content', 'faq_items', '<i>', 'question'|'answer']
 *   ['data', '<field>']                              (un campo del brief reso, es. business_name)
 *   ['data', 'offerings', '<i>', '<campo>'] / ['data', 'hours', '<giorno>']
 *
 * PERCHE' UN ARRAY E NON UNA STRINGA PUNTATA (fix T-307): una chiave di `data.hours.<giorno>` puo'
 * CONTENERE un punto — `HoursKeySchema` (src/domain/generation/document.ts) ammette '.' come
 * separatore interno ('lun.ven', 'lun-ven'). Con una coordinata puntata il reducer avrebbe dovuto
 * spezzare su '.', e 'data.hours.lun.ven' si sarebbe scomposto in ['data','hours','lun','ven'] —
 * un percorso che non risolve, cioe' un NO-OP SILENZIOSO su una edit legittima. Portando i segmenti
 * gia' separati DALL'ISOLA (dove la chiave del giorno e' ancora atomica) il punto dentro la chiave
 * non e' piu' ambiguo: 'lun.ven' resta UN segmento e il leaf viene edito.
 *
 * `value` e' SEMPRE testo piano: il tipo lo impone, e il reducer rifiuta comunque un valore che
 * non sia una stringa.
 */
type SlotEdit = {
  readonly blockId: string;
  readonly path: readonly string[];
  readonly value: string;
};

/**
 * Le azioni del reducer: una edit inline, uno switch di tema, l'aggiunta di un blocco dalla libreria
 * (T-314), il RIORDINO di un blocco entro una pagina (T-315), la SOSTITUZIONE di un blocco con un
 * altro dalla libreria (T-316), oppure un passo di undo/redo. `addBlock` porta lo slug della pagina
 * target e il blocco RISOLTO da inserire (content + data + images), sorgentato dal baseline dal
 * chiamante (model-free). `reorderBlock` porta lo slug della pagina e gli indici sorgente/destinazione
 * dello spostamento (lista ordinabile, nessun drag). `replaceBlock` porta lo slug della pagina,
 * l'indice del blocco da rimpiazzare e il blocco RISOLTO sostitutivo (anch'esso model-free).
 */
export type DraftAction =
  | { readonly type: 'editSlot'; readonly edit: SlotEdit }
  | { readonly type: 'setTheme'; readonly themeId: string }
  | { readonly type: 'addBlock'; readonly pageSlug: string; readonly block: SiteBlock }
  | {
      readonly type: 'reorderBlock';
      readonly pageSlug: string;
      readonly fromIndex: number;
      readonly toIndex: number;
    }
  | {
      readonly type: 'replaceBlock';
      readonly pageSlug: string;
      readonly blockIndex: number;
      readonly block: SiteBlock;
    }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' };

/**
 * Lo stato del draft: il documento corrente e i due stack. `past` e' dal piu' vecchio al piu'
 * recente (l'ultimo elemento e' lo stato immediatamente precedente al corrente); `future`
 * tiene gli stati annullati, dal piu' vicino al corrente in poi.
 */
export type DraftState = {
  readonly document: SiteDocument;
  readonly past: readonly SiteDocument[];
  readonly future: readonly SiteDocument[];
};

/** Stato iniziale: il documento corrente, stack vuoti. Usato anche come `init` di useReducer. */
export function initialDraftState(document: SiteDocument): DraftState {
  return { document, past: [], future: [] };
}

/** True se c'e' almeno uno stato a cui tornare / da riapplicare. Deriva dagli stack. */
export function canUndo(state: DraftState): boolean {
  return state.past.length > 0;
}
export function canRedo(state: DraftState): boolean {
  return state.future.length > 0;
}

/**
 * IL REDUCER PURO. Non muta mai lo stato in ingresso; ritorna un nuovo stato oppure lo STESSO
 * riferimento quando l'azione non cambia nulla (edit no-op, undo/redo con stack vuoto), cosi' un
 * consumatore React non ri-renderizza inutilmente e non nasce una voce di storia spuria.
 */
export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case 'editSlot': {
      const next = applySlotEdit(state.document, action.edit);
      // Nessun cambiamento (blocco/slot sconosciuto, target non-stringa, stesso valore): niente
      // storia, stesso stato.
      if (next === state.document) return state;
      return { document: next, past: [...state.past, state.document], future: [] };
    }
    case 'setTheme': {
      // Lo SWITCH TEMA (T-308): aggiorna SOLO `document.theme_id`. Il valore e' un id del catalogo
      // versionato scelto dal selettore (mai testo libero, security_note T-308); il reducer non
      // conosce il catalogo — la validazione dei 5 temi vive nel chrome — ma resta difensivo: un
      // themeId non-stringa non sovrascrive nulla. Lo stesso id e' un no-op (nessuna voce di storia
      // spuria), esattamente come una edit al medesimo valore. Structural sharing: cambia solo
      // `theme_id`, `pages` resta la stessa REFERENCE. Il tema e' un DATO (un id), mai HTML.
      if (typeof action.themeId !== 'string') return state;
      if (action.themeId === state.document.theme_id) return state;
      const next: SiteDocument = { ...state.document, theme_id: action.themeId };
      return { document: next, past: [...state.past, state.document], future: [] };
    }
    case 'addBlock': {
      // AGGIUNTA DALLA LIBRERIA (T-314): il dominio inserisce il blocco risolto in coda, riallinea
      // brief_fields_rendered e RI-GATE il documento. Se il gate rifiuta (oltre i limiti, pagina
      // assente, invariante rotto) `addBlock` ritorna null -> no-op: stesso stato, nessuna voce di
      // storia spuria e nulla che possa poi essere persistito. Altrimenti nuovo stato con push su
      // past e futuro azzerato, la stessa disciplina di editSlot/setTheme.
      const next = addBlock(state.document, action.pageSlug, action.block);
      if (next === null) return state;
      return { document: next, past: [...state.past, state.document], future: [] };
    }
    case 'reorderBlock': {
      // RIORDINO ENTRO UNA PAGINA (T-315): il dominio sposta il blocco da fromIndex a toIndex,
      // ri-gate del documento e ritorna la copia validata. Un rifiuto (indici invalidi/fuori range,
      // stessa posizione, pagina assente) e' null -> no-op: stesso stato, nessuna voce di storia
      // spuria. Altrimenti nuovo stato con push su past e futuro azzerato, come editSlot/addBlock.
      const next = reorderBlock(state.document, action.pageSlug, action.fromIndex, action.toIndex);
      if (next === null) return state;
      return { document: next, past: [...state.past, state.document], future: [] };
    }
    case 'replaceBlock': {
      // SOSTITUZIONE DALLA LIBRERIA (T-316): il dominio rimpiazza il blocco all'indice dato col
      // blocco risolto, riconcilia brief_fields_rendered e RI-GATE il documento. Un rifiuto (indice
      // invalido/fuori range, pagina assente, id duplicato con un altro blocco, invariante rotto) e'
      // null -> no-op: stesso stato, nessuna voce di storia spuria. Altrimenti nuovo stato con push su
      // past e futuro azzerato, la stessa disciplina di editSlot/addBlock/reorderBlock.
      const next = replaceBlock(state.document, action.pageSlug, action.blockIndex, action.block);
      if (next === null) return state;
      return { document: next, past: [...state.past, state.document], future: [] };
    }
    case 'undo': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        document: previous,
        past: state.past.slice(0, -1),
        future: [state.document, ...state.future],
      };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return {
        document: next,
        past: [...state.past, state.document],
        future: rest,
      };
    }
    default:
      return state;
  }
}

// ── applicazione di una edit ──────────────────────────────────────────────────

/**
 * Applica una edit al documento e ne ritorna una COPIA immutabile con il solo leaf indirizzato
 * cambiato — oppure lo STESSO documento (per riferimento) se l'edit non si applica: valore non
 * stringa, radice diversa da 'content'/'data', blocco inesistente, percorso non risolto, target
 * non-stringa, o stesso valore. Il chiamante usa quell'uguaglianza di riferimento per non
 * spingere una voce di storia.
 */
function applySlotEdit(document: SiteDocument, edit: SlotEdit): SiteDocument {
  // Il valore e' testo piano: mai una struttura, mai HTML. Il tipo lo impone, ma l'input puo'
  // arrivare da JS non tipizzato, quindi si verifica comunque.
  if (typeof edit.value !== 'string') return document;

  // La coordinata e' un array di segmenti gia' separati: il PRIMO sceglie il ramo del blocco
  // ('content' | 'data'), i restanti indirizzano il campo DENTRO quel ramo. Nessuno split su '.':
  // e' proprio quel che permette a una chiave di orari con un punto ('lun.ven') di restare intatta.
  const [root, ...segments] = edit.path;
  // Serve una radice E almeno un segmento sotto di essa: una coordinata piu' corta (o vuota) non
  // indirizza un leaf editabile.
  if (segments.length === 0) return document;
  if (root !== 'content' && root !== 'data') return document;
  // Un segmento vuoto (['content','','x'], ['content','x','']) e' malformato: rifiuto, non un match
  // strano. La radice e' gia' filtrata sopra; qui si guardano i soli segmenti sotto di essa.
  if (segments.some((segment) => segment.length === 0)) return document;

  let changed = false;
  const pages = document.pages.map((page) => {
    let pageChanged = false;
    const blocks = page.blocks.map((block) => {
      // MATCH DEL BLOCCO PER UGUAGLIANZA ESATTA, mai per prefisso: 'about' non e' 'about-us'.
      if (block.id !== edit.blockId) return block;
      const branch: unknown = block[root];
      const updatedBranch = setLeaf(branch, segments, edit.value);
      if (updatedBranch === branch) return block; // percorso non risolto o stesso valore
      pageChanged = true;
      // Solo il ramo indirizzato cambia; gli altri campi del blocco restano la stessa reference.
      // Il cast e' sicuro per costruzione: setLeaf sostituisce SOLO un leaf stringa esistente,
      // quindi la forma del ramo (e del blocco) e' preservata.
      return { ...block, [root]: updatedBranch } as typeof block;
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, blocks };
  });

  return changed ? { ...document, pages } : document;
}

/**
 * Scende nel percorso `segments` dentro `container` e sostituisce il LEAF finale con `value`,
 * ritornando copie immutabili lungo il percorso toccato (structural sharing sui rami intatti).
 * Ritorna `container` per riferimento — segnale di "nessun cambiamento" — quando:
 *  - una chiave d'oggetto non e' una proprieta' PROPRIA (match esatto, niente ereditate/prefissi);
 *  - un indice d'array e' fuori range o non canonico;
 *  - il leaf finale non e' una stringa (non si trasforma una struttura in testo, ne si crea un
 *    campo assente — coerente col fatto che un'isola esiste solo per un campo di testo presente);
 *  - il nuovo valore e' uguale a quello attuale.
 */
function setLeaf(container: unknown, segments: readonly string[], value: string): unknown {
  const [head, ...tail] = segments;

  if (Array.isArray(container)) {
    const index = toArrayIndex(head);
    if (index === null || index >= container.length) return container;
    const child: unknown = container[index];
    const updated = tail.length === 0 ? replaceStringLeaf(child, value) : setLeaf(child, tail, value);
    if (updated === child) return container;
    const copy = container.slice();
    copy[index] = updated;
    return copy;
  }

  if (isPlainRecord(container)) {
    // PROPRIETA' PROPRIA soltanto: esclude le chiavi ereditate dal prototipo (es. '__proto__')
    // e impone il match esatto della chiave.
    if (!Object.prototype.hasOwnProperty.call(container, head)) return container;
    const child: unknown = container[head];
    const updated = tail.length === 0 ? replaceStringLeaf(child, value) : setLeaf(child, tail, value);
    if (updated === child) return container;
    return { ...container, [head]: updated };
  }

  // Non si puo' scendere dentro un primitivo: il percorso pretendeva piu' struttura di quanta ce
  // ne sia.
  return container;
}

/** Sostituisce un leaf SOLO se e' gia' una stringa e il valore cambia; altrimenti no-op. */
function replaceStringLeaf(child: unknown, value: string): unknown {
  if (typeof child !== 'string') return child;
  return child === value ? child : value;
}

/** L'indice d'array se `segment` e' un intero non negativo CANONICO ('0','1',…), altrimenti null. */
function toArrayIndex(segment: string): number | null {
  if (!/^\d+$/.test(segment)) return null;
  const index = Number(segment);
  return String(index) === segment ? index : null;
}

/** Un oggetto semplice (non array, non null): il tipo dentro cui una chiave puntata puo' scendere. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
