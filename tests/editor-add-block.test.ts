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
import { applyBriefUpdate, emptyBrief } from '@/domain/onboarding/brief';
import { addableBlocks, addBlock, findResolvedBlock } from '@/domain/editor/block-ops';
import { draftReducer, initialDraftState } from '@/ui/editor/draft-state';

// T-314 (macrotask editor-blocks, P3) — ORACOLO di "aggiungi blocco dalla libreria". Le asserzioni
// DERIVANO dagli acceptance_criteria AC-314-1..4, taggate `// covers: AC-314-<n>` sulla riga
// dell'EXPECT. Il cuore e' DOMINIO PURO (addableBlocks/addBlock/findResolvedBlock, src/domain/editor)
// piu' l'azione del reducer (src/ui/editor/draft-state); l'anteprima strutturale e la label i18n si
// verificano sul RENDERER UNICO reale via `renderDraftPage` (T-313), non su una ri-implementazione.
//
// MODEL-FREE (P2-D7: un blocco senza dati non esiste, niente prosa fabbricata): il blocco aggiunto e'
// una ISTANZA RISOLTA presa dal documento corrente/baseline (dove `resolve` l'ha gia' prodotta), mai
// costruita a mano ne chiesta al modello. La sorgente e' `findResolvedBlock`, per UGUAGLIANZA ESATTA.
//
// PRECONDITION VERA, non riscritta: l'offerta riusa `blocksFor` (T-210) come gate di precondizione+
// ruolo, cosi' AC-314-2 ha denti — un brief SENZA i dati di X non offre X; un brief CON i dati di X lo
// offre — e 'recensioni' resta fuori perche' la sua precondition e' `() => false` (blocksFor la esclude).
//
// DISCIPLINA FIXTURE (lezione P1/P2): piu' di un blocco, valori DISCORDANTI, e una coppia di id in cui
// uno e' PREFISSO dell'altro ('orari' e' prefisso di 'orari-estivi'), col partner-prefisso messo PRIMA
// nel documento sorgente — cosi' un match per prefisso (startsWith/includes) pescherebbe quello
// sbagliato, mentre l'uguaglianza esatta no. Anche le offerte portano la coppia 'Tagliere' /
// 'Tagliere della casa'.

// ── mock dei SOLI seam (come render-draft-page.test.ts) ───────────────────────────────────────────
// next-intl/server: risolto dal catalogo REALE it (namespace 'site'), cosi' le etichette dei landmark
// sono autentiche e l'escaping resta quello vero di React.
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

/** La label i18n di SEZIONE del catalogo it, per id di blocco (namespace 'site' -> 'blocks.*'). */
function itBlockLabel(key: string): string {
  const blocks = (
    (itMessages as Record<string, unknown>).site as { blocks: Record<string, string> }
  ).blocks;
  return blocks[key];
}

// ── il brief: passa dal VALIDATORE vero, cosi' e' un brief che il dominio accetta davvero ─────────
const BASE_PATCH: Record<string, unknown> = {
  business_name: 'Osteria del Ponte',
  vertical: 'ristorazione',
  description: 'Osteria di quartiere aperta dal 1998, cucina di stagione.',
  address: 'Via dei Mille 4, Bologna',
  phone: '+39 051 000111',
  whatsapp: '+39 340 0001112',
  email: 'ciao@osteriadelponte.it',
  primary_goal: 'prenota',
  highlights: ['Pasta fatta in casa', 'Cantina naturale'],
  // 'Tagliere' e' PREFISSO di 'Tagliere della casa': valori discordanti, coppia-prefisso.
  offerings: [
    { name: 'Tagliere', price: '12,00' },
    { name: 'Tagliere della casa', section: 'Antipasti' },
    { name: 'Zuppa di ceci', price: '9,50' },
  ],
  hours: { 'lun-ven': '9:00-13:00', sabato: '9:00-13:00' },
};

function makeBrief(patch: Record<string, unknown> = {}) {
  const { brief, rejected } = applyBriefUpdate(emptyBrief('it'), { ...BASE_PATCH, ...patch });
  expect(rejected, `patch scartata: ${rejected.join(',')}`).toEqual([]);
  return brief;
}

