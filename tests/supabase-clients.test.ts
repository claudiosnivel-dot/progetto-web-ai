import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('T-002 client Supabase', () => {
  it('il client browser non referenzia la service_role e usa la anon key', () => {
    const src = read('src/data/supabase-browser.ts');
    expect(src.includes('SUPABASE_SERVICE_ROLE_KEY')).toBe(false); // covers: AC-002-2
    expect(src.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY')).toBe(true); // covers: AC-002-2
  });

  it("il client admin ha import 'server-only' come prima istruzione", () => {
    const src = read('src/data/supabase-admin.ts');
    const firstStatement = src
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('//'));
    expect(firstStatement).toBe("import 'server-only';"); // covers: AC-002-3
  });

  it('nessun segreto/JWT hardcoded nei client né placeholder valorizzati in .env.example', () => {
    const jwtLike = /eyJ[A-Za-z0-9_-]{10,}/; // pattern JWT Supabase
    for (const p of ['src/data/supabase-browser.ts', 'src/data/supabase-admin.ts', '.env.example']) {
      expect(jwtLike.test(read(p))).toBe(false); // covers: AC-002-4
    }
    // In .env.example ogni chiave ha valore vuoto (nessun segreto reale)
    const example = read('.env.example');
    for (const line of example.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) expect(m[2].trim()).toBe(''); // covers: AC-002-4
    }
  });

  it('la config ESLint vieta import del client service_role (supabase-admin) fuori dai moduli server', () => {
    const eslint = read('eslint.config.mjs');
    expect(eslint.includes('no-restricted-imports')).toBe(true); // covers: AC-002-6
    expect(eslint.includes('supabase-admin')).toBe(true); // covers: AC-002-6
  });
});
