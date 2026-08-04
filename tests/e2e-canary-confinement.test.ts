import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// T-240 (macrotask generation-e2e, P2) — IL CONFINAMENTO del canary e la DISGIUNZIONE delle suite,
// asseriti nel giro PER-TASK (vitest, control 4). Le asserzioni derivano da AC-240-3, AC-240-4,
// AC-240-5 (05-generation-e2e.md), taggate `// covers`. Questo file NON tocca Supabase e NON avvia
// il browser: solo filesystem, cosi' gira nella suite unitaria come ogni altro test.
//
// AC-240-3: il canary non compare nel bundle di produzione e nessuna rotta dell'app lo raggiunge.
//   Il grep di .next e' skipIf(!.next) — al checkpoint il build c'e', nel giro per-task no — ma i
//   CHECK STRUTTURALI (marker solo sotto e2e/, nessun src/ lo contiene o importa il canary) girano
//   SEMPRE.
// AC-240-4: la config del vitest e la lista degli spec e2e sono INSIEMI DISGIUNTI.
// AC-240-5: il runner prevede il SOLO Chromium.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const CANARY_MARKER = 'BELORA_CANARY_INSECURE';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.trueline',
  '.auth',
  'coverage',
  'dist',
  'build',
]);
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.html', '.css']);

function walk(dir: string, opts: { skipDirs?: Set<string>; ext?: Set<string> } = {}): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      if (opts.skipDirs?.has(name)) continue;
      found.push(...walk(full, opts));
    } else {
      if (opts.ext) {
        const dot = name.lastIndexOf('.');
        const ext = dot >= 0 ? name.slice(dot) : '';
        if (!opts.ext.has(ext)) continue;
      }
      found.push(full);
    }
  }
  return found;
}

/** Percorso repo-relativo con separatore '/', indipendente dall'OS. */
function rel(path: string): string {
  return relative(ROOT, path).split(sep).join('/');
}

