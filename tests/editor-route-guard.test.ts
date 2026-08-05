// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import itMessages from '../messages/it.json';
import esMessages from '../messages/es.json';
import { parseDocument, type SiteBlock, type SiteDocument } from '@/domain/generation/document';
import { THEMES } from '@/domain/generation/themes';

// T-311 (macrotask editor-core, P3) — ORACOLO della rotta /{locale}/editor/{siteId}: l'editor
// inline protetto da `enterSiteRoute`. Le asserzioni derivano da AC-311-1..4 (01-editor-core.md),
// taggate `// covers: AC-311-<n>` sulla riga dell'EXPECT.
//
// COSA SI MOCKA E PERCHE' NON E' HOLLOW:
//  - next/navigation: redirect/notFound con throw-sentinel, come in produzione (in Next lanciano
//    e interrompono il render).
//  - next-intl/server getTranslations: risolve dai cataloghi REALI it/es e REGISTRA il locale con
//    cui e' invocato — cosi' AC-311-4 osserva che a valle non entra mai il locale arbitrario.
//  - @/data/supabase-ssr getUser, @/data/sites listSites: i seam d'ingresso (auth + proprieta',
//    PER SITO, con SITE_A non in posizione 0 e un id che e' PREFISSO di uno posseduto).
//  - @/data/generation-document readGenerationDocument: la lettura del DOCUMENTO CORRENTE (T-304,
//    "ultima revisione else baseline"). parseDocument, SiteView, il registry, i blocchi e
//    EditableText NON sono mockati: l'editor rende col RENDERER UNICO reale (P2-D8 / P3-D5).
//
// NOTA (FX-EDITOR-2): dopo la composizione end-to-end (T-319) la pagina rende `SiteView` DENTRO
// `EditorClient` (client), che al mount attiva le isole, carica la storia (listRevisions) e usa il
// router. Questo oracolo di rotta e' percio' DEFERITO al checkpoint (DB-backed): i seam client
// (next/navigation, le server action della storia, getGeneration, selectVariant) sono qui mockati per
// COERENZA e per il typecheck, ma la verifica autorevole della guardia gira a runtime col DB reale.
//
// PROPRIETA' PINNATE oltre agli AC:
//  - MODALITA' EDITABLE: l'editor rende ISOLE EditableText (data-slot-id), cio' che lo distingue
//    dall'anteprima read-only — pinna che la pagina passi editable=true a SiteView (T-305).
//  - UGUAGLIANZA ESATTA del siteId (il prefisso di un id posseduto e' negato): anti-enumerazione.
//  - CLIENT DI SESSIONE, MAI service_role: nessuna sorgente del deliverable nomina la service_role
//    ne' legge i pool (la lettura passa dal read-path RLS di T-304).

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
  // EditorClient (client) usa il router per il refresh dopo un ripristino: seam mockato.
  useRouter: () => ({ refresh: () => {} }),
}));

