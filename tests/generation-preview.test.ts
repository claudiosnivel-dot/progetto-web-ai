// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import itMessages from '../messages/it.json';
import esMessages from '../messages/es.json';
import { parseDocument, type SiteBlock, type SiteDocument } from '@/domain/generation/document';
import { THEMES } from '@/domain/generation/themes';

// T-235 (macrotask generation-ui, P2) — ORACOLO dell'anteprima navigabile /{locale}/preview/{siteId}.
// Le asserzioni derivano da AC-235-1,-2,-3,-4 (04-generation-ui.md), taggate `// covers: AC-235-<n>`
// sulla riga dell'EXPECT.
//
// COSA SI MOCKA E PERCHE' NON E' HOLLOW:
//  - next/navigation: redirect/notFound con throw-sentinel, come in produzione (in Next lanciano
//    e interrompono il render).
//  - next-intl/server getTranslations: risolve dai cataloghi REALI it/es, cosi' le etichette
//    (site.nav.*) sono stringhe autentiche e la differenza di lingua non e' finta.
//  - @/data/supabase-ssr getUser, @/data/sites listSites: i seam d'ingresso (auth + proprieta',
//    PER SITO, con SITE_A non in posizione 0 e un id che e' PREFISSO di uno posseduto).
//  - @/data/generation-document readGenerationDocument: la lettura del DOCUMENTO. `parseDocument`,
//    `SiteView` e i blocchi NON sono mockati: l'anteprima rende col renderer REALE (P2-D8).
//
// PROPRIETA' PINNATE oltre agli AC:
//  - UGUAGLIANZA ESATTA del siteId (il prefisso di un id posseduto e' negato, come /generate).
//  - L'anteprima NON legge i pool: nessun modulo del deliverable importa readHomePools o la
//    server action dei pool (AC-235-1 letto in senso stretto — "coi pool rimossi, rende").

const { REDIRECT, NOT_FOUND, redirectSpy, notFoundSpy } = vi.hoisted(() => {
  const redirectSentinel = Symbol('redirect');
  const notFoundSentinel = Symbol('not-found');
  return {
    REDIRECT: redirectSentinel,
    NOT_FOUND: notFoundSentinel,
    redirectSpy: vi.fn(() => {
      throw redirectSentinel;
    }),
    notFoundSpy: vi.fn(() => {
      throw notFoundSentinel;
    }),
  };
});

vi.mock('next/navigation', () => ({
  redirect: redirectSpy,
  notFound: notFoundSpy,
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => {
    const cat = (locale === 'es' ? esMessages : itMessages) as Record<string, unknown>;
    const ns = ((cat[namespace] ?? {}) as Record<string, unknown>) ?? {};
    return (key: string) => {
      const value = key
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], ns);
      return typeof value === 'string' ? value : `${namespace}.${key}`;
    };
  },
}));

const { authHolder } = vi.hoisted(() => ({ authHolder: { user: null as { id: string } | null } }));
vi.mock('@/data/supabase-ssr', () => ({ getUser: async () => authHolder.user }));

const { sitesHolder, listSitesSpy } = vi.hoisted(() => {
  const holder = { list: { ok: true, sites: [] } as unknown };
  return { sitesHolder: holder, listSitesSpy: vi.fn(async () => holder.list) };
});
vi.mock('@/data/sites', () => ({ listSites: listSitesSpy }));

const { docHolder, readDocumentSpy } = vi.hoisted(() => {
  const holder = { result: { ok: true, document: null } as unknown };
  return { docHolder: holder, readDocumentSpy: vi.fn(async () => holder.result) };
});
vi.mock('@/data/generation-document', () => ({ readGenerationDocument: readDocumentSpy }));

// Import DOPO i mock.
import PreviewPage from '@/app/[locale]/preview/[siteId]/page';

const THEME = THEMES[0];

const SITE_A = 'site-of-a';
const SITE_A_NAME = 'Officina di A';
const SITE_B = 'site-of-b';
const SITE_B_NAME = 'Panetteria di B';
const UNKNOWN_SITE = 'site-che-non-esiste';
// PREFISSO PROPRIO di entrambi gli id posseduti: non e' l'id di alcun sito, ma
// `site.id.startsWith(siteId)` lo accetterebbe. Prova l'UGUAGLIANZA ESATTA.
const PREFIX_OF_OWNED = 'site-of';

