import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createTestUser, deleteTestUser } from './helpers/supabase-test';

// T-043 — Login/logout email-password RUNTIME contro il Supabase locale.
//
// Cosa mockiamo e perché NON è hollow:
//  - next/headers: solo il TRASPORTO dei cookie (in-memory store). È il canale
//    reale con cui il client SSR scrive/legge i cookie di sessione, quindi
//    ispezionarne il contenuto prova davvero "cookie di sessione impostati/cancellati".
//  - next/navigation → redirect: catturiamo la destinazione e lanciamo un sentinel
//    (redirect() reale interrompe l'esecuzione con un throw). Verificare l'argomento
//    prova che l'azione reindirizza al path FISSO atteso.
//  - @supabase/ssr → createServerClient: NON mockiamo il modulo SSR dell'app.
//    Lasciamo girare il VERO createServerSupabaseClient/getUserFromRequest (anon key
//    + adapter cookie, R7). Avvolgiamo solo signInWithPassword/signOut con spy in
//    CALLTHROUGH: la chiamata resta autentica (rete reale verso l'auth server
//    locale), lo spy conta solo le invocazioni. La validazione dell'identità nel
//    middleware è quindi REALE — nessun auto-conferma.
const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { cookieState, redirects, spy } = vi.hoisted(() => ({
  cookieState: { store: new Map<string, string>() },
  redirects: { targets: [] as string[] },
  spy: { signIn: 0, signOut: 0 },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () =>
      [...cookieState.store.entries()].map(([name, value]) => ({ name, value })),
    get: (name: string) => {
      const value = cookieState.store.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieState.store.set(name, value);
    },
    delete: (name: string) => {
      cookieState.store.delete(name);
    },
  }),
  headers: async () => new Headers({ host: 'localhost:3000' }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirects.targets.push(url);
    // Mima il control-flow reale di Next: redirect() interrompe l'azione (throw).
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock('@supabase/ssr', async (importActual) => {
  const actual = await importActual<typeof import('@supabase/ssr')>();
  return {
    ...actual,
    createServerClient: (...args: Parameters<typeof actual.createServerClient>) => {
      const client = actual.createServerClient(...args);
      const realSignIn = client.auth.signInWithPassword.bind(client.auth);
      vi.spyOn(client.auth, 'signInWithPassword').mockImplementation((creds) => {
        spy.signIn += 1;
        return realSignIn(creds);
      });
      const realSignOut = client.auth.signOut.bind(client.auth);
      vi.spyOn(client.auth, 'signOut').mockImplementation((...a) => {
        spy.signOut += 1;
        return realSignOut(...a);
      });
      return client;
    },
  };
});

// Import DOPO i mock (vi.mock è hoisted): azioni e middleware risolvono
// next/headers, next/navigation e @supabase/ssr ai mock.
import { login, logout } from '@/app/[locale]/login/actions';
import middleware from '@/middleware';

// "Cookie di sessione presenti": esiste almeno un cookie con valore NON vuoto.
// Robusto rispetto al clear di signOut, che azzera i valori (value '') invece di
// rimuovere le chiavi.
const hasSessionCookie = (store: Map<string, string>): boolean =>
  [...store.values()].some((v) => v.length > 0);

// NextRequest con i cookie del session store (bridge verso getUserFromRequest, che
// legge i cookie dalla request e non da next/headers).
function requestWithCookies(path: string, store: Map<string, string>): NextRequest {
  const req = new NextRequest(new URL(path, 'http://localhost'));
  for (const [name, value] of store) req.cookies.set(name, value);
  return req;
}

describe.skipIf(!SB)('T-043 login/logout (runtime, Supabase locale)', () => {
  let userId = '';
  const email = `t043_${randomUUID()}@example.test`;
  const password = 'Password123!';

  beforeAll(async () => {
    const user = await createTestUser(email, password);
    userId = user.id;
  });

  afterAll(async () => {
    cookieState.store.clear();
    if (userId) await deleteTestUser(userId);
  });

  beforeEach(() => {
    cookieState.store.clear();
    redirects.targets.length = 0;
    spy.signIn = 0;
    spy.signOut = 0;
  });

  it('AC-043-1: credenziali valide → signInWithPassword success, cookie di sessione impostati, redirect a /it/dashboard', async () => {
    // given: credenziali valide di un utente esistente
    const fd = new FormData();
    fd.set('email', email);
    fd.set('password', password);

    // when: la Server Action di login viene inviata → al successo fa redirect
    // (throw NEXT_REDIRECT, atteso).
    await expect(login('it', { status: 'idle' }, fd)).rejects.toThrow(/NEXT_REDIRECT/);

    // then: signInWithPassword invocato una volta ed esitato con successo (senza
    // errore → l'azione è arrivata al redirect).
    expect(spy.signIn).toBe(1); // covers: AC-043-1
    // then: i cookie di sessione risultano realmente impostati dall'adapter SSR.
    expect(hasSessionCookie(cookieState.store)).toBe(true); // covers: AC-043-1
    // then: la destinazione del redirect è la dashboard del locale it.
    expect(redirects.targets).toContain('/it/dashboard'); // covers: AC-043-1
  });

  it('AC-043-2: password errata (email esistente) ed email inesistente → nessuna sessione, STESSO messaggio generico', async () => {
    // given/when: email esistente ma password errata
    const fdWrong = new FormData();
    fdWrong.set('email', email);
    fdWrong.set('password', 'WrongPassword123!');
    const stateWrong = await login('it', { status: 'idle' }, fdWrong);

    // then: esito d'errore, nessuna sessione (nessun cookie con valore), nessun redirect
    expect(stateWrong.status).toBe('error'); // covers: AC-043-2
    expect(hasSessionCookie(cookieState.store)).toBe(false); // covers: AC-043-2
    expect(redirects.targets).toEqual([]); // covers: AC-043-2

    cookieState.store.clear();

    // given/when: email INESISTENTE (formato valido, nessun utente)
    const fdNoUser = new FormData();
    fdNoUser.set('email', `nouser_${randomUUID()}@example.test`);
    fdNoUser.set('password', 'WhateverPass123!');
    const stateNoUser = await login('it', { status: 'idle' }, fdNoUser);

    // then: anche qui esito d'errore e nessuna sessione
    expect(stateNoUser.status).toBe('error'); // covers: AC-043-2
    expect(hasSessionCookie(cookieState.store)).toBe(false); // covers: AC-043-2

    // then (ANTI-ENUMERATION, security_note HARD): i due casi ritornano lo STESSO
    // messaggio, non distinguibile → non rivela quale campo è errato.
    expect(stateNoUser.message).toBeTruthy(); // covers: AC-043-2
    expect(stateWrong.message).toBe(stateNoUser.message); // covers: AC-043-2
  });

  it('AC-043-3: logout chiama signOut, cancella i cookie, redirect a /it/login; poi /it/dashboard → /it/login dal middleware', async () => {
    // given: sessione ATTIVA stabilita con un login reale
    const fd = new FormData();
    fd.set('email', email);
    fd.set('password', password);
    await expect(login('it', { status: 'idle' }, fd)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(hasSessionCookie(cookieState.store)).toBe(true);

    // sanity "before": con i cookie di sessione validi il middleware reale NON
    // blocca /it/dashboard (identità validata lato auth server). Il contrasto
    // before/after prova che è il logout — e non la sola assenza di cookie — a
    // togliere l'accesso.
    const before = await middleware(requestWithCookies('/it/dashboard', cookieState.store));
    expect(before.headers.get('location')).toBeNull(); // covers: AC-043-3

    redirects.targets.length = 0;

    // when: viene invocata la Server Action di logout (redirect → throw atteso)
    await expect(logout('it')).rejects.toThrow(/NEXT_REDIRECT/);

    // then: signOut chiamato, cookie di sessione cancellati, redirect a /it/login
    expect(spy.signOut).toBe(1); // covers: AC-043-3
    expect(hasSessionCookie(cookieState.store)).toBe(false); // covers: AC-043-3
    expect(redirects.targets).toContain('/it/login'); // covers: AC-043-3

    // then: la successiva richiesta a /it/dashboard è reindirizzata a /it/login dal
    // middleware reale (l'identità non valida più dopo il logout).
    const after = await middleware(requestWithCookies('/it/dashboard', cookieState.store));
    expect(after.status).toBe(307); // covers: AC-043-3
    expect(new URL(after.headers.get('location') as string).pathname).toBe('/it/login'); // covers: AC-043-3
  });
});
