// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { render, cleanup, act, fireEvent, renderHook } from '@testing-library/react';
import itMessages from '../messages/it.json';
import { THEMES } from '@/domain/generation/themes';
import {
  parseDocument,
  type ImageSlot,
  type SiteBlock,
  type SiteDocument,
} from '@/domain/generation/document';
import { assetPublicUrl } from '@/config/storage';
import { setUploadedImage } from '@/domain/editor/block-ops';
import { draftReducer, initialDraftState } from '@/ui/editor/draft-state';
import { useEditorDraft } from '@/ui/editor/useEditorDraft';

// T-416 (macrotask media-editor-render, P4) — ORACOLO di "carica una foto per uno slot immagine
// dell'editor". Le asserzioni DERIVANO da AC-416-1..5 (blueprint 05-media-editor-render), taggate
// `// covers: AC-416-<n>` sulla riga dell'EXPECT. Il cuore e' DOMINIO PURO (`setUploadedImage`,
// src/domain/editor) + l'azione del reducer (src/ui/editor/draft-state); l'affordance client e la
// persistenza si provano cablando l'EditorClient REALE con i SOLI seam di I/O mockati (uploadAsset,
// saveRevision), e la riflessione in anteprima passa dal RENDERER UNICO reale via `renderDraftPage`.
//
// DUE PORTE, MAI TRE. Il file va al server SOLO via `uploadAsset` (server action, M4); la
// persistenza SOLO via `saveRevision` attraverso il save-point (autosave/esplicito, T-309).
// L'affordance non scrive nulla: dispaccia l'azione e il save-point persiste il draft cambiato —
// nessun secondo canale, nessun upload diretto browser->bucket.
//
// MODEL-FREE / P2-D12: lo slot `uploaded` porta SOLO l'asset_id (un uuid); l'<img> nasce nel
// renderer unico (SiteImage, T-415) col src COSTRUITO da `assetPublicUrl(asset_id)`, mai da testo
// libero e mai fabbricato lato client.
//
// DISCIPLINA FIXTURE (lezione P1/P2): PIU' DI UN blocco/slot, asset_id e indici DISCORDANTI, e una
// coppia di id in cui uno e' PREFISSO dell'altro ('orari' e' prefisso di 'orari-estivi'), col
// partner-prefisso messo PRIMA nel documento. Cosi' l'uguaglianza ESATTA del blockId e' osservabile
// mentre agisce: settare lo slot di 'orari' NON tocca 'orari-estivi'. Una NEAR-COLLISION di uuid
// (35 char condivisi, differisce solo in coda) prova che nessun asset finisce sul blocco sbagliato.

// ── uuid: near-collision (35 char condivisi) + valori del tutto discordanti ────────────────────────
const A_NEW = '55555555-5555-4555-8555-555555555551'; // cio' che uploadAsset restituisce
const A_NEAR = '55555555-5555-4555-8555-555555555552'; // near-collision con A_NEW (35 char condivisi)
const A_OTHER = '99999999-9999-4999-8999-999999999999'; // forma del tutto discordante

const ph = (token: string): ImageSlot => ({ source: 'theme-placeholder', token });
const up = (assetId: string): ImageSlot => ({ source: 'uploaded', asset_id: assetId });

const THEME = THEMES[0];

// ── il documento sorgente (valido per il gate): hero(2 slot), orari-estivi(1, PRIMA), orari(2) ─────
// 'orari-estivi' e' il PARTNER-PREFISSO di 'orari' e sta PRIMA: un match per prefisso lo confonderebbe.
// Il suo unico slot e' un `uploaded` con A_NEAR (near-collision di A_NEW): se settando 'orari' un
// asset finisse qui per sbaglio, la near-collision lo renderebbe evidente.
function heroBlock(): SiteBlock {
  return {
    id: 'hero',
    content: { hero_title: 'Osteria del Ponte', hero_subtitle: 'Cucina di stagione' },
    data: { business_name: 'Osteria del Ponte' },
    brief_fields_rendered: ['business_name'],
    images: [ph('hero-a'), ph('hero-b')],
  };
}
function orariEstiviBlock(): SiteBlock {
  return {
    id: 'orari-estivi',
    content: { hours_title: 'Orari estivi' },
    data: {},
    brief_fields_rendered: [],
    images: [up(A_NEAR)],
  };
}
function orariBlock(): SiteBlock {
  return {
    id: 'orari',
    content: { hours_title: 'Orari di apertura' },
    data: {},
    brief_fields_rendered: [],
    images: [ph('orari-map'), ph('orari-photo')],
  };
}