const SITE_A_ROW = { id: SITE_A, name: SITE_A_NAME, slug: 'officina-di-a', status: 'draft' };
const SITE_B_ROW = { id: SITE_B, name: SITE_B_NAME, slug: 'panetteria-di-b', status: 'draft' };
// SITE_A NON in posizione 0: la differenza fra il siteId richiesto e sites[0].id e' osservabile.
const OWNED_SITES = [SITE_B_ROW, SITE_A_ROW];

// ── fixture builder (LOCALI al file) ──────────────────────────────────────────
// Un blocco hero minimo ma VALIDO (parseDocument lo accetta) e che RENDE il proprio titolo in un
// <h1>: cosi' "la pagina rende" e "la home e' resa per intero" sono osservabili sull'albero.
function heroBlock(title: string): SiteBlock {
  return {
    id: 'hero',
    content: { hero_title: title },
    data: {},
    brief_fields_rendered: [],
    images: [],
  };
}

// DOCUMENTO a CINQUE pagine, con ruoli DISCORDANTI e una coppia di slug in relazione di PREFISSO
// ('contatti' e' prefisso di 'contatti-mappa'): un accoppiamento voce<->slug fatto con
// startsWith/includes invece che con uguaglianza esatta incrocia le due e viene visto.
const FIVE_PAGE_DOC: SiteDocument = {
  recipe_id: 'vetrina-dell-offerta@1',
  theme_id: THEME.id,
  pages: [
    { slug: 'home', role: 'home', title: 'Benvenuti', meta_description: 'La home', blocks: [heroBlock('Casa nostra')] },
    { slug: 'offerte', role: 'offerings', title: 'Le offerte', meta_description: 'Cosa offriamo', blocks: [heroBlock('Le nostre offerte')] },
    { slug: 'orari', role: 'hours', title: 'Gli orari', meta_description: 'Quando siamo aperti', blocks: [heroBlock('I nostri orari')] },
    { slug: 'contatti', role: 'contact', title: 'I contatti', meta_description: 'Come trovarci', blocks: [heroBlock('Scrivici')] },
    { slug: 'contatti-mappa', role: 'reviews', title: 'Dicono di noi', meta_description: 'Le recensioni', blocks: [heroBlock('Le testimonianze')] },
  ],
};

// ONE-PAGER: la sola home. Il titolo del suo hero e' un marcatore, per verificare che la home sia
// resa PER INTERO (AC-235-4) e non solo elencata.
const HOME_MARK = 'ANTEPRIMA-HOME-INTERA';
const ONE_PAGE_DOC: SiteDocument = {
  recipe_id: 'vetrina-dell-offerta@1',
  theme_id: THEME.id,
  pages: [
    { slug: 'home', role: 'home', title: 'Solo home', meta_description: 'One pager', blocks: [heroBlock(HOME_MARK)] },
  ],
};

const renderPreview = async (siteId: string, locale: 'it' | 'es' = 'it') => {
  const ui = await PreviewPage({ params: Promise.resolve({ locale, siteId }) });
  render(ui);
};

// I file del deliverable dell'anteprima: nessuno di essi deve leggere i pool (AC-235-1).
const PREVIEW_SOURCES = [
  '../src/app/[locale]/preview/[siteId]/page.tsx',
  '../src/app/[locale]/preview/[siteId]/guard.ts',
  '../src/app/[locale]/preview/[siteId]/PreviewNavigation.tsx',
  '../src/data/generation-document.ts',
].map((rel) => fileURLToPath(new URL(rel, import.meta.url)));

