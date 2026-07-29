import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
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

  // ── Rafforzamenti dall'audit degli oracoli (schema A) ───────────────────────
  // Due proprieta distinte, entrambe prive di oracolo prima di questi test.

  // covers: AC-103-4 — e in piu' PROVA DI COMPORTAMENTO della policy
  // sites_delete_member (rilievo S45-01): in tutto il repo nessun test eseguiva un
  // .delete() come utente NON autorizzato, quindi neutralizzare la policy DELETE di
  // sites (es. `using (account_id is not null)`, che lascia cancellare qualunque sito
  // di qualunque account) lasciava 35 test su 35 verdi.
  //
  // Fixture a DUE righe con name DISCORDANTI e id distinti generati dal DB (mai
  // derivati l'uno dall'altro): con una riga sola "cancella il bersaglio" e "cancella
  // tutto quello che vedo" sarebbero indistinguibili.
  //
  // NOTA sull'oracolo: il "0 righe cancellate" restituito da .delete().select() NON e
  // l'oracolo — con RLS, .select() e filtrato anche dalla policy SELECT, quindi
  // tornerebbe vuoto pure se le righe fossero state davvero cancellate. L'oracolo e il
  // guardrail service_role: le righe ESISTEVANO prima ed ESISTONO ANCORA dopo.
  it("B non puo eliminare i siti di A: le due righe di A esistono prima ed esistono ancora dopo (guardrail service_role)", async () => {
    const targetId = await makeSiteInA('Bersaglio Cross Tenant');
    const witnessId = await makeSiteInA('Testimone Cross Tenant');
    expect(targetId).not.toBe(witnessId); // covers: AC-103-4 — due righe davvero distinte

    // Guardrail service_role PRIMA: i dati ESISTONO (il verde non puo derivare da
    // dati assenti).
    const admin = adminClient();
    const before = await admin.from('sites').select('id, name').in('id', [targetId, witnessId]);
    expect(before.error).toBeNull(); // covers: AC-103-4
    expect(before.data ?? []).toHaveLength(2); // covers: AC-103-4

    // DELETE ESEGUITO DAVVERO come utente autenticato di un ALTRO account (JWT reale,
    // ruolo authenticated, RLS attiva): prima via server action, poi via client diretto
    // (che esercita la policy senza il wrapper applicativo).
    clientHolder.current = clientB;
    const del = await deleteSite(targetId);
    expect(typeof del.ok).toBe('boolean'); // covers: AC-103-4 — l'esito non e l'oracolo

    const raw = await clientB.from('sites').delete().eq('id', targetId).select();
    expect(raw.error).toBeNull(); // covers: AC-103-4
    expect(raw.data ?? []).toHaveLength(0); // covers: AC-103-4 — indizio, non oracolo

    // Tentativo di cancellazione "di massa" sull'account di A: se la policy DELETE
    // cadesse, questo spazzerebbe via entrambe le righe.
    const sweep = await clientB.from('sites').delete().eq('account_id', accountAId).select();
    expect(sweep.error).toBeNull(); // covers: AC-103-4
    expect(sweep.data ?? []).toHaveLength(0); // covers: AC-103-4 — indizio, non oracolo

    // ORACOLO — guardrail service_role DOPO: entrambe le righe sono ancora li, con il
    // loro id e il loro name.
    const after = await admin.from('sites').select('id, name').in('id', [targetId, witnessId]);
    expect(after.error).toBeNull(); // covers: AC-103-4
    expect(after.data ?? []).toHaveLength(2); // covers: AC-103-4
    const byId = new Map((after.data ?? []).map((r) => [r.id as string, r.name as string]));
    expect(byId.get(targetId)).toBe('Bersaglio Cross Tenant'); // covers: AC-103-4
    expect(byId.get(witnessId)).toBe('Testimone Cross Tenant'); // covers: AC-103-4
  });

  // covers: AC-103-3 — e in piu' RAGGIO D'AZIONE di deleteSite (rilievo S45-02).
  // Sostituendo `.eq('id', siteId)` con un predicato che seleziona tutte le righe
  // visibili, deleteSite cancella TUTTI i siti del chiamante e 35 test su 35 restavano
  // verdi: ogni test asseriva solo "il bersaglio e sparito", mai "gli altri sono
  // sopravvissuti", e l'account di test aveva UN SOLO sito.
  // Qui A ha DUE siti con name DISCORDANTI: si cancella il bersaglio e si asserisce che
  // il testimone e ancora li, con il suo id e il suo name.
  it("A elimina UN suo sito: il testimone (secondo sito dello stesso account) sopravvive con id e name intatti", async () => {
    const targetId = await makeSiteInA('Bersaglio Da Cancellare');
    const witnessId = await makeSiteInA('Testimone Da Conservare');
    expect(targetId).not.toBe(witnessId); // covers: AC-103-3

    const admin = adminClient();
    const before = await admin.from('sites').select('id').eq('account_id', accountAId);
    expect(before.error).toBeNull(); // covers: AC-103-3
    const beforeIds = (before.data ?? []).map((r) => r.id as string);
    // Guardrail service_role PRIMA: entrambe le righe esistono.
    expect(beforeIds).toContain(targetId); // covers: AC-103-3
    expect(beforeIds).toContain(witnessId); // covers: AC-103-3

    clientHolder.current = clientA;
    const res = await deleteSite(targetId);
    expect(res.ok).toBe(true); // covers: AC-103-3

    const after = await admin.from('sites').select('id, name').eq('account_id', accountAId);
    expect(after.error).toBeNull(); // covers: AC-103-3
    const afterIds = (after.data ?? []).map((r) => r.id as string);

    // Il bersaglio e sparito...
    expect(afterIds).not.toContain(targetId); // covers: AC-103-3
    // ...e il TESTIMONE e ancora li, con il suo name (S45-02).
    expect(afterIds).toContain(witnessId); // covers: AC-103-3
    const witness = (after.data ?? []).find((r) => (r.id as string) === witnessId);
    expect(witness?.name).toBe('Testimone Da Conservare'); // covers: AC-103-3

    // Raggio d'azione ESATTO: e sparita UNA sola riga dell'account, ed e il bersaglio.
    const removed = beforeIds.filter((id) => !afterIds.includes(id));
    expect(removed).toEqual([targetId]); // covers: AC-103-3
  });

  // covers: AC-103-1 — e in piu' RAGGIO D'AZIONE di renameSite (stessa classe di
  // S45-02 applicata all'UPDATE): rinominare il bersaglio non deve toccare il name del
  // testimone. Con un solo sito per account, "rinomina quello giusto" e "rinomina
  // tutto" sono indistinguibili.
  it("A rinomina UN suo sito: il name del testimone (secondo sito dello stesso account) resta invariato", async () => {
    const targetId = await makeSiteInA('Bersaglio Da Rinominare');
    const witnessId = await makeSiteInA('Testimone Nome Intatto');
    expect(targetId).not.toBe(witnessId); // covers: AC-103-1

    const admin = adminClient();
    const before = await admin.from('sites').select('id, name').eq('account_id', accountAId);
    expect(before.error).toBeNull(); // covers: AC-103-1
    const beforeNames = new Map((before.data ?? []).map((r) => [r.id as string, r.name as string]));
    // Guardrail service_role PRIMA: entrambe le righe esistono con name DISCORDANTI.
    expect(beforeNames.get(targetId)).toBe('Bersaglio Da Rinominare'); // covers: AC-103-1
    expect(beforeNames.get(witnessId)).toBe('Testimone Nome Intatto'); // covers: AC-103-1

    clientHolder.current = clientA;
    const res = await renameSite(targetId, 'Solo Il Bersaglio Rinominato');
    expect(res.ok).toBe(true); // covers: AC-103-1

    const after = await admin.from('sites').select('id, name').eq('account_id', accountAId);
    expect(after.error).toBeNull(); // covers: AC-103-1
    const afterNames = new Map((after.data ?? []).map((r) => [r.id as string, r.name as string]));

    expect(afterNames.get(targetId)).toBe('Solo Il Bersaglio Rinominato'); // covers: AC-103-1
    // Il TESTIMONE non e stato toccato: stesso id, stesso name.
    expect(afterNames.get(witnessId)).toBe('Testimone Nome Intatto'); // covers: AC-103-1

    // Raggio d'azione ESATTO: e cambiato UN solo name nell'account, ed e il bersaglio
    // (una riga sparita conterebbe qui come cambiata, ed e voluto).
    const changed = [...beforeNames.entries()]
      .filter(([id, name]) => afterNames.get(id) !== name)
      .map(([id]) => id);
    expect(changed).toEqual([targetId]); // covers: AC-103-1
  });

  // covers: AC-103-4 — e in piu' l'UNICA forma in cui la policy sites_delete_member e
  // l'ULTIMA linea di difesa, MISURATA cosi:
  //  - attraverso PostgREST un DELETE porta SEMPRE un WHERE (un .delete() senza filtri
  //    e respinto con 400 "DELETE requires a WHERE clause"), e un WHERE che nomina
  //    colonne della tabella obbliga Postgres ad applicare alla riga esistente anche la
  //    policy SELECT: con sites_select_member integra, neutralizzare la SOLA policy
  //    DELETE — perfino in `using (true)` — lascia 0 righe cancellate;
  //  - resta il DELETE NUDO (nessun WHERE, nessun RETURNING), che solo una connessione
  //    SQL diretta puo emettere (pooler, job, futura edge function con connessione di
  //    sessione): li la policy SELECT non entra e la policy DELETE e il solo gate.
  //    Con `using (true)` quel DELETE cancella davvero i siti di un altro tenant.
  // Il ruolo e emulato come fa PostgREST (request.jwt.claims + role authenticated):
  // RLS ATTIVA e auth.uid() reale, MAI superuser (che la bypasserebbe → falso verde).
  // La transazione e annullata: l'oracolo e il numero di righe che il DELETE AVREBBE
  // cancellato, letto prima del rollback.
  it.skipIf(!process.env.DATABASE_URL)(
    'DELETE nudo su sites: come utente di un altro account cancella 0 righe, come membro cancella i propri (la RLS e attiva davvero)',
    async () => {
      await makeSiteInA('Bersaglio Delete Nudo');
      await makeSiteInA('Testimone Delete Nudo');

      // Guardrail service_role PRIMA: l'account di A ha righe da perdere. Senza questo,
      // "0 righe cancellate" sarebbe compatibile con una tabella vuota.
      const before = await adminClient().from('sites').select('id').eq('account_id', accountAId);
      expect(before.error).toBeNull(); // covers: AC-103-4
      const nA = (before.data ?? []).length;
      expect(nA).toBeGreaterThanOrEqual(2); // covers: AC-103-4

      // Esegue `delete from public.sites` (nudo) col ruolo/claim dell'utente indicato e
      // ANNULLA la transazione, restituendo quante righe sarebbero sparite.
      async function bareDeleteAs(userId: string): Promise<number> {
        const client = new Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        try {
          await client.query('begin');
          await client.query('select set_config($1, $2, true)', [
            'request.jwt.claims',
            JSON.stringify({ sub: userId, role: 'authenticated' }),
          ]);
          await client.query('set local role authenticated');
          const res = await client.query('delete from public.sites');
          await client.query('rollback');
          return res.rowCount ?? -1;
        } finally {
          await client.end();
        }
      }

      // B non e membro dell'account di A: nessuna riga qualifica per la policy DELETE.
      expect(await bareDeleteAs(userBId)).toBe(0); // covers: AC-103-4

      // Controprova che l'emulazione del ruolo FUNZIONA e che la RLS non e semplicemente
      // spenta o cieca: lo stesso identico DELETE, come membro, colpisce esattamente le
      // righe del proprio account (se auth.uid() non arrivasse, anche questo darebbe 0;
      // se il ruolo restasse superuser, la RLS sarebbe bypassata e ne colpirebbe di piu').
      expect(await bareDeleteAs(userAId)).toBe(nA); // covers: AC-103-4

      // Guardrail service_role DOPO: i siti di A sono tutti ancora li (rollback).
      const after = await adminClient().from('sites').select('id').eq('account_id', accountAId);
      expect((after.data ?? []).length).toBe(nA); // covers: AC-103-4
    },
  );
});
