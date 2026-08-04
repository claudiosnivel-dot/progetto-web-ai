// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import itMessages from '../messages/it.json';
import esMessages from '../messages/es.json';

// T-102 — Scheletro dashboard (Server Component async). Il componente è invocato
// come funzione per ottenerne l'albero di elementi, poi reso in jsdom. Mockiamo:
//  - next/navigation: redirect (throw sentinel, come in produzione) + usePathname
//    (per AppShell);
//  - next/link: <a> semplice (nessun runtime Next);
//  - next-intl/server getTranslations: risolve dai cataloghi REALI it/es (così
//    AC-102-5 verifica una differenza di stringa autentica, non finta);
//  - @/data/supabase-ssr getUser: identità server-side;
//  - @/data/sites listSites + createSiteForm: dati e azione di creazione.

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
  // useRouter è usato da SiteRow (T-105) per il refresh post-mutazione.
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
  getTranslations: async ({
    locale,
    namespace,
  }: {
    locale: string;
    namespace: string;
  }) => {
    const cat = (locale === 'es' ? esMessages : itMessages) as Record<
      string,
      unknown
    >;
    const ns = (cat[namespace] ?? {}) as Record<string, unknown>;
    // Risolve sia chiavi piatte ('title') sia annidate puntate ('actions.rename').
    return (key: string) => {
      const value = key
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], ns);
      return typeof value === 'string' ? value : `${namespace}.${key}`;
    };
  },
}));

const { authHolder } = vi.hoisted(() => ({
  authHolder: { user: null as { id: string } | null },
}));
vi.mock('@/data/supabase-ssr', () => ({
  getUser: async () => authHolder.user,
}));

const { sitesHolder, createSiteFormSpy } = vi.hoisted(() => ({
  sitesHolder: {
    list: { ok: true, sites: [] } as {
      ok: boolean;
      sites: { id: string; name: string; slug: string; status: string }[];
    },
  },
  createSiteFormSpy: vi.fn(async () => ({ status: 'success' as const })),
}));
vi.mock('@/data/sites', () => ({
  listSites: async () => sitesHolder.list,
  createSiteForm: createSiteFormSpy,
  // renameSite/deleteSite sono importate da SiteRow (T-105): spy no-op qui.
  renameSite: vi.fn(async () => ({ ok: true })),
  deleteSite: vi.fn(async () => ({ ok: true })),
}));

// T-153 — La dashboard legge ora lo stato del brief di ogni sito via getBrief (@/data/briefs)
// per decidere il badge "pronto per generare". È una DIPENDENZA NUOVA della pagina, non un
// cambio di comportamento di T-102: senza questo mock la server action reale girerebbe in
// jsdom e chiamerebbe createServerSupabaseClient (assente dal mock di @/data/supabase-ssr
// qui sopra). Nessuna asserzione di questo file è stata toccata: si stubba "nessun brief"
// per tutti i siti, cioè lo stato in cui gli AC di T-102/T-105 sono stati scritti. Gli AC di
// T-153 vivono in tests/dashboard-onboarding-cta.test.tsx.
vi.mock('@/data/briefs', () => ({
  getBrief: vi.fn(async () => ({ ok: true, brief: null, status: null, complete: false })),
}));

// T-236 — La dashboard legge ora anche lo stato di generazione di tutti i siti via
// listGenerationStatuses (@/data/generations), in UNA query, per la CTA di generazione per
// riga. È una DIPENDENZA NUOVA della pagina, non un cambio di comportamento di T-102: senza
// questo mock la server action reale girerebbe in jsdom e chiamerebbe createServerSupabaseClient
// (assente dal mock di @/data/supabase-ssr qui sopra). Si stubba "nessuna generazione" per tutti
// i siti; gli AC di T-236 vivono in tests/dashboard-generation-state.test.ts.
vi.mock('@/data/generations', () => ({
  listGenerationStatuses: vi.fn(async () => ({ ok: true as const, statuses: [] })),
}));

// Import DOPO i mock (vi.mock è hoisted).
import DashboardPage from '@/app/[locale]/dashboard/page';

async function renderDashboard(locale: string) {
  const ui = await DashboardPage({ params: Promise.resolve({ locale }) });
  render(ui);
}

