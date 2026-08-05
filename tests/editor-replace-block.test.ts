// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { render, cleanup } from '@testing-library/react';
import itMessages from '../messages/it.json';
import { THEMES } from '@/domain/generation/themes';
import { parseDocument, type SiteBlock, type SiteDocument } from '@/domain/generation/document';
import { applyBriefUpdate, emptyBrief } from '@/domain/onboarding/brief';
import { addableBlocks, replaceBlock } from '@/domain/editor/block-ops';
import { draftReducer, initialDraftState } from '@/ui/editor/draft-state';

// T-316 (macrotask editor-blocks, P3) — ORACOLO di "sostituisci un blocco con un altro dalla
// libreria". Le asserzioni DERIVANO dagli acceptance_criteria AC-316-1..3, taggate
// `// covers: AC-316-<n>` sulla riga dell'EXPECT. Il cuore e' DOMINIO PURO (`replaceBlock`,
// src/domain/editor) piu' l'azione del reducer (src/ui/editor/draft-state); il blocco reso al posto
// del vecchio si osserva sul RENDERER UNICO reale via `renderDraftPage` (T-313), mai su una
// ri-implementazione. La sostituzione e' model-free e rispettosa della precondition, come T-314.
//
// MODEL-FREE (P2-D7): il nuovo blocco e' una ISTANZA RISOLTA (content prosa + data del brief), qui
// scritta a mano come fixture (la sorgente di produzione e' il baseline, come per l'aggiunta). La
// PRECONDITION dei candidati non e' riscritta: i candidati sostitutivi sono `addableBlocks` — lo
// stesso gate `blocksFor`+presenti dell'aggiunta — cosi' AC-316-2 ha i denti (un blocco senza i suoi
// dati non e' offerto; falsificabile col brief che i dati li ha) e 'recensioni' resta sempre fuori.
//
// DISCIPLINA FIXTURE (lezione P1/P2): la pagina ha PIU' DI UN blocco, con valori DISCORDANTI, e una
// coppia di id in cui uno e' PREFISSO dell'altro ('orari' e' prefisso di 'orari-estivi'), col
// partner-prefisso messo PRIMA nel documento. Cosi' l'uguaglianza ESATTA morde: il candidato 'orari'
// resta offerto benche' 'orari-estivi' sia presente, e il blocco reso porta i dati della VERA 'orari'
// e non quelli del partner-prefisso. Il NUOVO blocco (`orariInstance`) ha `brief_fields_rendered`
// DIVERGENTE da Object.keys(data) PRIMA della sostituzione, cosi' la riconciliazione e' osservabile
// mentre agisce (AC-316-1). Riusa i pattern di tests/editor-add-block.test.ts.

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

/** La label i18n di SEZIONE del catalogo it, per chiave di blocco (namespace 'site' -> 'blocks.*'). */
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

// ── istanze RISOLTE (content prosa + data del brief), contenuti DISCORDANTI ────────────────────
function heroInstance(): SiteBlock {
  return {
    id: 'hero',
    content: {
      hero_title_kicker: 'Dal 1998',
      hero_title: 'Osteria del Ponte',
      hero_subtitle: 'Cucina di stagione',
    },
    data: { business_name: 'Osteria del Ponte' },
    brief_fields_rendered: ['business_name'],
    images: [],
  };
}

// PARTNER-PREFISSO: id 'orari-estivi' e' PREFISSO-partner di 'orari'. Dati DISCORDANTI dalla vera
// 'orari', e messo PRIMA nel documento: un match per prefisso lo confonderebbe con 'orari'. Non e'
// nel registry, quindi in anteprima rende null — ma esiste per fare mordere l'uguaglianza esatta.
function orariEstiviInstance(): SiteBlock {
  return {
    id: 'orari-estivi',
    content: { hours_title: 'Orari estivi' },
    data: { hours: { estate: 'CHIUSO ad agosto' } },
    brief_fields_rendered: ['hours'],
    images: [],
  };
}

