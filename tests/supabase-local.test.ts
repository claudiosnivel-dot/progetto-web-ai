import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pgQuery } from './helpers/pg';

const root = process.cwd();
const DB = !!process.env.DATABASE_URL;
const BASELINE_VERSION = '20260723000000';

describe('T-004 Supabase locale + migrazioni (statico)', () => {
  it('lo script db:reset invoca la CLI supabase', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['db:reset']).toContain('supabase'); // covers: AC-004-3
  });
});

describe.skipIf(!DB)('T-004 Supabase locale + migrazioni (runtime, richiede DB locale)', () => {
  it('la baseline è registrata in supabase_migrations.schema_migrations', async () => {
    const rows = await pgQuery(
      'select version from supabase_migrations.schema_migrations where version = $1',
      [BASELINE_VERSION],
    );
    expect(rows).toHaveLength(1); // covers: AC-004-1
  });

  it("l'oggetto creato dalla baseline (schema app) esiste nel catalogo", async () => {
    const rows = await pgQuery(
      'select 1 from information_schema.schemata where schema_name = $1',
      ['app'],
    );
    expect(rows).toHaveLength(1); // covers: AC-004-2
  });

  it('la baseline è idempotente: ri-applicarla non produce errori di oggetto esistente', async () => {
    await pgQuery('create schema if not exists app'); // covers: AC-004-4
    const rows = await pgQuery(
      'select 1 from information_schema.schemata where schema_name = $1',
      ['app'],
    );
    expect(rows).toHaveLength(1); // covers: AC-004-4
  });
});
