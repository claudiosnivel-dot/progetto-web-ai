import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
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

  // ── Rafforzamenti dall'audit degli oracoli (schema A) ───────────────────────
  // Rilievo S45-01: in TUTTO il repo nessun test eseguiva un .delete() come utente non
  // autorizzato, quindi neutralizzare la policy site_briefs_delete_member (es. in
  // `using (account_id is not null)`, che lascia cancellare il brief di qualunque
  // account) lasciava 35 test su 35 verdi. Nessuna server action cancella brief: la
  // policy si esercita percio' con i client autenticati gia costruiti nel beforeAll,
  // senza nuovi sign-in (rate limit auth).

  // Crea, via service_role (setup, mai browser), un nuovo sito dell'account di A con il
  // suo brief 1:1, e ne ritorna gli id. Serve alle fixture a PIU DI UN ELEMENTO qui
  // sotto: il vincolo 1:1 di site_briefs e per-SITO, non per-account, quindi due siti di
  // A hanno due brief distinti nella STESSA tabella — il testimone e possibile senza
  // uscire da site_briefs.
  async function makeSiteWithBriefInA(
    businessName: string,
  ): Promise<{ siteId: string; briefId: string }> {
    const admin = adminClient();
    const { data: site, error: siteErr } = await admin
      .from('sites')
      .insert({
        account_id: accountAId,
        name: `Sito ${businessName}`,
        slug: `s-${randomUUID()}`,
      })
      .select('id')
      .single();
    if (siteErr) throw siteErr;
    const siteId = site!.id as string;

    const { data: brief, error: briefErr } = await admin
      .from('site_briefs')
      .insert({
        account_id: accountAId,
        site_id: siteId,
        business_name: businessName,
        locale: 'it',
      })
      .select('id')
      .single();
    if (briefErr) throw briefErr;
    return { siteId, briefId: brief!.id as string };
  }

  // covers: AC-123-6 (isolamento cross-tenant in scrittura) — esteso al comando DELETE,
  // che nessun test esercitava.
  //
  // NOTA sull'oracolo: il "0 righe cancellate" di .delete().select() NON e l'oracolo —
  // con RLS il .select() e filtrato anche dalla policy SELECT, quindi tornerebbe vuoto
  // pure se le righe fossero state davvero cancellate. L'oracolo e il guardrail
  // service_role: le righe ESISTEVANO prima ed ESISTONO ANCORA dopo.
  //
  // Fixture a DUE righe con business_name DISCORDANTI: con una riga sola "cancella la
  // riga giusta" e "cancella tutto quello che vedo" sarebbero indistinguibili.
  it('B non puo eliminare i brief di A: le due righe esistono prima ed esistono ancora dopo (guardrail service_role)', async () => {
    const target = await makeSiteWithBriefInA('Bersaglio Cross Tenant');
    const witness = await makeSiteWithBriefInA('Testimone Cross Tenant');
    expect(target.briefId).not.toBe(witness.briefId); // covers: AC-123-6
    expect(target.siteId).not.toBe(witness.siteId); // covers: AC-123-6

    // Guardrail service_role PRIMA: i dati ESISTONO (il verde non puo derivare da
    // dati assenti).
    const admin = adminClient();
    const before = await admin
      .from('site_briefs')
      .select('id, business_name')
      .in('id', [target.briefId, witness.briefId]);
    expect(before.error).toBeNull(); // covers: AC-123-6
    expect(before.data ?? []).toHaveLength(2); // covers: AC-123-6

    // DELETE ESEGUITO DAVVERO come utente autenticato di un ALTRO account (JWT reale,
    // ruolo authenticated, RLS attiva): mirato sul bersaglio...
    const targeted = await clientB
      .from('site_briefs')
      .delete()
      .eq('site_id', target.siteId)
      .select();
    expect(targeted.error).toBeNull(); // covers: AC-123-6
    expect(targeted.data ?? []).toHaveLength(0); // covers: AC-123-6 — indizio, non oracolo

    // ...e "tutto quello che vedo" sull'account di A: se la policy DELETE cadesse,
    // questo spazzerebbe via entrambe le righe.
    const sweep = await clientB
      .from('site_briefs')
      .delete()
      .eq('account_id', accountAId)
      .select();
    expect(sweep.error).toBeNull(); // covers: AC-123-6
    expect(sweep.data ?? []).toHaveLength(0); // covers: AC-123-6 — indizio, non oracolo

    // Anche senza sessione (client anonimo, nessun GRANT su site_briefs): nulla cancellato.
    const anonDel = await anon
      .from('site_briefs')
      .delete()
      .eq('site_id', target.siteId)
      .select();
    expect(anonDel.data ?? []).toHaveLength(0); // covers: AC-123-5 — indizio, non oracolo

    // ORACOLO — guardrail service_role DOPO: entrambe le righe ci sono ancora, con il
    // loro account_id e il loro business_name.
    const after = await admin
      .from('site_briefs')
      .select('id, account_id, business_name')
      .in('id', [target.briefId, witness.briefId]);
    expect(after.error).toBeNull(); // covers: AC-123-6
    expect(after.data ?? []).toHaveLength(2); // covers: AC-123-6
    const byId = new Map(
      (after.data ?? []).map((r) => [r.id as string, r as { account_id: string; business_name: string }]),
    );
    expect(byId.get(target.briefId)?.business_name).toBe('Bersaglio Cross Tenant'); // covers: AC-123-6
    expect(byId.get(witness.briefId)?.business_name).toBe('Testimone Cross Tenant'); // covers: AC-123-6
    expect(byId.get(target.briefId)?.account_id).toBe(accountAId); // covers: AC-123-6
    expect(byId.get(witness.briefId)?.account_id).toBe(accountAId); // covers: AC-123-6
  });

  // Percorso POSITIVO della stessa policy (nessun AC copre la cancellazione di un
  // brief: lo si dichiara qui invece di inventare un id). Serve a due cose:
  //  1. distinguere "la policy DELETE isola i tenant" da "la policy DELETE non esiste":
  //     senza questo, rimuovere del tutto la policy resterebbe verde;
  //  2. pinnare il RAGGIO D'AZIONE della cancellazione — si cancella la riga bersaglio
  //     e il TESTIMONE (brief di un ALTRO sito dello STESSO account, business_name
  //     discordante) deve sopravvivere con il suo id e il suo valore.
  it('A elimina UN suo brief: la riga bersaglio sparisce e il brief testimone dello stesso account resta intatto', async () => {
    const target = await makeSiteWithBriefInA('Brief Da Cancellare');
    const witness = await makeSiteWithBriefInA('Brief Testimone');
    expect(target.briefId).not.toBe(witness.briefId);

    // Guardrail service_role PRIMA: entrambe le righe esistono.
    const admin = adminClient();
    const before = await admin
      .from('site_briefs')
      .select('id, business_name')
      .in('id', [target.briefId, witness.briefId]);
    expect(before.error).toBeNull();
    expect(before.data ?? []).toHaveLength(2);

    // DELETE eseguito dal proprietario legittimo (JWT reale, RLS attiva).
    const del = await clientA
      .from('site_briefs')
      .delete()
      .eq('site_id', target.siteId)
      .select('id');
    expect(del.error).toBeNull();
    expect(del.data ?? []).toHaveLength(1); // la policy DELETE consente il proprietario
    expect(del.data?.[0].id).toBe(target.briefId);

    // ORACOLO service_role DOPO: sparita SOLO la riga bersaglio; il testimone e ancora
    // li con il suo business_name.
    const after = await admin
      .from('site_briefs')
      .select('id, business_name')
      .in('id', [target.briefId, witness.briefId]);
    expect(after.error).toBeNull();
    expect(after.data ?? []).toHaveLength(1);
    expect(after.data?.[0].id).toBe(witness.briefId);
    expect(after.data?.[0].business_name).toBe('Brief Testimone');

    // Il sito del brief cancellato NON e stato toccato (la FK composita cascata dal
    // sito al brief, non viceversa).
    const site = await admin.from('sites').select('id').eq('id', target.siteId);
    expect(site.data ?? []).toHaveLength(1);
  });

  // L'UNICA forma in cui site_briefs_delete_member e l'ULTIMA linea di difesa, MISURATA:
  // attraverso PostgREST ogni DELETE porta un WHERE (un .delete() senza filtri e respinto
  // con 400 "DELETE requires a WHERE clause") e il WHERE, nominando colonne della tabella,
  // obbliga Postgres ad applicare anche la policy SELECT alla riga esistente — percio' con
  // site_briefs_select_member integra, neutralizzare la SOLA policy DELETE (perfino in
  // `using (true)`) lascia 0 righe cancellate. Resta il DELETE NUDO (nessun WHERE, nessun
  // RETURNING), che solo una connessione SQL diretta puo emettere (pooler, job, futura
  // edge function): li la policy SELECT non entra e la policy DELETE e il solo gate.
  // Ruolo emulato come fa PostgREST (request.jwt.claims + role authenticated): RLS ATTIVA
  // e auth.uid() reale, MAI superuser. Transazione annullata: l'oracolo e il numero di
  // righe che sarebbero sparite, letto prima del rollback.
  it.skipIf(!process.env.DATABASE_URL)(
    'DELETE nudo su site_briefs: come utente di un altro account cancella 0 righe, come membro cancella i propri (la RLS e attiva davvero)',
    async () => {
      await makeSiteWithBriefInA('Brief Delete Nudo Uno');
      await makeSiteWithBriefInA('Brief Delete Nudo Due');

      // Guardrail service_role PRIMA: ci sono righe da perdere (senza dati, "0 righe
      // cancellate" non proverebbe nulla).
      const before = await adminClient()
        .from('site_briefs')
        .select('id')
        .eq('account_id', accountAId);
      expect(before.error).toBeNull();
      const nA = (before.data ?? []).length;
      expect(nA).toBeGreaterThanOrEqual(2);

      const bareDeleteBriefsAs = async (userId: string): Promise<number> => {
        const conn = new Client({ connectionString: process.env.DATABASE_URL });
        await conn.connect();
        try {
          await conn.query('begin');
          await conn.query(
            "select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)",
            [JSON.stringify({ sub: userId, role: 'authenticated' })],
          );
          const affected = (await conn.query('delete from public.site_briefs')).rowCount ?? -1;
          await conn.query('rollback');
          return affected;
        } finally {
          await conn.end();
        }
      };

      // B non e membro dell'account di A: nessun brief qualifica per la policy DELETE.
      expect(await bareDeleteBriefsAs(userBId)).toBe(0);

      // Controprova che l'emulazione del ruolo FUNZIONA e che la RLS non e spenta ne
      // cieca: lo stesso DELETE, come membro, colpisce esattamente i brief del proprio
      // account (se auth.uid() non arrivasse darebbe 0; se il ruolo restasse superuser la
      // RLS sarebbe bypassata e ne colpirebbe di piu').
      expect(await bareDeleteBriefsAs(userAId)).toBe(nA);

      // Guardrail service_role DOPO: i brief di A sono tutti ancora li (rollback).
      const after = await adminClient()
        .from('site_briefs')
        .select('id')
        .eq('account_id', accountAId);
      expect((after.data ?? []).length).toBe(nA);
    },
  );
});