// IL BLOCCO VECCHIO da sostituire: 'chi-siamo' rende (registry) e porta un data-block-id, cosi' la
// sua SPARIZIONE dopo la sostituzione e' osservabile.
function chiSiamoInstance(): SiteBlock {
  return {
    id: 'chi-siamo',
    content: {
      about_title: 'La nostra storia',
      about_body: 'Una cucina di quartiere.',
      about_points: [],
    },
    data: {},
    brief_fields_rendered: [],
    images: [],
  };
}

// IL BLOCCO NUOVO (istanza risolta di 'orari'): `brief_fields_rendered` DIVERGENTE da
// Object.keys(data) (data ha 'hours', questo e' []) DI PROPOSITO — cosi' la riconciliazione a
// Object.keys(data) che `replaceBlock` deve applicare e' osservabile mentre agisce (AC-316-1).
function orariInstance(): SiteBlock {
  return {
    id: 'orari',
    content: { hours_title: 'Orari di apertura' },
    data: { hours: { 'lun-ven': '8:00-13:00', sabato: '9:00-12:00' } },
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
    brief_fields_rendered: ['offerings'],
    images: [],
  };
}

// IL DOCUMENTO da editare: una home con QUATTRO blocchi, contenuti discordanti, il partner-prefisso
// 'orari-estivi' (index 1) PRIMA della candidata 'orari'. Il vecchio blocco da sostituire e'
// 'chi-siamo' all'index 2. Ordine iniziale degli id: ['hero', 'orari-estivi', 'chi-siamo', 'offerte'].
function editingDoc(): SiteDocument {
  return {
    recipe_id: 'ricetta-test@1',
    theme_id: THEME.id,
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: 'Osteria del Ponte',
        meta_description: 'Cucina di stagione a Bologna',
        blocks: [heroInstance(), orariEstiviInstance(), chiSiamoInstance(), offerteInstance()],
      },
    ],
  };
}

const START_IDS = ['hero', 'orari-estivi', 'chi-siamo', 'offerte'];

