// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import itMessages from '../messages/it.json';
import esMessages from '../messages/es.json';

// T-236 (macrotask generation-ui, P2) — AGGANCIO DASHBOARD: il badge segnaposto 'pronto
// per generare' di T-153 e' sostituito dallo STATO REALE della generazione per sito, letto
// con listGenerationStatuses() in UNA sola query, e da una CTA per riga che dipende dallo
// stato (genera / riprendi / vedi l'anteprima / riprova), ciascuna con la propria
// destinazione (/{locale}/generate o /{locale}/preview).
//
// Il Server Component DashboardPage e' invocato come funzione per ottenere l'albero e poi
// reso in jsdom (stessa tecnica di dashboard-onboarding-cta.test.tsx). Mock:
//  - next/navigation: redirect (throw sentinel) + usePathname (AppShell) + useRouter (SiteRow);
//  - next/link: <a> semplice, cosi' l'href e' un attributo ispezionabile;
//  - next-intl/server getTranslations: risolve dai cataloghi REALI it/es (l'AC sul locale
//    verifica differenze di stringa autentiche, non finte);
//  - @/data/supabase-ssr getUser, @/data/sites listSites, @/data/briefs getBrief;
//  - @/data/generations listGenerationStatuses: e' il DOPPIO che CONTA le chiamate (AC-236-1).
//
// ANTI-TAUTOLOGIA (correzione di metodo P1, ripetuta tre volte con la suite verde): la
// dashboard rende una LISTA, quindi "esiste una CTA da qualche parte" non prova nulla. Le
// fixture hanno SEI siti con stati di generazione DISCORDANTI (nessuna/ready/chosen/
// generating/complete/failed) e le asserzioni sono PER RIGA:
//  - 'sito-1' e' PREFISSO di 'sito-1-extra', e 'sito-3' di 'sito-3-bis': una mappatura
//    site_id->stato fatta con startsWith/includes invece che con un lookup esatto incrocia
//    le righe e viene vista;
//  - lo `status` del SITO e' deliberatamente DISCORDANTE dallo stato di GENERAZIONE (un sito
//    con site.status='published' ha generazione null; uno con site.status='draft' e'
//    'complete'): leggere site.status al posto dello stato di generazione non sopravvive;
//  - l'ordine dell'array di listGenerationStatuses NON e' quello dei siti: un accoppiamento
//    per indice non regge.

type GenerationStatusValue =
  | 'generating'
  | 'ready'
  | 'chosen'
  | 'complete'
  | 'failed'
  | null;

const { REDIRECT, redirectSpy, pathnameHolder } = vi.hoisted(() => {
  const sentinel = Symbol('redirect');
  return {
    REDIRECT: sentinel,
    redirectSpy: vi.fn(() => {
      throw sentinel;
    }),
    pathnameHolder: { current: '/it/dashboard' },
  };
});

vi.mock('next/navigation', () => ({
  redirect: redirectSpy,
  usePathname: () => pathnameHolder.current,
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
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => {
    const cat = (locale === 'es' ? esMessages : itMessages) as Record<string, unknown>;
    const ns = (cat[namespace] ?? {}) as Record<string, unknown>;
    return (key: string) => {
      const value = key
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], ns);
      return typeof value === 'string' ? value : `${namespace}.${key}`;
    };
  },
}));

const { authHolder } = vi.hoisted(() => ({
  authHolder: { user: { id: 'user-a' } as { id: string } | null },
}));
vi.mock('@/data/supabase-ssr', () => ({
  getUser: async () => authHolder.user,
}));

const { sitesHolder } = vi.hoisted(() => ({
  sitesHolder: {
    list: { ok: true, sites: [] } as
      | { ok: true; sites: { id: string; name: string; slug: string; status: string }[] }
      | { ok: false; status: 401 | 500 },
  },
}));
vi.mock('@/data/sites', () => ({
  listSites: async () => sitesHolder.list,
  createSiteForm: vi.fn(async () => ({ status: 'success' as const })),
  renameSite: vi.fn(async () => ({ ok: true })),
  deleteSite: vi.fn(async () => ({ ok: true })),
}));

// getBrief resta il carry-over N+1 di T-153 (out_of_scope di T-236): qui e' doppiato per
// non far crollare la pagina, con un brief benigno per ogni sito.
vi.mock('@/data/briefs', () => ({
  getBrief: vi.fn(async () => ({ ok: true, brief: null, status: null, complete: false })),
}));

