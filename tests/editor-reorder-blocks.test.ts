// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { render, cleanup } from '@testing-library/react';
import itMessages from '../messages/it.json';
import { THEMES } from '@/domain/generation/themes';
import {
  DOCUMENT_LIMITS,
  parseDocument,
  type SiteBlock,
  type SiteDocument,
} from '@/domain/generation/document';
import { reorderBlock } from '@/domain/editor/block-ops';
import { draftReducer, initialDraftState } from '@/ui/editor/draft-state';

// T-315 (macrotask editor-blocks, P3) — ORACOLO di "riordina i blocchi in una pagina (lista
// ordinabile)". Le asserzioni DERIVANO dagli acceptance_criteria AC-315-1..3, taggate
// `// covers: AC-315-<n>` sulla riga dell'EXPECT. Il cuore e' DOMINIO PURO (`reorderBlock`,
// src/domain/editor) piu' l'azione del reducer (src/ui/editor/draft-state); l'ordine reso in
// anteprima si osserva sul RENDERER UNICO reale via `renderDraftPage` (T-313), mai su una
// ri-implementazione.
//
// IL RIORDINO E' UNA LISTA ORDINABILE (DoD T-315): sposta un blocco da un indice a un altro entro
// la pagina — nessun drag pixel-libero. La domanda che l'oracolo pone e' precisa: cambia SOLO
// l'ordine, MAI il contenuto (AC-315-1), l'anteprima riflette il nuovo ordine (AC-315-2), e il
// documento riordinato passa comunque `parseDocument` (AC-315-3).
//
// DISCIPLINA FIXTURE (lezione P1/P2, e AC-315-1 la pretende): la pagina ha PIU' DI UN blocco, con
// contenuti DISCORDANTI, e una coppia di id in cui uno e' PREFISSO dell'altro ('orari' e' prefisso
// di 'orari-estivi'), col partner-prefisso messo PRIMA nel documento. Cosi' AC-315-1 puo' provare
// che l'identita' dei blocchi e' per UGUAGLIANZA ESATTA (confronto profondo per id) e non per
// prefisso: dopo un riordino la 'orari' vera conserva i propri dati e non viene confusa con la
// 'orari-estivi' che la precede.

// ── mock dei SOLI seam (come editor-add-block.test.ts) ─────────────────────────────────────────
// next-intl/server: risolto dal catalogo REALE it (namespace 'site'), cosi' le etichette dei
// landmark sono autentiche e l'escaping resta quello vero di React.
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ namespace }: { locale: string; namespace: string }) => {
    const ns = ((itMessages as Record<string, unknown>)[namespace] ?? {}) as Record<string, unknown>;
    return (key: string) => {
      const value = key
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], ns);
      return typeof value === 'string' ? value : `${namespace}.${key}`;
    };
  },
}));

// getGeneration e' il SEAM di OWNERSHIP (RLS) di renderDraftPage: pilotato per-test dall'holder.
const { genHolder } = vi.hoisted(() => ({ genHolder: { current: null as unknown } }));
vi.mock('@/data/generations', () => ({ getGeneration: async () => genHolder.current }));

import { renderDraftPage } from '@/app/[locale]/editor/[siteId]/render-draft-page';

const THEME = THEMES[0];
// 'posseduto': renderDraftPage legge solo la non-nullita' di `generation`.
const OWNED = { ok: true, generation: { id: 'gen-1', site_id: 'site-1', status: 'chosen' } };

afterEach(() => cleanup());

// ── istanze RISOLTE, contenuti DISCORDANTI, con la coppia-prefisso 'orari'/'orari-estivi' ───────
// Blocchi con un componente registrato (hero/orari/offerte) rendono e portano un data-block-id; il
// partner-prefisso 'orari-estivi' non e' nel registry, quindi rende null — ma esiste nel documento
// per fare mordere l'uguaglianza esatta nel confronto per id di AC-315-1.

function heroInstance(): SiteBlock {
  return {
    id: 'hero',
    content: { hero_title_kicker: 'Dal 1998', hero_title: 'Osteria del Ponte', hero_subtitle: 'Cucina di stagione' },
    data: { business_name: 'Osteria del Ponte' },
    brief_fields_rendered: ['business_name'],
    images: [],
  };
}

