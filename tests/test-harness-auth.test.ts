import { describe, it, expect, afterAll } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createTestUser, signInAs, deleteTestUser } from './helpers/supabase-test';
import { pgQuery } from './helpers/pg';

const root = process.cwd();
const SB = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const DB = !!process.env.DATABASE_URL;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const decodeRole = (jwt: string): string => {
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
  return payload.role as string;
};

describe('T-005 helper di test (statico)', () => {
  it('nessun modulo src/** importa gli helper di test (adminClient resta lato test)', () => {
    for (const f of walk(resolve(root, 'src'))) {
      const src = readFileSync(f, 'utf8');
      expect(src.includes('tests/helpers')).toBe(false); // covers: AC-005-3
      expect(src.includes('helpers/supabase-test')).toBe(false); // covers: AC-005-3
    }
  });
});

describe.skipIf(!SB)('T-005 helper di test (runtime, richiede Supabase locale)', () => {
  const email = `t005_${Date.now()}@example.test`;
  const password = 'Password123!';
  let userId = '';

  afterAll(async () => {
    if (userId) await deleteTestUser(userId);
  });

  it("createTestUser + signInAs danno un client con sessione e id corretti", async () => {
    const user = await createTestUser(email, password);
    userId = user.id;
    const client = await signInAs(email, password);
    const { data } = await client.auth.getUser();
    expect(data.user?.id).toBe(userId); // covers: AC-005-1
  });

  it('il client autenticato gira come ruolo authenticated (non superuser)', async () => {
    const client = await signInAs(email, password);
    const { data } = await client.auth.getSession();
    expect(decodeRole(data.session!.access_token)).toBe('authenticated'); // covers: AC-005-2
  });
});

describe.skipIf(!DB)('T-005 helper pg diretto (richiede DB locale)', () => {
  it('pgQuery apre una connessione Postgres diretta funzionante', async () => {
    const rows = await pgQuery<{ ok: number }>('select 1 as ok');
    expect(rows[0].ok).toBe(1); // covers: AC-005-4
  });
});
