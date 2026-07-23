import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pgQuery } from './helpers/pg';
import { adminClient, createTestUser, deleteTestUser } from './helpers/supabase-test';

// T-100 — Schema account-scoped public.sites + RLS + unicità slug per-account.
// Le asserzioni derivano dagli acceptance_criteria AC-100-1..6 (06-sites.md).
//
// Due strati di verifica:
//  - CATALOGO (AC-100-1/2/4): connessione Postgres diretta (pgQuery) su
//    pg_class/information_schema/pg_policies — PostgREST non espone i cataloghi.
//  - VINCOLI a runtime (AC-100-3/5/6): righe reali inserite via connessione
//    superuser (pgQuery), che BYPASSA la RLS ma NON i vincoli CHECK/UNIQUE/FK →
//    prova i vincoli di tabella in isolamento dalla RLS. Gli account reali sono
//    auto-provisionati creando utenti via admin API (esente da rate limit).

const DB = !!process.env.DATABASE_URL;
const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.DATABASE_URL
);

type ColRow = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
};

describe.skipIf(!DB)('T-100 sites schema + RLS (catalogo)', () => {
  // covers: AC-100-1
  it('RLS abilitata (relrowsecurity = true) su public.sites', async () => {
    const rows = await pgQuery<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid = 'public.sites'::regclass`,
    );
    expect(rows[0].relrowsecurity).toBe(true); // covers: AC-100-1
  });

  // covers: AC-100-2
  it('espone esattamente id/account_id/name/slug/status/created_at con tipi, nullability e default attesi', async () => {
    const cols = await pgQuery<ColRow>(
      `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'sites'
        order by column_name`,
    );
    const by = Object.fromEntries(cols.map((c) => [c.column_name, c]));

    // Insieme ESATTO delle colonne del contratto di naming.
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      'account_id',
      'created_at',
      'id',
      'name',
      'slug',
      'status',
    ]); // covers: AC-100-2

    // id uuid NOT NULL default gen_random_uuid()
    expect(by['id'].data_type).toBe('uuid'); // covers: AC-100-2
    expect(by['id'].is_nullable).toBe('NO'); // covers: AC-100-2
    expect(by['id'].column_default ?? '').toContain('gen_random_uuid()'); // covers: AC-100-2

    // account_id uuid NOT NULL
    expect(by['account_id'].data_type).toBe('uuid'); // covers: AC-100-2
    expect(by['account_id'].is_nullable).toBe('NO'); // covers: AC-100-2

    // name / slug text NOT NULL
    expect(by['name'].data_type).toBe('text'); // covers: AC-100-2
    expect(by['name'].is_nullable).toBe('NO'); // covers: AC-100-2
    expect(by['slug'].data_type).toBe('text'); // covers: AC-100-2
    expect(by['slug'].is_nullable).toBe('NO'); // covers: AC-100-2

    // status text NOT NULL default 'draft'
    expect(by['status'].data_type).toBe('text'); // covers: AC-100-2
    expect(by['status'].is_nullable).toBe('NO'); // covers: AC-100-2
    expect(by['status'].column_default ?? '').toContain("'draft'"); // covers: AC-100-2

    // created_at timestamptz
    expect(by['created_at'].data_type).toBe('timestamp with time zone'); // covers: AC-100-2
  });

  // covers: AC-100-2 (FK) — account_id -> accounts ON DELETE CASCADE
  it('account_id è FK verso public.accounts con ON DELETE CASCADE', async () => {
    const fk = await pgQuery<{ def: string; confdeltype: string }>(
      `select pg_get_constraintdef(c.oid) as def, c.confdeltype
         from pg_constraint c
        where c.conrelid = 'public.sites'::regclass
          and c.contype = 'f'
          and c.confrelid = 'public.accounts'::regclass`,
    );
    expect(fk).toHaveLength(1); // covers: AC-100-2
    expect(fk[0].confdeltype).toBe('c'); // covers: AC-100-2 — ON DELETE CASCADE
    expect(fk[0].def).toContain('account_id'); // covers: AC-100-2
  });

  // covers: AC-100-4
  it('ha policy per SELECT/INSERT/UPDATE/DELETE, tutte TO authenticated, nessuna con qual/with_check = true', async () => {
    const pols = await pgQuery<{
      policyname: string;
      cmd: string;
      roles: string[];
      qual: string | null;
      with_check: string | null;
    }>(
      `select policyname, cmd, roles::text[] as roles, qual, with_check
         from pg_policies
        where schemaname = 'public' and tablename = 'sites'`,
    );

    const cmds = pols.map((p) => p.cmd).sort();
    expect(cmds).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']); // covers: AC-100-4

    const isLiteralTrue = (e: string | null): boolean =>
      e != null && /^\(*true\)*$/.test(e.replace(/\s+/g, '').toLowerCase());

    expect(pols.length).toBeGreaterThan(0);
    for (const p of pols) {
      expect(p.roles).toEqual(['authenticated']); // covers: AC-100-4
      expect(isLiteralTrue(p.qual)).toBe(false); // covers: AC-100-4
      expect(isLiteralTrue(p.with_check)).toBe(false); // covers: AC-100-4
      // Vincolo di tenancy esplicito: ogni policy cita account_id (auditabile
      // staticamente, come richiesto dall'oracolo RLS004).
      const blob = `${p.qual ?? ''} ${p.with_check ?? ''}`;
      expect(blob).toContain('account_id'); // covers: AC-100-4
    }
  });

  // covers: AC-100-2 (index) — indice btree su account_id (colonna di policy, R9)
  it('esiste un indice btree su sites(account_id)', async () => {
    const idx = await pgQuery<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where schemaname = 'public' and tablename = 'sites'`,
    );
    const hasAccountIdIdx = idx.some((r) =>
      /\busing\s+btree\s*\(\s*account_id\s*\)/i.test(r.indexdef),
    );
    expect(hasAccountIdIdx).toBe(true);
  });
});