// I blocchi che ESISTONO sulla home col brief RICCO, in ordine di catalogo (letterale, scritto a mano
// — mai derivato da BLOCKS): 'recensioni' non c'e' (precondition ()=>false), i sette restanti si'.
const RICCO_HOME = ['hero', 'offerte', 'chi-siamo', 'orari', 'contatti', 'faq', 'cta-whatsapp'];

// ── istanze RISOLTE (content prosa + data del brief), la sorgente model-free ───────────────────────
function heroInstance(): SiteBlock {
  return {
    id: 'hero',
    content: { hero_title_kicker: 'Dal 1998', hero_title: 'Osteria del Ponte', hero_subtitle: 'Cucina di stagione' },
    data: { business_name: 'Osteria del Ponte' },
    brief_fields_rendered: ['business_name'],
    images: [],
  };
}

// PARTNER-PREFISSO: id 'orari' e' PREFISSO di 'orari-estivi'. Dati DISCORDANTI dalla vera 'orari',
// e messo PRIMA nel documento sorgente: un match per prefisso lo pescherebbe al posto di 'orari'.
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
    // DIVERGENTE da Object.keys(data) DI PROPOSITO (data ha 'hours', questo e' []): fa mordere il
    // riallineamento brief_fields_rendered = Object.keys(data) che addBlock deve applicare (AC-314-1).
    brief_fields_rendered: [],
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
    brief_fields_rendered: [],
    images: [],
  };
}

// Il DOCUMENTO SORGENTE delle istanze risolte (il "corrente/baseline" della generazione): piu' blocchi,
// valori discordanti, la coppia-prefisso 'orari-estivi' PRIMA di 'orari'.
function sourceDocument(): SiteDocument {
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

/** Un blocco minimo e VALIDO per il gate (content/data vuoti, forma corretta). */
function minimalBlock(id: string): SiteBlock {
  return { id, content: {}, data: {}, brief_fields_rendered: [], images: [] };
}

/** Un documento con la sola pagina 'home' che contiene i blocchi dati per id (minimali, validi). */
function homeDoc(presentIds: readonly string[]): SiteDocument {
  return {
    recipe_id: 'ricetta-test@1',
    theme_id: THEME.id,
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: 'Titolo home',
        meta_description: 'Meta della home',
        blocks: presentIds.map(minimalBlock),
      },
    ],
  };
}

