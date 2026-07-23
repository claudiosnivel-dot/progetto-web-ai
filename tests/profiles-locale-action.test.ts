import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, createTestUser, signInAs, deleteTestUser } from './helpers/supabase-test';

// T-083 — (a) validazione server-side di updateProfileLocale (allowlist ['it','es']),
// (b) risoluzione del locale iniziale al bootstrap del layout via profiles.locale
// quando il cookie NEXT_LOCALE è assente. Si esercita il CODICE REALE:
//  - createServerSupabaseClient è mockato per iniettare il client di A (auth reale);
//  - next/headers cookies è mockato per controllare la presenza di NEXT_LOCALE;
//  - updateProfileLocale, getProfileLocale e resolveInitialLocale girano davvero.

const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { clientHolder, cookieHolder } = vi.hoisted(() => ({
  clientHolder: { current: null as SupabaseClient | null },
  cookieHolder: { nextLocale: undefined as string | undefined },
}));

vi.mock('@/data/supabase-ssr', () => ({
  createServerSupabaseClient: async () => clientHolder.current,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieHolder.nextLocale !== undefined && name === 'NEXT_LOCALE'
        ? { name, value: cookieHolder.nextLocale }
        : undefined,
  }),
}));

import { updateProfileLocale } from '@/data/updateProfileLocale';
import { resolveInitialLocale } from '@/i18n/resolveInitialLocale';

describe.skipIf(!SB)('T-083 validazione updateProfileLocale + resolveInitialLocale', () => {
  const password = 'Password123!';
  const emailA = `t083c_${randomUUID()}@example.test`;
  let userAId = '';
  let clientA: SupabaseClient;

  beforeAll(async () => {
    const a = await createTestUser(emailA, password);
    userAId = a.id;
    clientA = await signInAs(emailA, password);
  });

  afterAll(async () => {
    if (userAId) await deleteTestUser(userAId);
  });

  // covers: AC-083-3
  it("updateProfileLocale('de') (fuori allowlist) da utente autenticato → 400 e nessuna scrittura", async () => {
    clientHolder.current = clientA;
    // A è appena creato: auto-provision → locale 'it'.
    const before = await adminClient()
      .from('profiles')
      .select('locale')
      .eq('id', userAId)
      .single();
    expect(before.data?.locale).toBe('it');

    const res = await updateProfileLocale('de');
    expect(res.ok).toBe(false); // covers: AC-083-3
    if (res.ok) throw new Error('un locale fuori allowlist non doveva essere accettato');
    expect(res.status).toBe(400); // covers: AC-083-3

    // Nessuna scrittura: il locale di A è invariato.
    const after = await adminClient()
      .from('profiles')
      .select('locale')
      .eq('id', userAId)
      .single();
    expect(after.data?.locale).toBe('it'); // covers: AC-083-3
  });

  // covers: AC-083-5
  it("con profiles.locale='es' e nessun cookie NEXT_LOCALE, resolveInitialLocale risolve 'es'", async () => {
    // Precondizione: la preferenza di A su DB è 'es'.
    await adminClient().from('profiles').update({ locale: 'es' }).eq('id', userAId);
    clientHolder.current = clientA;
    cookieHolder.nextLocale = undefined; // nessun cookie NEXT_LOCALE

    // Anche partendo da un URL /it, in assenza di cookie la preferenza su profiles vince.
    const resolved = await resolveInitialLocale('it');
    expect(resolved).toBe('es'); // covers: AC-083-5
  });

  it('quando il cookie NEXT_LOCALE è presente e valido, ha precedenza sul profilo', async () => {
    // Precedenza dichiarata: cookie > profilo > URL. Con il cookie 'it' presente,
    // resolveInitialLocale non consulta il profilo (che qui è 'es').
    clientHolder.current = clientA;
    cookieHolder.nextLocale = 'it';
    const resolved = await resolveInitialLocale('es');
    expect(resolved).toBe('it');
    cookieHolder.nextLocale = undefined;
  });
});