// PARTNER-PREFISSO: id 'orari-estivi' e' PREFISSO-partner di 'orari'. Dati DISCORDANTI dalla vera
// 'orari', e messo PRIMA nel documento: un confronto per prefisso lo confonderebbe con 'orari'.
function orariEstiviInstance(): SiteBlock {
  return {
    id: 'orari-estivi',
    content: { hours_title: 'Orari estivi' },
    data: { hours: { estate: 'CHIUSO ad agosto' } },
    brief_fields_rendered: ['hours'],
    images: [],
  };
}

function orariInstance(): SiteBlock {
  return {
    id: 'orari',
    content: { hours_title: 'Orari di apertura' },
    data: { hours: { 'lun-ven': '8:00-13:00', sabato: '9:00-12:00' } },
    brief_fields_rendered: ['hours'],
    images: [],
  };
}

function offerteInstance(): SiteBlock {
  return {
    id: 'offerte',
    content: { offerings_title: 'Il nostro menu' },
    data: {
      offerings: [
        { name: 'Tagliere', price: '12,00' },
        { name: 'Tagliere della casa', section: 'Antipasti' },
      ],
    },
    brief_fields_rendered: ['offerings'],
    images: [],
  };
}

// IL DOCUMENTO da riordinare: una home con QUATTRO blocchi, contenuti discordanti, la coppia
// 'orari-estivi' (index 1) PRIMA di 'orari' (index 2). Ordine iniziale degli id:
//   ['hero', 'orari-estivi', 'orari', 'offerte'].
function reorderDoc(): SiteDocument {
  return {
    recipe_id: 'ricetta-test@1',
    theme_id: THEME.id,
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: 'Osteria del Ponte',
        meta_description: 'Cucina di stagione a Bologna',
        blocks: [heroInstance(), orariEstiviInstance(), orariInstance(), offerteInstance()],
      },
    ],
  };
}

const START_IDS = ['hero', 'orari-estivi', 'orari', 'offerte'];

/** Gli id dei blocchi della home, in ordine. */
function homeBlockIds(document: SiteDocument): string[] {
  const home = document.pages.find((p) => p.slug === 'home');
  return (home?.blocks ?? []).map((b) => b.id);
}

/** La sequenza degli id-blocco RESI (in ordine di DOM), da `data-block-id` (SiteSection). */
function renderedBlockIds(root: HTMLElement): string[] {
  return [...root.querySelectorAll('[data-block-id]')].map(
    (el) => (el as HTMLElement).getAttribute('data-block-id') ?? '',
  );
}

