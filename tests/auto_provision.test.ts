import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestUser, deleteTestUser } from './helpers/supabase-test';
import { pgQuery } from './helpers/pg';

// T-062 — Auto-provision su signup. createTestUser inserisce l'utente in
// auth.users, il che FA SCATTARE il trigger AFTER INSERT public.handle_new_user()
// (attivo perche tutte le migrazioni sono applicate prima dei test). Si asserisce
// l'esito del provisioning sui cataloghi/dati via connessione Postgres diretta
// (pgQuery, DATABASE_URL) con query PARAMETRIZZATE ($1/$2), mai interpolate (A05:2025).
//
// Richiede sia Supabase locale (creazione utente reale) sia la connessione DB diretta
// (conteggi + simulazione di re-provision idempotente): describe gated su SB && DB.
// Un solo utente creato in beforeAll (rate limit auth), rimosso in afterAll.

const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);
const DB = !!process.env.DATABASE_URL;

describe.skipIf(!(SB && DB))('T-062 auto-provision su signup (trigger handle_new_user)', () => {
  const password = 'Password123!';
  const email = `t062_${randomUUID()}@example.test`;
  let userId = '';
  let accountId = '';

  beforeAll(async () => {
    // Creazione dell'utente -> insert in auth.users -> trigger AFTER INSERT ->
    // auto-provision di account + membership owner + profilo.
    const u = await createTestUser(email, password);
    userId = u.id;

    const acc = await pgQuery<{ id: string }>(
      'select id from public.accounts where owner_id = $1',
      [userId],
    );
    accountId = acc[0]?.id ?? '';
  });

  afterAll(async () => {
    if (userId) await deleteTestUser(userId);
  });

  // covers: AC-062-1
  it('crea esattamente 1 account con owner_id = nuovo utente', async () => {
    const rows = await pgQuery<{ n: number }>(
      'select count(*)::int as n from public.accounts where owner_id = $1',
      [userId],
    );
    expect(rows[0].n).toBe(1); // covers: AC-062-1
    expect(accountId).not.toBe(''); // covers: AC-062-1 — l'account e stato effettivamente creato
  });

  // covers: AC-062-2
  it("crea esattamente 1 membership owner (account dell'utente, user_id=utente, role='owner')", async () => {
    // Esattamente 1 riga (account creato per U, U, 'owner').
    const owned = await pgQuery<{ n: number }>(
      "select count(*)::int as n from public.account_members where account_id = $1 and user_id = $2 and role = 'owner'",
      [accountId, userId],
    );
    expect(owned[0].n).toBe(1); // covers: AC-062-2

    // Nessun'altra membership per l'utente: il provisioning crea SOLO l'owner.
    const total = await pgQuery<{ n: number }>(
      'select count(*)::int as n from public.account_members where user_id = $1',
      [userId],
    );
    expect(total[0].n).toBe(1); // covers: AC-062-2
  });

  // covers: AC-062-3
  it("crea esattamente 1 profilo con id = utente e locale = 'it'", async () => {
    const localed = await pgQuery<{ n: number }>(
      "select count(*)::int as n from public.profiles where id = $1 and locale = 'it'",
      [userId],
    );
    expect(localed[0].n).toBe(1); // covers: AC-062-3

    // Esattamente un profilo per l'utente (nessun duplicato).
    const total = await pgQuery<{ n: number }>(
      'select count(*)::int as n from public.profiles where id = $1',
      [userId],
    );
    expect(total[0].n).toBe(1); // covers: AC-062-3
  });

  // covers: AC-062-5
  it('handle_new_user() garantisce l idempotenza per costruzione (guardie nel corpo della funzione + PK reali)', async () => {
    // Un trigger AFTER INSERT non e ri-eseguibile dai test (ri-inserire la stessa riga
    // auth.users viola il PK; una nuova insert crea un id diverso = altro utente; una
    // trigger function non e invocabile fuori dal contesto di trigger). Perche il verde
    // provi l'idempotenza della FUNZIONE DEPLOYATA — e non di copie inline degli statement
    // (self-fulfilling) — si vincola l'asserzione al corpo reale della funzione e alla
    // realta dei vincoli PK bersaglio degli ON CONFLICT.

    // (a) Il corpo della funzione deployata contiene le guardie di idempotenza: una
    //     regressione che rimuovesse ON CONFLICT o la guardia su owner_id verrebbe colta qui.
    const def = await pgQuery<{ src: string }>(
      "select pg_get_functiondef('public.handle_new_user()'::regprocedure) as src",
    );
    const src = def[0].src.toLowerCase().replace(/\s+/g, ' ');
    expect(src).toContain('on conflict (account_id, user_id) do nothing'); // covers: AC-062-5 — membership idempotente
    expect(src).toContain('on conflict (id) do nothing'); // covers: AC-062-5 — profilo idempotente
    expect(src).toContain('owner_id = new.id'); // covers: AC-062-5 — guardia accounts (PK random, nessun UNIQUE su owner_id)

    // (b) I bersagli degli ON CONFLICT sono PK REALI: un insert NON guardato che duplica
    //     la membership owner e il profilo dell'utente gia provisionato DEVE sollevare una
    //     unique_violation (23505). Prova che gli ON CONFLICT sopra non sono no-op silenziosi.
    //     (pgQuery e autocommit: nel caso di regressione del PK, la cascade su deleteTestUser
    //     in afterAll ripulisce comunque le righe.)
    await expect(
      pgQuery(
        "insert into public.account_members (account_id, user_id, role) values ($1::uuid, $2::uuid, 'owner')",
        [accountId, userId],
      ),
    ).rejects.toMatchObject({ code: '23505' }); // covers: AC-062-5 — PK composita (account_id,user_id) reale
    await expect(
      pgQuery(
        "insert into public.profiles (id, locale) values ($1::uuid, 'it')",
        [userId],
      ),
    ).rejects.toMatchObject({ code: '23505' }); // covers: AC-062-5 — PK (id) reale

    // (c) Conteggi invariati: esattamente 1 riga each, nessun duplicato introdotto.
    const accounts = await pgQuery<{ n: number }>(
      'select count(*)::int as n from public.accounts where owner_id = $1',
      [userId],
    );
    const members = await pgQuery<{ n: number }>(
      'select count(*)::int as n from public.account_members where user_id = $1',
      [userId],
    );
    const profiles = await pgQuery<{ n: number }>(
      'select count(*)::int as n from public.profiles where id = $1',
      [userId],
    );
    expect(accounts[0].n).toBe(1); // covers: AC-062-5 — nessun account duplicato
    expect(members[0].n).toBe(1); // covers: AC-062-5 — nessuna membership duplicata
    expect(profiles[0].n).toBe(1); // covers: AC-062-5 — nessun profilo duplicato
  });

  // covers: AC-062-5
  it('idempotenza garantita dallo schema: un 2o account per lo stesso owner e rifiutato (UNIQUE, 23505)', async () => {
    // Emendamento ledger 2026-07-23: UNIQUE(owner_id) su accounts. Rende l'idempotenza
    // dell'auto-provision provabile PER COSTRUZIONE (non solo per la guardia applicativa
    // nella funzione): un secondo account per l'owner gia provisionato in beforeAll e
    // rifiutato dal DB con unique_violation, quindi un re-provision non puo duplicare.
    await expect(
      pgQuery('insert into public.accounts (owner_id) values ($1::uuid)', [userId]),
    ).rejects.toMatchObject({ code: '23505' }); // covers: AC-062-5 — vincolo UNIQUE(owner_id) enforced
  });
});