describe.skipIf(!SB)('T-100 sites vincoli a runtime (UNIQUE / CHECK / cross-tenant)', () => {
  const password = 'Password123!';
  const emailX = `t100x_${randomUUID()}@example.test`;
  const emailY = `t100y_${randomUUID()}@example.test`;
  let userXId = '';
  let userYId = '';
  let accountXId = '';
  let accountYId = '';

  beforeAll(async () => {
    const x = await createTestUser(emailX, password);
    const y = await createTestUser(emailY, password);
    userXId = x.id;
    userYId = y.id;
    const admin = adminClient();
    const { data: accX } = await admin
      .from('accounts')
      .select('id')
      .eq('owner_id', userXId)
      .single();
    const { data: accY } = await admin
      .from('accounts')
      .select('id')
      .eq('owner_id', userYId)
      .single();
    accountXId = accX!.id as string;
    accountYId = accY!.id as string;
  });

  afterAll(async () => {
    if (userXId) await deleteTestUser(userXId); // cascade: accounts → sites
    if (userYId) await deleteTestUser(userYId);
  });

  // covers: AC-100-3
  it('due righe con lo stesso (account_id, slug) violano il vincolo UNIQUE (SQLSTATE 23505)', async () => {
    await pgQuery(
      `insert into public.sites (account_id, name, slug) values ($1, $2, $3)`,
      [accountXId, 'Pizzeria', 'pizzeria'],
    );
    await expect(
      pgQuery(
        `insert into public.sites (account_id, name, slug) values ($1, $2, $3)`,
        [accountXId, 'Pizzeria 2', 'pizzeria'],
      ),
    ).rejects.toMatchObject({ code: '23505' }); // covers: AC-100-3
  });

  // covers: AC-100-5
  it("uno status fuori dai valori ammessi ('archived') viola il CHECK (SQLSTATE 23514)", async () => {
    await expect(
      pgQuery(
        `insert into public.sites (account_id, name, slug, status) values ($1, $2, $3, $4)`,
        [accountXId, 'Bar', 'bar-archiviato', 'archived'],
      ),
    ).rejects.toMatchObject({ code: '23514' }); // covers: AC-100-5
  });

  // covers: AC-100-6
  it('lo stesso slug in due account diversi è ammesso (unicità per-account, no enumerazione cross-tenant)', async () => {
    // accountX ha già 'pizzeria' (dal test AC-100-3). Lo stesso slug in accountY
    // deve inserirsi senza violazione: la unique è (account_id, slug), non globale.
    const rows = await pgQuery<{ id: string; account_id: string }>(
      `insert into public.sites (account_id, name, slug) values ($1, $2, $3)
         returning id, account_id`,
      [accountYId, 'Pizzeria', 'pizzeria'],
    );
    expect(rows).toHaveLength(1); // covers: AC-100-6
    expect(rows[0].account_id).toBe(accountYId); // covers: AC-100-6
  });
});