function sourceDoc(): SiteDocument {
  return {
    recipe_id: 'ricetta-test@1',
    theme_id: THEME.id,
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: 'Osteria del Ponte',
        meta_description: 'Cucina di stagione a Bologna',
        blocks: [heroBlock(), orariEstiviBlock(), orariBlock()],
      },
    ],
  };
}

/** Il blocco per id (uguaglianza esatta) dentro un documento. */
function blockOf(document: SiteDocument, id: string): SiteBlock {
  const found = document.pages.flatMap((page) => page.blocks).find((b) => b.id === id);
  if (!found) throw new Error(`fixture priva del blocco ${id}`);
  return found;
}

afterEach(() => cleanup());

// ═══════════════════════════════════════════════════════════════════════════════
// Sanity — la fixture passa il gate (le asserzioni successive non sono vacue).
// ═══════════════════════════════════════════════════════════════════════════════

describe('T-416 — la fixture sorgente e valida per parseDocument', () => {
  it('near-collision reale (35 char condivisi) e documento gate-valido', () => {
    expect(A_NEW.slice(0, 35)).toBe(A_NEAR.slice(0, 35));
    expect(A_NEW).not.toBe(A_NEAR);
    expect(parseDocument(sourceDoc()).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC-416-2 — DOMINIO PURO: setUploadedImage cambia SOLO lo slot indirizzato (blockId esatto +
// indice canonico); ogni altro slot/blocco/contenuto resta la STESSA reference (Object.is).
// ═══════════════════════════════════════════════════════════════════════════════

describe('AC-416-2 — setUploadedImage: solo lo slot indirizzato cambia, il resto stessa reference', () => {
  it('setta orari[1]=uploaded(A_NEW); orari[0], gli altri blocchi e content/data restano la stessa reference', () => {
    const doc = sourceDoc();
    const next = setUploadedImage(doc, 'orari', 1, A_NEW);
    expect(next).not.toBeNull(); // covers: AC-416-2

    const nextOrari = blockOf(next as SiteDocument, 'orari');
    const srcOrari = blockOf(doc, 'orari');

    // Lo slot indirizzato e' ora uploaded col NOSTRO asset_id.
    expect(nextOrari.images[1]).toEqual(up(A_NEW)); // covers: AC-416-2
    // Lo slot NON indirizzato dello stesso blocco resta la STESSA reference (structural sharing).
    expect(Object.is(nextOrari.images[0], srcOrari.images[0])).toBe(true); // covers: AC-416-2
    // content e data del blocco toccato: stessa reference (solo `images` cambia).
    expect(Object.is(nextOrari.content, srcOrari.content)).toBe(true); // covers: AC-416-2
    expect(Object.is(nextOrari.data, srcOrari.data)).toBe(true); // covers: AC-416-2

    // Uguaglianza ESATTA del blockId: 'orari-estivi' (prefisso-partner, PRIMA nel documento) NON e'
    // toccato — stessa reference, e il suo uploaded near-collision A_NEAR e' intatto (nessuno scambio).
    expect(Object.is(blockOf(next as SiteDocument, 'orari-estivi'), blockOf(doc, 'orari-estivi'))).toBe(true); // covers: AC-416-2
    expect(blockOf(next as SiteDocument, 'orari-estivi').images[0]).toEqual(up(A_NEAR)); // covers: AC-416-2
    // Anche l'altro blocco (hero) resta la stessa reference.
    expect(Object.is(blockOf(next as SiteDocument, 'hero'), blockOf(doc, 'hero'))).toBe(true); // covers: AC-416-2

    // Immutabilita': il documento in ingresso non e' mutato.
    expect(blockOf(doc, 'orari').images[1]).toEqual(ph('orari-photo')); // covers: AC-416-2
    // Il risultato passa comunque il gate.
    expect(parseDocument(next).ok).toBe(true); // covers: AC-416-2
  });

  it('uguaglianza esatta falsificabile: settare orari-estivi tocca SOLO orari-estivi, non orari', () => {
    const doc = sourceDoc();
    const next = setUploadedImage(doc, 'orari-estivi', 0, A_OTHER) as SiteDocument;
    expect(blockOf(next, 'orari-estivi').images[0]).toEqual(up(A_OTHER)); // covers: AC-416-2
    // 'orari' (di cui 'orari-estivi' NON e' prefisso, e viceversa) resta la stessa reference.
    expect(Object.is(blockOf(next, 'orari'), blockOf(doc, 'orari'))).toBe(true); // covers: AC-416-2
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC-416-4 (dominio) — un target invalido e' un NO-OP: null dal dominio (indice fuori range/non
// canonico, blocco assente, asset_id non-uuid che il gate rifiuta). Nulla di mutato.
// ═══════════════════════════════════════════════════════════════════════════════

describe('AC-416-4 — target invalido: setUploadedImage ritorna null (no-op), nulla mutato', () => {
  it('indice fuori range / non canonico / blocco assente -> null', () => {
    const doc = sourceDoc();
    expect(setUploadedImage(doc, 'orari', 2, A_NEW)).toBeNull(); // fuori range (orari ha 2 slot) covers: AC-416-4
    expect(setUploadedImage(doc, 'orari', -1, A_NEW)).toBeNull(); // negativo covers: AC-416-4
    expect(setUploadedImage(doc, 'orari', 1.5, A_NEW)).toBeNull(); // non intero covers: AC-416-4
    expect(setUploadedImage(doc, 'orar', 0, A_NEW)).toBeNull(); // blocco assente (prefisso) covers: AC-416-4
    expect(setUploadedImage(doc, 'contatti', 0, A_NEW)).toBeNull(); // blocco assente covers: AC-416-4
    // Nulla mutato dal tentativo respinto.
    expect(blockOf(doc, 'orari').images[1]).toEqual(ph('orari-photo')); // covers: AC-416-4
  });

  it('un asset_id NON-uuid rompe il gate parseDocument -> null (nessuno slot uploaded fabbricato)', () => {
    const doc = sourceDoc();
    // Non e' un uuid: ImageSlotSchema (variante uploaded) lo rifiuta -> parseDocument fallisce -> null.
    expect(setUploadedImage(doc, 'orari', 1, 'non-un-uuid')).toBeNull(); // covers: AC-416-4
    expect(blockOf(doc, 'orari').images[1]).toEqual(ph('orari-photo')); // covers: AC-416-4
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Reducer + hook — l'azione delega al dominio con la disciplina delle altre azioni:
// successo -> nuovo stato con voce di storia; rifiuto (null) -> stessa reference, nessuna storia.
// ═══════════════════════════════════════════════════════════════════════════════

describe('reducer setUploadedImage — nuova azione con la disciplina delle esistenti', () => {
  it('un set valido spinge un nuovo stato con voce di storia; undo lo annulla', () => {
    const state0 = initialDraftState(sourceDoc());
    const state1 = draftReducer(state0, {
      type: 'setUploadedImage',
      blockId: 'orari',
      imageIndex: 1,
      assetId: A_NEW,
    });
    expect(blockOf(state1.document, 'orari').images[1]).toEqual(up(A_NEW)); // covers: AC-416-1
    expect(state1.past).toHaveLength(1);
    const undone = draftReducer(state1, { type: 'undo' });
    expect(undone.document).toEqual(state0.document);
  });

  it('un set invalido e un NO-OP: stessa reference, nessuna voce di storia spuria', () => {
    const state0 = initialDraftState(sourceDoc());
    const rejected = draftReducer(state0, {
      type: 'setUploadedImage',
      blockId: 'orari',
      imageIndex: 9,
      assetId: A_NEW,
    });
    expect(rejected).toBe(state0); // covers: AC-416-4
  });

  it('il hook espone setUploadedImage e aggiorna il draft in anteprima', () => {
    const { result } = renderHook(() => useEditorDraft(sourceDoc()));
    expect(typeof result.current.setUploadedImage).toBe('function');
    act(() => result.current.setUploadedImage('orari', 1, A_NEW));
    expect(blockOf(result.current.document, 'orari').images[1]).toEqual(up(A_NEW)); // covers: AC-416-1
    expect(result.current.canUndo).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC-416-1 / AC-416-3 / AC-416-4 — l'AFFORDANCE nell'EditorClient reale: il file va a uploadAsset
// (server action) e SOLO su ok lo slot diventa uploaded nel draft; la persistenza passa SOLO dal
// save-point (saveRevision). Un esito non-ok non muta il draft e non persiste nulla.
// ═══════════════════════════════════════════════════════════════════════════════

// Seam di I/O mockati (hoisted), stile editor-integration.test.ts.
const { uploadAssetSpy } = vi.hoisted(() => ({ uploadAssetSpy: vi.fn() }));
vi.mock('@/data/media/uploadAsset', () => ({ uploadAsset: uploadAssetSpy }));

const { saveRevisionSpy, restoreRevisionSpy, listRevisionsSpy } = vi.hoisted(() => ({
  saveRevisionSpy: vi.fn(),
  restoreRevisionSpy: vi.fn(),
  listRevisionsSpy: vi.fn(),
}));
vi.mock('@/data/site-document-revisions', () => ({
  saveRevision: saveRevisionSpy,
  restoreRevision: restoreRevisionSpy,
  listRevisions: listRevisionsSpy,
}));

const { selectVariantSpy } = vi.hoisted(() => ({ selectVariantSpy: vi.fn() }));
vi.mock('@/data/generation-choose', () => ({ selectVariant: selectVariantSpy }));

const { refreshSpy } = vi.hoisted(() => ({ refreshSpy: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshSpy }) }));

// getGeneration e next-intl/server servono al RENDERER UNICO reale (renderDraftPage) usato in AC-416-5.
const { genHolder } = vi.hoisted(() => ({ genHolder: { current: null as unknown } }));
vi.mock('@/data/generations', () => ({ getGeneration: async () => genHolder.current }));
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ namespace }: { locale: string; namespace: string }) => {
    const ns = ((itMessages as Record<string, unknown>)[namespace] ?? {}) as Record<string, unknown>;
    return (key: string) => {
      const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], ns);
      return typeof value === 'string' ? value : `${namespace}.${key}`;
    };
  },
}));

// Import DOPO i mock (vi.mock e' hoisted).
import { EditorClient } from '@/ui/editor/EditorClient';
import { renderDraftPage } from '@/app/[locale]/editor/[siteId]/render-draft-page';

const SITE_ID = 'site-di-a';
const DEBOUNCE = 1000;
const LABELS = {
  revisionsTitle: 'Storia delle revisioni',
  restore: 'Ripristina',
  rechoose: 'Cambia proposta',
  rechooseConfirm: 'Le tue modifiche restano salvate nella storia delle revisioni.',
  rechooseConfirmYes: 'Sì, riscegli',
  rechooseCancel: 'Annulla',
};

let saveRevision: Mock;
let uploadAsset: Mock;

beforeEach(() => {
  vi.useFakeTimers();
  uploadAsset = uploadAssetSpy;
  uploadAssetSpy.mockReset();
  saveRevision = saveRevisionSpy;
  saveRevisionSpy.mockReset();
  saveRevisionSpy.mockImplementation(
    async (_siteId: string, document: SiteDocument) => ({ ok: true, document }),
  );
  restoreRevisionSpy.mockReset();
  restoreRevisionSpy.mockResolvedValue({ ok: true, document: sourceDoc() });
  listRevisionsSpy.mockReset();
  listRevisionsSpy.mockResolvedValue({ ok: true, revisions: [] });
  selectVariantSpy.mockReset();
  selectVariantSpy.mockResolvedValue(undefined);
  refreshSpy.mockReset();
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

// Rende l'EditorClient col draft della fixture e l'affordance di upload abilitata. Il children
// (anteprima) e' uno stub: l'affordance deriva gli slot da draft.document, non dai children.
function renderEditor() {
  return render(
    createElement(EditorClient, {
      document: sourceDoc(),
      siteId: SITE_ID,
      locale: 'it',
      labels: LABELS,
      debounceMs: DEBOUNCE,
      uploadImageTitle: 'Foto',
      uploadImageLabel: 'Carica foto',
      children: createElement('div', { 'data-preview-stub': true }),
    }),
  );
}

/** L'input file dell'affordance per (blockId, imageIndex). */
function slotInput(container: HTMLElement, blockId: string, imageIndex: number): HTMLInputElement {
  const input = container.querySelector(
    `input[type="file"][data-upload-block-id="${blockId}"][data-upload-image-index="${imageIndex}"]`,
  );
  if (input === null) throw new Error(`affordance assente per ${blockId}[${imageIndex}]`);
  return input as HTMLInputElement;
}

describe('AC-416-1/3 — affordance -> uploadAsset(server) -> slot uploaded nel draft -> saveRevision', () => {
  it('un file valido invoca uploadAsset(siteId,file) e su ok il draft ottiene lo slot uploaded, persistito dal save-point', async () => {
    uploadAsset.mockResolvedValue({ ok: true, asset_id: A_NEW });
    const { container } = renderEditor();

    // C'e' un'affordance PER OGNI slot immagine del draft (hero:2 + orari-estivi:1 + orari:2 = 5).
    expect(container.querySelectorAll('input[type="file"][data-upload-block-id]')).toHaveLength(5); // covers: AC-416-1

    const file = new File([new Uint8Array([1, 2, 3])], 'foto.jpg', { type: 'image/jpeg' });
    await act(async () => {
      fireEvent.change(slotInput(container, 'orari', 1), { target: { files: [file] } });
    });

    // uploadAsset e' invocata ATTRAVERSO IL SERVER (la server action mockata), con (siteId, file).
    expect(uploadAsset).toHaveBeenCalledTimes(1); // covers: AC-416-1
    expect(uploadAsset).toHaveBeenCalledWith(SITE_ID, file); // covers: AC-416-1
    expect(uploadAsset.mock.calls[0][1]).toBeInstanceOf(File); // covers: AC-416-1

    // Nessuna scrittura mentre il debounce e' pendente; alla pausa, UNA saveRevision con il draft.
    expect(saveRevision).not.toHaveBeenCalled(); // covers: AC-416-3
    await tick(DEBOUNCE);
    expect(saveRevision).toHaveBeenCalledTimes(1); // covers: AC-416-3
    const [siteIdArg, documentArg] = saveRevision.mock.calls[0] as [string, SiteDocument];
    // Persistenza dall'UNICA porta, legata al sito.
    expect(siteIdArg).toBe(SITE_ID); // covers: AC-416-3
    // Il draft persistito contiene lo slot uploaded al posto del placeholder indirizzato...
    expect(blockOf(documentArg, 'orari').images[1]).toEqual(up(A_NEW)); // covers: AC-416-1
    // ...e SOLO quello: l'altro slot di orari resta il placeholder, e il near-collision di
    // orari-estivi non e' stato scambiato.
    expect(blockOf(documentArg, 'orari').images[0]).toEqual(ph('orari-map')); // covers: AC-416-1
    expect(blockOf(documentArg, 'orari-estivi').images[0]).toEqual(up(A_NEAR)); // covers: AC-416-1
    // Il documento inviato passa il gate (AC-416-3: parseDocument sul documento persistito).
    expect(parseDocument(documentArg).ok).toBe(true); // covers: AC-416-3
  });
});

describe('AC-416-4 — un esito non-ok non muta il draft e non persiste nulla', () => {
  it('uploadAsset non-ok (sniff fail/SVG/oversize): nessuno slot uploaded, nessuna saveRevision', async () => {
    uploadAsset.mockResolvedValue({ ok: false, status: 400 });
    const { container } = renderEditor();

    const file = new File([new Uint8Array([1, 2, 3])], 'brutto.svg', { type: 'image/svg+xml' });
    await act(async () => {
      fireEvent.change(slotInput(container, 'orari', 1), { target: { files: [file] } });
    });

    // Il tentativo e' passato dal server, ma l'esito e' non-ok: nessun dispatch.
    expect(uploadAsset).toHaveBeenCalledTimes(1); // covers: AC-416-4
    expect(uploadAsset).toHaveBeenCalledWith(SITE_ID, file); // covers: AC-416-4

    // Il draft non e' cambiato: l'autosave non parte (nessuna nuova reference) e nulla e' persistito,
    // nemmeno lasciando scadere il debounce.
    await tick(DEBOUNCE * 3);
    expect(saveRevision).not.toHaveBeenCalled(); // covers: AC-416-4
    // L'indicatore del save-point resta a riposo (nessuna scrittura tentata).
    expect(container.querySelector('[data-status]')?.getAttribute('data-status')).toBe('idle'); // covers: AC-416-4
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC-416-5 — l'anteprima riflette lo slot uploaded ATTRAVERSO IL RENDERER UNICO (SiteImage, T-415):
// un <img> col src da assetPublicUrl(asset_id), mai un img fabbricato lato client.
// ═══════════════════════════════════════════════════════════════════════════════

const OWNED = { ok: true, generation: { id: 'gen-1', site_id: 'site-1', status: 'chosen' } };

describe('AC-416-5 — lo slot uploaded si rende via SiteImage nel renderer unico', () => {
  it('dopo il set, renderDraftPage rende un <img data-image-asset> col src da assetPublicUrl(asset_id)', async () => {
    genHolder.current = OWNED;
    // hero rende `block.images` via SiteSection->SiteImage: settiamo hero[0] a uploaded.
    const next = setUploadedImage(sourceDoc(), 'hero', 0, A_NEW) as SiteDocument;
    expect(next).not.toBeNull();

    const element = await renderDraftPage('site-1', next, 'home', 'it');
    expect(element).not.toBeNull(); // covers: AC-416-5
    const { container } = render(element as ReactElement);

    // Lo slot uploaded e' un <img> VERO (dal renderer unico), col src del NOSTRO builder dall'asset_id.
    const img = container.querySelector(`img[data-image-asset="${A_NEW}"]`);
    expect(img).not.toBeNull(); // covers: AC-416-5
    expect(img?.tagName).toBe('IMG'); // covers: AC-416-5
    expect(img?.getAttribute('src')).toBe(assetPublicUrl(A_NEW)); // covers: AC-416-5
    expect(img?.getAttribute('src')?.endsWith(`/${A_NEW}`)).toBe(true); // covers: AC-416-5
    // Nessuno schema pericoloso: il src e' solo il nostro Storage URL costruito dall'id.
    expect(img?.getAttribute('src')?.toLowerCase().startsWith('javascript:')).toBe(false); // covers: AC-416-5
    // L'altro slot di hero (non toccato) resta un placeholder decorativo, nessun img fabbricato.
    expect(container.querySelector('[data-image-token="hero-b"]')?.tagName).toBe('DIV'); // covers: AC-416-5
  });
});
