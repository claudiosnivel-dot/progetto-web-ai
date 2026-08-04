// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import itMessages from '../messages/it.json';
import esMessages from '../messages/es.json';

// T-153 (macrotask onboarding-ui, P1) — la dashboard dei siti (T-102/T-105) mostra su
// OGNI riga un CTA verso /{locale}/onboarding/{siteId} e, per i siti il cui brief e'
// 'confirmed', un badge SEGNAPOSTO "pronto per generare" (la generazione e' P2).
//
// Il Server Component DashboardPage e' invocato come funzione per ottenere l'albero di
// elementi e poi reso in jsdom (stessa tecnica di tests/dashboard-sites.test.tsx). Mock:
//  - next/navigation: redirect (throw sentinel) + usePathname (AppShell) + useRouter
//    (SiteRow, T-105);
//  - next/link: <a> semplice, cosi' l'href e' ispezionabile come attributo;
//  - next-intl/server getTranslations: risolve dai cataloghi REALI it/es (l'AC sul locale
//    es verifica una differenza di stringa autentica, non finta);
//  - @/data/supabase-ssr getUser, @/data/sites listSites, @/data/briefs getBrief.
//
// ANTI-TAUTOLOGIA (il difetto ripetuto tre volte in questa sessione): la dashboard rende
// una LISTA, quindi "esiste un CTA da qualche parte" non dimostra nulla. Le fixture hanno
// CINQUE siti con stati di brief DIVERSI, e le asserzioni sono PER RIGA:
//  - `sito-1` e' PREFISSO di `sito-1-extra` e di `sito-10/../fuga`: un accoppiamento
//    sito↔brief fatto con startsWith/includes invece di un'associazione esatta incrocia
//    le righe e viene visto;
//  - lo `status` del SITO e quello del BRIEF sono deliberatamente DISCORDANTI (un sito
//    con site.status='published' ha brief draft, uno con site.status='draft' ha brief
//    confirmed): leggere site.status al posto dello stato del brief non sopravvive;
//  - due righe hanno il badge e tre no: si asserisce anche l'ASSENZA, riga per riga;
//  - getBrief lancia su un siteId non atteso: interrogare l'id sbagliato non passa
//    inosservato come "nessun brief".

type BriefState =
  | { ok: true; brief: null; status: null; complete: false }
  | { ok: true; brief: Record<string, unknown>; status: 'draft' | 'confirmed'; complete: boolean }
  | { ok: false; status: 500 };

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
    list: { ok: true, sites: [] } as {
      ok: boolean;
      sites: { id: string; name: string; slug: string; status: string }[];
    },
  },
}));
vi.mock('@/data/sites', () => ({
  listSites: async () => sitesHolder.list,
  createSiteForm: vi.fn(async () => ({ status: 'success' as const })),
  renameSite: vi.fn(async () => ({ ok: true })),
  deleteSite: vi.fn(async () => ({ ok: true })),
}));

const { briefsHolder, getBriefSpy } = vi.hoisted(() => {
  const holder = { bySite: {} as Record<string, unknown> };
  return {
    briefsHolder: holder,
    getBriefSpy: vi.fn(async (siteId: string) => {
      if (!(siteId in holder.bySite)) {
        // Un id non atteso e' un ERRORE del chiamante, non "nessun brief": si lancia,
        // cosi' un accoppiamento sbagliato sito↔brief non si travesta da stato vuoto.
        throw new Error(`getBrief: siteId non atteso: ${siteId}`);
      }
      return holder.bySite[siteId];
    }),
  };
});
vi.mock('@/data/briefs', () => ({
  getBrief: getBriefSpy,
}));

// T-236 — la dashboard ora legge anche lo stato di generazione (listGenerationStatuses, UNA
// query). Questo file resta focalizzato sull'aggancio ONBOARDING di T-153 (CTA + stato del
// brief): la lettura di generazione e' doppiata con ok:true e NESSUNO stato (ogni sito → CTA
// 'genera'), cosi' la pagina si rende senza toccare il DB reale. La CTA di generazione e i suoi
// stati sono coperti a parte in tests/dashboard-generation-state.test.ts.
vi.mock('@/data/generations', () => ({
  listGenerationStatuses: vi.fn(async () => ({ ok: true as const, statuses: [] })),
}));