/** Gli id dei blocchi della home, in ordine. */
function homeBlockIds(document: SiteDocument): string[] {
  const home = document.pages.find((p) => p.slug === 'home');
  return (home?.blocks ?? []).map((b) => b.id);
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

// ─────────────────────────────────────────────────────────────────────────────
// AC-316-1 — la SOSTITUZIONE: il nuovo blocco entra al posto del vecchio, brief_fields_rendered
// riconciliato, ed e' reso (il vecchio no).
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-316-1 — replaceBlock mette il nuovo blocco al posto del vecchio e riconcilia i campi', () => {
  it('sostituisce all indice dato, riallinea a Object.keys(data), non muta l originale', () => {
    const doc = editingDoc();
    const nuovo = orariInstance();
    // La fixture del nuovo blocco e' DIVERGENTE: brief_fields_rendered [] mentre data ha 'hours'. Se
    // replaceBlock non riconciliasse, l'asserzione sotto fallirebbe — cosi' la riconciliazione e'
    // osservabile mentre agisce.
    expect(nuovo.brief_fields_rendered).not.toEqual(Object.keys(nuovo.data));

    // Sostituisci 'chi-siamo' (index 2) con l'istanza risolta di 'orari'.
    const next = replaceBlock(doc, 'home', 2, nuovo);
    expect(next).not.toBeNull();

    const home = (next as SiteDocument).pages.find((p) => p.slug === 'home');
    const blocks = home?.blocks ?? [];
    // Al POSTO del vecchio: l'indice 2 porta ora il nuovo blocco, il vecchio 'chi-siamo' non c'e' piu'.
    expect(blocks[2].id).toBe('orari'); // covers: AC-316-1
    expect(blocks.map((b) => b.id)).toEqual(['hero', 'orari-estivi', 'orari', 'offerte']); // covers: AC-316-1
    expect(blocks.map((b) => b.id)).not.toContain('chi-siamo'); // covers: AC-316-1

    // brief_fields_rendered RICONCILIATO ai campi effettivamente presenti in data (contratto A05).
    const sostituito = blocks[2];
    expect(sostituito.brief_fields_rendered).toEqual(Object.keys(sostituito.data)); // covers: AC-316-1
    expect(sostituito.brief_fields_rendered).toEqual(['hours']); // covers: AC-316-1

    // Gli ALTRI blocchi restano intatti (per id esatto): la coppia-prefisso non e' confusa.
    const byId = new Map(blocks.map((b) => [b.id, b]));
    expect((byId.get('orari')?.data.hours as Record<string, string>)['lun-ven']).toBe('8:00-13:00'); // covers: AC-316-1
    expect((byId.get('orari')?.data.hours as Record<string, string>)['estate']).toBeUndefined(); // covers: AC-316-1
    expect(
      (byId.get('orari-estivi')?.data.hours as Record<string, string>)['estate'],
    ).toBe('CHIUSO ad agosto'); // covers: AC-316-1

    // PURO: il documento in ingresso NON e' mutato — 'chi-siamo' resta all'index 2, niente 'orari'.
    expect(homeBlockIds(doc)).toEqual(START_IDS); // covers: AC-316-1
    expect(doc.pages[0].blocks[2].id).toBe('chi-siamo'); // covers: AC-316-1
    expect(homeBlockIds(doc)).not.toContain('orari'); // covers: AC-316-1
  });

  it('rendendo col renderer unico, il nuovo blocco compare al posto del vecchio (label i18n inclusa)', async () => {
    genHolder.current = OWNED;
    const doc = editingDoc();

    // Anteprima PRIMA: 'chi-siamo' e' reso (il partner-prefisso 'orari-estivi' no).
    const beforeEl = await renderDraftPage('site-1', doc, 'home', 'it');
    expect(beforeEl).not.toBeNull();
    const beforeContainer = render(beforeEl as ReactElement).container;
    expect(beforeContainer.querySelector('[data-block-id="chi-siamo"]')).not.toBeNull(); // covers: AC-316-1
    expect(beforeContainer.querySelector('[data-block-id="orari"]')).toBeNull(); // covers: AC-316-1
    cleanup();

    // Sostituisci 'chi-siamo' (index 2) con 'orari' e ri-rendi.
    const next = replaceBlock(doc, 'home', 2, orariInstance()) as SiteDocument;
    const afterEl = await renderDraftPage('site-1', next, 'home', 'it');
    expect(afterEl).not.toBeNull();
    const afterContainer = render(afterEl as ReactElement).container;

    // Il NUOVO blocco e' reso; il VECCHIO no. Una sola sezione 'orari' (identita' esatta).
    const section = afterContainer.querySelector('[data-block-id="orari"]');
    expect(section).not.toBeNull(); // covers: AC-316-1
    expect(afterContainer.querySelectorAll('[data-block-id="orari"]')).toHaveLength(1); // covers: AC-316-1
    expect(afterContainer.querySelector('[data-block-id="chi-siamo"]')).toBeNull(); // covers: AC-316-1

    // La label i18n del NUOVO blocco e' presente sul landmark (aria-label di catalogo, mai l'id).
    const atteso = itBlockLabel('orari');
    expect(atteso).toBe('Orari'); // pin del valore di catalogo (non un placeholder)
    expect(section?.getAttribute('aria-label')).toBe(atteso); // covers: AC-316-1
    expect(section?.getAttribute('aria-label')).not.toBe('orari'); // covers: AC-316-1

    // Coi DATI del nuovo blocco, non quelli del partner-prefisso (uguaglianza esatta, mai prefisso).
    expect(afterContainer.textContent).toContain('8:00-13:00'); // covers: AC-316-1
    expect(afterContainer.textContent).not.toContain('CHIUSO ad agosto'); // covers: AC-316-1
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-316-2 — i CANDIDATI sostitutivi (addableBlocks): niente blocco con precondition dati falsa.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-316-2 — i candidati di sostituzione rispettano la precondition dati e i presenti', () => {
  it('un blocco con precondition dati FALSA non e offerto; FALSIFICABILE col dato presente', () => {
    // Presenti: hero, chi-siamo e 'orari-estivi' (PREFISSO-partner della candidata 'orari').
    const present = ['hero', 'chi-siamo', 'orari-estivi'];
    // Brief SENZA offerte: la precondition di 'offerte' e' falsa -> NON e' un candidato sostitutivo.
    const senzaOfferte = addableBlocks(makeBrief({ offerings: [] }), homeDoc(present), 'home').map(
      (b) => b.id,
    );
    expect(senzaOfferte).not.toContain('offerte'); // covers: AC-316-2
    // FALSIFICABILE: lo STESSO documento/pagina, ma col brief che HA le offerte -> 'offerte' e' offerto.
    const conOfferte = addableBlocks(makeBrief(), homeDoc(present), 'home').map((b) => b.id);
    expect(conOfferte).toContain('offerte'); // covers: AC-316-2
    // 'recensioni' resta fuori in ENTRAMBI: non e' un dato mancante, e' precondition () => false.
    expect(senzaOfferte).not.toContain('recensioni'); // covers: AC-316-2
    expect(conOfferte).not.toContain('recensioni'); // covers: AC-316-2
    // La candidata 'orari' RESTA offerta benche' il partner-prefisso 'orari-estivi' sia presente:
    // l'esclusione dei presenti e' per uguaglianza ESATTA, mai per prefisso.
    expect(conOfferte).toContain('orari'); // covers: AC-316-2
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-316-3 — il GATE: la sostituzione risultante passa parseDocument; input invalido -> null.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-316-3 — la sostituzione supera parseDocument; indici invalidi rifiutati (no-op)', () => {
  it('il documento sostituito passa parseDocument (una home, blocchi entro il tetto)', () => {
    const doc = editingDoc();
    const next = replaceBlock(doc, 'home', 2, orariInstance()) as SiteDocument;
    const parsed = parseDocument(next);
    expect(parsed.ok).toBe(true); // covers: AC-316-3
    if (parsed.ok) {
      const homes = parsed.document.pages.filter((p) => p.role === 'home');
      expect(homes).toHaveLength(1); // covers: AC-316-3
      expect(homes[0].blocks.map((b) => b.id)).toEqual(['hero', 'orari-estivi', 'orari', 'offerte']); // covers: AC-316-3
    }
  });

  it('indice fuori range / non canonico / pagina assente -> null, e il documento resta intatto', () => {
    const doc = editingDoc();
    const snapshot = JSON.parse(JSON.stringify(doc));
    const nuovo = orariInstance();
    expect(replaceBlock(doc, 'home', -1, nuovo)).toBeNull(); // indice negativo // covers: AC-316-3
    expect(replaceBlock(doc, 'home', 4, nuovo)).toBeNull(); // == length, fuori range // covers: AC-316-3
    expect(replaceBlock(doc, 'home', 1.5, nuovo)).toBeNull(); // non intero // covers: AC-316-3
    expect(replaceBlock(doc, 'home', Number.NaN, nuovo)).toBeNull(); // NaN // covers: AC-316-3
    // Pagina inesistente (per uguaglianza esatta dello slug) -> null.
    expect(replaceBlock(doc, 'pagina-inesistente', 0, nuovo)).toBeNull(); // covers: AC-316-3
    // Nulla e' mutato da alcun rifiuto.
    expect(doc).toEqual(snapshot); // covers: AC-316-3
    expect(homeBlockIds(doc)).toEqual(START_IDS); // covers: AC-316-3
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Difesa in profondità — come `addBlock`, `replaceBlock` autocontiene l'invariante "niente id di
// blocco duplicato sulla pagina": parseDocument non impone l'unicita' degli id di blocco, quindi
// sostituire un blocco con l'id di un ALTRO gia' presente e' rifiutato (uguaglianza esatta),
// escludendo pero' il blocco che si sta sostituendo (un nuovo blocco con lo stesso id resta lecito).
// ─────────────────────────────────────────────────────────────────────────────

describe('replaceBlock — difesa in profondità: id di blocco duplicato con un ALTRO presente rifiutato', () => {
  it('sostituire con l id di un blocco gia presente ALTROVE -> null, documento non mutato', () => {
    const doc = editingDoc();
    // 'hero' e' gia' presente all'index 0: sostituire 'chi-siamo' (index 2) con un blocco 'hero'
    // creerebbe due sezioni con lo stesso data-block-id -> rifiuto.
    const rejected = replaceBlock(doc, 'home', 2, heroInstance());
    expect(rejected).toBeNull();
    expect(homeBlockIds(doc)).toEqual(START_IDS);
  });

  it('FALSIFICABILE: sostituire con un id NON presente altrove e accettato', () => {
    const doc = editingDoc();
    // 'orari' non e' presente (c'e' solo il partner-prefisso 'orari-estivi', per uguaglianza esatta
    // NON lo blocca): la sostituzione passa.
    const ok = replaceBlock(doc, 'home', 2, orariInstance());
    expect(ok).not.toBeNull();
    expect(homeBlockIds(ok as SiteDocument)).toEqual(['hero', 'orari-estivi', 'orari', 'offerte']);
  });

  it('sostituire un blocco con un nuovo blocco dallo STESSO id (all indice stesso) e lecito', () => {
    const doc = editingDoc();
    // Il guardiano esclude il blocco che si sta sostituendo: rimpiazzare 'chi-siamo' (index 2) con
    // una nuova istanza 'chi-siamo' non e' un duplicato e non e' rifiutato.
    const fresh: SiteBlock = { ...chiSiamoInstance(), content: { about_title: 'Rinnovata' } };
    const ok = replaceBlock(doc, 'home', 2, fresh);
    expect(ok).not.toBeNull();
    expect(homeBlockIds(ok as SiteDocument)).toEqual(START_IDS);
    const home = (ok as SiteDocument).pages.find((p) => p.slug === 'home');
    expect(home?.blocks[2].content.about_title).toBe('Rinnovata');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cablaggio reducer — l'azione replaceBlock chiama il dominio; no-op (stessa reference) sul rifiuto.
// ─────────────────────────────────────────────────────────────────────────────

describe('reducer replaceBlock — nuova azione con la disciplina delle esistenti', () => {
  it('una sostituzione valida spinge un nuovo stato con voce di storia; undo la annulla', () => {
    const state0 = initialDraftState(editingDoc());
    const state1 = draftReducer(state0, {
      type: 'replaceBlock',
      pageSlug: 'home',
      blockIndex: 2,
      block: orariInstance(),
    });

    const home = state1.document.pages.find((p) => p.slug === 'home');
    expect(home?.blocks[2].id).toBe('orari');
    // Il dominio ha riconciliato brief_fields_rendered anche attraverso il reducer.
    expect(home?.blocks[2].brief_fields_rendered).toEqual(['hours']);
    // Voce di storia spinta e futuro azzerato, la stessa disciplina di editSlot/addBlock/reorderBlock.
    expect(state1.past).toHaveLength(1);
    expect(state1.future).toHaveLength(0);
    // Undo torna esattamente allo stato precedente.
    const undone = draftReducer(state1, { type: 'undo' });
    expect(undone.document).toEqual(state0.document);
  });

  it('una sostituzione invalida e un NO-OP: stessa reference, nessuna voce di storia spuria', () => {
    const state0 = initialDraftState(editingDoc());
    // Indice fuori range.
    expect(
      draftReducer(state0, { type: 'replaceBlock', pageSlug: 'home', blockIndex: 9, block: orariInstance() }),
    ).toBe(state0);
    // Pagina inesistente.
    expect(
      draftReducer(state0, { type: 'replaceBlock', pageSlug: 'nope', blockIndex: 0, block: orariInstance() }),
    ).toBe(state0);
    // Id duplicato con un ALTRO blocco presente (difesa in profondità) -> rifiuto del dominio -> no-op.
    expect(
      draftReducer(state0, { type: 'replaceBlock', pageSlug: 'home', blockIndex: 2, block: heroInstance() }),
    ).toBe(state0);
  });
});
