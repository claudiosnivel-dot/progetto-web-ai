import { describe, it, expect, vi, beforeEach } from 'vitest';

// T-043 — Avvio dell'OAuth Google (PREDISPOSTO, testato via mock; nessuna
// credenziale reale necessaria).
//
// Cosa mockiamo e perché NON è hollow:
//  - @/data/supabase-ssr → createServerSupabaseClient: mockiamo il client SSR con
//    una spia su signInWithOAuth. La spia REGISTRA gli argomenti che l'azione
//    costruisce (provider letterale + redirectTo calcolato da locale + origine) e
//    simula il comportamento server-side (ritorna l'URL di autorizzazione, nessun
//    errore). Verifichiamo la computazione REALE dell'azione, non una tautologia.
//  - next/headers → headers: fornisce l'host da cui l'azione deriva l'origine
//    ASSOLUTA del redirectTo.
//  - next/navigation → redirect: cattura la destinazione finale (l'URL di
//    autorizzazione) e lancia un sentinel (redirect() reale interrompe l'azione).
const { oauth, redirects } = vi.hoisted(() => ({
  oauth: {
    calls: [] as { provider: string; options?: { redirectTo?: string } }[],
  },
  redirects: { targets: [] as string[] },
}));

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ host: 'app.belora.test', 'x-forwarded-proto': 'https' }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirects.targets.push(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock('@/data/supabase-ssr', () => ({
  createServerSupabaseClient: async () => ({
    auth: {
      signInWithOAuth: (params: {
        provider: string;
        options?: { redirectTo?: string };
      }) => {
        oauth.calls.push(params);
        // Comportamento server-side reale di signInWithOAuth: nessun auto-redirect,
        // ritorna l'URL di autorizzazione da seguire e nessun errore.
        return Promise.resolve({
          data: {
            provider: params.provider,
            url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
          },
          error: null,
        });
      },
    },
  }),
}));

// Import DOPO i mock (vi.mock è hoisted).
import { signInWithGoogle } from '@/app/[locale]/login/actions';

describe("T-043 Accedi con Google (avvio signInWithOAuth)", () => {
  beforeEach(() => {
    oauth.calls.length = 0;
    redirects.targets.length = 0;
  });

  it("AC-043-4: locale it → signInWithOAuth con provider 'google' e options.redirectTo terminante con /it/auth/callback", async () => {
    // when: l'azione "Accedi con Google" viene avviata per il locale it → al
    // successo reindirizza all'URL di autorizzazione (throw NEXT_REDIRECT, atteso).
    await expect(signInWithGoogle('it')).rejects.toThrow(/NEXT_REDIRECT/);

    // then: signInWithOAuth invocato esattamente una volta
    expect(oauth.calls).toHaveLength(1); // covers: AC-043-4
    const call = oauth.calls[0];

    // then: provider === 'google'
    expect(call.provider).toBe('google'); // covers: AC-043-4

    // then: options.redirectTo è una URL ASSOLUTA che termina con /it/auth/callback
    const redirectTo = call.options?.redirectTo ?? '';
    expect(redirectTo.endsWith('/it/auth/callback')).toBe(true); // covers: AC-043-4
    // (assoluta: parsabile come URL con host)
    expect(new URL(redirectTo).host).toBe('app.belora.test'); // covers: AC-043-4

    // then: la destinazione finale è l'URL di autorizzazione emesso dall'auth server
    expect(redirects.targets[0]).toContain('accounts.google.com'); // covers: AC-043-4
  });

  it("AC-043-4: il locale è preservato → per es il redirectTo termina con /es/auth/callback", async () => {
    // when: avvio per il locale es
    await expect(signInWithGoogle('es')).rejects.toThrow(/NEXT_REDIRECT/);

    // then: stesso provider, ma callback del locale es (nessun corto-circuito al default)
    const call = oauth.calls[0];
    expect(call.provider).toBe('google'); // covers: AC-043-4
    expect((call.options?.redirectTo ?? '').endsWith('/es/auth/callback')).toBe(true); // covers: AC-043-4
  });
});
