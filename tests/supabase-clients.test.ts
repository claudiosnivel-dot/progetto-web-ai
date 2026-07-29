import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { ESLint } from 'eslint';

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

// I due test qui sopra leggono eslint.config.mjs come TESTO: provano che due
// stringhe compaiono nel file, non che la regola valga qualcosa. Sostituendo
// l'intero blocco con "'no-restricted-imports': 'off'" entrambe le stringhe
// restano (nei commenti e nelle costanti supabaseAdminPaths/Patterns) e il file
// resta verde: il confine che bypassa la RLS puo' essere spento senza che nulla
// protesti. I test che seguono ESEGUONO la regola con ESLint sui moduli reali
// del repo, come gia' si fa per il confine LLM (tests/anthropic-boundary.test.ts).

// I moduli che finiscono nel bundle del browser NON si riconoscono dal percorso
// (in App Router una page con 'use client' vive sotto src/app/**, non solo in
// src/ui/**): si enumerano dalla direttiva. Il divieto va provato su TUTTI,
// non su un percorso di comodo.
function clientModules(dir = resolve(root, 'src')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return clientModules(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    return /^\s*['"]use client['"]/m.test(readFileSync(full, 'utf8')) ? [full] : [];
  });
}

// Sorgente-fixture: l'unica cosa che fa e' importare il client service_role.
// E' l'import a dover essere giudicato, non il resto del modulo.
const ADMIN_IMPORT_FIXTURE =
  "import { createAdminClient } from '@/data/supabase-admin';\n\nexport const seam = createAdminClient;\n";

const RULE = 'no-restricted-imports';

describe('T-002 confine service_role: la regola ESLint viene eseguita, non solo citata', () => {
  // MUTAZIONE CHE LO FA DIVENTARE ROSSO: in eslint.config.mjs sostituire il blocco
  // di default (files: src/**, tests/**) con "'no-restricted-imports': 'off'",
  // oppure togliere supabaseAdminPaths/supabaseAdminPatterns da quel blocco,
  // oppure abbassare la severita' da 'error' a 'warn'. Tutte e tre passano oggi
  // i due test testuali qui sopra.
  // covers: AC-002-6
  it('OGNI modulo client reale che importa @/data/supabase-admin fallisce il lint con severita error e per quel motivo', async () => {
    const eslint = new ESLint({ cwd: root });

    const modules = clientModules();
    expect(modules.length).toBeGreaterThan(0); // covers: AC-002-6 — guardia anti-vacuita: i moduli client esistono davvero
    // Il layer app deve essere rappresentato: e' li' che App Router mette le page
    // 'use client', quelle che un divieto limitato a src/ui/** non coprirebbe.
    expect(modules.some((m) => relative(root, m).replace(/\\/g, '/').startsWith('src/app/'))).toBe(
      true,
    ); // covers: AC-002-6

    for (const filePath of modules) {
      const [result] = await eslint.lintText(ADMIN_IMPORT_FIXTURE, { filePath });
      const where = relative(root, filePath);
      // Anti-placebo: se il file non venisse nemmeno parsato, l'assenza/presenza
      // di messaggi non direbbe nulla sulla regola.
      expect(
        result.messages.some((m) => m.fatal === true),
        `errore di parsing su ${where}`,
      ).toBe(false); // covers: AC-002-6
      const restricted = result.messages.filter((m) => m.ruleId === RULE);
      expect(restricted.length, `nessun errore ${RULE} su ${where}`).toBeGreaterThan(0); // covers: AC-002-6 — import lato client = errore di lint
      expect(
        restricted.every((m) => m.severity === 2),
        `warning invece di error su ${where}`,
      ).toBe(true); // covers: AC-002-6 — severita error: un warning non blocca nulla
      expect(
        restricted.some((m) => m.message.includes('supabase-admin')),
        `a bloccare ${where} non e' il confine service_role`,
      ).toBe(true); // covers: AC-002-6 — e' proprio supabase-admin a essere vietato, non un'altra rotta
    }
  });

  // Verso opposto, oggi non coperto da nessun test: senza questo, una regola che
  // vieta l'import A CHIUNQUE (nessuna eccezione per i moduli server designati)
  // supererebbe il test qui sopra pur rompendo il progetto. Si proverebbe che la
  // regola e' severa, non che e' MIRATA.
  // MUTAZIONE CHE LO FA DIVENTARE ROSSO: in eslint.config.mjs cancellare l'ultimo
  // blocco (files: src/data/**, tests/** -> 'no-restricted-imports': 'off'),
  // o rimuovere 'src/data/**' dai suoi files.
  // covers: AC-002-6 (verso permissivo: "fuori dai moduli server" implica che
  // DENTRO i moduli server l'import resti lecito)
  it('un modulo server designato sotto src/data/ puo importare @/data/supabase-admin senza errori di lint', async () => {
    const eslint = new ESLint({ cwd: root });
    const serverModule = resolve(root, 'src/data/sites.ts'); // modulo server reale ('use server'), non un percorso inventato

    const [result] = await eslint.lintText(ADMIN_IMPORT_FIXTURE, { filePath: serverModule });

    expect(result.messages.some((m) => m.fatal === true)).toBe(false); // covers: AC-002-6 — anti-placebo: nessun errore di parsing
    expect(result.messages.filter((m) => m.ruleId === RULE)).toEqual([]); // covers: AC-002-6
  });

  // Il confine e' mirato ma non generoso: solo src/data/** e' esentato. Il layer
  // di dominio e' server, eppure deve passare dai moduli dati.
  // MUTAZIONE CHE LO FA DIVENTARE ROSSO: aggiungere 'src/domain/**' ai files del
  // blocco che spegne la regola, o togliere supabaseAdminPaths/Patterns dal
  // blocco src/domain/**.
  // Oltre AC-002-6: l'AC parla dei "moduli server designati"; questo pinna che
  // "server" da solo non basta a ottenere la service_role.
  it('il layer di dominio, pur essendo server, resta soggetto al divieto', async () => {
    const eslint = new ESLint({ cwd: root });
    const domainModule = resolve(root, 'src/domain/onboarding/interview.ts');

    const [result] = await eslint.lintText(ADMIN_IMPORT_FIXTURE, { filePath: domainModule });

    expect(result.messages.some((m) => m.fatal === true)).toBe(false); // anti-placebo
    const restricted = result.messages.filter((m) => m.ruleId === RULE);
    expect(restricted.length).toBeGreaterThan(0);
    expect(restricted.every((m) => m.severity === 2)).toBe(true);
    expect(restricted.some((m) => m.message.includes('supabase-admin'))).toBe(true);
  });
});