beforeEach(() => {
  authHolder.user = { id: 'user-a' };
  sitesHolder.list = { ok: true, sites: [] };
  redirectSpy.mockClear();
  createSiteFormSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('T-102 dashboard (scheletro localizzato)', () => {
  // covers: AC-102-1
  it('utente autenticato senza siti: rende lo stato vuoto localizzato (it)', async () => {
    authHolder.user = { id: 'user-a' };
    sitesHolder.list = { ok: true, sites: [] };
    await renderDashboard('it');
    expect(screen.getByText(itMessages.dashboard.emptyState)).toBeTruthy(); // covers: AC-102-1
  });

  // covers: AC-102-2
  it('utente con N siti: rende esattamente N elementi con il name di ciascuno', async () => {
    sitesHolder.list = {
      ok: true,
      sites: [
        { id: 's1', name: 'Sito Uno', slug: 'sito-uno', status: 'draft' },
        { id: 's2', name: 'Sito Due', slug: 'sito-due', status: 'published' },
      ],
    };
    await renderDashboard('it');
    // Scoping al <main>: la lista siti vive nel contenuto della pagina, non nella
    // nav dell'AppShell (che ha una propria <ul> di chrome). L'AC riguarda la
    // lista dei siti, non gli elementi di navigazione.
    const items = within(screen.getByRole('main')).getAllByRole('listitem');
    expect(items).toHaveLength(2); // covers: AC-102-2
    expect(screen.getByText('Sito Uno')).toBeTruthy(); // covers: AC-102-2
    expect(screen.getByText('Sito Due')).toBeTruthy(); // covers: AC-102-2
  });

  // covers: AC-102-3
  it('senza sessione: reindirizza al login e non rende il contenuto della dashboard', async () => {
    authHolder.user = null;
    await expect(
      DashboardPage({ params: Promise.resolve({ locale: 'it' }) }),
    ).rejects.toBe(REDIRECT); // covers: AC-102-3
    expect(redirectSpy).toHaveBeenCalledWith('/it/login'); // covers: AC-102-3
    // Nessun contenuto reso (il redirect ha interrotto prima del render).
    expect(screen.queryByText(itMessages.dashboard.title)).toBeNull(); // covers: AC-102-3
  });

  // covers: AC-102-4
  it('il form crea-sito reso dalla dashboard è wired a createSiteForm e gli passa il name inviato', async () => {
    // Wiring REALE: si rende il vero DashboardPage (che lega
    // createSiteForm.bind(null, locale) alla prop action del form), si compila il
    // campo name e si invia. Si verifica che createSiteForm sia invocata con un
    // FormData che porta il name digitato — la catena adapter→createSite→comparsa
    // è provata end-to-end in tests/sites-actions.test.ts (AC-102-4).
    const user = userEvent.setup();
    authHolder.user = { id: 'user-a' };
    sitesHolder.list = { ok: true, sites: [] };
    await renderDashboard('it');

    await user.type(
      screen.getByLabelText(itMessages.dashboard.siteName),
      'Nuovo Sito',
    );
    await user.click(
      screen.getByRole('button', { name: itMessages.dashboard.createSite }),
    );

    await waitFor(() => expect(createSiteFormSpy).toHaveBeenCalled()); // covers: AC-102-4
    // L'ultimo argomento passato all'azione è il FormData del submit; porta il name.
    const lastCall = createSiteFormSpy.mock.calls.at(-1) as unknown[] | undefined;
    const formData = lastCall?.at(-1) as FormData;
    expect(formData.get('name')).toBe('Nuovo Sito'); // covers: AC-102-4
  });

  // covers: AC-102-5
  it('locale es: titolo, bottone crea ed empty state resi in spagnolo (diversi dall it)', async () => {
    sitesHolder.list = { ok: true, sites: [] };
    await renderDashboard('es');
    expect(screen.getByText(esMessages.dashboard.title)).toBeTruthy(); // covers: AC-102-5
    expect(esMessages.dashboard.title).not.toBe(itMessages.dashboard.title); // covers: AC-102-5
    expect(screen.getByText(esMessages.dashboard.emptyState)).toBeTruthy(); // covers: AC-102-5
    // Il bottone di creazione porta l'etichetta spagnola.
    expect(
      screen.getByRole('button', { name: esMessages.dashboard.createSite }),
    ).toBeTruthy(); // covers: AC-102-5
  });
});
