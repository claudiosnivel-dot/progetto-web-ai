// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { NextRequest } from 'next/server';
import itMessages from '../messages/it.json';
import { generatable } from '@/domain/generation/generatable';
import { DOCUMENT_LIMITS } from '@/domain/generation/document';
import { RECIPES } from '@/domain/generation/recipes';
import { applyBriefUpdate, emptyBrief } from '@/domain/onboarding/brief';

// T-230 (macrotask generation-ui, P2) — ORACOLO della rotta protetta /generate e
// dell'endpoint POST /api/generate (parte pagina + parte fallimento del confine). Le
// asserzioni derivano da AC-230-1,-2,-3,-4,-7 (04-generation-ui.md), taggate
// `// covers: AC-230-<n>` sulla riga dell'EXPECT.
//
// COSA SI MOCKA E PERCHE' NON E' HOLLOW:
//  - next/navigation: redirect/notFound con throw-sentinel, come in produzione (in Next
//    lanciano davvero e interrompono il render) + usePathname per AppShell.
//  - next/link: <a> semplice (nessun runtime Next).
//  - next-intl/server getTranslations: risolve dal catalogo REALE it, cosi' le etichette
//    asserite sono stringhe autentiche.
//  - @/data/supabase-ssr getUser, @/data/sites listSites, @/data/briefs getBrief: i seam
//    a monte, PER SITO (le fixture hanno DUE siti posseduti, SITE_A non in posizione 0).
//  - @/data/generations createGeneration/writePool/markReady/markFailed e @/data/anthropic
//    runGenerationTurn: i seam di scrittura e il confine. `generatable` NON e' mockata: la
//    genera-bilita' e' calcolata dal codice di produzione sul brief REALE.
//
// PROPRIETA' PINNATE oltre agli AC:
//  - UGUAGLIANZA ESATTA del siteId: un id che e' solo PREFISSO di un id posseduto e' negato.
//  - GUASTO DI LETTURA del brief (AC-230-4) reso come stato d'errore ESPLICITO, DISTINTO
//    dall'elenco "brief povero" (AC-230-3).
//  - Il confine che LANCIA dopo la creazione della riga → markFailed con motivo nominato,
//    markReady MAI chiamato: la riga non resta 'generating' (AC-230-7).

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
  usePathname: () => '/it/generate/site-of-a',
  // WIRE — RegenerateButton e Phase2Trigger del selettore usano useRouter().refresh.
  useRouter: () => ({ refresh: () => {} }),
}));

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  type LinkProps = { href: string; children?: ReactNode; 'aria-current'?: 'page' };
  return {
    default: ({ href, children, ...rest }: LinkProps) =>
      createElement('a', { href, ...rest }, children),
  };
});

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

const { authHolder } = vi.hoisted(() => ({ authHolder: { user: null as { id: string } | null } }));
vi.mock('@/data/supabase-ssr', () => ({ getUser: async () => authHolder.user }));

const { sitesHolder, listSitesSpy } = vi.hoisted(() => {
  const holder = { list: { ok: true, sites: [] } as unknown };
  return { sitesHolder: holder, listSitesSpy: vi.fn(async () => holder.list) };
});
vi.mock('@/data/sites', () => ({ listSites: listSitesSpy }));

const { briefsHolder, getBriefSpy } = vi.hoisted(() => {
  const holder = { getBySite: {} as Record<string, unknown>, get: null as unknown };
  return {
    briefsHolder: holder,
    getBriefSpy: vi.fn(async (siteId: string) => holder.getBySite[siteId] ?? holder.get),
  };
});
vi.mock('@/data/briefs', () => ({ getBrief: getBriefSpy }));

