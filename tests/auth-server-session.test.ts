import { describe, it, expect, vi, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { createTestUser, deleteTestUser } from './helpers/supabase-test';

// T-041 — getUser() reale: sessione server-side VALIDATA.
// getUser() legge i cookie via next/headers: qui mockiamo SOLO il TRASPORTO dei
// cookie (next/headers), MAI la validazione del token. Un in-memory store simula
// il cookie store della request; getUser() costruisce un client SSR reale che
// invia il JWT all'auth server locale (supabase.auth.getUser(), non getSession).
// La validazione del JWT è quindi REALE — non un mock hollow.
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

// Import DOPO il mock (vi.mock è hoisted): getUser() risolverà next/headers al mock.
import { getUser } from '@/data/supabase-ssr';

const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const anonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

describe.skipIf(!SB)('T-041 getUser() server-side (runtime, Supabase locale)', () => {
  let userId = '';
  const email = `t041_${randomUUID()}@example.test`;
  const password = 'Password123!';

  afterAll(async () => {
    cookieState.store.clear();
    if (userId) await deleteTestUser(userId);
  });

  it('senza sessione (cookie vuoti) getUser() ritorna null senza sollevare eccezioni', async () => {
    // given: contesto server privo di sessione; when: getUser()
    cookieState.store.clear();
    // then: null, nessuna eccezione (la Promise risolve, non rigetta)
    await expect(getUser()).resolves.toBeNull(); // covers: AC-041-3
  });

  it('con sessione reale valida getUser() ritorna lo user con id atteso (JWT validato lato server)', async () => {
    // given: un utente reale con sessione autenticata valida
    const user = await createTestUser(email, password);
    userId = user.id;

    // Login REALE con un client SSR "writer" che scrive nel medesimo store i
    // cookie di sessione realmente emessi dall'auth server locale.
    cookieState.store.clear();
    const writer = createServerClient(supabaseUrl(), anonKey(), {
      cookies: {
        getAll: () =>
          [...cookieState.store.entries()].map(([name, value]) => ({ name, value })),
        setAll: (list) => {
          for (const c of list) cookieState.store.set(c.name, c.value);
        },
      },
    });
    const { error } = await writer.auth.signInWithPassword({ email, password });
    expect(error).toBeNull();
    expect(cookieState.store.size).toBeGreaterThan(0);

    // when: getUser() legge quei cookie (via next/headers mockato) e RIVALIDA il
    // JWT contro l'auth server locale.
    const validated = await getUser();

    // then: ritorna lo user con id === id atteso (validazione reale del token).
    expect(validated).not.toBeNull(); // covers: AC-041-4
    expect(validated?.id).toBe(userId); // covers: AC-041-4
  });
});
