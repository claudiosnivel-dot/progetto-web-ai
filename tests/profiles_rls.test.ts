import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTestUser, signInAs, deleteTestUser, adminClient } from './helpers/supabase-test';

// T-061 — RLS runtime di public.profiles ATTRAVERSO il client con auth reale.
// AC-061-5: due utenti reali A e B (le righe profiles esistono GIA', create
// dall'auto-provision del trigger T-062 → MAI insert manuale, niente conflitto PK).
// A vede SOLO la propria riga e non puo aggiornare la riga di B.
// Guardrail service_role (bypassa la RLS): l'admin VEDE la riga di B → un eventuale
// "0 righe" lato client A prova l'isolamento della RLS, non l'assenza di dati.
// Sign-in una sola volta per utente (rate limit auth); i client sono riusati.

const SB = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe.skipIf(!SB)('T-061 profiles RLS (runtime, Supabase locale)', () => {
  const password = 'Password123!';
  const emailA = `t061a_${randomUUID()}@example.test`;
  const emailB = `t061b_${randomUUID()}@example.test`;
  let userAId = '';
  let userBId = '';
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;

  beforeAll(async () => {
    // Ogni utente e creato UNA volta; l'auto-provision (T-062) crea gia la riga
    // profiles corrispondente. Nessuna insert manuale (eviterebbe il conflitto PK).
    const a = await createTestUser(emailA, password);
    const b = await createTestUser(emailB, password);
    userAId = a.id;
    userBId = b.id;
    clientA = await signInAs(emailA, password);
    clientB = await signInAs(emailB, password);
  });

  afterAll(async () => {
    if (userAId) await deleteTestUser(userAId);
    if (userBId) await deleteTestUser(userBId);
  });

  it('guardrail: la riga profiles di B esiste davvero (vista dal service_role)', async () => {
    // covers: AC-061-5
    // Il service_role bypassa la RLS: se vede la riga di B, il successivo "0 righe"
    // lato client A provera l'isolamento della RLS e non la semplice assenza di dati.
    const { data, error } = await adminClient().from('profiles').select('id').eq('id', userBId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].id).toBe(userBId);
  });

  it('B (autenticato) vede la propria riga profiles: la policy non e un deny cieco', async () => {
    // covers: AC-061-5
    // Controllo positivo: il verde di A non deriva da una policy che nega tutto.
    const { data, error } = await clientB.from('profiles').select('id');
    expect(error).toBeNull();
    expect(data?.map((r) => r.id)).toContain(userBId);
  });

  it('A vede SOLO la propria riga e la riga di B e assente', async () => {
    // covers: AC-061-5
    const { data, error } = await clientA.from('profiles').select('id');
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).toContain(userAId);
    expect(ids).not.toContain(userBId);
    expect(data).toHaveLength(1);
  });

  it('A non legge la riga di B nemmeno filtrando per id (0 righe via RLS)', async () => {
    // covers: AC-061-5
    const { data, error } = await clientA.from('profiles').select('id').eq('id', userBId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it('A non puo aggiornare la riga di B: 0 righe modificate e riga di B invariata', async () => {
    // covers: AC-061-5
    // Stato di B PRIMA (oracolo service_role).
    const before = await adminClient()
      .from('profiles')
      .select('display_name')
      .eq('id', userBId)
      .single();
    expect(before.error).toBeNull();

    // A tenta l'update della riga di B: la USING della policy filtra la riga →
    // 0 righe restituite dal .select() (nessun errore, semplicemente niente match).
    const { data: updated, error } = await clientA
      .from('profiles')
      .update({ display_name: 'hacked-by-A' })
      .eq('id', userBId)
      .select();
    expect(error).toBeNull();
    expect(updated).toHaveLength(0);

    // Verifica via service_role: la riga di B e rimasta invariata.
    const after = await adminClient()
      .from('profiles')
      .select('display_name')
      .eq('id', userBId)
      .single();
    expect(after.error).toBeNull();
    expect(after.data?.display_name).toBe(before.data?.display_name);
    expect(after.data?.display_name).not.toBe('hacked-by-A');
  });
});