const { genHolder, createGenerationSpy, writePoolSpy, markReadySpy, markFailedSpy, getGenerationSpy } =
  vi.hoisted(() => {
    const holder = {
      create: { ok: true, id: 'gen-x' } as unknown,
      writePool: { ok: true, id: 'pool-x' } as unknown,
      markFailedCalls: [] as unknown[][],
      // WIRE — lo STATO letto dalla pagina per decidere fra launcher e selettore. Default: nessuna
      // generazione, cosi' gli AC-230 restano sul ramo del launcher (nessun cambiamento).
      getGen: { ok: true, generation: null } as unknown,
    };
    return {
      genHolder: holder,
      createGenerationSpy: vi.fn(async () => holder.create),
      writePoolSpy: vi.fn(async () => holder.writePool),
      markReadySpy: vi.fn(async () => ({ ok: true })),
      markFailedSpy: vi.fn(async (...args: unknown[]) => {
        holder.markFailedCalls.push(args);
        return { ok: true };
      }),
      getGenerationSpy: vi.fn(async () => holder.getGen),
    };
  });
vi.mock('@/data/generations', () => ({
  createGeneration: createGenerationSpy,
  writePool: writePoolSpy,
  markReady: markReadySpy,
  markFailed: markFailedSpy,
  getGeneration: getGenerationSpy,
}));

// WIRE — i seam del SELETTORE (T-232/T-233/T-234), montato quando esiste una generazione
// scegliibile. readHomePools shared:null => le VariantCard rendono null, ma il wrapper del chooser,
// i pulsanti "rigenera" e "scegli" (e il trigger di fase 2 su 'chosen') restano: e' cio' che questo
// file verifica — il RAMO, non la resa delle card (oracolo suo: generation-chooser.test).
const { readHomePoolsSpy, poolsHolder } = vi.hoisted(() => {
  const holder = {
    current: { ok: true, shared: null as unknown, byVariant: {} as Record<number, unknown> } as unknown,
  };
  return { poolsHolder: holder, readHomePoolsSpy: vi.fn(async () => holder.current) };
});
vi.mock('@/data/generation-pools', () => ({ readHomePools: readHomePoolsSpy }));

const { selectVariantSpy } = vi.hoisted(() => ({
  selectVariantSpy: vi.fn(async () => ({ ok: false, reason: 'stato_non_valido' })),
}));
vi.mock('@/data/generation-choose', () => ({ selectVariant: selectVariantSpy }));

const { regenerateVariantSpy } = vi.hoisted(() => ({
  regenerateVariantSpy: vi.fn(async () => ({ ok: true, poolId: 'p' })),
}));
vi.mock('@/data/generation-regenerate', () => ({ regenerateVariant: regenerateVariantSpy }));

