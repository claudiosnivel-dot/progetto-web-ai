import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const run = (cmd: string) => execSync(cmd, { cwd: root, stdio: 'pipe', encoding: 'utf8' });

describe('T-001 scaffold Next.js', () => {
  it('npm run typecheck esce con exit 0', () => {
    // covers: AC-001-1
    expect(() => run('npm run typecheck')).not.toThrow();
  }, 180000);

  it('npm run build esce con exit 0 e crea la cartella .next', () => {
    run('npm run build'); // throws se exit != 0 // covers: AC-001-2
    expect(existsSync(resolve(root, '.next'))).toBe(true); // covers: AC-001-2
  }, 300000);

  it('esistono le cartelle di dominio src/ui, src/domain, src/data', () => {
    for (const d of ['src/ui', 'src/domain', 'src/data']) {
      expect(existsSync(resolve(root, d))).toBe(true); // covers: AC-001-3
    }
  });

  it('package.json espone gli script dev, build, typecheck, test, lint', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    for (const s of ['dev', 'build', 'typecheck', 'test', 'lint']) {
      expect(pkg.scripts).toHaveProperty(s); // covers: AC-001-4
    }
  });

  it('npm run lint esce con exit 0', () => {
    // covers: AC-001-5
    expect(() => run('npm run lint')).not.toThrow();
  }, 180000);
});
