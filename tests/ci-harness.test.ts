import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('T-003 harness & gate qualità', () => {
  it('npm run knip esce con exit 0 (nessun dead-code residuo)', () => {
    // covers: AC-003-2
    expect(() => execSync('npm run knip', { cwd: root, stdio: 'pipe' })).not.toThrow();
  }, 120000);

  it('il workflow CI invoca typecheck, test e knip su push e pull_request', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('push'); // covers: AC-003-3
    expect(ci).toContain('pull_request'); // covers: AC-003-3
    expect(ci).toContain('npm run typecheck'); // covers: AC-003-3
    expect(ci).toContain('npm test'); // covers: AC-003-3
    expect(ci).toContain('npm run knip'); // covers: AC-003-3
  });

  it('vitest.config include il pattern tests/**/*.test.ts', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toContain('tests/**/*.test.ts'); // covers: AC-003-4
  });
});
