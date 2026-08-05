import { describe, it, expect, vi, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pgQuery } from './helpers/pg';
import { deleteTestUser } from './helpers/supabase-test';

// T-042 — Flusso di signup RUNTIME contro il Supabase locale. Qui NON mockiamo
// supabase.auth.signUp: l'utente viene creato DAVVERO (prova non-hollow → riga in
// auth.users). Mockiamo solo (a) il TRASPORTO dei cookie via next/headers, così il
// client SSR funziona in ambiente node, e (b) createServerClient di @supabase/ssr
// per AVVOLGERE signUp con uno spy che CONTA le invocazioni ma DELEGA alla signUp
// reale (callthrough): la chiamata resta autentica, lo spy prova solo "una volta".
const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.DATABASE_URL
);

const { cookieState } = vi.hoisted(() => ({
  cookieState: { store: new Map<string, string>() },
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
}));

const { signUpCalls } = vi.hoisted(() => ({ signUpCalls: { count: 0 } }));

vi.mock('@supabase/ssr', async (importActual) => {
  const actual = await importActual<typeof import('@supabase/ssr')>();
  return {
    ...actual,
    createServerClient: (...args: Parameters<typeof actual.createServerClient>) => {
      const client = actual.createServerClient(...args);
      const realSignUp = client.auth.signUp.bind(client.auth);
      // Spy con callthrough: conta le invocazioni ma esegue la signUp REALE.
      vi.spyOn(client.auth, 'signUp').mockImplementation((credentials) => {
        signUpCalls.count += 1;
        return realSignUp(credentials);
      });
      return client;
    },
  };
});

// Import DOPO i mock (vi.mock è hoisted).
import { signup } from '@/app/[locale]/signup/actions';

describe.skipIf(!SB)('T-042 signup flow (runtime, Supabase locale)', () => {
  let userId = '';
  const email = `t042_${randomUUID()}@example.test`;
  const password = 'Password123!';

  afterAll(async () => {
    cookieState.store.clear();
    if (userId) await deleteTestUser(userId);
  });

  it('AC-042-3: email valida + password conforme → signUp chiamato una volta, esito success, utente creato', async () => {
    // given: payload valido (email UNICA + password conforme alla policy)
    const fd = new FormData();
    fd.set('email', email);
    fd.set('password', password);

    // when: il flusso di signup viene eseguito con il client Supabase locale
    const state = await signup({ status: 'idle' }, fd);

    // then: nessun errore di validazione → esito success
    expect(state.status).toBe('success'); // covers: AC-042-3
    // supabase.auth.signUp è stato invocato ESATTAMENTE una volta
    expect(signUpCalls.count).toBe(1); // covers: AC-042-3
    // l'utente è stato realmente creato: ESATTAMENTE una riga in auth.users
    const rows = await pgQuery<{ id: string }>(
      'select id from auth.users where email = $1',
      [email],
    );
    expect(rows).toHaveLength(1); // covers: AC-042-3
    userId = rows[0].id;
  });
});