// Import DOPO i mock (vi.mock e' hoisted).
import DashboardPage from '@/app/[locale]/dashboard/page';

// ---------------------------------------------------------------------------
// Fixture: cinque siti, stati di brief diversi, id con relazione di prefisso.
// ---------------------------------------------------------------------------

const BAR_SOLE = 'sito-2';
const PANIFICIO = 'sito-1';
const PALESTRA = 'sito-1-extra'; // 'sito-1' e' suo PREFISSO
const STUDIO = 'sito-10/../fuga'; // 'sito-1' e' suo PREFISSO + caratteri da codificare
const OSTERIA = 'sito-3';

const SITES = [
  // brief confirmed ma site.status 'draft' → il badge non puo' venire da site.status
  { id: BAR_SOLE, name: 'Bar Sole', slug: 'bar-sole', status: 'draft' },
  // brief draft ma site.status 'published' → nessun badge nonostante il sito pubblicato
  { id: PANIFICIO, name: 'Panificio Aurora', slug: 'panificio-aurora', status: 'published' },
  { id: PALESTRA, name: 'Palestra Nord', slug: 'palestra-nord', status: 'draft' },
  { id: STUDIO, name: 'Studio Verdi', slug: 'studio-verdi', status: 'published' },
  { id: OSTERIA, name: 'Osteria Guasto', slug: 'osteria-guasto', status: 'published' },
];

const draftBrief: BriefState = {
  ok: true,
  brief: { business_name: 'Panificio Aurora' },
  status: 'draft',
  complete: false,
};
const confirmedBrief: BriefState = {
  ok: true,
  brief: { business_name: 'Bar Sole' },
  status: 'confirmed',
  complete: true,
};
const noBrief: BriefState = { ok: true, brief: null, status: null, complete: false };
const readFailure: BriefState = { ok: false, status: 500 };

const BRIEFS: Record<string, BriefState> = {
  [BAR_SOLE]: confirmedBrief,
  [PANIFICIO]: draftBrief,
  [PALESTRA]: noBrief,
  [STUDIO]: confirmedBrief,
  [OSTERIA]: readFailure,
};

// href attesi scritti a MANO (non ricalcolati con encodeURIComponent, che riprodurrebbe
// l'implementazione): il segmento del siteId e' codificato e non introduce segmenti nuovi.
const EXPECTED_HREF_IT: Record<string, string> = {
  'Bar Sole': '/it/onboarding/sito-2',
  'Panificio Aurora': '/it/onboarding/sito-1',
  'Palestra Nord': '/it/onboarding/sito-1-extra',
  'Studio Verdi': '/it/onboarding/sito-10%2F..%2Ffuga',
  'Osteria Guasto': '/it/onboarding/sito-3',
};

const itCta = itMessages.dashboard.onboarding.cta;
const itUnavailable = itMessages.dashboard.onboarding.statusUnavailable;
const esCta = esMessages.dashboard.onboarding.cta;

async function renderDashboard(locale: string) {
  const ui = await DashboardPage({ params: Promise.resolve({ locale }) });
  render(ui);
}

// La riga di un sito: il <li> che contiene il nome del sito (SiteRow rende il name in
// un nodo di testo). Le asserzioni sono sempre SCOPED a questa riga.
function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest('li');
  if (!row) throw new Error(`riga (<li>) non trovata per il sito ${name}`);
  return row as HTMLElement;
}