beforeEach(() => {
  authHolder.user = { id: 'user-a' };
  sitesHolder.list = { ok: true, sites: OWNED_SITES };
  docHolder.result = { ok: true, document: FIVE_PAGE_DOC };
  redirectSpy.mockClear();
  notFoundSpy.mockClear();
  listSitesSpy.mockClear();
  readDocumentSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('T-235 anteprima /preview — proprieta e anti-enumerazione (AC-235-3)', () => {
  // covers: AC-235-3
  it('senza sessione: reindirizza al login e non legge nulla del sito ne il documento', async () => {
    authHolder.user = null;
    await expect(
      PreviewPage({ params: Promise.resolve({ locale: 'it', siteId: SITE_A }) }),
    ).rejects.toBe(REDIRECT); // covers: AC-235-3
    expect(redirectSpy).toHaveBeenCalledWith('/it/login'); // covers: AC-235-3
    expect(listSitesSpy).not.toHaveBeenCalled(); // covers: AC-235-3
    expect(readDocumentSpy).not.toHaveBeenCalled(); // covers: AC-235-3
  });

  // covers: AC-235-3
  it('senza sessione: un locale fuori allowlist non entra grezzo nel redirect', async () => {
    authHolder.user = null;
    await expect(
      PreviewPage({ params: Promise.resolve({ locale: '../../evil.example', siteId: SITE_A }) }),
    ).rejects.toBe(REDIRECT); // covers: AC-235-3
    expect(redirectSpy).toHaveBeenCalledWith('/it/login'); // covers: AC-235-3
  });

  // covers: AC-235-3
  it('sito di un altro tenant, sito inesistente e prefisso di un id posseduto: STESSA risposta (notFound), nessun documento letto', async () => {
    // given: A possiede il solo SITE_B; SITE_A e' di un altro tenant, UNKNOWN non esiste,
    // PREFIX_OF_OWNED e' prefisso di un id posseduto ma non e' un id.
    sitesHolder.list = { ok: true, sites: [SITE_B_ROW] };
    for (const siteId of [SITE_A, UNKNOWN_SITE, PREFIX_OF_OWNED]) {
      notFoundSpy.mockClear();
      readDocumentSpy.mockClear();
      await expect(
        PreviewPage({ params: Promise.resolve({ locale: 'it', siteId }) }),
      ).rejects.toBe(NOT_FOUND); // covers: AC-235-3
      expect(notFoundSpy).toHaveBeenCalledTimes(1); // covers: AC-235-3
      // Del sito non proprio/inesistente non si legge il documento: nessun oracolo di esistenza.
      expect(readDocumentSpy).not.toHaveBeenCalled(); // covers: AC-235-3
    }
    // CONTRO-PROVA: il sito posseduto SITE_B viene reso (nessun notFound), e il documento e' letto
    // con il PROPRIO siteId.
    notFoundSpy.mockClear();
    docHolder.result = { ok: true, document: ONE_PAGE_DOC };
    await renderPreview(SITE_B);
    expect(notFoundSpy).not.toHaveBeenCalled(); // covers: AC-235-3
    expect(readDocumentSpy).toHaveBeenCalledWith(SITE_B); // covers: AC-235-3
  });
});

describe('T-235 anteprima /preview — rende il DOCUMENTO, mai il pool (AC-235-1)', () => {
  // covers: AC-235-1
  it('col solo documento (nessun pool fornito) l anteprima rende il sito completo', async () => {
    // Sanity: la fixture e' un documento VALIDO (altrimenti l'anteprima renderebbe lo stato vuoto).
    expect(parseDocument(FIVE_PAGE_DOC).ok).toBe(true);

    docHolder.result = { ok: true, document: FIVE_PAGE_DOC };
    await renderPreview(SITE_A);

    const main = within(screen.getByRole('main'));
    // then: il sito e' reso — una sezione per pagina, con i blocchi del renderer REALE.
    expect(document.querySelectorAll('[data-site-page]')).toHaveLength(5); // covers: AC-235-1
    expect(main.getByText('Casa nostra')).toBeTruthy(); // covers: AC-235-1
    // then: il documento e' stato letto da site_generations (readGenerationDocument), non i pool.
    expect(readDocumentSpy).toHaveBeenCalledWith(SITE_A); // covers: AC-235-1
  });

  // covers: AC-235-1
  it('nessun file del deliverable legge i pool (ne readHomePools ne la server action dei pool)', () => {
    // AC-235-1 alla lettera: coi pool RIMOSSI l'anteprima rende comunque, perche' NON dipende da
    // loro. La prova strutturale: nessuna sorgente dell'anteprima li nomina.
    for (const file of PREVIEW_SOURCES) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain('readHomePools'); // covers: AC-235-1
      expect(source).not.toContain('generation-pools'); // covers: AC-235-1
    }
  });
});

describe('T-235 anteprima /preview — navigazione derivata dalle pagine (AC-235-2)', () => {
  // covers: AC-235-2
  it('un documento a cinque pagine: una voce per ciascuna e per nessun altra, ogni destinazione uno slug presente', async () => {
    await renderPreview(SITE_A);

    const items = [...document.querySelectorAll('[data-preview-nav-item]')];
    // then: esattamente cinque voci — una per pagina.
    expect(items).toHaveLength(FIVE_PAGE_DOC.pages.length); // covers: AC-235-2

    // Le destinazioni sono ancore #<slug>: si estrae lo slug e lo si confronta col documento.
    const destinations = items.map((el) => el.getAttribute('href') ?? '');
    const slugsFromNav = destinations.map((href) => href.replace(/^#/, ''));
    const presentSlugs = FIVE_PAGE_DOC.pages.map((page) => page.slug);

    // then: ogni destinazione e' un '#' + uno slug PRESENTE, e per nessuno slug assente.
    expect(destinations.every((href) => href.startsWith('#'))).toBe(true); // covers: AC-235-2
    expect(new Set(slugsFromNav)).toEqual(new Set(presentSlugs)); // covers: AC-235-2
    expect([...slugsFromNav].sort()).toEqual([...presentSlugs].sort()); // covers: AC-235-2
    // Trappola del PREFISSO: 'contatti' e 'contatti-mappa' sono due destinazioni distinte, nessuna
    // assorbe l'altra.
    expect(slugsFromNav).toContain('contatti'); // covers: AC-235-2
    expect(slugsFromNav).toContain('contatti-mappa'); // covers: AC-235-2
    expect(new Set(destinations).size).toBe(destinations.length); // covers: AC-235-2
  });

  // covers: AC-235-2
  it('le etichette delle voci vengono dal catalogo (site.nav.*), non dal titolo del modello', async () => {
    await renderPreview(SITE_A);
    const nav = within(document.querySelector('[data-preview-nav]') as HTMLElement);
    // Le etichette sono quelle del catalogo per ruolo, non i title delle pagine ('Benvenuti', …).
    expect(nav.getByText(itMessages.site.nav.home)).toBeTruthy(); // covers: AC-235-2
    expect(nav.getByText(itMessages.site.nav.offerings)).toBeTruthy(); // covers: AC-235-2
    expect(nav.getByText(itMessages.site.nav.reviews)).toBeTruthy(); // covers: AC-235-2
    expect(nav.queryByText('Benvenuti')).toBeNull(); // covers: AC-235-2
  });
});

describe('T-235 anteprima /preview — one-pager senza navigazione (AC-235-4)', () => {
  // covers: AC-235-4
  it('un documento con la sola home non rende alcuna navigazione, e la home e resa per intero', async () => {
    expect(parseDocument(ONE_PAGE_DOC).ok).toBe(true);

    docHolder.result = { ok: true, document: ONE_PAGE_DOC };
    await renderPreview(SITE_A);

    // then: NESSUN elemento di navigazione fra pagine.
    expect(document.querySelectorAll('[data-preview-nav]')).toHaveLength(0); // covers: AC-235-4
    expect(document.querySelectorAll('[data-preview-nav-item]')).toHaveLength(0); // covers: AC-235-4
    // then: la home e' resa PER INTERO — la sua sezione e il suo blocco, col titolo marcatore.
    expect(document.querySelector('[data-site-page="home"]')).not.toBeNull(); // covers: AC-235-4
    expect(
      document.querySelector('[data-site-page="home"] [data-block-id="hero"]'),
    ).not.toBeNull(); // covers: AC-235-4
    expect(within(screen.getByRole('main')).getByText(HOME_MARK)).toBeTruthy(); // covers: AC-235-4
  });
});