const { runPhase2Spy } = vi.hoisted(() => ({ runPhase2Spy: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/data/generation-phase2', () => ({ runPhase2: runPhase2Spy }));

const { boundarySpy } = vi.hoisted(() => ({ boundarySpy: vi.fn() }));
vi.mock('@/data/anthropic', () => ({ runGenerationTurn: boundarySpy }));

// Import DOPO i mock.
import GeneratePage from '@/app/[locale]/generate/[siteId]/page';
import { POST } from '@/app/api/generate/route';

const ORIGIN = 'http://localhost';
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

// Brief RICCO (generabile), costruito col dominio REALE — valori DISCORDANTI (offerte con
// sezioni diverse, due chiavi orario).
const RICH_BRIEF = applyBriefUpdate(emptyBrief('it'), {
  business_name: 'Bar Sole',
  vertical: 'ristorazione',
  description: 'Caffe e cornetti nel centro storico',
  whatsapp: '+39 333 1112222',
  phone: '+39 06 1234567',
  address: 'Via Roma 1, Roma',
  hours: { 'lun-ven': '08:00-20:00', sab: '09:00-13:00' },
  offerings: [
    { name: 'Espresso', section: 'Caffetteria' },
    { name: 'Cornetto', section: 'Colazione' },
    { name: 'Cappuccino', section: 'Caffetteria' },
  ],
}).brief;

// Brief POVERO: solo il nome → un solo blocco (hero) → generatable.ok e' false, e
// `missing` porta piu' voci con campi DISCORDANTI (offerings, description, hours, ...).
const POOR_BRIEF = applyBriefUpdate(emptyBrief('it'), { business_name: 'Solo Nome' }).brief;

const POOR_MISSING = generatable(POOR_BRIEF, { maxPages: DOCUMENT_LIMITS.max_pages }).missing;

const renderPage = async (siteId: string, locale: 'it' | 'es' = 'it') => {
  const ui = await GeneratePage({ params: Promise.resolve({ locale, siteId }) });
  render(ui);
};

function buildRequest(body: unknown): NextRequest {
  const headers = new Headers({
    'content-type': 'application/json',
    origin: ORIGIN,
    'sec-fetch-site': 'same-origin',
  });
  return new NextRequest(new URL('/api/generate', ORIGIN), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const runGenerate = (siteId: string) => POST(buildRequest({ siteId }));

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Record<string, unknown>> {
  const { value, done } = await reader.read();
  expect(done).toBe(false);
  return JSON.parse(new TextDecoder().decode(value).trim()) as Record<string, unknown>;
}

// Il pulsante che OFFRE la generazione (GenerateLauncher). La sua presenza distingue il
// caso generabile dal caso "brief povero", dove NON deve comparire.
const CTA_LABEL = itMessages.generate.cta;

beforeEach(() => {
  authHolder.user = { id: 'user-a' };
  sitesHolder.list = { ok: true, sites: OWNED_SITES };
  briefsHolder.getBySite = {};
  briefsHolder.get = { ok: true, brief: RICH_BRIEF, status: 'confirmed', complete: true };
  genHolder.create = { ok: true, id: 'gen-x' };
  genHolder.writePool = { ok: true, id: 'pool-x' };
  genHolder.markFailedCalls.length = 0;
  // WIRE — default: nessuna generazione (ramo launcher), pool condiviso assente.
  genHolder.getGen = { ok: true, generation: null };
  poolsHolder.current = { ok: true, shared: null, byVariant: {} };
  redirectSpy.mockClear();
  notFoundSpy.mockClear();
  listSitesSpy.mockClear();
  getBriefSpy.mockClear();
  createGenerationSpy.mockClear();
  writePoolSpy.mockClear();
  markReadySpy.mockClear();
  markFailedSpy.mockClear();
  getGenerationSpy.mockClear();
  readHomePoolsSpy.mockClear();
  selectVariantSpy.mockClear();
  regenerateVariantSpy.mockClear();
  runPhase2Spy.mockClear();
  boundarySpy.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('T-230 rotta pagina /generate protetta', () => {
  // covers: AC-230-1
  it('senza sessione: la pagina reindirizza al login e non legge nulla del sito', async () => {
    authHolder.user = null;
    await expect(
      GeneratePage({ params: Promise.resolve({ locale: 'it', siteId: SITE_A }) }),
    ).rejects.toBe(REDIRECT); // covers: AC-230-1
    expect(redirectSpy).toHaveBeenCalledWith('/it/login'); // covers: AC-230-1
    expect(listSitesSpy).not.toHaveBeenCalled(); // covers: AC-230-1
    expect(getBriefSpy).not.toHaveBeenCalled(); // covers: AC-230-1
  });

  // covers: AC-230-1
  it('senza sessione: il locale fuori allowlist non entra grezzo nel redirect', async () => {
    authHolder.user = null;
    await expect(
      GeneratePage({ params: Promise.resolve({ locale: '../../evil.example.com', siteId: SITE_A }) }),
    ).rejects.toBe(REDIRECT); // covers: AC-230-1
    expect(redirectSpy).toHaveBeenCalledWith('/it/login'); // covers: AC-230-1
  });

  // covers: AC-230-2
  it('sito non tuo, sito inesistente e prefisso di un id posseduto: STESSA risposta (notFound)', async () => {
    // given: A possiede il solo SITE_B; SITE_A e' di un altro tenant, UNKNOWN non esiste,
    // PREFIX_OF_OWNED e' prefisso di un id posseduto ma non e' un id.
    sitesHolder.list = { ok: true, sites: [SITE_B_ROW] };
    for (const siteId of [SITE_A, UNKNOWN_SITE, PREFIX_OF_OWNED]) {
      notFoundSpy.mockClear();
      getBriefSpy.mockClear();
      await expect(
        GeneratePage({ params: Promise.resolve({ locale: 'it', siteId }) }),
      ).rejects.toBe(NOT_FOUND); // covers: AC-230-2
      expect(notFoundSpy).toHaveBeenCalledTimes(1); // covers: AC-230-2
      // Del sito non proprio/inesistente non si legge il brief.
      expect(getBriefSpy).not.toHaveBeenCalled(); // covers: AC-230-2
    }
    // CONTRO-PROVA: il sito posseduto SITE_B viene reso (nessun notFound).
    notFoundSpy.mockClear();
    await renderPage(SITE_B);
    expect(notFoundSpy).not.toHaveBeenCalled(); // covers: AC-230-2
    expect(within(screen.getByRole('main')).getByText(SITE_B_NAME)).toBeTruthy(); // covers: AC-230-2
  });

  // covers: AC-230-3
  it('brief povero: la pagina elenca cosa manca con link all onboarding e NON offre la generazione', async () => {
    briefsHolder.getBySite = {
      [SITE_A]: { ok: true, brief: POOR_BRIEF, status: 'confirmed', complete: false },
    };
    await renderPage(SITE_A);

    const main = within(screen.getByRole('main'));
    // then: la sezione "cosa manca" e' resa, con un titolo dal catalogo (i18n reale).
    expect(main.getByText(itMessages.generate.missing.title)).toBeTruthy(); // covers: AC-230-3
    // then: una voce per OGNI entry di generatable.missing (derivata dal codice reale), e
    // i campi resi coincidono con quelli mancanti — nessuno inventato, nessuno omesso.
    const items = document.querySelectorAll('[data-missing-field]');
    expect(items.length).toBe(POOR_MISSING.length); // covers: AC-230-3
    const renderedFields = new Set(
      [...items].map((el) => (el as HTMLElement).dataset.missingField),
    );
    const expectedFields = new Set(POOR_MISSING.map((m) => m.field));
    expect(renderedFields).toEqual(expectedFields); // covers: AC-230-3
    // then: l'etichetta di un campo mancante e' quella del catalogo (non una stringa inline).
    // 'description' compare una volta sola nell'elenco; 'whatsapp' comparirebbe due volte
    // (blocco contatti + cta-whatsapp), quindi qui si asserisce su un campo a voce unica.
    expect(main.getByText(itMessages.generate.missing.fields.description)).toBeTruthy(); // covers: AC-230-3
    // then: c'e' un link all'onboarding di QUESTO sito, per completare il brief.
    const onboardingLink = main.getByText(itMessages.generate.missing.onboardingCta);
    expect(onboardingLink.getAttribute('href')).toBe(`/it/onboarding/${SITE_A}`); // covers: AC-230-3
    // then: NON si offre la generazione — il pulsante di avvio e' assente.
    expect(main.queryByRole('button', { name: CTA_LABEL })).toBeNull(); // covers: AC-230-3
  });

  // covers: AC-230-3
  it('brief ricco: la pagina OFFRE la generazione e non mostra l elenco dei mancanti', async () => {
    briefsHolder.getBySite = {
      [SITE_A]: { ok: true, brief: RICH_BRIEF, status: 'confirmed', complete: true },
    };
    await renderPage(SITE_A);
    const main = within(screen.getByRole('main'));
    // then: il pulsante di avvio c'e' (contrasto con il caso povero).
    expect(main.getByRole('button', { name: CTA_LABEL })).toBeTruthy(); // covers: AC-230-3
    // then: nessun elenco di campi mancanti.
    expect(document.querySelectorAll('[data-missing-field]').length).toBe(0); // covers: AC-230-3
  });

  // covers: AC-230-4
  it('lettura del brief fallita: stato d errore ESPLICITO, distinto dal messaggio di brief povero', async () => {
    // given: getBrief fallisce (guasto di lettura, NON un brief assente ne' povero)
    briefsHolder.getBySite = { [SITE_A]: { ok: false, status: 500 } };
    await renderPage(SITE_A);
    const main = within(screen.getByRole('main'));
    // then: lo stato d'errore di lettura e' reso…
    expect(main.getByText(itMessages.generate.readError)).toBeTruthy(); // covers: AC-230-4
    // …e NON e' il caso "brief povero": nessun elenco di mancanti, nessun titolo dei mancanti.
    expect(document.querySelectorAll('[data-missing-field]').length).toBe(0); // covers: AC-230-4
    expect(main.queryByText(itMessages.generate.missing.title)).toBeNull(); // covers: AC-230-4
    // …e non offre la generazione: un guasto non e' un via libera.
    expect(main.queryByRole('button', { name: CTA_LABEL })).toBeNull(); // covers: AC-230-4
  });
});

// ── WIRE: la pagina monta il SELETTORE quando una generazione e' gia' scegliibile ──────────────
// Rende raggiungibile end-to-end cio' che T-232/T-233/T-234 hanno costruito (chiude gli orfani
// P2-D26). Il default (nessuna generazione) tiene intatto il ramo del launcher degli AC-230.
describe('T-230/WIRE — selettore montato dallo stato della generazione', () => {
  const genRow = (status: string) => ({
    id: 'gen-x',
    site_id: SITE_A,
    status,
    chosen_variant: status === 'chosen' || status === 'complete' ? 0 : null,
    max_pages: 8,
    failure_reason: null,
    updated_at: new Date().toISOString(),
  });

  // covers: AC-235-5
  it("generazione 'ready': monta GenerationChooser (una scelta per card) e NON il launcher", async () => {
    genHolder.getGen = { ok: true, generation: genRow('ready') };
    await renderPage(SITE_A);
    const main = within(screen.getByRole('main'));

    // il selettore e' montato (wrapper con l'id della generazione).
    expect(document.querySelector('[data-generation-chooser="gen-x"]')).not.toBeNull(); // covers: AC-235-5
    // una scelta per card — cinque, quante le direzioni (RECIPES): selectVariant e' raggiungibile.
    expect(document.querySelectorAll('[data-choose-variant]')).toHaveLength(RECIPES.length); // covers: AC-235-5
    // il launcher (che AVVIA una NUOVA generazione) non c'e': non si rigenera cio' che gia' esiste.
    expect(main.queryByRole('button', { name: CTA_LABEL })).toBeNull(); // covers: AC-235-5
    // 'ready' non offre ancora il trigger della fase 2: prima si sceglie.
    expect(document.querySelector('[data-phase2-trigger]')).toBeNull(); // covers: AC-235-5
    // la pagina ha letto lo STATO col proprio siteId (lettura autorevole).
    expect(getGenerationSpy).toHaveBeenCalledWith(SITE_A); // covers: AC-235-5
  });

  // covers: AC-235-5
  it("generazione 'chosen': il selettore c'e' e la FASE 2 e' raggiungibile (trigger presente)", async () => {
    genHolder.getGen = { ok: true, generation: genRow('chosen') };
    await renderPage(SITE_A);
    expect(document.querySelector('[data-generation-chooser="gen-x"]')).not.toBeNull(); // covers: AC-235-5
    // il trigger della fase 2 e' montato: runPhase2 e' raggiungibile da una rotta (non orfano).
    expect(document.querySelector('[data-phase2-trigger]')).not.toBeNull(); // covers: AC-235-5
  });

  // covers: AC-235-5
  it("generazione 'complete': il selettore c'e' (riscelta possibile) ma NESSUN trigger di fase 2", async () => {
    genHolder.getGen = { ok: true, generation: genRow('complete') };
    await renderPage(SITE_A);
    expect(document.querySelector('[data-generation-chooser="gen-x"]')).not.toBeNull(); // covers: AC-235-5
    expect(document.querySelector('[data-phase2-trigger]')).toBeNull(); // covers: AC-235-5
  });

  // covers: AC-230-3
  it("nessuna generazione: la pagina OFFRE il launcher e NON monta il selettore (ramo AC-230 intatto)", async () => {
    genHolder.getGen = { ok: true, generation: null };
    await renderPage(SITE_A);
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('button', { name: CTA_LABEL })).toBeTruthy(); // covers: AC-230-3
    expect(document.querySelector('[data-generation-chooser]')).toBeNull(); // covers: AC-230-3
  });

  // covers: AC-230-3
  it("stato 'generating': non e' scegliibile — il launcher resta, nessun selettore", async () => {
    genHolder.getGen = { ok: true, generation: genRow('generating') };
    await renderPage(SITE_A);
    const main = within(screen.getByRole('main'));
    expect(document.querySelector('[data-generation-chooser]')).toBeNull(); // covers: AC-230-3
    expect(main.getByRole('button', { name: CTA_LABEL })).toBeTruthy(); // covers: AC-230-3
  });
});

describe('T-230 POST /api/generate — auth, gate e fallimento del confine', () => {
  // covers: AC-230-1
  it('POST senza sessione: 401, nessuna riga creata e nessuna chiamata al confine', async () => {
    authHolder.user = null;
    const res = await runGenerate(SITE_A);
    expect(res.status).toBe(401); // covers: AC-230-1
    expect(res.headers.get('location')).toBeNull(); // covers: AC-230-1
    expect(createGenerationSpy).not.toHaveBeenCalled(); // covers: AC-230-1
    expect(boundarySpy).not.toHaveBeenCalled(); // covers: AC-230-1
  });

  // covers: AC-230-2
  it('POST su sito non tuo/inesistente: STESSA risposta 404, nessuna riga, nessun confine', async () => {
    sitesHolder.list = { ok: true, sites: [SITE_B_ROW] };
    for (const siteId of [SITE_A, UNKNOWN_SITE, PREFIX_OF_OWNED]) {
      createGenerationSpy.mockClear();
      boundarySpy.mockClear();
      const res = await runGenerate(siteId);
      expect(res.status).toBe(404); // covers: AC-230-2
      expect(await res.text()).toBe('{"error":"not-found"}'); // covers: AC-230-2
      expect(createGenerationSpy).not.toHaveBeenCalled(); // covers: AC-230-2
      expect(boundarySpy).not.toHaveBeenCalled(); // covers: AC-230-2
    }
  });

  // covers: AC-230-3
  it('POST con brief povero: respinta senza creare la riga e senza chiamare il confine', async () => {
    briefsHolder.getBySite = {
      [SITE_A]: { ok: true, brief: POOR_BRIEF, status: 'confirmed', complete: false },
    };
    const res = await runGenerate(SITE_A);
    // then: rifiuto esplicito (non 200), senza spendere una chiamata a pagamento.
    expect(res.status).toBe(422); // covers: AC-230-3
    expect(createGenerationSpy).not.toHaveBeenCalled(); // covers: AC-230-3
    expect(boundarySpy).not.toHaveBeenCalled(); // covers: AC-230-3
  });

  // covers: AC-230-7
  it('il confine LANCIA dopo la creazione della riga: la riga va a failed con motivo nominato, mai lasciata generating', async () => {
    // given: brief ricco, riga creata, e un confine che LANCIA
    briefsHolder.getBySite = {
      [SITE_A]: { ok: true, brief: RICH_BRIEF, status: 'confirmed', complete: true },
    };
    boundarySpy.mockRejectedValue(new Error('confine giu'));

    const res = await runGenerate(SITE_A);
    expect(res.status).toBe(200); // covers: AC-230-7
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();

    // La riga 'generating' e' stata creata PRIMA della chiamata al confine.
    expect(createGenerationSpy).toHaveBeenCalledTimes(1); // covers: AC-230-7
    // FLUSH 1 — le cornici escono comunque (sono pure).
    expect((await readChunk(reader)).type).toBe('frames'); // covers: AC-230-7
    // FLUSH 2 — un chunk error, MAI un chunk pool: il pool non esiste.
    const chunk2 = await readChunk(reader);
    expect(chunk2.type).toBe('error'); // covers: AC-230-7
    expect(typeof chunk2.reason).toBe('string'); // covers: AC-230-7

    // then: la riga e' portata a 'failed' con un failure_reason NOMINATO, e NON resta
    // 'generating': markFailed e' stato chiamato, markReady no.
    expect(markFailedSpy).toHaveBeenCalledTimes(1); // covers: AC-230-7
    expect(genHolder.markFailedCalls[0][0]).toBe('gen-x'); // covers: AC-230-7
    expect(typeof genHolder.markFailedCalls[0][1]).toBe('string'); // covers: AC-230-7
    expect((genHolder.markFailedCalls[0][1] as string).length).toBeGreaterThan(0); // covers: AC-230-7
    expect(markReadySpy).not.toHaveBeenCalled(); // covers: AC-230-7
    expect(writePoolSpy).not.toHaveBeenCalled(); // covers: AC-230-7

    expect((await reader.read()).done).toBe(true); // covers: AC-230-7
  });
});

// ── SEC: ogni esito di fallimento, e il ritorno delle transizioni RISPETTATO ──────────────────
// DoD di T-230: "Ogni esito di fallimento del confine (T-224) porta la riga a status='failed' con
// failure_reason". Qui si esercitano i QUATTRO esiti NOMINATI del confine (via il ramo
// if(!phase1.ok)) e il fallimento di writePool, verificando che ciascuno:
//  - chiami markFailed col motivo NOMINATO corrispondente,
//  - emetta un chunk 'error' e MAI un chunk 'pool',
//  - non dichiari mai 'ready'.
// E la meta' P2-D15: se markReady FALLISCE (CAS 'generating'->'ready' perso perche' la riga e'
// stata riconciliata a 'failed' durante la lunga chiamata, o l'UPDATE ha fallito) la rotta NON
// deve emettere 'pool'+200 come successo — deve emettere 'error'. Il pool e' stato scritto, ma la
// generazione non e' viva.
describe('T-230 POST /api/generate — SEC: esiti di fallimento e transizioni rispettate', () => {
  // Un pool valido di massima, per i rami in cui il confine RIESCE ma una scrittura successiva no.
  const OK_POOL = { pages: { home: { hero_title: 'ok' } } };

  // covers: AC-230-7
  it('i quattro esiti nominati del confine: markFailed col motivo, chunk error, mai un chunk pool', async () => {
    const NOMINATI = [
      'risposta_troncata',
      'tool_use_assente',
      'stop_reason_anomalo',
      'pool_non_valido',
    ] as const;

    for (const reason of NOMINATI) {
      markFailedSpy.mockClear();
      markReadySpy.mockClear();
      writePoolSpy.mockClear();
      genHolder.markFailedCalls.length = 0;
      boundarySpy.mockReset();
      // Il confine ritorna l'esito NOMINATO di fallimento (T-224): runGenerationPhase1 lo propaga.
      boundarySpy.mockResolvedValue({ ok: false, reason });

      const res = await runGenerate(SITE_A);
      expect(res.status).toBe(200); // covers: AC-230-7
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();

      // FLUSH 1 — le cornici escono comunque (pure); FLUSH 2 — un chunk error con QUEL motivo.
      expect((await readChunk(reader)).type).toBe('frames'); // covers: AC-230-7
      const chunk2 = await readChunk(reader);
      expect(chunk2.type).toBe('error'); // covers: AC-230-7
      expect(chunk2.reason).toBe(reason); // covers: AC-230-7 — il motivo nominato, non uno generico

      // La riga va a 'failed' col motivo NOMINATO; mai 'ready', mai una scrittura di pool.
      expect(markFailedSpy).toHaveBeenCalledTimes(1); // covers: AC-230-7
      expect(genHolder.markFailedCalls[0][1]).toBe(reason); // covers: AC-230-7
      expect(markReadySpy).not.toHaveBeenCalled(); // covers: AC-230-7
      expect(writePoolSpy).not.toHaveBeenCalled(); // covers: AC-230-7
      // Nessun terzo chunk: lo stream si chiude dopo l'error, non c'e' MAI un pool.
      expect((await reader.read()).done).toBe(true); // covers: AC-230-7
    }
  });

  // covers: AC-230-7
  it('writePool fallisce dopo un confine riuscito: markFailed(pool_non_scritto), chunk error, nessun pool', async () => {
    boundarySpy.mockResolvedValue({ ok: true, pool: OK_POOL });
    genHolder.writePool = { ok: false, status: 500 };

    const res = await runGenerate(SITE_A);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();

    expect((await readChunk(reader)).type).toBe('frames'); // covers: AC-230-7
    const chunk2 = await readChunk(reader);
    expect(chunk2.type).toBe('error'); // covers: AC-230-7
    expect(chunk2.reason).toBe('pool_non_scritto'); // covers: AC-230-7

    expect(writePoolSpy).toHaveBeenCalledTimes(1); // covers: AC-230-7 — il confine e' riuscito, la scrittura no
    expect(markFailedSpy).toHaveBeenCalledTimes(1); // covers: AC-230-7
    expect(genHolder.markFailedCalls[0][1]).toBe('pool_non_scritto'); // covers: AC-230-7
    expect(markReadySpy).not.toHaveBeenCalled(); // covers: AC-230-7
    expect((await reader.read()).done).toBe(true); // covers: AC-230-7
  });

  // covers: AC-230-7
  // La finestra P2-D15: pool scritto, ma la transizione durabile a 'ready' e' PERSA. La rotta
  // deve RISPETTARE il ritorno di markReady e NON dichiarare successo emettendo 'pool'.
  it('markReady ritorna ok:false (CAS perso): NIENTE chunk pool, emette error e passa da markFailed', async () => {
    boundarySpy.mockResolvedValue({ ok: true, pool: OK_POOL });
    genHolder.writePool = { ok: true, id: 'pool-x' };
    // La transizione 'generating'->'ready' non tocca alcuna riga (riga riconciliata a 'failed').
    // La rotta guarda solo `.ok`; lo status non e' materia di questo test.
    markReadySpy.mockResolvedValueOnce({ ok: false });

    const res = await runGenerate(SITE_A);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();

    expect((await readChunk(reader)).type).toBe('frames'); // covers: AC-230-7
    const chunk2 = await readChunk(reader);
    // NON un 'pool' di successo: il pool c'e' ma la generazione non e' viva.
    expect(chunk2.type).toBe('error'); // covers: AC-230-7
    expect(chunk2.reason).toBe('ready_non_scritto'); // covers: AC-230-7

    // Il pool era stato scritto (il confine e markReady sono stati raggiunti)…
    expect(writePoolSpy).toHaveBeenCalledTimes(1); // covers: AC-230-7
    expect(markReadySpy).toHaveBeenCalledTimes(1); // covers: AC-230-7
    // …ma il successo NON e' dichiarato: si passa dal ramo di fallimento (markFailed) con 'error'.
    expect(markFailedSpy).toHaveBeenCalledTimes(1); // covers: AC-230-7
    expect(genHolder.markFailedCalls[0][1]).toBe('ready_non_scritto'); // covers: AC-230-7
    // Nessun chunk 'pool' emesso in tutto lo stream.
    expect((await reader.read()).done).toBe(true); // covers: AC-230-7
  });
});