function readSafe(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function contains(path: string, needle: string): boolean {
  return readSafe(path).includes(needle);
}

/**
 * Traduce un glob semplice ('tests/**\/*.test.ts') in regex, per la prova di disgiunzione. Un solo
 * passaggio con un replacer: ogni token ('**\/', '**', '*', un carattere regex-speciale) e' tradotto
 * esattamente una volta, senza segnaposto — cosi' il '*' introdotto da '(?:.*\/)?' non viene poi
 * ri-tradotto.
 */
function matchesGlob(path: string, glob: string): boolean {
  const body = glob.replace(/\*\*\/|\*\*|\*|[.+^${}()|[\]\\]/g, (token) => {
    if (token === '**/') return '(?:.*/)?';
    if (token === '**') return '.*';
    if (token === '*') return '[^/]*';
    return '\\' + token;
  });
  return new RegExp('^' + body + '$').test(path);
}

// ── AC-240-5 — il runner prevede il solo Chromium ─────────────────────────────
describe('T-240 AC-240-5 — un solo browser: chromium', () => {
  // Il browser e' dichiarato nel CODICE della config, non nei commenti: si spogliano i commenti
  // (di riga e di blocco, preservando il '//' dentro gli URL) prima di cercare i motori, altrimenti
  // una frase come "nessun altro motore" trarrebbe in inganno il controllo per sottostringa.
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const configText = stripComments(readFileSync(join(ROOT, 'playwright.config.ts'), 'utf8'));

  // covers: AC-240-5
  it('playwright.config dichiara esattamente un browserName, e vale chromium', () => {
    const browsers = [...configText.matchAll(/browserName:\s*['"]([a-z]+)['"]/g)].map((m) => m[1]);
    expect(browsers.length).toBeGreaterThan(0); // non vacuo: un browser E' dichiarato // covers: AC-240-5
    expect(browsers).toEqual(['chromium']); // covers: AC-240-5
    expect(configText.includes('firefox')).toBe(false); // covers: AC-240-5
    expect(configText.includes('webkit')).toBe(false); // covers: AC-240-5
  });
});

// ── AC-240-4 — suite unitaria e e2e sono insiemi disgiunti ────────────────────
describe('T-240 AC-240-4 — vitest e e2e raccolgono insiemi disgiunti', () => {
  const vitestText = readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8');
  const includeBlock = vitestText.match(/include:\s*\[([^\]]*)\]/);
  const includeGlobs = includeBlock
    ? [...includeBlock[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
    : [];

  // covers: AC-240-4
  it('il vitest include e confinato a tests/ e a *.test.ts(x), senza alcun *.spec', () => {
    expect(includeGlobs.length).toBeGreaterThan(0); // covers: AC-240-4
    for (const glob of includeGlobs) {
      expect(glob.startsWith('tests/')).toBe(true); // covers: AC-240-4
      expect(/\.test\.tsx?$/.test(glob)).toBe(true); // covers: AC-240-4
      expect(glob.includes('.spec')).toBe(false); // covers: AC-240-4
    }
  });

  // covers: AC-240-4
  it('gli spec e2e vivono sotto e2e/ come *.spec.ts e NESSUNO e raccolto dal vitest', () => {
    const e2eSpecs = walk(join(ROOT, 'e2e'), { skipDirs: SKIP_DIRS })
      .filter((path) => path.endsWith('.spec.ts'))
      .map(rel);
    expect(e2eSpecs.length).toBeGreaterThan(0); // almeno harness.spec.ts // covers: AC-240-4
    for (const spec of e2eSpecs) {
      expect(spec.startsWith('e2e/')).toBe(true); // covers: AC-240-4
      expect(spec.startsWith('tests/')).toBe(false); // covers: AC-240-4
      expect(/\.test\.tsx?$/.test(spec)).toBe(false); // estensione diversa // covers: AC-240-4
    }
    // La disgiunzione vera: nessuno spec e2e e' catturato da un glob del vitest.
    const collectedByUnit = e2eSpecs.filter((spec) => includeGlobs.some((glob) => matchesGlob(spec, glob)));
    expect(collectedByUnit).toEqual([]); // covers: AC-240-4
  });

  // covers: AC-240-4
  it('questo file di confinamento GIRA nella suite unitaria (contro-prova: gli insiemi sono davvero due)', () => {
    const self = rel(SELF);
    expect(self.startsWith('tests/')).toBe(true); // covers: AC-240-4
    expect(includeGlobs.some((glob) => matchesGlob(self, glob))).toBe(true); // covers: AC-240-4
  });
});

// ── AC-240-3 — il canary e confinato al test e fuori dal bundle ───────────────
describe('T-240 AC-240-3 — il canary e confinato a e2e/ e non raggiungibile', () => {
  // covers: AC-240-3
  it('il marker del canary vive SOLO sotto e2e/ (nessun sorgente di produzione lo contiene)', () => {
    const files = walk(ROOT, { skipDirs: SKIP_DIRS, ext: TEXT_EXT }).filter((path) => path !== SELF);
    const withMarker = files.filter((path) => contains(path, CANARY_MARKER)).map(rel);

    // Non vacuo: il canary esiste davvero (altrimenti il grep sarebbe vero per assenza).
    expect(withMarker.length).toBeGreaterThan(0); // covers: AC-240-3
    // Ogni occorrenza e' sotto e2e/: mai src/, mai altrove nel repo.
    for (const file of withMarker) {
      expect(file.startsWith('e2e/')).toBe(true); // covers: AC-240-3
    }
    // In particolare, NESSUN file di produzione (src/**) lo contiene.
    expect(withMarker.some((file) => file.startsWith('src/'))).toBe(false); // covers: AC-240-3
  });

  // covers: AC-240-3
  it('nessun file src/** importa il modulo del canary (e2e/canary): nessuna rotta lo raggiunge', () => {
    const srcFiles = walk(join(ROOT, 'src'), { skipDirs: SKIP_DIRS, ext: TEXT_EXT });
    const importers = srcFiles.filter((path) => /e2e[\\/]canary/.test(readSafe(path))).map(rel);
    expect(importers).toEqual([]); // covers: AC-240-3
  });

  // covers: AC-240-3
  it('il canary vive sotto e2e/canary/ e porta il marker nel proprio sorgente', () => {
    const canaryDir = join(ROOT, 'e2e', 'canary');
    expect(existsSync(canaryDir)).toBe(true); // covers: AC-240-3
    const canaryFiles = walk(canaryDir, { skipDirs: SKIP_DIRS });
    const marked = canaryFiles.filter((path) => contains(path, CANARY_MARKER)).map(rel);
    expect(marked.length).toBeGreaterThan(0); // covers: AC-240-3
    for (const file of marked) {
      expect(file.startsWith('e2e/canary/')).toBe(true); // covers: AC-240-3
    }
  });

  // covers: AC-240-3
  it('il bundle di produzione (.next) NON contiene il marker del canary', () => {
    const nextDir = join(ROOT, '.next');
    if (!existsSync(nextDir)) return; // skipIf: build assente nel giro per-task
    const built = walk(nextDir, {
      skipDirs: new Set(['cache']),
      ext: new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.map', '.txt']),
    });
    const leaked = built.filter((path) => contains(path, CANARY_MARKER)).map((path) => rel(path));
    expect(leaked).toEqual([]); // covers: AC-240-3
  });
});