// IL DOPPIO CHE CONTA (AC-236-1): la dashboard deve leggere lo stato di generazione di TUTTI
// i siti con UNA sola chiamata. listGenerationStatusesSpy e' lo spy; il suo risultato e'
// governato da statusesHolder cosi' un test puo' iniettare stati diversi o un guasto.
const { statusesHolder, listStatusesSpy } = vi.hoisted(() => {
  const holder = {
    result: { ok: true, statuses: [] } as
      | { ok: true; statuses: { site_id: string; status: GenerationStatusValue }[] }
      | { ok: false; status: 401 | 500 },
  };
  return {
    statusesHolder: holder,
    listStatusesSpy: vi.fn(async () => holder.result),
  };
});
vi.mock('@/data/generations', () => ({
  listGenerationStatuses: listStatusesSpy,
}));

// Import DOPO i mock (vi.mock e' hoisted).
import DashboardPage from '@/app/[locale]/dashboard/page';

// ---------------------------------------------------------------------------
// Fixture: sei siti, stati di generazione discordanti, id con relazione di prefisso.
// ---------------------------------------------------------------------------

const PANIFICIO = 'sito-1'; // generazione null  → genera
const PALESTRA = 'sito-1-extra'; // 'sito-1' e' suo PREFISSO; generazione ready  → riprendi
const BAR_SOLE = 'sito-2'; // generazione chosen → riprendi
const GELATERIA = 'sito-2-bis'; // 'sito-2' e' suo PREFISSO; generazione generating → riprendi
const OSTERIA = 'sito-3'; // generazione complete → vedi l'anteprima
const STUDIO = 'sito-3-bis'; // 'sito-3' e' suo PREFISSO; generazione failed → riprova

const SITES = [
  // site.status 'published' ma generazione null → il CTA non puo' venire da site.status
  { id: PANIFICIO, name: 'Panificio Aurora', slug: 'panificio-aurora', status: 'published' },
  { id: PALESTRA, name: 'Palestra Nord', slug: 'palestra-nord', status: 'draft' },
  { id: BAR_SOLE, name: 'Bar Sole', slug: 'bar-sole', status: 'draft' },
  // site.status 'published' ma generazione 'generating' → in corso, non pubblicata: la CTA
  // 'riprendi' viene dallo STATO di generazione, non da site.status.
  { id: GELATERIA, name: 'Gelateria Iris', slug: 'gelateria-iris', status: 'published' },
  // site.status 'draft' ma generazione 'complete' → l'anteprima non puo' venire da site.status
  { id: OSTERIA, name: 'Osteria Guasto', slug: 'osteria-guasto', status: 'draft' },
  { id: STUDIO, name: 'Studio Verdi', slug: 'studio-verdi', status: 'published' },
];

// L'ordine dell'array e' DIVERSO da SITES, e i valori sono discordanti: un accoppiamento per
// indice o per prefisso non produce il risultato atteso.
const STATUSES: { site_id: string; status: GenerationStatusValue }[] = [
  { site_id: BAR_SOLE, status: 'chosen' },
  { site_id: GELATERIA, status: 'generating' },
  { site_id: STUDIO, status: 'failed' },
  { site_id: PANIFICIO, status: null },
  { site_id: OSTERIA, status: 'complete' },
  { site_id: PALESTRA, status: 'ready' },
];

// Etichette REALI dai cataloghi (mai stringhe inline nel test: cosi' un cambio di catalogo
// non traduce in un falso verde).
const genGenerate = itMessages.dashboard.generation.generate;
const genResume = itMessages.dashboard.generation.resume;
const genPreview = itMessages.dashboard.generation.preview;
const genRetry = itMessages.dashboard.generation.retry;

async function renderDashboard(locale: string) {
  const ui = await DashboardPage({ params: Promise.resolve({ locale }) });
  render(ui);
}

// La riga di un sito: il <li> che contiene il nome. Le asserzioni sono sempre SCOPED a essa.
function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest('li');
  if (!row) throw new Error(`riga (<li>) non trovata per il sito ${name}`);
  return row as HTMLElement;
}