// Un documento a UN solo blocco valido per la pagina: confine "niente da riordinare".
function singleBlockDoc(): SiteDocument {
  return {
    recipe_id: 'ricetta-test@1',
    theme_id: THEME.id,
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: 'Titolo home',
        meta_description: 'Meta della home',
        blocks: [heroInstance()],
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-315-1 — cambia SOLO l'ordine; nessun contenuto di blocco e' alterato.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-315-1 — reorderBlock cambia solo la sequenza, mai il contenuto dei blocchi', () => {
  it('sposta il blocco senza alterare alcun content/data (confronto profondo per id esatto)', () => {
    const doc = reorderDoc();
    // Sposta 'orari' (index 2) in testa (index 0), OLTRE il suo partner-prefisso 'orari-estivi'.
    const next = reorderBlock(doc, 'home', 2, 0);
    expect(next).not.toBeNull();

    const before = homeBlockIds(doc);
    const after = homeBlockIds(next as SiteDocument);
    // L'ordine e' cambiato in modo OSSERVABILE: 'orari' e' passato in testa.
    expect(before).toEqual(START_IDS); // covers: AC-315-1
    expect(after).toEqual(['orari', 'hero', 'orari-estivi', 'offerte']); // covers: AC-315-1
    expect(after).not.toEqual(before); // covers: AC-315-1

    // Stesso INSIEME di blocchi (per id): e' una permutazione, nulla e' aggiunto o tolto.
    expect([...after].sort()).toEqual([...before].sort()); // covers: AC-315-1

    // NESSUN contenuto alterato: ogni blocco, per id ESATTO, e' profondamente uguale a prima.
    const nextHome = (next as SiteDocument).pages.find((p) => p.slug === 'home');
    const byId = new Map((nextHome?.blocks ?? []).map((b) => [b.id, b]));
    for (const original of doc.pages[0].blocks) {
      expect(byId.get(original.id)).toEqual(original); // covers: AC-315-1
    }

    // PREFISSO NON CONFUSO: la 'orari' vera conserva i propri orari e non eredita quelli di
    // 'orari-estivi' (partner-prefisso); e viceversa. L'identita' e' per uguaglianza esatta.
    const orari = byId.get('orari');
    const orariEstivi = byId.get('orari-estivi');
    expect((orari?.data.hours as Record<string, string>)['lun-ven']).toBe('8:00-13:00'); // covers: AC-315-1
    expect((orari?.data.hours as Record<string, string>)['estate']).toBeUndefined(); // covers: AC-315-1
    expect((orariEstivi?.data.hours as Record<string, string>)['estate']).toBe('CHIUSO ad agosto'); // covers: AC-315-1
    expect((orariEstivi?.data.hours as Record<string, string>)['lun-ven']).toBeUndefined(); // covers: AC-315-1
  });

  it('e PURO: non muta il documento in ingresso', () => {
    const doc = reorderDoc();
    const snapshot = JSON.parse(JSON.stringify(doc));
    reorderBlock(doc, 'home', 2, 0);
    expect(doc).toEqual(snapshot); // covers: AC-315-1
    expect(homeBlockIds(doc)).toEqual(START_IDS); // covers: AC-315-1
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-315-2 — l'anteprima rende i blocchi nel NUOVO ordine.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-315-2 — renderDraftPage rende i data-block-id nel nuovo ordine', () => {
  it('dopo il riordino la sequenza resa cambia; il partner-prefisso non confonde la sequenza', async () => {
    genHolder.current = OWNED;
    const doc = reorderDoc();

    // Anteprima PRIMA del riordino: i blocchi registrati rendono nell'ordine iniziale
    // (il partner-prefisso 'orari-estivi' non e' nel registry e non compare).
    const beforeEl = await renderDraftPage('site-1', doc, 'home', 'it');
    expect(beforeEl).not.toBeNull();
    const beforeContainer = render(beforeEl as ReactElement).container;
    expect(renderedBlockIds(beforeContainer)).toEqual(['hero', 'orari', 'offerte']); // covers: AC-315-2
    cleanup();

    // Riordino: 'orari' (index 2) va in testa (index 0).
    const next = reorderBlock(doc, 'home', 2, 0) as SiteDocument;
    const afterEl = await renderDraftPage('site-1', next, 'home', 'it');
    expect(afterEl).not.toBeNull();
    const afterContainer = render(afterEl as ReactElement).container;

    // L'anteprima riflette il NUOVO ordine: 'orari' e' ora il primo blocco reso.
    expect(renderedBlockIds(afterContainer)).toEqual(['orari', 'hero', 'offerte']); // covers: AC-315-2
    // FALSIFICABILE: la sequenza e' DAVVERO cambiata rispetto all'anteprima iniziale.
    expect(renderedBlockIds(afterContainer)).not.toEqual(['hero', 'orari', 'offerte']); // covers: AC-315-2
    // La 'orari' resa e' UNA sola sezione (identita' esatta, mai un match di prefisso su 'orari-estivi').
    expect(afterContainer.querySelectorAll('[data-block-id="orari"]')).toHaveLength(1); // covers: AC-315-2
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-315-3 — il documento riordinato passa parseDocument (una home, limiti rispettati).
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-315-3 — il documento riordinato supera il gate parseDocument', () => {
  it('parseDocument accetta il riordino: una sola home e blocchi entro il tetto', () => {
    const doc = reorderDoc();
    const next = reorderBlock(doc, 'home', 2, 0) as SiteDocument;

    const parsed = parseDocument(next);
    expect(parsed.ok).toBe(true); // covers: AC-315-3
    if (parsed.ok) {
      const homes = parsed.document.pages.filter((p) => p.role === 'home');
      expect(homes).toHaveLength(1); // covers: AC-315-3
      expect(homes[0].blocks.length).toBeLessThanOrEqual(DOCUMENT_LIMITS.blocks_per_page); // covers: AC-315-3
      // La home riordinata ha ancora tutti e quattro i blocchi, nel nuovo ordine.
      expect(homes[0].blocks.map((b) => b.id)).toEqual(['orari', 'hero', 'orari-estivi', 'offerte']); // covers: AC-315-3
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Indici invalidi / fuori range — no-op (null), documento non mutato.
// ─────────────────────────────────────────────────────────────────────────────

describe('reorderBlock — input invalido: no-op, nulla e mutato', () => {
  it('fromIndex === toIndex non e un movimento -> null (no-op)', () => {
    const doc = reorderDoc();
    expect(reorderBlock(doc, 'home', 2, 2)).toBeNull();
    expect(homeBlockIds(doc)).toEqual(START_IDS);
  });

  it('indici fuori range -> null, e il documento resta intatto', () => {
    const doc = reorderDoc();
    const snapshot = JSON.parse(JSON.stringify(doc));
    expect(reorderBlock(doc, 'home', 5, 0)).toBeNull(); // fromIndex oltre il tetto
    expect(reorderBlock(doc, 'home', 0, -1)).toBeNull(); // toIndex negativo
    expect(reorderBlock(doc, 'home', 0, 4)).toBeNull(); // toIndex fuori range (== length)
    expect(doc).toEqual(snapshot);
  });

  it('indice non intero (canonico) -> null', () => {
    const doc = reorderDoc();
    expect(reorderBlock(doc, 'home', 1.5, 0)).toBeNull();
    expect(reorderBlock(doc, 'home', 0, Number.NaN)).toBeNull();
    expect(homeBlockIds(doc)).toEqual(START_IDS);
  });

  it('pagina inesistente (per uguaglianza esatta dello slug) -> null', () => {
    const doc = reorderDoc();
    expect(reorderBlock(doc, 'pagina-inesistente', 0, 1)).toBeNull();
    expect(doc.pages).toHaveLength(1);
  });

  it('una pagina con un solo blocco non ha nulla da riordinare -> null', () => {
    const doc = singleBlockDoc();
    expect(reorderBlock(doc, 'home', 0, 0)).toBeNull();
    expect(homeBlockIds(doc)).toEqual(['hero']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cablaggio reducer — l'azione reorderBlock chiama il dominio; no-op (stessa reference) sul rifiuto.
// ─────────────────────────────────────────────────────────────────────────────

describe('reducer reorderBlock — nuova azione con la disciplina delle esistenti', () => {
  it('un riordino valido spinge un nuovo stato con voce di storia; undo lo annulla', () => {
    const state0 = initialDraftState(reorderDoc());
    const state1 = draftReducer(state0, { type: 'reorderBlock', pageSlug: 'home', fromIndex: 2, toIndex: 0 });

    expect(homeBlockIds(state1.document)).toEqual(['orari', 'hero', 'orari-estivi', 'offerte']);
    // Voce di storia spinta e futuro azzerato, la stessa disciplina di editSlot/addBlock.
    expect(state1.past).toHaveLength(1);
    expect(state1.future).toHaveLength(0);
    // Undo torna esattamente allo stato precedente.
    const undone = draftReducer(state1, { type: 'undo' });
    expect(undone.document).toEqual(state0.document);
  });

  it('un riordino invalido e un NO-OP: stessa reference, nessuna voce di storia spuria', () => {
    const state0 = initialDraftState(reorderDoc());
    // Stesso indice: nessun movimento.
    expect(draftReducer(state0, { type: 'reorderBlock', pageSlug: 'home', fromIndex: 1, toIndex: 1 })).toBe(state0);
    // Fuori range.
    expect(draftReducer(state0, { type: 'reorderBlock', pageSlug: 'home', fromIndex: 9, toIndex: 0 })).toBe(state0);
    // Pagina inesistente.
    expect(draftReducer(state0, { type: 'reorderBlock', pageSlug: 'nope', fromIndex: 0, toIndex: 1 })).toBe(state0);
  });
});
