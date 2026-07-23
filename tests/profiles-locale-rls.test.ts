import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  adminClient,
  createTestUser,
  signInAs,
  deleteTestUser,
} from './helpers/supabase-test';

// T-083 — updateProfileLocale RUNTIME contro il Supabase locale. La scrittura passa
// dal client Supabase con la sessione dell'utente (RLS attiva), MAI la service_role:
// l'isolamento (AC-083-2) è imposto dalla RLS di profiles (UPDATE vincolata a
// id = auth.uid()) e provato con client ad auth reale — mai nell'SQL editor.
// Mockiamo SOLO la costruzione del client SSR, iniettando il client di A o un
// client anonimo senza sessione.

const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { clientHolder } = vi.hoisted(() => ({
  clientHolder: { current: null as SupabaseClient | null },
}));
vi.mock('@/data/supabase-ssr', () => ({
  createServerSupabaseClient: async () => clientHolder.current,
}));

import { updateProfileLocale } from '@/data/updateProfileLocale';

describe.skipIf(!SB)('T-083 updateProfileLocale (runtime, Supabase locale)', () => {
  const password = 'Password123!';
  const emailA = `t083a_${randomUUID()}@example.test`;
  const emailB = `t083b_${randomUUID()}@example.test`;
  let userAId = '';
  let userBId = '';
  let clientA: SupabaseClient;
  let anon: SupabaseClient;

  beforeAll(async () => {
    const a = await createTestUser(emailA, password);
    const b = await createTestUser(emailB, password);
    userAId = a.id;
    userBId = b.id;
    clientA = await signInAs(emailA, password);
    anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  });

  afterAll(async () => {
    if (userAId) await deleteTestUser(userAId);
    if (userBId) await deleteTestUser(userBId);
  });

  // covers: AC-083-1
  it("A aggiorna la propria preferenza: profiles.locale di A diventa 'es'", async () => {
    clientHolder.current = clientA;
    const res = await updateProfileLocale('es');
    expect(res.ok).toBe(true); // covers: AC-083-1

    // Oracolo service_role: la riga di A ha locale='es'.
    const { data } = await adminClient()
      .from('profiles')
      .select('locale')
      .eq('id', userAId)
      .single();
    expect(data?.locale).toBe('es'); // covers: AC-083-1
  });

  // covers: AC-083-2
  it("A non può cambiare il locale della riga di B: l'update RLS colpisce 0 righe, il locale di B resta invariato", async () => {
    // Stato di B PRIMA (oracolo service_role): auto-provision → locale 'it'.
    const before = await adminClient()
      .from('profiles')
      .select('locale')
      .eq('id', userBId)
      .single();
    expect(before.data?.locale).toBe('it');

    // A (client auth reale) tenta di aggiornare la riga di B con un locale VALIDO
    // ('es'): la rejection è quindi attribuibile alla RLS, non al CHECK.
    const { data: updated, error } = await clientA
      .from('profiles')
      .update({ locale: 'es' })
      .eq('id', userBId)
      .select();
    expect(error).toBeNull(); // covers: AC-083-2
    expect(updated ?? []).toHaveLength(0); // covers: AC-083-2 — RLS filtra a 0 righe

    // Oracolo service_role: il locale di B è invariato.
    const after = await adminClient()
      .from('profiles')
      .select('locale')
      .eq('id', userBId)
      .single();
    expect(after.data?.locale).toBe('it'); // covers: AC-083-2
  });

  // covers: AC-083-4
  it('senza sessione autenticata: updateProfileLocale ritorna 401 e nessuna riga viene modificata', async () => {
    // Stato di A PRIMA (dovrebbe essere 'es' dal test AC-083-1).
    const before = await adminClient()
      .from('profiles')
      .select('locale')
      .eq('id', userAId)
      .single();

    clientHolder.current = anon;
    const res = await updateProfileLocale('es');
    expect(res.ok).toBe(false); // covers: AC-083-4
    if (res.ok) throw new Error('updateProfileLocale senza sessione non doveva riuscire');
    expect(res.status).toBe(401); // covers: AC-083-4

    // Nessuna scrittura: il locale di A è identico a prima.
    const after = await adminClient()
      .from('profiles')
      .select('locale')
      .eq('id', userAId)
      .single();
    expect(after.data?.locale).toBe(before.data?.locale); // covers: AC-083-4
  });
});
