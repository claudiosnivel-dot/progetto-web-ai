import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  adminClient,
  createTestUser,
  signInAs,
  deleteTestUser,
} from './helpers/supabase-test';

// T-103 — Server action renameSite/deleteSite RUNTIME contro il Supabase locale.
// L'isolamento cross-tenant (AC-103-4) è imposto dalla RLS di sites e provato con
// client ad AUTH REALE (mai nell'SQL editor, che gira come superuser → falso verde).
// Mockiamo SOLO la costruzione del client SSR, iniettando il client autenticato di
// A o di B; la logica delle azioni gira per intero contro il DB locale.

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

import { renameSite, deleteSite } from '@/data/sites';

describe.skipIf(!SB)('T-103 renameSite/deleteSite (runtime, Supabase locale)', () => {
  const password = 'Password123!';
  const emailA = `t103a_${randomUUID()}@example.test`;
  const emailB = `t103b_${randomUUID()}@example.test`;
  let userAId = '';
  let userBId = '';
  let accountAId = '';
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;

  // Crea un sito nell'account di A via service_role (setup, non browser) e ne
  // ritorna l'id. Slug unico per evitare collisioni tra i test.
  async function makeSiteInA(name: string): Promise<string> {
    const { data, error } = await adminClient()
      .from('sites')
      .insert({ account_id: accountAId, name, slug: `s-${randomUUID()}` })
      .select('id')
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  beforeAll(async () => {
    const a = await createTestUser(emailA, password);
    const b = await createTestUser(emailB, password);
    userAId = a.id;
    userBId = b.id;
    const { data: accA } = await adminClient()
      .from('accounts')
      .select('id')
      .eq('owner_id', userAId)
      .single();
    accountAId = accA!.id as string;

    clientA = await signInAs(emailA, password);
    clientB = await signInAs(emailB, password);
  });

  afterAll(async () => {
    if (userAId) await deleteTestUser(userAId);
    if (userBId) await deleteTestUser(userBId);
  });

  // covers: AC-103-1
  it("A rinomina il proprio sito con un name valido → name aggiornato, esito success", async () => {
    const siteId = await makeSiteInA('Nome Originale');
    clientHolder.current = clientA;
    const res = await renameSite(siteId, 'Nuovo Nome');
    expect(res.ok).toBe(true); // covers: AC-103-1

    const { data } = await adminClient()
      .from('sites')
      .select('name')
      .eq('id', siteId)
      .single();
    expect(data?.name).toBe('Nuovo Nome'); // covers: AC-103-1
  });

  // covers: AC-103-2
  it("A rinomina con name di soli spazi → validazione rifiuta (400), name invariato", async () => {
    const siteId = await makeSiteInA('Resta Cosi');
    clientHolder.current = clientA;
    const res = await renameSite(siteId, '   ');
    expect(res.ok).toBe(false); // covers: AC-103-2
    if (res.ok) throw new Error('renameSite avrebbe dovuto rifiutare');
    expect(res.status).toBe(400); // covers: AC-103-2

    const { data } = await adminClient()
      .from('sites')
      .select('name')
      .eq('id', siteId)
      .single();
    expect(data?.name).toBe('Resta Cosi'); // covers: AC-103-2
  });

  // covers: AC-103-3
  it("A elimina il proprio sito → una select su S restituisce insieme vuoto", async () => {
    const siteId = await makeSiteInA('Da Eliminare');
    clientHolder.current = clientA;
    const res = await deleteSite(siteId);
    expect(res.ok).toBe(true); // covers: AC-103-3

    const { data } = await adminClient()
      .from('sites')
      .select('id')
      .eq('id', siteId);
    expect(data ?? []).toHaveLength(0); // covers: AC-103-3
  });

  // covers: AC-103-4
  it("B (non membro dell account di A) non può rinominare né eliminare il sito S di A: S resta invariato", async () => {
    const siteId = await makeSiteInA('Sito di A');
    clientHolder.current = clientB;

    const rename = await renameSite(siteId, 'Hack');
    const del = await deleteSite(siteId);
    // La RLS filtra a 0 righe: le azioni non sollevano, ma non hanno effetto.
    // (L'esito ok/!ok non è l'oracolo: lo è lo stato del DB verificato sotto.)
    expect(typeof rename.ok).toBe('boolean'); // covers: AC-103-4
    expect(typeof del.ok).toBe('boolean'); // covers: AC-103-4

    // Oracolo service_role: S esiste ancora con il name originale.
    const { data } = await adminClient()
      .from('sites')
      .select('name')
      .eq('id', siteId)
      .single();
    expect(data?.name).toBe('Sito di A'); // covers: AC-103-4 — non rinominato né eliminato
    expect(data?.name).not.toBe('Hack'); // covers: AC-103-4
  });
});