/** Una home con `count` blocchi validi e distinti (b0..b{count-1}): il confine del tetto per pagina. */
function fullPageDoc(count: number): SiteDocument {
  const ids = Array.from({ length: count }, (_, i) => `b${i}`);
  return {
    recipe_id: 'ricetta-test@1',
    theme_id: THEME.id,
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: 'Pagina piena',
        meta_description: 'Home al tetto dei blocchi',
        blocks: ids.map(minimalBlock),
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// findResolvedBlock — la sorgente model-free dell'istanza, per UGUAGLIANZA ESATTA.
// ─────────────────────────────────────────────────────────────────────────────

describe('findResolvedBlock — sorgente dell istanza per uguaglianza esatta (mai prefisso)', () => {
  it('ritorna l istanza con id ESATTO, non il partner-prefisso messo prima', () => {
    const src = sourceDocument(); // 'orari-estivi' compare PRIMA di 'orari'
    const resolved = findResolvedBlock(src, 'orari');
    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe('orari');
    // E' la VERA 'orari' (dati discordanti da 'orari-estivi'): un match per prefisso avrebbe preso l'altro.
    const hours = resolved?.data.hours as Record<string, string>;
    expect(hours['lun-ven']).toBe('8:00-13:00');
    expect(hours['estate']).toBeUndefined();
  });

  it('un id assente dal sorgente -> null: niente prosa fabbricata (model-free)', () => {
    expect(findResolvedBlock(sourceDocument(), 'contatti')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-314-2 — l'OFFERTA: solo i blocchi con precondition dati soddisfatta, esclusi i presenti.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-314-2 — offerta rispettosa della precondition dati e dei blocchi presenti', () => {
  it('su pagina vuota offre ESATTAMENTE i blocchi del ruolo con precondition vera (recensioni MAI)', () => {
    const offered = addableBlocks(makeBrief(), homeDoc([]), 'home').map((b) => b.id);
    // Uguaglianza ESATTA con l'elenco letterale: la precondition e' quella VERA di blocksFor, in ordine
    // di catalogo. 'recensioni' non c'e' perche' la sua precondition e' () => false.
    expect(offered).toEqual(RICCO_HOME); // covers: AC-314-2
    expect(offered).not.toContain('recensioni'); // covers: AC-314-2
  });

  it('esclude i blocchi GIA presenti sulla pagina, per uguaglianza esatta (il prefisso non esclude)', () => {
    // Presenti: hero, chi-siamo e 'orari-estivi' (PREFISSO-partner della candidata 'orari').
    const offered = addableBlocks(makeBrief(), homeDoc(['hero', 'chi-siamo', 'orari-estivi']), 'home').map(
      (b) => b.id,
    );
    expect(offered).toEqual(['offerte', 'orari', 'contatti', 'faq', 'cta-whatsapp']); // covers: AC-314-2
    // I presenti non sono offerti...
    expect(offered).not.toContain('hero'); // covers: AC-314-2
    expect(offered).not.toContain('chi-siamo'); // covers: AC-314-2
    // ...ma 'orari' RESTA offerto benche' 'orari-estivi' (suo prefisso) sia presente: match esatto.
    expect(offered).toContain('orari'); // covers: AC-314-2
  });

  it('un blocco la cui precondition dati e FALSA non e offerto; FALSIFICABILE col dato presente', () => {
    const present = ['hero', 'chi-siamo', 'orari-estivi'];
    // Brief SENZA offerte: la precondition di 'offerte' e' falsa -> non offerto.
    const senzaOfferte = addableBlocks(makeBrief({ offerings: [] }), homeDoc(present), 'home').map(
      (b) => b.id,
    );
    expect(senzaOfferte).not.toContain('offerte'); // covers: AC-314-2
    // FALSIFICABILE: lo STESSO documento/pagina, ma col brief che HA le offerte -> 'offerte' e' offerto.
    const conOfferte = addableBlocks(makeBrief(), homeDoc(present), 'home').map((b) => b.id);
    expect(conOfferte).toContain('offerte'); // covers: AC-314-2
    // 'recensioni' resta fuori in ENTRAMBI: non e' un dato mancante, e' precondition () => false.
    expect(senzaOfferte).not.toContain('recensioni'); // covers: AC-314-2
    expect(conOfferte).not.toContain('recensioni'); // covers: AC-314-2
  });

  it('una pagina inesistente non offre nulla (nessuna offerta senza pagina target)', () => {
    expect(addableBlocks(makeBrief(), homeDoc([]), 'pagina-inesistente')).toEqual([]); // covers: AC-314-2
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-314-1 — l'AGGIUNTA: il blocco risolto entra in coda, brief_fields_rendered riallineato, e' reso.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-314-1 — addBlock inserisce il blocco risolto e riallinea brief_fields_rendered', () => {
  it('inserisce in coda (modello a lista), riallinea a Object.keys(data), non muta l originale', () => {
    const doc = homeDoc(['hero', 'chi-siamo']);
    const resolved = findResolvedBlock(sourceDocument(), 'orari');
    expect(resolved).not.toBeNull();
    // La fixture risolta e' DIVERGENTE: brief_fields_rendered [] mentre data ha 'hours'. Se addBlock non
    // riallineasse, l'asserzione sotto fallirebbe — cosi' il riallineamento e' osservabile mentre agisce.
    expect(resolved?.brief_fields_rendered).not.toEqual(Object.keys(resolved?.data ?? {}));

    const next = addBlock(doc, 'home', resolved as SiteBlock);
    expect(next).not.toBeNull();

    const home = next?.pages.find((p) => p.slug === 'home');
    const blocks = home?.blocks ?? [];
    // In coda: l'ultimo blocco e' quello aggiunto.
    expect(blocks[blocks.length - 1].id).toBe('orari'); // covers: AC-314-1
    const added = blocks[blocks.length - 1];
    // brief_fields_rendered riallineato ai campi effettivamente presenti in data (contratto di sicurezza).
    expect(added.brief_fields_rendered).toEqual(Object.keys(added.data)); // covers: AC-314-1
    expect(added.brief_fields_rendered).toEqual(['hours']); // covers: AC-314-1

    // Il documento in ingresso NON e' mutato (addBlock e' puro): la home resta a 2 blocchi.
    expect(doc.pages[0].blocks).toHaveLength(2); // covers: AC-314-1
    // Cio' che torna e' passato dal gate: e' la copia validata.
    expect(parseDocument(next).ok).toBe(true); // covers: AC-314-1
  });

  it('rendendo la pagina col renderer unico, il blocco aggiunto compare coi suoi dati', async () => {
    genHolder.current = OWNED;
    const doc = homeDoc(['hero', 'chi-siamo']);
    const resolved = findResolvedBlock(sourceDocument(), 'orari') as SiteBlock;
    const next = addBlock(doc, 'home', resolved) as SiteDocument;

    const element = await renderDraftPage('site-1', next, 'home', 'it');
    expect(element).not.toBeNull(); // covers: AC-314-1
    const container = render(element as ReactElement).container;

    // Il blocco aggiunto e' reso (il registry lo dispaccia per id esatto) coi valori del dato risolto.
    expect(container.querySelector('[data-block-id="orari"]')).not.toBeNull(); // covers: AC-314-1
    expect(container.textContent).toContain('8:00-13:00'); // covers: AC-314-1
    // FALSIFICABILE: i dati del PARTNER-PREFISSO 'orari-estivi' NON compaiono (non e' quello aggiunto).
    expect(container.textContent).not.toContain('CHIUSO ad agosto'); // covers: AC-314-1
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-314-3 — il GATE: un'aggiunta oltre i limiti e' RIFIUTATA (null), nulla e' mutato/persistito.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-314-3 — un aggiunta oltre i limiti e rifiutata da parseDocument', () => {
  it('portare la pagina a >12 blocchi -> addBlock ritorna null, il documento non e mutato', () => {
    const full = fullPageDoc(DOCUMENT_LIMITS.blocks_per_page); // esattamente al tetto (12)
    const resolved = findResolvedBlock(sourceDocument(), 'orari') as SiteBlock;
    const before = full.pages[0].blocks.length;

    const rejected = addBlock(full, 'home', resolved);
    expect(rejected).toBeNull(); // covers: AC-314-3
    // Nulla e' mutato: la pagina ha ancora esattamente i blocchi di prima (niente persistito a valle).
    expect(full.pages[0].blocks).toHaveLength(before); // covers: AC-314-3
    expect(full.pages[0].blocks.length).toBe(DOCUMENT_LIMITS.blocks_per_page); // covers: AC-314-3
  });

  it('FALSIFICABILE: un aggiunta ENTRO i limiti (11 -> 12) passa e supera parseDocument', () => {
    const almost = fullPageDoc(DOCUMENT_LIMITS.blocks_per_page - 1); // 11
    const resolved = findResolvedBlock(sourceDocument(), 'orari') as SiteBlock;

    const ok = addBlock(almost, 'home', resolved);
    expect(ok).not.toBeNull(); // covers: AC-314-3
    expect(ok?.pages[0].blocks).toHaveLength(DOCUMENT_LIMITS.blocks_per_page); // covers: AC-314-3
    expect(parseDocument(ok).ok).toBe(true); // covers: AC-314-3
  });

  it('aggiungere a una pagina inesistente e rifiutato (null), nessuna pagina inventata', () => {
    const doc = homeDoc(['hero']);
    const resolved = findResolvedBlock(sourceDocument(), 'orari') as SiteBlock;
    expect(addBlock(doc, 'pagina-inesistente', resolved)).toBeNull(); // covers: AC-314-3
    expect(doc.pages).toHaveLength(1); // covers: AC-314-3
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Difesa in profondità — addBlock rifiuta un id di blocco GIA presente sulla pagina (uguaglianza
// esatta): parseDocument non impone l'unicita' degli id di blocco in una pagina, quindi il mutatore
// autocontiene l'invariante invece di delegarla tutta all'offerta.
// ─────────────────────────────────────────────────────────────────────────────

describe('addBlock — difesa in profondità: id di blocco duplicato sulla pagina rifiutato', () => {
  it('un id GIA presente sulla pagina -> null (uguaglianza esatta), documento non mutato', () => {
    const doc = homeDoc(['hero', 'orari']); // 'orari' gia' presente
    const resolved = findResolvedBlock(sourceDocument(), 'orari') as SiteBlock;
    const rejected = addBlock(doc, 'home', resolved);
    expect(rejected).toBeNull();
    expect(doc.pages[0].blocks).toHaveLength(2);
  });

  it('FALSIFICABILE: il partner-prefisso (id NON presente) e accettato, non e confuso col presente', () => {
    // 'orari-estivi' e' PREFISSO-partner di 'orari' presente: l'uguaglianza esatta NON lo blocca.
    const doc = homeDoc(['hero', 'orari']);
    const estivi = findResolvedBlock(sourceDocument(), 'orari-estivi') as SiteBlock;
    const ok = addBlock(doc, 'home', estivi);
    expect(ok).not.toBeNull();
    expect(ok?.pages[0].blocks.map((b) => b.id)).toEqual(['hero', 'orari', 'orari-estivi']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-314-4 — la LABEL i18n: il blocco aggiunto e' reso con la sua etichetta di catalogo, mai l'id.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-314-4 — il blocco aggiunto usa la label i18n del catalogo, non l id grezzo', () => {
  it('il landmark del blocco aggiunto porta l etichetta di sezione it (aria-label), non l id', async () => {
    genHolder.current = OWNED;
    const doc = homeDoc(['hero']);
    const resolved = findResolvedBlock(sourceDocument(), 'offerte') as SiteBlock;
    const next = addBlock(doc, 'home', resolved) as SiteDocument;

    const element = await renderDraftPage('site-1', next, 'home', 'it');
    const container = render(element as ReactElement).container;

    const section = container.querySelector('[data-block-id="offerte"]');
    expect(section).not.toBeNull();
    // aria-label = l'etichetta i18n REALE del catalogo it per il blocco offerte ('Offerta').
    const atteso = itBlockLabel('offerte');
    expect(atteso).toBe('Offerta'); // pin del valore di catalogo (non un placeholder)
    expect(section?.getAttribute('aria-label')).toBe(atteso); // covers: AC-314-4
    // MAI l'id grezzo ne la prosa non tradotta del modello.
    expect(section?.getAttribute('aria-label')).not.toBe('offerte'); // covers: AC-314-4
    expect(section?.getAttribute('aria-label')).not.toBe('Il nostro menu'); // covers: AC-314-4
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cablaggio reducer — l'azione addBlock chiama il dominio; no-op (stessa reference) sul rifiuto.
// ─────────────────────────────────────────────────────────────────────────────

describe('reducer addBlock — nuova azione con la disciplina delle esistenti', () => {
  it('un aggiunta valida spinge un nuovo stato con voce di storia; undo la annulla', () => {
    const state0 = initialDraftState(homeDoc(['hero', 'chi-siamo']));
    const resolved = findResolvedBlock(sourceDocument(), 'orari') as SiteBlock;

    const state1 = draftReducer(state0, { type: 'addBlock', pageSlug: 'home', block: resolved });
    const home = state1.document.pages.find((p) => p.slug === 'home');
    expect(home?.blocks).toHaveLength(3);
    expect(home?.blocks[2].id).toBe('orari');
    // Il dominio ha riallineato brief_fields_rendered anche attraverso il reducer.
    expect(home?.blocks[2].brief_fields_rendered).toEqual(['hours']);
    // Voce di storia spinta: undo torna esattamente allo stato precedente.
    expect(state1.past).toHaveLength(1);
    const undone = draftReducer(state1, { type: 'undo' });
    expect(undone.document).toEqual(state0.document);
  });

  it('un aggiunta oltre i limiti e un NO-OP: stessa reference, nessuna voce di storia spuria', () => {
    const state0 = initialDraftState(fullPageDoc(DOCUMENT_LIMITS.blocks_per_page));
    const resolved = findResolvedBlock(sourceDocument(), 'orari') as SiteBlock;
    const state1 = draftReducer(state0, { type: 'addBlock', pageSlug: 'home', block: resolved });
    expect(state1).toBe(state0); // covers: AC-314-3 — rifiuto del gate -> no-op, nulla nel draft
  });
});
