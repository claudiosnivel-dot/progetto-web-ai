import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { ESLint } from 'eslint';
import { createServerSupabaseClient, getUserFromRequest } from '@/data/supabase-ssr';

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

// ---------------------------------------------------------------------------
// Il confine service_role, nel verso finora mancante.
//
// Tutto quello che precede guarda un lato solo: che supabase-browser non NOMINI
// la service_role, che supabase-admin abbia 'server-only', che l'import di
// supabase-admin sia vietato lato client. Nessuno guarda il TERZO client, quello
// SSR — che e il piu esposto dei tre. Se ssrEnv() restituisse la service_role al
// posto della anon key, ogni Server Component, ogni Server Action e il middleware
// girerebbero con la RLS BYPASSATA, e nessuna delle difese qui sopra se ne
// accorgerebbe: l'import vietato non c'e, il file 'server-only' non c'entra, il
// sorgente del client browser e immacolato. E il caso in cui non esiste seconda
// linea, perche a essere disattivata e proprio la RLS.
//
// La verifica e a COMPORTAMENTO, non sul testo del sorgente: alle due chiavi si
// danno valori distinguibili e si guarda con QUALE delle due il client viene
// davvero costruito. Un test che leggesse il sorgente si aggirerebbe con un
// alias, una variabile intermedia o un `process.env[nome]`.
const { ssrCalls } = vi.hoisted(() => ({ ssrCalls: [] as unknown[][] }));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => {
    ssrCalls.push(args);
    return {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
      },
    };
  },
}));

// next/headers non esiste fuori dal runtime di Next: qui e solo il TRASPORTO dei
// cookie e non e l'oggetto di questi test.
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [] as { name: string; value: string }[],
    get: () => undefined,
    set: () => {},
    delete: () => {},
  }),
}));

const URL_SENTINELLA = 'https://sentinella.supabase.test';
const ANON_SENTINELLA = 'CHIAVE-ANON-SENTINELLA-aaa111';
const SERVICE_ROLE_SENTINELLA = 'CHIAVE-SERVICE-ROLE-SENTINELLA-zzz999';

// La sentinella si cerca in TUTTI gli argomenti, in profondita: non basta
// guardare il secondo posizionale, perche la service_role potrebbe raggiungere il
// client anche per altra via (es. global.headers.Authorization).
function contieneSentinella(value: unknown, ago: string): boolean {
  if (typeof value === 'string') return value.includes(ago);
  if (Array.isArray(value)) return value.some((v) => contieneSentinella(v, ago));
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) => contieneSentinella(v, ago));
  }
  return false;
}

describe('T-002/T-041 il client SSR e costruito con la anon key, mai con la service_role', () => {
  beforeEach(() => {
    ssrCalls.length = 0;
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_SENTINELLA);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON_SENTINELLA);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_SENTINELLA);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // MUTAZIONE CHE LO RENDE ROSSO: in src/data/supabase-ssr.ts, dentro ssrEnv(),
  // `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY` -> `process.env.SUPABASE_SERVICE_ROLE_KEY`.
  // Oggi quella sostituzione lascia 25 test su 25 verdi mentre bypassa la RLS in
  // ogni Server Component e in ogni Server Action.
  // Oltre AC-002-2 (che parla del solo client browser): pinna la DoD di T-041
  // ("client SSR ... usa NEXT_PUBLIC_SUPABASE_ANON_KEY, mai service_role") e la
  // security_note R7 comune a T-002 e T-041.
  it('nel contesto Server Component/Server Action il client SSR riceve la ANON key e la service_role non compare fra i suoi argomenti', async () => {
    // Anti-vacuita: la service_role e davvero nell'ambiente ed e distinguibile
    // dalla anon. Senza questa guardia, "non compare" sarebbe vero per
    // costruzione — la forma di verde finto piu banale.
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe(SERVICE_ROLE_SENTINELLA);
    expect(ANON_SENTINELLA).not.toBe(SERVICE_ROLE_SENTINELLA);

    await createServerSupabaseClient();

    // Anti-vacuita: il client e stato costruito una volta sola e davvero.
    expect(ssrCalls.length).toBe(1);
    const [url, key] = ssrCalls[0];
    expect(url).toBe(URL_SENTINELLA);
    expect(key).toBe(ANON_SENTINELLA);
    expect(contieneSentinella(ssrCalls[0], SERVICE_ROLE_SENTINELLA)).toBe(false);
  });

  // MUTAZIONE CHE LO RENDE ROSSO: la stessa sostituzione in ssrEnv() — che
  // serve ENTRAMBI i punti d'ingresso — oppure una service_role passata solo qui.
  // Questo e il client che gira nel middleware, cioe su ogni richiesta alle rotte
  // protette: e il posto in cui un bypass di RLS sarebbe piu ampio e piu muto.
  // Oltre AC-002-2: stessa proprieta, altro punto d'ingresso del modulo.
  it('anche il client SSR del middleware (getUserFromRequest) riceve la ANON key e mai la service_role', async () => {
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe(SERVICE_ROLE_SENTINELLA);

    const request = { cookies: { getAll: () => [{ name: 'sb-access-token', value: 'AAA' }] } };
    await getUserFromRequest(request as unknown as Parameters<typeof getUserFromRequest>[0]);

    expect(ssrCalls.length).toBe(1);
    const [url, key] = ssrCalls[0];
    expect(url).toBe(URL_SENTINELLA);
    expect(key).toBe(ANON_SENTINELLA);
    expect(contieneSentinella(ssrCalls[0], SERVICE_ROLE_SENTINELLA)).toBe(false);
  });
});