// I locali con cui getTranslations e' invocato: e' cio' che rende OSSERVABILE che un locale fuori
// allowlist non scende mai a valle (AC-311-4). Array HOISTED (plain), popolato dalla factory del
// mock, che gira LAZY all'import e vede i cataloghi gia' inizializzati.
const { localeCalls } = vi.hoisted(() => ({
  localeCalls: [] as { locale: string; namespace: string }[],
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => {
    localeCalls.push({ locale, namespace });
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

// La generazione corrente per la riscelta soft (T-310): la pagina la legge (id + variante scelta)
// per abilitare il chiamante di produzione fromEditor. Seam mockato (deferito con la rotta).
const { getGenerationSpy, genHolder } = vi.hoisted(() => {
  const holder = {
    result: { ok: true, generation: null } as unknown,
  };
  return { genHolder: holder, getGenerationSpy: vi.fn(async () => holder.result) };
});
vi.mock('@/data/generations', () => ({ getGeneration: getGenerationSpy }));

// Le server action della storia (T-302/T-318) e la riscelta (T-310) che EditorClient importa: seam
// mockati cosi' l'attivazione client non tocca auth/DB nel typecheck/deferred.
vi.mock('@/data/site-document-revisions', () => ({
  saveRevision: vi.fn(async () => ({ ok: true, document: null })),
  restoreRevision: vi.fn(async () => ({ ok: true, document: null })),
  listRevisions: vi.fn(async () => ({ ok: true, revisions: [] })),
}));
vi.mock('@/data/generation-choose', () => ({ selectVariant: vi.fn(async () => undefined) }));

// Import DOPO i mock.
import EditorPage from '@/app/[locale]/editor/[siteId]/page';

const THEME = THEMES[0];

const SITE_A = 'site-of-a';
const SITE_A_NAME = 'Officina di A';
const SITE_B = 'site-of-b';
const SITE_B_NAME = 'Panetteria di B';
const UNKNOWN_SITE = 'site-che-non-esiste';
// PREFISSO PROPRIO di entrambi gli id posseduti: non e' l'id di alcun sito, ma
// `site.id.startsWith(siteId)` lo accetterebbe. Prova l'UGUAGLIANZA ESATTA (anti-enumerazione).
const PREFIX_OF_OWNED = 'site-of';
// Locale FUORI allowlist: input controllabile dal client. Non deve mai finire grezzo a valle.
const ARBITRARY_LOCALE = '../../evil.example';

const SITE_A_ROW = { id: SITE_A, name: SITE_A_NAME, slug: 'officina-di-a', status: 'draft' };
const SITE_B_ROW = { id: SITE_B, name: SITE_B_NAME, slug: 'panetteria-di-b', status: 'draft' };
// SITE_A NON in posizione 0: la differenza fra il siteId richiesto e sites[0].id e' osservabile.
const OWNED_SITES = [SITE_B_ROW, SITE_A_ROW];

// ── fixture builder (LOCALI al file) ──────────────────────────────────────────
// Un blocco hero minimo ma VALIDO (parseDocument lo accetta) che rende il proprio titolo in un
// <h1>: in modalita editable il titolo diventa un'isola EditableText (data-slot-id).
function heroBlock(title: string): SiteBlock {
  return {
    id: 'hero',
    content: { hero_title: title },
    data: {},
    brief_fields_rendered: [],
    images: [],
  };
}

// Il DOCUMENTO CORRENTE del sito (cio' che readGenerationDocument restituisce). Marcatore nel
// titolo, per osservare che l'editor rende PROPRIO questo documento.
const CURRENT_MARK = 'EDITOR-DOCUMENTO-CORRENTE';
const CURRENT_DOC: SiteDocument = {
  recipe_id: 'vetrina-dell-offerta@1',
  theme_id: THEME.id,
  pages: [
    {
      slug: 'home',
      role: 'home',
      title: 'Casa nostra',
      meta_description: 'La home',
      blocks: [heroBlock(CURRENT_MARK)],
    },
  ],
};

/** Le isole EditableText sotto `root` (solo le isole portano `data-editable-slot-id`, T-305/D4). */
function islands(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll('[data-editable-slot-id]')].map((el) => el as HTMLElement);
}

const renderEditor = async (siteId: string, locale: string = 'it') => {
  const ui = await EditorPage({ params: Promise.resolve({ locale, siteId }) });
  // EditorClient monta effetti async (attivazione isole + listRevisions): render dentro act.
  await act(async () => {
    render(ui);
  });
};

// I file del deliverable dell'editor: nessuno deve nominare la service_role ne' leggere i pool
// (la lettura passa dal read-path RLS di T-304). Client di SESSIONE, mai service_role.
const EDITOR_SOURCES = [
  '../src/app/[locale]/editor/[siteId]/page.tsx',
  '../src/app/[locale]/editor/[siteId]/guard.ts',
].map((rel) => fileURLToPath(new URL(rel, import.meta.url)));

beforeEach(() => {
  authHolder.user = { id: 'user-a' };
  sitesHolder.list = { ok: true, sites: OWNED_SITES };
  docHolder.result = { ok: true, document: CURRENT_DOC };
  genHolder.result = {
    ok: true,
    generation: { id: 'gen-a', site_id: SITE_A, status: 'chosen', chosen_variant: 0 },
  };
  localeCalls.length = 0;
  redirectSpy.mockClear();
  notFoundSpy.mockClear();
  listSitesSpy.mockClear();
  readDocumentSpy.mockClear();
  getGenerationSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('T-311 rotta /editor — proprietario: 200 e editor reso dal documento corrente (AC-311-1)', () => {
  // covers: AC-311-1
  it('il proprietario apre l editor: nessun redirect/404, il documento CORRENTE e reso in modalita editable', async () => {
    // Sanity: la fixture e' un documento VALIDO (altrimenti l'editor renderebbe lo stato vuoto).
    expect(parseDocument(CURRENT_DOC).ok).toBe(true);

    await renderEditor(SITE_A);

    // then: la guardia ha lasciato passare — nessun redirect al login, nessun notFound.
    expect(redirectSpy).not.toHaveBeenCalled(); // covers: AC-311-1
    expect(notFoundSpy).not.toHaveBeenCalled(); // covers: AC-311-1
    // then: il DOCUMENTO CORRENTE e' letto col PROPRIO siteId (read-path T-304), non i pool.
    expect(readDocumentSpy).toHaveBeenCalledWith(SITE_A); // covers: AC-311-1
    // then: il sito e' reso — la pagina del documento col renderer REALE, col titolo marcatore.
    const main = within(screen.getByRole('main'));
    expect(document.querySelector('[data-site-page="home"]')).not.toBeNull(); // covers: AC-311-1
    expect(main.getByText(CURRENT_MARK)).toBeTruthy(); // covers: AC-311-1
    // then: MODALITA' EDITABLE — il testo e' reso dentro un'isola EditableText (data-slot-id),
    // cio' che distingue l'editor dall'anteprima read-only. La coppia block/slot identifica il campo.
    const found = islands(document.body);
    expect(found.length).toBeGreaterThan(0); // covers: AC-311-1
    const titolo = document.querySelector(
      '[data-editable-block-id="hero"][data-editable-slot-id="content.hero_title"]',
    );
    expect(titolo).not.toBeNull(); // covers: AC-311-1
    expect((titolo as HTMLElement).textContent).toBe(CURRENT_MARK); // covers: AC-311-1
  });
});

describe('T-311 rotta /editor — anti-enumerazione: non-tuo/inesistente/prefisso = notFound (AC-311-2)', () => {
  // covers: AC-311-2
  it('sito di un altro tenant, sito inesistente e prefisso di un id posseduto: STESSA risposta (notFound), nessun documento letto', async () => {
    // given: A possiede il solo SITE_B; SITE_A e' di un altro tenant, UNKNOWN non esiste,
    // PREFIX_OF_OWNED e' prefisso di un id posseduto ma non e' un id.
    sitesHolder.list = { ok: true, sites: [SITE_B_ROW] };
    for (const siteId of [SITE_A, UNKNOWN_SITE, PREFIX_OF_OWNED]) {
      notFoundSpy.mockClear();
      readDocumentSpy.mockClear();
      await expect(
        EditorPage({ params: Promise.resolve({ locale: 'it', siteId }) }),
      ).rejects.toBe(NOT_FOUND); // covers: AC-311-2
      expect(notFoundSpy).toHaveBeenCalledTimes(1); // covers: AC-311-2
      // Del sito non proprio/inesistente non si legge il documento: nessun oracolo di esistenza.
      expect(readDocumentSpy).not.toHaveBeenCalled(); // covers: AC-311-2
    }
    // CONTRO-PROVA: il sito posseduto SITE_B viene reso (nessun notFound), col PROPRIO siteId.
    notFoundSpy.mockClear();
    await renderEditor(SITE_B);
    expect(notFoundSpy).not.toHaveBeenCalled(); // covers: AC-311-2
    expect(readDocumentSpy).toHaveBeenCalledWith(SITE_B); // covers: AC-311-2
  });
});

describe('T-311 rotta /editor — utente non autenticato: redirect a /login (AC-311-3)', () => {
  // covers: AC-311-3
  it('senza sessione: reindirizza al login e non legge nulla del sito ne il documento', async () => {
    authHolder.user = null;
    await expect(
      EditorPage({ params: Promise.resolve({ locale: 'it', siteId: SITE_A }) }),
    ).rejects.toBe(REDIRECT); // covers: AC-311-3
    expect(redirectSpy).toHaveBeenCalledWith('/it/login'); // covers: AC-311-3
    // Il redirect interrompe prima di ogni lettura: ne proprieta' ne documento.
    expect(listSitesSpy).not.toHaveBeenCalled(); // covers: AC-311-3
    expect(readDocumentSpy).not.toHaveBeenCalled(); // covers: AC-311-3
  });

  // covers: AC-311-3
  it('senza sessione e locale fuori allowlist: il locale grezzo non entra nella destinazione del redirect', async () => {
    authHolder.user = null;
    await expect(
      EditorPage({ params: Promise.resolve({ locale: ARBITRARY_LOCALE, siteId: SITE_A }) }),
    ).rejects.toBe(REDIRECT); // covers: AC-311-3
    // Destinazione interna FISSA, vincolata all'allowlist (default it) — mai il locale arbitrario.
    expect(redirectSpy).toHaveBeenCalledWith('/it/login'); // covers: AC-311-3
  });
});

describe('T-311 rotta /editor — locale fuori allowlist: gestito dalla guardia (AC-311-4)', () => {
  // covers: AC-311-4
  it('proprietario con locale fuori allowlist: rende comunque, e a valle NON scende mai il locale arbitrario', async () => {
    // given: proprietario di SITE_A, ma il segmento [locale] e' arbitrario (input del client).
    await renderEditor(SITE_A, ARBITRARY_LOCALE);

    // then: la guardia di locale lo ha VINCOLATO all'allowlist — la pagina rende (nessun 404), e
    // il documento e' letto: il locale arbitrario non ha impedito ne dirottato il render.
    expect(notFoundSpy).not.toHaveBeenCalled(); // covers: AC-311-4
    expect(readDocumentSpy).toHaveBeenCalledWith(SITE_A); // covers: AC-311-4
    // then: NESSUNA risoluzione i18n e' avvenuta col locale grezzo — a valle e' arrivato solo il
    // locale vincolato (default 'it'), mai il valore arbitrario del client.
    expect(localeCalls.length).toBeGreaterThan(0); // covers: AC-311-4
    expect(localeCalls.some((call) => call.locale === ARBITRARY_LOCALE)).toBe(false); // covers: AC-311-4
    expect(localeCalls.every((call) => call.locale === 'it')).toBe(true); // covers: AC-311-4
  });
});

describe('T-311 rotta /editor — client di sessione, mai service_role (security_note)', () => {
  // La lettura passa dal read-path RLS di T-304: nessuna sorgente del deliverable nomina la
  // service_role ne' legge i pool. Prova STRUTTURALE del confine di sicurezza del task.
  it('nessun file del deliverable nomina la service_role ne legge i pool', () => {
    for (const file of EDITOR_SOURCES) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain('service_role');
      expect(source).not.toContain('SERVICE_ROLE');
      expect(source).not.toContain('generation-pools');
      expect(source).not.toContain('readHomePools');
    }
  });
});
