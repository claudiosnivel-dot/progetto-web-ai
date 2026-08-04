import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, createTestUser, signInAs, deleteTestUser } from './helpers/supabase-test';

// T-230 (SEC) — markReady/markFailed COME COMPARE-AND-SET da 'generating', RUNTIME contro il
// Supabase locale. Le due transizioni della fase 1 (AC-230-7): la riga non resta MAI 'generating'
// in modo incoerente, e nessuna transizione parte da uno stato diverso da 'generating'. Le
// proprieta' misurate qui:
//  - da 'generating' la transizione RIESCE, cambia lo status e TOCCA `updated_at` (la prova di
//    vita: senza, la riga invecchierebbe e la riconciliazione P2-D15 la ucciderebbe da viva);
//  - da 'ready'/'failed' la transizione e' un NO-OP: torna ok:false (409) e NON tocca la riga —
//    ne' lo status, ne' `updated_at`, ne' `failure_reason`. E' il probe del CAS: una mutazione che
//    togliesse `.eq('status','generating')` renderebbe questi no-op delle scritture, e la riga
//    'ready'/'failed' verrebbe toccata (o addirittura ri-transizionata).
//
// Stessa forma di generations-write-actions: si mocka SOLO createServerSupabaseClient con un
// client ad AUTH REALE (RLS ATTIVA). La service_role e' l'ORACOLO INDIPENDENTE (adminClient) che
// rilegge la riga senza passare da nessuna delle azioni sotto test.

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

import { markReady, markFailed } from '@/data/generations';

const ORA_MS = 60 * 60 * 1000;
// Eta fissa delle fixture: un'ora. Serve a rendere MISURABILE l'avanzamento di `updated_at` sul
// ramo riuscito, e la sua IMMOBILITA' sul ramo no-op.
const ETA_FIXTURE = ORA_MS;