beforeEach(() => {
  authHolder.user = { id: 'user-a' };
  sitesHolder.list = { ok: true, sites: SITES };
  statusesHolder.result = { ok: true, statuses: STATUSES };
  redirectSpy.mockClear();
  listStatusesSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('T-236 dashboard: stato di generazione per sito, in una query', () => {
  // covers: AC-236-1
  it('legge lo stato di generazione di TUTTI i siti con UNA sola chiamata al DB', async () => {
    await renderDashboard('it');

    // La proprieta' centrale: una sola chiamata, non una per sito (N+1 di P1 §7 p.15 non
    // reintrodotta). Sei siti, UNA chiamata: `toHaveBeenCalledTimes(1)` distingue gia' 1 da N.
    // (Rimossa qui la riga `not.toHaveBeenCalledTimes(SITES.length)`: era VACUA — 1 !== SITES.length
    // e' implicato dalla riga qui sopra, quindi non poteva cadere per conto proprio.)
    expect(listStatusesSpy).toHaveBeenCalledTimes(1); // covers: AC-236-1

    // …e le tre righe in stati diversi (nessuna/ready/complete) mostrano lo stato corretto.
    expect(
      within(rowFor('Panificio Aurora')).getByRole('link', { name: genGenerate }).getAttribute('href'),
    ).toBe('/it/generate/sito-1'); // covers: AC-236-1
    expect(
      within(rowFor('Palestra Nord')).getByRole('link', { name: genResume }).getAttribute('href'),
    ).toBe('/it/generate/sito-1-extra'); // covers: AC-236-1
    expect(
      within(rowFor('Osteria Guasto')).getByRole('link', { name: genPreview }).getAttribute('href'),
    ).toBe('/it/preview/sito-3'); // covers: AC-236-1
  });

  // covers: AC-236-4
  it('la CTA per riga dipende dallo stato, ciascuna con la propria destinazione', async () => {
    await renderDashboard('it');

    // nessuna → genera → /generate
    expect(
      within(rowFor('Panificio Aurora')).getByRole('link', { name: genGenerate }).getAttribute('href'),
    ).toBe('/it/generate/sito-1'); // covers: AC-236-4
    // ready → riprendi → /generate
    expect(
      within(rowFor('Palestra Nord')).getByRole('link', { name: genResume }).getAttribute('href'),
    ).toBe('/it/generate/sito-1-extra'); // covers: AC-236-4
    // chosen → riprendi → /generate
    expect(
      within(rowFor('Bar Sole')).getByRole('link', { name: genResume }).getAttribute('href'),
    ).toBe('/it/generate/sito-2'); // covers: AC-236-4
    // complete → vedi l'anteprima → /preview
    expect(
      within(rowFor('Osteria Guasto')).getByRole('link', { name: genPreview }).getAttribute('href'),
    ).toBe('/it/preview/sito-3'); // covers: AC-236-4
    // failed → riprova → /generate
    expect(
      within(rowFor('Studio Verdi')).getByRole('link', { name: genRetry }).getAttribute('href'),
    ).toBe('/it/generate/sito-3-bis'); // covers: AC-236-4
    // generating → riprendi → /generate: una generazione IN CORSO si riprende da /generate, NON
    // porta all'anteprima. E' il sesto stato, quello che alle fixture mancava; e' raggruppato con
    // ready/chosen sotto 'riprendi'. Probe rossa: spostare il case 'generating' fuori da quel
    // gruppo (verso 'genera' o 'preview') fa cadere QUESTA riga.
    expect(
      within(rowFor('Gelateria Iris')).getByRole('link', { name: genResume }).getAttribute('href'),
    ).toBe('/it/generate/sito-2-bis'); // covers: AC-236-4

    // La destinazione /preview esiste per il SOLO sito 'complete', e per nessun altro: la
    // CTA non e' un link fisso, distingue davvero gli stati.
    const previewLinks = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'))
      .filter((href): href is string => !!href && href.includes('/preview/'));
    expect(previewLinks).toEqual(['/it/preview/sito-3']); // covers: AC-236-4
    // Trappola del prefisso: 'sito-1' (genera) e 'sito-1-extra' (riprendi) non condividono
    // la destinazione; il lookup e' esatto, non per prefisso.
    expect('/it/generate/sito-1').not.toBe('/it/generate/sito-1-extra'); // covers: AC-236-4
  });

  // covers: AC-236-2
  it('un guasto di lettura mostra uno stato d errore esplicito, NON l elenco vuoto', async () => {
    // (a) listSites fallisce: e' la lezione di T-153 (un 500 rendeva 'nessun sito').
    sitesHolder.list = { ok: false, status: 500 };
    statusesHolder.result = { ok: true, statuses: STATUSES };
    await renderDashboard('it');
    expect(screen.getByText(itMessages.dashboard.sitesUnavailable)).toBeTruthy(); // covers: AC-236-2
    expect(screen.queryByText(itMessages.dashboard.emptyState)).toBeNull(); // covers: AC-236-2

    // (b) listGenerationStatuses fallisce: anche il guasto della lettura di STATO non deve
    // rendere l'elenco vuoto (PIN 3 di T-236).
    cleanup();
    sitesHolder.list = { ok: true, sites: SITES };
    statusesHolder.result = { ok: false, status: 500 };
    await renderDashboard('it');
    expect(screen.getByText(itMessages.dashboard.sitesUnavailable)).toBeTruthy(); // covers: AC-236-2
    expect(screen.queryByText(itMessages.dashboard.emptyState)).toBeNull(); // covers: AC-236-2

    // Contro-prova: un elenco DAVVERO vuoto resta lo stato vuoto, non un errore.
    cleanup();
    sitesHolder.list = { ok: true, sites: [] };
    statusesHolder.result = { ok: true, statuses: [] };
    await renderDashboard('it');
    expect(screen.getByText(itMessages.dashboard.emptyState)).toBeTruthy(); // covers: AC-236-2
    expect(screen.queryByText(itMessages.dashboard.sitesUnavailable)).toBeNull(); // covers: AC-236-2
  });

  // covers: AC-236-3
  it('un locale fuori dall allowlist non entra negli href: si usa il default', async () => {
    await renderDashboard('../attacco');

    // La CTA di generazione (genera) usa il locale dell'allowlist, non il valore grezzo.
    const genera = within(rowFor('Panificio Aurora')).getByRole('link', { name: genGenerate });
    expect(genera.getAttribute('href')).toBe('/it/generate/sito-1'); // covers: AC-236-3
    expect(genera.getAttribute('href')).not.toContain('attacco'); // covers: AC-236-3

    // …e anche la destinazione /preview del sito 'complete'.
    const anteprima = within(rowFor('Osteria Guasto')).getByRole('link', { name: genPreview });
    expect(anteprima.getAttribute('href')).toBe('/it/preview/sito-3'); // covers: AC-236-3
    expect(anteprima.getAttribute('href')).not.toContain('attacco'); // covers: AC-236-3

    // Nessun href di generazione della pagina porta il locale grezzo.
    const genHrefs = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href') ?? '')
      .filter((href) => href.includes('/generate/') || href.includes('/preview/'));
    expect(genHrefs.length).toBeGreaterThan(0); // covers: AC-236-3
    for (const href of genHrefs) {
      expect(href.startsWith('/it/')).toBe(true); // covers: AC-236-3
      expect(href).not.toContain('attacco'); // covers: AC-236-3
    }
  });

  // supporto (non-AC): le etichette vengono dal CATALOGO del locale, non da stringhe inline.
  // Con locale 'es' la CTA cambia lingua e l'href passa sotto /es.
  it('locale es: le etichette della CTA vengono dal catalogo es e gli href sono sotto /es', async () => {
    await renderDashboard('es');

    const esGenera = esMessages.dashboard.generation.generate;
    const esAnteprima = esMessages.dashboard.generation.preview;

    expect(
      within(rowFor('Panificio Aurora')).getByRole('link', { name: esGenera }).getAttribute('href'),
    ).toBe('/es/generate/sito-1');
    expect(
      within(rowFor('Osteria Guasto')).getByRole('link', { name: esAnteprima }).getAttribute('href'),
    ).toBe('/es/preview/sito-3');
    // I due cataloghi differiscono davvero: la stringa italiana non compare in es.
    expect(esGenera).not.toBe(genGenerate);
    expect(screen.queryByRole('link', { name: genGenerate })).toBeNull();
  });

  // supporto (pin): senza sessione si reindirizza al login e non si legge alcuno stato di
  // generazione (la lettura sta DOPO l'auth: nessun round-trip per chi non e' autenticato).
  it('senza sessione: redirect al login, nessuna lettura dello stato di generazione', async () => {
    authHolder.user = null;
    await expect(DashboardPage({ params: Promise.resolve({ locale: 'it' }) })).rejects.toBe(
      REDIRECT,
    );
    expect(redirectSpy).toHaveBeenCalledWith('/it/login');
    expect(listStatusesSpy).not.toHaveBeenCalled();
  });
});
