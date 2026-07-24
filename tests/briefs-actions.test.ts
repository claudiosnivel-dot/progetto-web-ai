import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  adminClient,
  createTestUser,
  signInAs,
  deleteTestUser,
} from './helpers/supabase-test';

// T-123 (P1) — Server action getBrief/upsertBrief/confirmBrief RUNTIME contro il
// Supabase locale. Le asserzioni derivano dagli acceptance_criteria AC-123-1..6.
//
// Come T-101: mockiamo SOLO la costruzione del client SSR (createServerSupabaseClient,
// dipendente dai cookie di next/headers non disponibili in node) con un client ad
// AUTH REALE (signInAs → JWT, ruolo authenticated, RLS ATTIVA). La logica delle azioni
// (validazione, derivazione account, ownership del sito, upsert/select con RLS) gira
// per intero contro il DB locale.

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

import { getBrief, upsertBrief, confirmBrief } from '@/data/briefs';

describe.skipIf(!SB)('T-123 getBrief/upsertBrief/confirmBrief (runtime, Supabase locale)', () => {
  const password = 'Password123!';
  const emailA = `t123a_${randomUUID()}@example.test`;
  const emailB = `t123b_${randomUUID()}@example.test`;
  let userAId = '';
  let userBId = '';
  let accountAId = '';
  let siteS = '';
  let siteNoBrief = '';
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let anon: SupabaseClient;

  beforeAll(async () => {
    const a = await createTestUser(emailA, password);
    const b = await createTestUser(emailB, password);
    userAId = a.id;
    userBId = b.id;
    const admin = adminClient();
    const { data: accA } = await admin
      .from('accounts')
      .select('id')
      .eq('owner_id', userAId)
      .single();
    accountAId = accA!.id as string;

    // Sito S dell'account A (inserito via service_role, setup — non browser).
    const { data: site } = await admin
      .from('sites')
      .insert({ account_id: accountAId, name: 'Sito A', slug: `sito-a-${randomUUID().slice(0, 8)}` })
      .select('id')
      .single();
    siteS = site!.id as string;

    // Un secondo sito di A che NON riceve mai un brief (per il caso confirmBrief → 404).
    const { data: siteNb } = await admin
      .from('sites')
      .insert({ account_id: accountAId, name: 'Sito A senza brief', slug: `sito-a-nb-${randomUUID().slice(0, 8)}` })
      .select('id')
      .single();
    siteNoBrief = siteNb!.id as string;

    clientA = await signInAs(emailA, password);
    clientB = await signInAs(emailB, password);
    anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  });

  afterAll(async () => {
    if (userAId) await deleteTestUser(userAId); // cascade accounts → sites → site_briefs
    if (userBId) await deleteTestUser(userBId);
  });

  // covers: AC-123-1
  it("A crea il brief del proprio sito: riga con account_id=X, site_id=S, business_name, status='draft'", async () => {
    clientHolder.current = clientA;
    const res = await upsertBrief(siteS, { business_name: 'Bar Sole', vertical: 'ristorazione' });
    expect(res.ok).toBe(true); // covers: AC-123-1
    if (!res.ok) throw new Error('upsertBrief fallita');

    const { data: row } = await adminClient()
      .from('site_briefs')
      .select('account_id, site_id, business_name, status')
      .eq('site_id', siteS)
      .single();
    expect(row?.account_id).toBe(accountAId); // covers: AC-123-1
    expect(row?.site_id).toBe(siteS); // covers: AC-123-1
    expect(row?.business_name).toBe('Bar Sole'); // covers: AC-123-1
    expect(row?.status).toBe('draft'); // covers: AC-123-1
  });

  // covers: AC-123-2
  it('A legge il proprio brief; B (altro account) ottiene brief null (RLS)', async () => {
    clientHolder.current = clientA;
    const own = await getBrief(siteS);
    expect(own.ok).toBe(true); // covers: AC-123-2
    if (!own.ok) throw new Error('getBrief (A) fallita');
    expect(own.brief?.business_name).toBe('Bar Sole'); // covers: AC-123-2

    clientHolder.current = clientB;
    const cross = await getBrief(siteS);
    expect(cross.ok).toBe(true); // covers: AC-123-2 — nessun errore, solo insieme vuoto
    if (!cross.ok) throw new Error('getBrief (B) fallita');
    expect(cross.brief).toBeNull(); // covers: AC-123-2 — la RLS isola per tenant
  });

  // covers: AC-123-4
  it("upsertBrief con vertical fuori allowlist → 400, nessun campo invalido scritto", async () => {
    clientHolder.current = clientA;
    const res = await upsertBrief(siteS, { vertical: 'casino' });
    expect(res.ok).toBe(false); // covers: AC-123-4
    if (res.ok) throw new Error('upsertBrief avrebbe dovuto rifiutare');
    expect(res.status).toBe(400); // covers: AC-123-4

    // Il vertical resta quello valido precedente ('ristorazione'): niente scritto.
    const { data: row } = await adminClient()
      .from('site_briefs')
      .select('vertical')
      .eq('site_id', siteS)
      .single();
    expect(row?.vertical).toBe('ristorazione'); // covers: AC-123-4
  });

  // covers: AC-123-6
  it("B non puo scrivere il brief del sito di A: 404, nessuna riga di S modificata da B", async () => {
    clientHolder.current = clientB;
    const res = await upsertBrief(siteS, { business_name: 'Hack' });
    expect(res.ok).toBe(false); // covers: AC-123-6
    if (res.ok) throw new Error('upsertBrief (B) non doveva riuscire');
    expect(res.status).toBe(404); // covers: AC-123-6 — B non vede il sito di A

    // Oracolo service_role: il brief di S appartiene ancora ad A e non e stato toccato.
    const { data: row } = await adminClient()
      .from('site_briefs')
      .select('account_id, business_name')
      .eq('site_id', siteS)
      .single();
    expect(row?.account_id).toBe(accountAId); // covers: AC-123-6
    expect(row?.business_name).toBe('Bar Sole'); // covers: AC-123-6 — non 'Hack'
  });

  // covers: AC-123-3
  it("A conferma il brief: una successiva getBrief mostra status='confirmed'", async () => {
    clientHolder.current = clientA;
    const res = await confirmBrief(siteS);
    expect(res.ok).toBe(true); // covers: AC-123-3
    if (!res.ok) throw new Error('confirmBrief fallita');

    const after = await getBrief(siteS);
    expect(after.ok).toBe(true); // covers: AC-123-3
    if (!after.ok) throw new Error('getBrief post-conferma fallita');
    expect(after.status).toBe('confirmed'); // covers: AC-123-3
  });

  // covers: AC-123-5
  it('senza sessione autenticata: get/upsert/confirm falliscono con 401, nessuna scrittura', async () => {
    clientHolder.current = anon;

    const get = await getBrief(siteS);
    expect(get.ok).toBe(false); // covers: AC-123-5
    if (get.ok) throw new Error('getBrief senza sessione non doveva riuscire');
    expect(get.status).toBe(401); // covers: AC-123-5

    const up = await upsertBrief(siteS, { business_name: 'Senza sessione' });
    expect(up.ok).toBe(false); // covers: AC-123-5
    if (up.ok) throw new Error('upsertBrief senza sessione non doveva riuscire');
    expect(up.status).toBe(401); // covers: AC-123-5

    const conf = await confirmBrief(siteS);
    expect(conf.ok).toBe(false); // covers: AC-123-5
    if (conf.ok) throw new Error('confirmBrief senza sessione non doveva riuscire');
    expect(conf.status).toBe(401); // covers: AC-123-5

    // Il brief di S non e stato sovrascritto da 'Senza sessione'.
    const { data: row } = await adminClient()
      .from('site_briefs')
      .select('business_name')
      .eq('site_id', siteS)
      .single();
    expect(row?.business_name).toBe('Bar Sole'); // covers: AC-123-5
  });

  // Rafforzamento (rilievo verifica avversariale): confirmBrief non riporta un falso
  // successo su 0 righe.
  it('confirmBrief su un sito senza brief → 404 (nessun falso successo)', async () => {
    clientHolder.current = clientA;
    const res = await confirmBrief(siteNoBrief);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('confirmBrief su sito senza brief non doveva riuscire');
    expect(res.status).toBe(404);
  });

  it('confirmBrief cross-tenant (B sul brief di A) → 404, nessuna conferma', async () => {
    clientHolder.current = clientB;
    const res = await confirmBrief(siteS);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('confirmBrief cross-tenant non doveva riuscire');
    expect(res.status).toBe(404);
  });
});
