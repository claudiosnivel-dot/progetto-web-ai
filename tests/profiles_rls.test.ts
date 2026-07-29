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

  // ── DELETE su profiles esercitato come utente autenticato ───────────────────
  // profiles NON ha alcuna policy DELETE, ma la migrazione concede
  // "grant select, insert, update, delete ... to authenticated": la proprieta
  // "nessun utente autenticato cancella righe profilo" regge SOLO sul default-deny
  // della RLS. Prima di questi test nessun .delete() del repo colpiva profiles.
  // Metodo, per ognuno: guardrail service_role (la riga esisteva PRIMA ed esiste
  // ancora DOPO — un "0 righe" da solo non distingue la RLS dai dati assenti) e
  // fixture di DUE righe con id DISCORDANTI (A e B).
  // Asserire error === null (e non 42501) dimostra che il DELETE raggiunge davvero
  // la tabella (il GRANT c'e) e che a fermarlo e il default-deny, non un privilegio.
  // Nessun sign-in nuovo: si riusa clientA del beforeAll (rate limit auth).

  // Stato delle due righe profilo letto via service_role (bypassa la RLS), come
  // chiave stabile e ordinata: confrontabile con toEqual senza dipendere dall'ordine.
  const profileRows = async (): Promise<string[]> => {
    const { data, error } = await adminClient()
      .from('profiles')
      .select('id, display_name, locale')
      .in('id', [userAId, userBId]);
    expect(error).toBeNull();
    return (data ?? []).map((r) => `${r.id}|${r.display_name}|${r.locale}`).sort();
  };

  it('A non puo cancellare la riga profilo di B: 0 righe eliminate e la riga di B resta', async () => {
    // covers: AC-061-5 — l'AC nomina select+update; qui la STESSA proprieta di
    // isolamento provata sul DELETE. Copertura AGGIUNTIVA oltre l'AC: profiles non
    // ha policy DELETE, quindi si prova il default-deny a comportamento.
    const before = await profileRows();
    expect(before).toHaveLength(2); // due righe con id DISCORDANTI (A e B)

    const { data: deleted, error } = await clientA
      .from('profiles')
      .delete()
      .eq('id', userBId)
      .select();
    expect(error).toBeNull();
    expect(deleted ?? []).toHaveLength(0);

    // Guardrail service_role: entrambe le righe sono ancora li, invariate.
    expect(await profileRows()).toEqual(before);
  });

  it('A non puo cancellare NEMMENO la propria riga profilo: 0 righe eliminate e la riga di A resta', async () => {
    // covers: AC-061-5 — copertura AGGIUNTIVA oltre l'AC, e la parte controintuitiva:
    // profiles ha policy "own" per SELECT/INSERT/UPDATE ma NESSUNA per DELETE, e
    // l'assenza di policy non e implicitamente permissiva nemmeno verso se stessi.
    // Il verde non deriva da "riga invisibile": A VEDE la propria riga.
    const own = await clientA.from('profiles').select('id').eq('id', userAId);
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);

    const before = await profileRows();
    const { data: deleted, error } = await clientA
      .from('profiles')
      .delete()
      .eq('id', userAId)
      .select();
    expect(error).toBeNull();
    expect(deleted ?? []).toHaveLength(0);

    // Guardrail service_role: la riga di A esisteva prima ed esiste ancora dopo.
    const after = await profileRows();
    expect(after).toEqual(before);
    expect(after.some((k) => k.startsWith(`${userAId}|`))).toBe(true);
  });

  it('un delete ad ampio raggio su profiles non cancella nulla: le righe di A e B restano entrambe', async () => {
    // covers: AC-061-5 — RAGGIO D'AZIONE, copertura AGGIUNTIVA oltre l'AC: A prova a
    // colpire in un colpo solo la propria riga E quella di B. Le due righe hanno id
    // DISCORDANTI: con una riga sola "cancella quella giusta" e "cancella tutto"
    // sarebbero indistinguibili.
    const before = await profileRows();
    expect(before).toHaveLength(2);

    const { data: deleted, error } = await clientA
      .from('profiles')
      .delete()
      .in('id', [userAId, userBId])
      .select();
    expect(error).toBeNull();
    expect(deleted ?? []).toHaveLength(0);

    expect(await profileRows()).toEqual(before);
  });
});
