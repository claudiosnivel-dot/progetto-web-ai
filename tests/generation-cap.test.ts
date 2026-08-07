import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { adminClient, createTestUser, signInAs, deleteTestUser } from './helpers/supabase-test';
import { getDailyGenerationCap } from '@/config/env';

// (deploy pass) T-4 — CAP GIORNALIERO delle generazioni (cintura di costo). Due pezzi:
// il parsing del tetto (getDailyGenerationCap, puro) e il conteggio RLS-scoped
// (countGenerationsSince, runtime contro il Supabase locale) su cui la rotta /api/generate
// decide il 429.

// ── parsing del tetto (puro) ──────────────────────────────────────────────────
describe('T-4 getDailyGenerationCap', () => {
  it('assente/vuota => default 20', () => {
    expect(getDailyGenerationCap({})).toBe(20);
    expect(getDailyGenerationCap({ GENERATION_DAILY_CAP: '' })).toBe(20);
    expect(getDailyGenerationCap({ GENERATION_DAILY_CAP: '   ' })).toBe(20);
  });

  it('intero >= 0 valido => quel valore (0 = pausa totale, legittima)', () => {
    expect(getDailyGenerationCap({ GENERATION_DAILY_CAP: '5' })).toBe(5);
    expect(getDailyGenerationCap({ GENERATION_DAILY_CAP: ' 12 ' })).toBe(12);
    expect(getDailyGenerationCap({ GENERATION_DAILY_CAP: '0' })).toBe(0);
  });

  it('valore storto (negativo, non-numero, non-intero) => default (non spalanca ne blocca)', () => {
    expect(getDailyGenerationCap({ GENERATION_DAILY_CAP: '-3' })).toBe(20);
    expect(getDailyGenerationCap({ GENERATION_DAILY_CAP: 'abc' })).toBe(20);
    expect(getDailyGenerationCap({ GENERATION_DAILY_CAP: '1.5' })).toBe(20);
  });
});

// ── conteggio RLS-scoped (runtime, Supabase locale) ───────────────────────────
const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { clientHolder } = vi.hoisted(() => ({ clientHolder: { current: null as SupabaseClient | null } }));
vi.mock('@/data/supabase-ssr', () => ({
  createServerSupabaseClient: async () => clientHolder.current,
}));

import { countGenerationsSince } from '@/data/generations';

const ORA_MS = 60 * 60 * 1000;

describe.skipIf(!SB)('T-4 countGenerationsSince (runtime, Supabase locale)', () => {
  const password = 'Password123!';
  const suffisso = randomUUID().slice(0, 8);
  const emailA = `t4a_${randomUUID()}@example.test`;
  const emailB = `t4b_${randomUUID()}@example.test`;
  let userAId = '';
  let userBId = '';
  let clientA: SupabaseClient;
  let anon: SupabaseClient;

  async function seedGen(accountId: string, siteId: string, etaMs: number): Promise<void> {
    const quando = new Date(Date.now() - etaMs).toISOString();
    const { error } = await adminClient()
      .from('site_generations')
      .insert({
        account_id: accountId,
        site_id: siteId,
        status: 'ready', // mai 'generating' => nessun conflitto con l'indice UNIQUE parziale
        max_pages: 5,
        document: null,
        chosen_variant: null,
        created_at: quando,
        updated_at: quando,
      });
    if (error) throw error;
  }

  beforeAll(async () => {
    const a = await createTestUser(emailA, password);
    const b = await createTestUser(emailB, password);
    userAId = a.id;
    userBId = b.id;

    const admin = adminClient();
    const { data: accA } = await admin.from('accounts').select('id').eq('owner_id', userAId).single();
    const { data: accB } = await admin.from('accounts').select('id').eq('owner_id', userBId).single();
    const accountAId = accA!.id as string;
    const accountBId = accB!.id as string;

    const { data: siteA } = await admin
      .from('sites')
      .insert({ account_id: accountAId, name: 'cap-a', slug: `cap-a-${suffisso}` })
      .select('id')
      .single();
    const { data: siteB } = await admin
      .from('sites')
      .insert({ account_id: accountBId, name: 'cap-b', slug: `cap-b-${suffisso}` })
      .select('id')
      .single();

    // Account A: DUE recenti (1h fa) + UNA vecchia (48h fa). Account B: UNA recente (1h fa),
    // che la RLS deve tenere FUORI dal conteggio di A.
    await seedGen(accountAId, siteA!.id as string, 1 * ORA_MS);
    await seedGen(accountAId, siteA!.id as string, 1 * ORA_MS);
    await seedGen(accountAId, siteA!.id as string, 48 * ORA_MS);
    await seedGen(accountBId, siteB!.id as string, 1 * ORA_MS);

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

  it('conta SOLO le generazioni del proprio account create dopo la soglia (recenti), isolate per tenant', async () => {
    clientHolder.current = clientA;
    const since24 = new Date(Date.now() - 24 * ORA_MS).toISOString();
    const res = await countGenerationsSince(since24);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('countGenerationsSince fallita');
    // 2 recenti di A; la vecchia (48h) esclusa dalla soglia; quella di B esclusa dalla RLS.
    expect(res.count).toBe(2);
  });

  it('con una soglia piu ampia (72h) conta TUTTE e sole le generazioni di A', async () => {
    clientHolder.current = clientA;
    const since72 = new Date(Date.now() - 72 * ORA_MS).toISOString();
    const res = await countGenerationsSince(since72);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('countGenerationsSince (72h) fallita');
    expect(res.count).toBe(3); // 2 recenti + 1 vecchia, mai quella di B
  });

  it('senza sessione: 401', async () => {
    clientHolder.current = anon;
    const res = await countGenerationsSince(new Date(0).toISOString());
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('countGenerationsSince senza sessione non doveva riuscire');
    expect(res.status).toBe(401);
  });
});
