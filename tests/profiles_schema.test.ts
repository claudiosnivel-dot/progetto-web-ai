import { describe, it, expect } from 'vitest';
import { pgQuery } from './helpers/pg';

// T-061 — Schema public.profiles + RLS. Asserzioni sui cataloghi di sistema via
// connessione Postgres diretta (PostgREST non li espone). Derivate dagli
// acceptance_criteria AC-061-1..4. Gira solo se DATABASE_URL e presente.

const DB = !!process.env.DATABASE_URL;

type ColumnRow = {
  column_name: string;
  data_type: string;
  column_default: string | null;
};

type PolicyRow = {
  policyname: string;
  cmd: string;
  roles: string[];
  qual: string | null;
  with_check: string | null;
};

// Un'espressione di policy lega l'identita se cita auth.uid() E la colonna id,
// NON e la costante true e NON e la sola auth.uid() IS NOT NULL (R3/R4).
const bindsIdentity = (expr: string | null): boolean =>
  expr !== null &&
  expr.trim() !== 'true' &&
  /auth\.uid\(\)/.test(expr) &&
  /\bid\b/.test(expr) &&
  !/is\s+not\s+null/i.test(expr);

describe.skipIf(!DB)('T-061 profiles schema + RLS (catalogo, richiede DB locale)', () => {
  it('colonne, PRIMARY KEY su id e FOREIGN KEY id -> auth.users ON DELETE CASCADE', async () => {
    // covers: AC-061-1
    const cols = await pgQuery<ColumnRow>(
      `select column_name, data_type, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles'`,
    );
    const byName = new Map(cols.map((c) => [c.column_name, c]));
    expect(byName.get('id')?.data_type).toBe('uuid');
    expect(byName.get('display_name')?.data_type).toBe('text');
    expect(byName.get('locale')?.data_type).toBe('text');
    expect(byName.get('created_at')?.data_type).toBe('timestamp with time zone');

    // PRIMARY KEY: esattamente la colonna id.
    const pk = await pgQuery<{ attname: string }>(
      `select a.attname
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.conrelid = 'public.profiles'::regclass and c.contype = 'p'`,
    );
    expect(pk.map((r) => r.attname)).toEqual(['id']);

    // FOREIGN KEY id -> auth.users con ON DELETE CASCADE (confdeltype = 'c').
    const fk = await pgQuery<{ col: string; referenced: string; confdeltype: string }>(
      `select a.attname as col,
              c.confrelid::regclass::text as referenced,
              c.confdeltype
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.conrelid = 'public.profiles'::regclass and c.contype = 'f'`,
    );
    expect(fk).toHaveLength(1);
    expect(fk[0].col).toBe('id');
    expect(fk[0].referenced).toBe('auth.users');
    expect(fk[0].confdeltype).toBe('c');
  });

  it("il CHECK vincola locale a 'it'/'es' e il default della colonna e 'it'", async () => {
    // covers: AC-061-2
    const checks = await pgQuery<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
        where c.conrelid = 'public.profiles'::regclass and c.contype = 'c'`,
    );
    const localeCheck = checks.find((r) => /locale/.test(r.def));
    expect(localeCheck).toBeDefined();
    expect(localeCheck!.def).toMatch(/'it'/);
    expect(localeCheck!.def).toMatch(/'es'/);

    const localeCol = await pgQuery<ColumnRow>(
      `select column_name, data_type, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles' and column_name = 'locale'`,
    );
    expect(localeCol[0].column_default).toContain("'it'");
  });

  it('RLS abilitata su public.profiles (relrowsecurity = true)', async () => {
    // covers: AC-061-3
    const rows = await pgQuery<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid = 'public.profiles'::regclass`,
    );
    expect(rows[0].relrowsecurity).toBe(true);
  });

  it('le policy sono TO authenticated, legano id = auth.uid(), e la UPDATE ha la SELECT companion', async () => {
    // covers: AC-061-4
    const policies = await pgQuery<PolicyRow>(
      `select policyname, cmd, roles::text[] as roles, qual, with_check
         from pg_policies
        where schemaname = 'public' and tablename = 'profiles'`,
    );
    expect(policies.length).toBeGreaterThan(0);

    // Ogni policy: SOLO il ruolo authenticated (R5); mai USING/WITH CHECK true (R3).
    for (const p of policies) {
      expect(p.roles).toEqual(['authenticated']);
      expect(p.qual).not.toBe('true');
      expect(p.with_check).not.toBe('true');
    }

    const byCmd = new Map(policies.map((p) => [p.cmd, p]));

    // SELECT: la USING lega l'identita.
    expect(byCmd.has('SELECT')).toBe(true);
    expect(bindsIdentity(byCmd.get('SELECT')!.qual)).toBe(true);

    // INSERT: la WITH CHECK lega l'identita.
    expect(byCmd.has('INSERT')).toBe(true);
    expect(bindsIdentity(byCmd.get('INSERT')!.with_check)).toBe(true);

    // UPDATE: USING e WITH CHECK legano l'identita...
    expect(byCmd.has('UPDATE')).toBe(true);
    expect(bindsIdentity(byCmd.get('UPDATE')!.qual)).toBe(true);
    expect(bindsIdentity(byCmd.get('UPDATE')!.with_check)).toBe(true);

    // ...e la UPDATE e accompagnata da una policy SELECT companion (R6).
    expect(byCmd.has('SELECT')).toBe(true);
  });
});
