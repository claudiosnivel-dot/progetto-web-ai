import { describe, it, expect } from 'vitest';
import { pgQuery } from './helpers/pg';

// Asserzioni sui cataloghi di sistema via connessione Postgres diretta
// (PostgREST non li espone). Coprono AC-060-1/2/3/4/6 di T-060.
const DB = !!process.env.DATABASE_URL;

type ColRow = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
};

describe.skipIf(!DB)('T-060 schema accounts + account_members (cataloghi)', () => {
  // covers: AC-060-1
  it('accounts espone esattamente id/owner_id/name/created_at con tipi e nullability attesi', async () => {
    const cols = await pgQuery<ColRow>(
      `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'accounts'
        order by column_name`,
    );
    const by = Object.fromEntries(cols.map((c) => [c.column_name, c]));

    // covers: AC-060-1 — insieme esatto delle colonne
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      'created_at',
      'id',
      'name',
      'owner_id',
    ]);
    // covers: AC-060-1 — id uuid NOT NULL default gen_random_uuid()
    expect(by['id'].data_type).toBe('uuid');
    expect(by['id'].is_nullable).toBe('NO');
    expect(by['id'].column_default ?? '').toContain('gen_random_uuid()');
    // covers: AC-060-1 — owner_id uuid NOT NULL
    expect(by['owner_id'].data_type).toBe('uuid');
    expect(by['owner_id'].is_nullable).toBe('NO');
    // covers: AC-060-1 — name text, created_at timestamptz
    expect(by['name'].data_type).toBe('text');
    expect(by['created_at'].data_type).toBe('timestamp with time zone');
  });

  // covers: AC-060-1
  it('account_members espone esattamente account_id/user_id/role/created_at con tipi attesi', async () => {
    const cols = await pgQuery<ColRow>(
      `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'account_members'
        order by column_name`,
    );
    const by = Object.fromEntries(cols.map((c) => [c.column_name, c]));

    // covers: AC-060-1 — insieme esatto delle colonne
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      'account_id',
      'created_at',
      'role',
      'user_id',
    ]);
    // covers: AC-060-1 — account_id/user_id uuid
    expect(by['account_id'].data_type).toBe('uuid');
    expect(by['user_id'].data_type).toBe('uuid');
    // covers: AC-060-1 — role text NOT NULL
    expect(by['role'].data_type).toBe('text');
    expect(by['role'].is_nullable).toBe('NO');
    // covers: AC-060-1 — created_at timestamptz
    expect(by['created_at'].data_type).toBe('timestamp with time zone');
  });

  // covers: AC-060-2
  it('account_members: PK composita (account_id,user_id), CHECK su role e FK account_id->accounts ON DELETE CASCADE', async () => {
    // PK composita nell'ordine (account_id, user_id)
    const pk = await pgQuery<{ cols: string[] }>(
      `select array_agg(a.attname::text order by k.ord) as cols
         from pg_constraint c
         join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        where c.conrelid = 'public.account_members'::regclass and c.contype = 'p'
        group by c.oid`,
    );
    expect(pk).toHaveLength(1); // covers: AC-060-2
    expect(pk[0].cols).toEqual(['account_id', 'user_id']); // covers: AC-060-2

    // CHECK che limita role a owner/editor
    const checks = await pgQuery<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
        where c.conrelid = 'public.account_members'::regclass and c.contype = 'c'`,
    );
    const roleCheck = checks.map((r) => r.def).find((d) => d.includes('role'));
    expect(roleCheck).toBeDefined(); // covers: AC-060-2
    expect(roleCheck).toContain("'owner'"); // covers: AC-060-2
    expect(roleCheck).toContain("'editor'"); // covers: AC-060-2

    // FK account_id -> accounts con ON DELETE CASCADE (confdeltype = 'c')
    const fk = await pgQuery<{ def: string; confdeltype: string }>(
      `select pg_get_constraintdef(c.oid) as def, c.confdeltype
         from pg_constraint c
        where c.conrelid = 'public.account_members'::regclass
          and c.contype = 'f'
          and c.confrelid = 'public.accounts'::regclass`,
    );
    expect(fk).toHaveLength(1); // covers: AC-060-2
    expect(fk[0].confdeltype).toBe('c'); // covers: AC-060-2 — ON DELETE CASCADE
    expect(fk[0].def).toContain('account_id'); // covers: AC-060-2
    expect(fk[0].def.toUpperCase()).toContain('ON DELETE CASCADE'); // covers: AC-060-2
  });

  // covers: AC-060-3
  it('RLS abilitata (relrowsecurity=true) su accounts e account_members', async () => {
    const rows = await pgQuery<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity
         from pg_class
        where relnamespace = 'public'::regnamespace
          and relname in ('accounts', 'account_members')
        order by relname`,
    );
    expect(rows).toHaveLength(2); // covers: AC-060-3
    for (const r of rows) expect(r.relrowsecurity).toBe(true); // covers: AC-060-3
  });

  // covers: AC-060-4
  it('ogni policy e TO authenticated e nessuna usa USING(true)/WITH CHECK(true) o auth.uid() IS NOT NULL da sola', async () => {
    const pols = await pgQuery<{
      tablename: string;
      policyname: string;
      roles: string[];
      qual: string | null;
      with_check: string | null;
    }>(
      `select tablename, policyname, roles::text[] as roles, qual, with_check
         from pg_policies
        where schemaname = 'public'
          and tablename in ('accounts', 'account_members')`,
    );

    // Almeno una policy per ciascuna tabella.
    const tables = new Set(pols.map((p) => p.tablename));
    expect(tables.has('accounts')).toBe(true); // covers: AC-060-4
    expect(tables.has('account_members')).toBe(true); // covers: AC-060-4

    // Vietate USING(true)/WITH CHECK(true) e la sola auth.uid() IS NOT NULL.
    const forbidden = (e: string | null): boolean => {
      if (e == null) return false;
      const s = e.replace(/\s+/g, '').toLowerCase();
      if (/^\(*true\)*$/.test(s)) return true;
      if (/^\(*(select)?auth\.uid\(\)(asuid)?\)*isnotnull\)*$/.test(s)) return true;
      return false;
    };

    expect(pols.length).toBeGreaterThan(0);
    for (const p of pols) {
      expect(p.roles).toEqual(['authenticated']); // covers: AC-060-4
      expect(forbidden(p.qual)).toBe(false); // covers: AC-060-4
      expect(forbidden(p.with_check)).toBe(false); // covers: AC-060-4
    }
  });

  // covers: AC-060-6
  it('ogni tabella con una policy UPDATE possiede anche una policy SELECT (companion R6)', async () => {
    const pols = await pgQuery<{ tablename: string; cmd: string }>(
      `select tablename, cmd
         from pg_policies
        where schemaname = 'public'
          and tablename in ('accounts', 'account_members')`,
    );

    for (const t of ['accounts', 'account_members']) {
      const cmds = pols.filter((p) => p.tablename === t).map((p) => p.cmd);
      if (cmds.includes('UPDATE')) {
        expect(cmds).toContain('SELECT'); // covers: AC-060-6
      }
    }

    // Guardia anti-vacuita: account_members ha davvero UPDATE + SELECT.
    const amCmds = pols
      .filter((p) => p.tablename === 'account_members')
      .map((p) => p.cmd);
    expect(amCmds).toContain('UPDATE'); // covers: AC-060-6
    expect(amCmds).toContain('SELECT'); // covers: AC-060-6
  });

  // Emendamento ledger 2026-07-23: UNIQUE(owner_id) su accounts (un utente possiede
  // al piu un account personale in P0/V1). Non tra gli AC originali di T-060.
  it('accounts ha un vincolo UNIQUE su owner_id (un account per owner)', async () => {
    const uniq = await pgQuery<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
        where c.conrelid = 'public.accounts'::regclass and c.contype = 'u'`,
    );
    expect(uniq.some((r) => /owner_id/.test(r.def))).toBe(true);
  });
});