describe.skipIf(!SB)('T-230 markReady/markFailed CAS da generating (runtime, Supabase locale)', () => {
  const password = 'Password123!';
  const suffisso = randomUUID().slice(0, 8);
  const emailA = `t230cas_${randomUUID()}@example.test`;
  let userAId = '';
  let accountAId = '';
  let clientA: SupabaseClient;

  // Fixture DEDICATE, una per esito, con stati DISCORDANTI: uno stato condiviso fra due test
  // renderebbe l'esito attribuibile a due cause.
  let gGenReady = ''; // 'generating' → markReady RIESCE
  let gGenFailed = ''; // 'generating' → markFailed RIESCE
  let gReadyNoopReady = ''; // 'ready'    → markReady NO-OP (probe del CAS)
  let gReadyNoopFailed = ''; // 'ready'   → markFailed NO-OP (probe del CAS)
  let gFailedNoop = ''; // 'failed'       → markReady NO-OP (un'altra partenza terminale)

  async function creaSito(slug: string): Promise<string> {
    const { data, error } = await adminClient()
      .from('sites')
      .insert({ account_id: accountAId, name: slug, slug: `${slug}-${suffisso}` })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async function creaGenerazione(slug: string, status: string): Promise<string> {
    const siteId = await creaSito(slug);
    const quando = new Date(Date.now() - ETA_FIXTURE).toISOString();
    const { data, error } = await adminClient()
      .from('site_generations')
      .insert({
        account_id: accountAId,
        site_id: siteId,
        status,
        max_pages: 8,
        created_at: quando,
        updated_at: quando,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  type Istantanea = { status: string; failure_reason: string | null; updated_at: string };
  async function istantanea(generationId: string): Promise<Istantanea> {
    const { data, error } = await adminClient()
      .from('site_generations')
      .select('status, failure_reason, updated_at')
      .eq('id', generationId)
      .single();
    if (error) throw error;
    return data as Istantanea;
  }

  beforeAll(async () => {
    const a = await createTestUser(emailA, password);
    userAId = a.id;
    const admin = adminClient();
    const { data: accA } = await admin.from('accounts').select('id').eq('owner_id', userAId).single();
    accountAId = accA!.id as string;

    gGenReady = await creaGenerazione('cas-gen-ready', 'generating');
    gGenFailed = await creaGenerazione('cas-gen-failed', 'generating');
    gReadyNoopReady = await creaGenerazione('cas-ready-noop-r', 'ready');
    gReadyNoopFailed = await creaGenerazione('cas-ready-noop-f', 'ready');
    gFailedNoop = await creaGenerazione('cas-failed-noop', 'failed');

    clientA = await signInAs(emailA, password);
  });

  afterAll(async () => {
    if (userAId) await deleteTestUser(userAId);
  });

  // covers: AC-230-7
  it("markReady da 'generating' RIESCE: status→ready e updated_at avanzato", async () => {
    clientHolder.current = clientA;
    const prima = await istantanea(gGenReady);

    const res = await markReady(gGenReady);
    expect(res.ok).toBe(true); // covers: AC-230-7

    const dopo = await istantanea(gGenReady);
    expect(dopo.status).toBe('ready'); // covers: AC-230-7
    // La prova di vita: `updated_at` e' stato TOCCATO (avanzato oltre il valore di fixture).
    expect(Date.parse(dopo.updated_at)).toBeGreaterThan(Date.parse(prima.updated_at)); // covers: AC-230-7
  });

  // covers: AC-230-7
  it("markFailed da 'generating' RIESCE: status→failed, failure_reason nominato, updated_at avanzato", async () => {
    clientHolder.current = clientA;
    const prima = await istantanea(gGenFailed);

    const res = await markFailed(gGenFailed, 'confine_in_errore');
    expect(res.ok).toBe(true); // covers: AC-230-7

    const dopo = await istantanea(gGenFailed);
    expect(dopo.status).toBe('failed'); // covers: AC-230-7
    expect(dopo.failure_reason).toBe('confine_in_errore'); // covers: AC-230-7 — motivo NOMINATO
    expect(Date.parse(dopo.updated_at)).toBeGreaterThan(Date.parse(prima.updated_at)); // covers: AC-230-7
  });

  // covers: AC-230-7
  // PROBE del CAS: da 'ready' markReady non ha nulla da fare. Deve tornare ok:false e NON toccare
  // la riga. Se il filtro `.eq('status','generating')` sparisse, la riga verrebbe toccata.
  it("markReady da 'ready' e un NO-OP: ok:false e la riga NON e toccata", async () => {
    clientHolder.current = clientA;
    const prima = await istantanea(gReadyNoopReady);

    const res = await markReady(gReadyNoopReady);
    expect(res.ok).toBe(false); // covers: AC-230-7

    const dopo = await istantanea(gReadyNoopReady);
    expect(dopo.status).toBe('ready'); // covers: AC-230-7 — invariata
    expect(dopo.updated_at).toBe(prima.updated_at); // covers: AC-230-7 — NON ringiovanita
    expect(dopo.failure_reason).toBeNull(); // covers: AC-230-7
  });

  // covers: AC-230-7
  // PROBE del CAS simmetrico: da 'ready' markFailed non parte (CAS da 'generating'), e la riga
  // resta 'ready' — non 'failed'. Un CAS assente scriverebbe 'failed' su una riga viva.
  it("markFailed da 'ready' e un NO-OP: ok:false, la riga resta 'ready' e non 'failed'", async () => {
    clientHolder.current = clientA;
    const prima = await istantanea(gReadyNoopFailed);

    const res = await markFailed(gReadyNoopFailed, 'confine_in_errore');
    expect(res.ok).toBe(false); // covers: AC-230-7

    const dopo = await istantanea(gReadyNoopFailed);
    expect(dopo.status).toBe('ready'); // covers: AC-230-7 — non e' stata portata a 'failed'
    expect(dopo.updated_at).toBe(prima.updated_at); // covers: AC-230-7
    expect(dopo.failure_reason).toBeNull(); // covers: AC-230-7 — nessun motivo scritto
  });

  // covers: AC-230-7
  it("markReady da 'failed' e un NO-OP: ok:false e la riga resta 'failed', intatta", async () => {
    clientHolder.current = clientA;
    const prima = await istantanea(gFailedNoop);

    const res = await markReady(gFailedNoop);
    expect(res.ok).toBe(false); // covers: AC-230-7

    const dopo = await istantanea(gFailedNoop);
    expect(dopo.status).toBe('failed'); // covers: AC-230-7 — una riga a riposo non torna viva
    expect(dopo.updated_at).toBe(prima.updated_at); // covers: AC-230-7
  });
});