beforeEach(() => {
  authHolder.user = { id: 'user-a' };
  sitesHolder.list = { ok: true, sites: SITES };
  briefsHolder.bySite = { ...BRIEFS };
  redirectSpy.mockClear();
  getBriefSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('T-153 dashboard: CTA onboarding + stato del brief', () => {
  // covers: AC-153-1
  it('sito senza brief e sito con brief draft: la PROPRIA riga ha il CTA verso /it/onboarding/<siteId>', async () => {
    await renderDashboard('it');

    for (const name of ['Palestra Nord', 'Panificio Aurora']) {
      const row = rowFor(name);
      const cta = within(row).getByRole('link', { name: itCta });
      expect(cta.getAttribute('href')).toBe(EXPECTED_HREF_IT[name]); // covers: AC-153-1
    }
  });

  // covers: AC-153-1
  it('OGNI riga ha il CTA e ognuna punta al PROPRIO siteId (href distinti, corrispondenza esatta)', async () => {
    await renderDashboard('it');

    const hrefs = SITES.map((site) => {
      const cta = within(rowFor(site.name)).getByRole('link', { name: itCta });
      return cta.getAttribute('href');
    });

    expect(hrefs).toEqual(SITES.map((site) => EXPECTED_HREF_IT[site.name])); // covers: AC-153-1
    expect(new Set(hrefs).size).toBe(SITES.length); // covers: AC-153-1 — nessuna riga riusa l'href di un'altra
    // La riga di 'sito-1' non punta a 'sito-1-extra' ne' viceversa (trappola del prefisso).
    expect(hrefs[1]).not.toBe(hrefs[2]); // covers: AC-153-1
  });

  // covers: AC-153-1
  it('il siteId e codificato: un id con caratteri strani non aggiunge segmenti al percorso', async () => {
    await renderDashboard('it');

    const href = within(rowFor('Studio Verdi'))
      .getByRole('link', { name: itCta })
      .getAttribute('href');
    expect(href).toBe('/it/onboarding/sito-10%2F..%2Ffuga'); // covers: AC-153-1
    // Esattamente tre segmenti dopo la radice: ['', 'it', 'onboarding', '<id codificato>'].
    expect(href?.split('/')).toHaveLength(4); // covers: AC-153-1
    expect(href).not.toContain('/../'); // covers: AC-153-1
  });

  // T-236 ha SOSTITUITO il badge segnaposto 'pronto per generare' con la CTA di generazione:
  // le asserzioni sul badge (ex AC-153-2) vivono ora, nella loro forma reale, in
  // tests/dashboard-generation-state.test.ts. Qui resta il CTA di onboarding, che T-236 non
  // tocca. I controlli T-105 della riga (salva + elimina) restano invariati: nessun bottone
  // 'genera' nasce nella riga (la generazione e' un LINK, non un bottone).
  it('la riga conserva i soli controlli T-105 (salva + elimina), nessun bottone di generazione', async () => {
    await renderDashboard('it');

    const buttonNames = within(rowFor('Bar Sole'))
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(buttonNames).toEqual([
      itMessages.dashboard.actions.save,
      itMessages.dashboard.actions.delete,
    ]);
  });

  // covers: AC-153-3
  it('locale es: il CTA di onboarding e in spagnolo, con href sotto /es (chiavi diverse dalla versione it)', async () => {
    await renderDashboard('es');

    // Il CTA: per ogni riga, etichetta spagnola e href sotto il locale es.
    const esHrefs = SITES.map((site) => {
      const cta = within(rowFor(site.name)).getByRole('link', { name: esCta });
      return cta.getAttribute('href');
    });
    expect(esHrefs).toEqual(
      SITES.map((site) => EXPECTED_HREF_IT[site.name].replace('/it/', '/es/')),
    ); // covers: AC-153-3

    // La stringa italiana del CTA NON e' resa in es, e i due cataloghi differiscono davvero.
    expect(screen.queryByRole('link', { name: itCta })).toBeNull(); // covers: AC-153-3
    expect(esCta).not.toBe(itCta); // covers: AC-153-3
  });

  // pin (vincolo 6): un GUASTO DI LETTURA non e' "nessun brief". La riga di un sito il cui
  // getBrief ritorna ok:false dichiara che lo stato del brief non e' disponibile, invece di
  // essere indistinguibile da un draft.
  it('getBrief ok:false: la riga dichiara lo stato non disponibile e non finge un brief assente', async () => {
    await renderDashboard('it');

    const guasta = rowFor('Osteria Guasto');
    expect(within(guasta).getByText(itUnavailable)).toBeTruthy();
    // Il CTA resta (il link non e' un gate: l'autorizzazione e' a valle, T-150 + RLS).
    expect(within(guasta).getByRole('link', { name: itCta }).getAttribute('href')).toBe(
      EXPECTED_HREF_IT['Osteria Guasto'],
    );
    // L'avviso e' SOLO sulla riga guasta: le altre non lo mostrano.
    expect(screen.getAllByText(itUnavailable)).toHaveLength(1);
    for (const name of ['Bar Sole', 'Panificio Aurora', 'Palestra Nord', 'Studio Verdi']) {
      expect(within(rowFor(name)).queryByText(itUnavailable)).toBeNull();
    }
  });

  // pin (vincolo 5): il segmento [locale] e' input controllabile dal client. Un locale fuori
  // dall'allowlist routing.locales non finisce nell'href: si usa il defaultLocale.
  it("un locale fuori dall'allowlist non entra nell'href del CTA (si usa il default)", async () => {
    await renderDashboard('../attacco');

    const href = within(rowFor('Bar Sole'))
      .getByRole('link', { name: itCta })
      .getAttribute('href');
    expect(href).toBe('/it/onboarding/sito-2');
    expect(href).not.toContain('attacco');
  });

  // pin: lo stato del brief e' letto con la sessione (RLS) una volta per sito. E' il COSTO
  // dichiarato di T-153: N query per render della dashboard, una per riga.
  it('legge lo stato del brief una volta per sito, con il proprio siteId', async () => {
    await renderDashboard('it');

    expect(getBriefSpy).toHaveBeenCalledTimes(SITES.length);
    expect(getBriefSpy.mock.calls.map((call) => call[0])).toEqual(SITES.map((site) => site.id));
  });

  // pin: le letture dei brief sono CONCORRENTI, non sequenziali. Il conteggio delle
  // chiamate qui sopra non lo distingue: un ciclo `for...of` con await produce lo stesso
  // numero e lo stesso ordine, e la dichiarazione di costo del file ("N round-trip ma
  // ~1 di latenza, in parallelo con Promise.all") diventerebbe FALSA in silenzio.
  // Si misura la sovrapposizione: quante chiamate sono PARTITE prima che la prima finisca.
  it('le letture dei brief partono tutte prima che la prima finisca (concorrenti)', async () => {
    let started = 0;
    let startedBeforeFirstEnd = -1;
    briefsHolder.bySite = Object.fromEntries(SITES.map((site) => [site.id, noBrief]));
    getBriefSpy.mockImplementation(async (siteId: string) => {
      started += 1;
      // Un tick di macrotask: chi e' sequenziale non puo' averne avviate altre nel mentre.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (startedBeforeFirstEnd === -1) startedBeforeFirstEnd = started;
      return briefsHolder.bySite[siteId];
    });

    await renderDashboard('it');

    expect(startedBeforeFirstEnd).toBe(SITES.length);
  });

  // pin: un GUASTO di lettura della LISTA non e' "nessun sito". La riga era pre-esistente
  // a T-102 (`result.ok ? result.sites : []`) e faceva rendere `emptyState`: un utente con
  // siti reali, se listSites falliva, leggeva "non hai ancora creato nessun sito" e nel
  // peggiore dei casi ne ricreava uno che esisteva. Stesso difetto corretto in T-152 e,
  // per i brief, dal resto di T-153: qui e' chiuso anche per la lista.
  it('listSites in errore: si dichiara che la lista non e leggibile, non che i siti non esistono', async () => {
    for (const locale of ['it', 'es'] as const) {
      cleanup();
      getBriefSpy.mockClear();
      sitesHolder.list = { ok: false, sites: [] };
      const catalog = locale === 'it' ? itMessages : esMessages;

      await renderDashboard(locale);

      expect(screen.getByText(catalog.dashboard.sitesUnavailable)).toBeTruthy();
      // NON si afferma il contrario di cio' che non si e' letto…
      expect(screen.queryByText(catalog.dashboard.emptyState)).toBeNull();
      // …e non si interroga nessun brief, perche' non c'e' nessuna riga.
      expect(getBriefSpy).not.toHaveBeenCalled();
    }
    // Contro-prova: la lista VUOTA per davvero resta lo stato vuoto, non un errore.
    cleanup();
    sitesHolder.list = { ok: true, sites: [] };
    await renderDashboard('it');
    expect(screen.getByText(itMessages.dashboard.emptyState)).toBeTruthy();
    expect(screen.queryByText(itMessages.dashboard.sitesUnavailable)).toBeNull();
  });

  // pin: senza sessione non si rende nulla e non si interroga nessun brief (T-102 regge).
  it('senza sessione: redirect al login, nessuna lettura di brief', async () => {
    authHolder.user = null;
    await expect(DashboardPage({ params: Promise.resolve({ locale: 'it' }) })).rejects.toBe(
      REDIRECT,
    );
    expect(redirectSpy).toHaveBeenCalledWith('/it/login');
    expect(getBriefSpy).not.toHaveBeenCalled();
  });
});
