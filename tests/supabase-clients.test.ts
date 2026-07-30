import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
// LE TRE FORME CHE IL CONFINE NON VEDEVA.
//
// Tutto quello che precede prova UNA forma sola: l'import STATICO con l'alias.
// Le altre tre famiglie sono state misurate sulla configurazione VERA e davano
// TUTTE 0 messaggi da ogni percorso del repo, mentre quella statica ne dava 2 —
// cioe' il divieto si aggirava scegliendo come scrivere l'import.
//   - DINAMICA. 'no-restricted-imports' aggancia soltanto ImportDeclaration,
//     ExportNamedDeclaration ed ExportAllDeclaration: nessun handler per
//     ImportExpression (verificato nel sorgente della regola). Serve la seconda
//     regola, 'no-restricted-syntax'.
//   - CON ESTENSIONE '.js'. moduleResolution 'bundler' la risolve allo STESSO file e
//     'npm run typecheck' la accetta senza fiatare, ma sfuggiva sia a `paths` (che
//     confronta la stringa esatta) sia ai pattern (che non terminano con l'estensione).
//   - FILE NON-TS. Col glob '{ts,tsx}' un .jsx o un .mjs sotto src/** non incontrava
//     NESSUNA restrizione, e tsconfig ha `allowJs`: e' codice che finisce nel bundle
//     come un .tsx.
//
// QUANTO PESA, detto senza gonfiarlo: supabase-admin.ts ha import 'server-only' come
// prima riga (pinnato dal test in cima a questo file), quindi se finisse in un bundle
// client il BUILD fallirebbe comunque. Questo strato non e' l'ultima difesa — e' il
// solo che da' un errore LEGGIBILE, che nomina il confine, e che arriva PRIMA del
// build; ed e' un gate della CI. Difesa in profondita'.
//
// I fixture sono VIRTUALI (lintText su un filePath che puo' non esistere): 'npm run
// lint' e' un gate della CI, quindi un file in violazione lasciato nel repo renderebbe
// la CI rossa per costruzione. E' il precedente di T-131 e di T-211.

// Le due regole che COMPONGONO il confine. Guardarne una sola lascerebbe fuori meta'
// del meccanismo senza che nessuna asserzione se ne accorga.
const REGOLE_DEL_CONFINE = ['no-restricted-imports', 'no-restricted-syntax'];

const eslintDelConfine = new ESLint({ cwd: root });

/**
 * Gli errori delle regole del confine prodotti da un sorgente linta a un certo percorso.
 *
 * La GUARDIA ANTI-PLACEBO sta qui dentro: un errore di PARSING avrebbe `ruleId` null e
 * svuoterebbe il filtro, quindi ogni ramo negativo passerebbe per un fixture che non
 * compila invece che per una regola mirata.
 */
async function erroriDelConfine(source: string, percorso: string) {
  const [risultato] = await eslintDelConfine.lintText(source, {
    filePath: resolve(root, percorso),
  });
  expect(
    risultato.messages.filter((messaggio) => messaggio.fatal === true),
    `errore di parsing sul fixture di ${percorso}`,
  ).toEqual([]);
  return risultato.messages.filter(
    (messaggio) => messaggio.ruleId !== null && REGOLE_DEL_CONFINE.includes(messaggio.ruleId),
  );
}

// LE SETTE FORME con cui un modulo puo' raggiungere il client service_role. Ognuna
// risolve allo stesso file. La `regola` attesa e' DICHIARATA forma per forma, cosi'
// l'elenco dice anche CON QUALE meccanismo ciascuna e' presa: senza, togliere la meta'
// dinamica del confine lascerebbe tutto verde sulle sole forme statiche.
const FORME_VIETATE_ADMIN = [
  {
    forma: "statica, alias '@/data/supabase-admin'",
    regola: 'no-restricted-imports',
    source:
      "import { createAdminClient } from '@/data/supabase-admin';\n\nexport const seam = createAdminClient;\n",
  },
  {
    forma: "statica, relativa '../data/supabase-admin'",
    regola: 'no-restricted-imports',
    source:
      "import { createAdminClient } from '../data/supabase-admin';\n\nexport const seam = createAdminClient;\n",
  },
  {
    forma: "con estensione, alias '@/data/supabase-admin.js'",
    regola: 'no-restricted-imports',
    source:
      "import { createAdminClient } from '@/data/supabase-admin.js';\n\nexport const seam = createAdminClient;\n",
  },
  {
    forma: "con estensione, relativa '../data/supabase-admin.js'",
    regola: 'no-restricted-imports',
    source:
      "import { createAdminClient } from '../data/supabase-admin.js';\n\nexport const seam = createAdminClient;\n",
  },
  {
    forma: "dinamica, alias import('@/data/supabase-admin')",
    regola: 'no-restricted-syntax',
    source: "export const carica = () => import('@/data/supabase-admin');\n",
  },
  {
    forma: "dinamica, relativa dentro await import('../data/supabase-admin')",
    regola: 'no-restricted-syntax',
    source:
      "export async function seam() {\n  const mod = await import('../data/supabase-admin');\n  return mod;\n}\n",
  },
  {
    forma: "dinamica con estensione, import('@/data/supabase-admin.js')",
    regola: 'no-restricted-syntax',
    source: "export const carica = () => import('@/data/supabase-admin.js');\n",
  },
  {
    // L'OTTAVA FORMA, ed e' costata un giro di verifica: un TEMPLATE LITERAL senza buchi.
    // Il suo nodo ha source.type === 'TemplateLiteral', non 'Literal', quindi il primo
    // selector non lo vedeva: misurato 0 messaggi da tutti e otto i layer, contro 1 della
    // forma con gli apici. Costa un carattere a chi la scrive e TypeScript la risolve allo
    // stesso modulo. La prende il secondo selector, quello su TemplateElement.
    forma: 'dinamica con TEMPLATE LITERAL senza buchi, import(`@/data/supabase-admin`)',
    regola: 'no-restricted-syntax',
    source: 'export const carica = () => import(`@/data/supabase-admin`);\n',
  },
];

// I LAYER SOGGETTI AL DIVIETO, uno per ciascuno dei quattro che il config distingue e
// nelle due estensioni. Non e' ridondanza: il divieto e' scritto in blocchi diversi
// (base, dominio, sito) e in flat config le opzioni della stessa regola si
// SOSTITUISCONO invece di sommarsi, quindi un layer puo' perdere il confine mentre gli
// altri lo tengono. I tre percorsi NON-TS coprono il terzo buco (`allowJs`).
const PERCORSI_SOGGETTI_ADMIN = [
  'src/ui/onboarding/ChatPanel.tsx', // UI del builder (blocco base), file VERO
  'src/app/[locale]/page.tsx', // App Router: qui vivono le page 'use client', file VERO
  'src/domain/onboarding/interview.ts', // dominio: server, ma non e un modulo dati, file VERO
  'src/ui/site/Hero.tsx', // layer del sito generato (T-231), non ancora su disco
  'src/ui/onboarding/Legacy.jsx', // NON-TS fuori da src/ui/site/
  'src/app/[locale]/legacy.mjs', // NON-TS sotto src/app/
  'src/domain/generation/legacy.jsx', // NON-TS nel dominio
  // Le tre estensioni che il glob elenca e che nessun caso esercitava: misurato,
  // togliendo '.cjs', '.mts' e '.cts' dal glob del blocco base la suite restava verde.
  // Un glob piu' largo del provato e' il verso sicuro in cui sbagliare, ma resta una
  // copertura che il prossimo refactor puo' togliere senza accorgersene.
  'src/ui/onboarding/legacy.cts', // NON-TS, estensione fuori dal caso comune
];

// I DUE LAYER ESENTATI, e sono FILE VERI: i moduli server designati e gli helper di
// test. Un percorso inventato resterebbe pulito comunque e il ciclo continuerebbe a
// passare senza piu' dire nulla. L'unico virtuale e' il .mjs, che serve a provare che
// anche l'ESENZIONE e' stata estesa ai file non-TS: se il blocco base coprisse i .mjs
// e il blocco che spegne la regola no, src/data/legacy.mjs diventerebbe un errore su
// codice corretto.
const PERCORSI_ESENTATI_ADMIN = [
  { percorso: 'src/data/sites.ts', vero: true },
  { percorso: 'src/data/generations.ts', vero: true },
  { percorso: 'tests/supabase-clients.test.ts', vero: true },
  { percorso: 'src/data/legacy.mjs', vero: false },
  // L'altra meta' della copertura sulle estensioni rare: l'ESENZIONE deve valere sulle
  // stesse otto del blocco base. Se il blocco base coprisse i .cjs e il blocco che spegne
  // la regola no, un modulo server CommonJS diventerebbe un errore su codice corretto.
  { percorso: 'src/data/legacy.cjs', vero: false },
];

// Cio' che deve restare LECITO OVUNQUE. Le tre forme dinamiche sono il ramo che
// impedisce alla regola nuova di essere troppo larga: il selector guarda il VALORE del
// literal, quindi vieta un import() del client admin e NON import() in quanto tale — un
// selector sciatto (il solo `ImportExpression`) romperebbe il code splitting
// dell'intera app e nessun'altra asserzione di questo file lo vedrebbe.
const IMPORT_LECITI_OVUNQUE = [
  {
    forma: 'il client BROWSER, che e client-safe per costruzione',
    source:
      "import { createBrowserSupabaseClient } from '@/data/supabase-browser';\n\nexport const seam = createBrowserSupabaseClient;\n",
  },
  {
    forma: 'una libreria esterna caricata in modo dinamico',
    source: "export const f = () => import('react');\n",
  },
  {
    forma: 'un modulo di dominio caricato in modo dinamico',
    source: "export const f = () => import('@/domain/generation/themes');\n",
  },
  {
    forma: 'l SDK Supabase caricato in modo dinamico',
    source: "export const f = () => import('@supabase/ssr');\n",
  },
  {
    // Il ramo che tiene onesto il selector NUOVO sul template: un template CON un buco e'
    // una forma legittima e diffusa, e nel repo esiste per davvero
    // (src/i18n/request.ts carica i cataloghi cosi'). Il selector guarda il testo GREZZO
    // del pezzo di template, quindi non lo tocca. Senza questa riga, un selector scritto
    // sul solo nodo TemplateLiteral romperebbe quel caso e nulla lo direbbe.
    forma: 'un template literal CON un buco, la forma che carica i cataloghi i18n',
    source: 'export const f = (n: string) => import(`../../messages/${n}.json`);\n',
  },
];

describe('T-002 confine service_role: le forme equivalenti dell import, non solo quella statica con alias', () => {
  // MUTAZIONE CHE LO FA DIVENTARE ROSSO, una per forma: togliere
  // '**/supabase-admin.*' da supabaseAdminPatterns (cadono le due forme con
  // estensione); togliere 'no-restricted-syntax' dal blocco base (cadono le tre
  // dinamiche su ui/app); toglierla dal blocco del dominio o da quello del sito
  // (cadono le dinamiche su quei due layer soltanto); riportare i `files` dei blocchi
  // a '{ts,tsx}' (cadono i tre percorsi non-TS in ogni forma).
  // covers: AC-002-6
  it('OGNI forma equivalente dell import del client service_role e un errore di lint, da OGNI layer soggetto', async () => {
    // Guardia anti-vacuita': i due elenchi hanno la taglia DICHIARATA, quindi il ciclo
    // esercita 49 casi e non zero. Le lunghezze sono scritte SEPARATE apposta: il solo
    // prodotto sopravviverebbe a un elenco svuotato e all'altro gonfiato.
    expect(FORME_VIETATE_ADMIN).toHaveLength(8); // covers: AC-002-6
    expect(PERCORSI_SOGGETTI_ADMIN).toHaveLength(8); // covers: AC-002-6

    for (const percorso of PERCORSI_SOGGETTI_ADMIN) {
      for (const { forma, regola, source } of FORME_VIETATE_ADMIN) {
        const errori = await erroriDelConfine(source, percorso);
        const dove = `${percorso} / ${forma}`;

        expect(errori.length, `nessun errore su ${dove}`).toBeGreaterThan(0); // covers: AC-002-6
        expect(
          errori.every((errore) => errore.severity === 2),
          `warning invece di error su ${dove}`,
        ).toBe(true); // covers: AC-002-6 — un warning non blocca nulla
        expect(
          errori.some((errore) => errore.message.includes('supabase-admin')),
          `a bloccare ${dove} non e il confine service_role`,
        ).toBe(true); // covers: AC-002-6
        // E ad averlo bloccato e' il meccanismo che tocca a quella forma: le statiche
        // 'no-restricted-imports', le dinamiche 'no-restricted-syntax'.
        expect(
          errori.some((errore) => errore.ruleId === regola),
          `${dove}: preso da [${errori.map((errore) => errore.ruleId).join(',')}] invece che da ${regola}`,
        ).toBe(true); // covers: AC-002-6
      }
    }
  });

  // Il verso permissivo, esteso alle stesse sette forme: senza, una regola che vieta
  // l'import A CHIUNQUE supererebbe il ciclo qui sopra pur rompendo i moduli server.
  // MUTAZIONE CHE LO FA DIVENTARE ROSSO: togliere 'no-restricted-syntax': 'off' dal
  // blocco che esenta src/data/** e tests/** (cadono le tre forme dinamiche), o
  // riportare i suoi `files` a '{ts,tsx}' (cade il percorso .mjs).
  // covers: AC-002-6 (verso permissivo)
  it('i moduli server designati e gli helper di test restano liberi in TUTTE le forme', async () => {
    expect(PERCORSI_ESENTATI_ADMIN).toHaveLength(5); // covers: AC-002-6

    for (const { percorso, vero } of PERCORSI_ESENTATI_ADMIN) {
      if (vero) {
        expect(existsSync(resolve(root, percorso)), `non e un file vero: ${percorso}`).toBe(true); // covers: AC-002-6
      }
      for (const { forma, source } of FORME_VIETATE_ADMIN) {
        const errori = await erroriDelConfine(source, percorso);
        expect(errori, `${percorso} / ${forma}`).toEqual([]); // covers: AC-002-6
      }
    }
  });

  // La regola nuova nomina un MODULO, non la sintassi import(). Se il selector vietasse
  // ImportExpression in quanto tale, il code splitting dell'intera app sarebbe rotto e
  // i due cicli qui sopra resterebbero verdi.
  // MUTAZIONE CHE LO FA DIVENTARE ROSSO: nel selector, sostituire
  // "ImportExpression[source.type='Literal'][source.value=/supabase-admin/]" con il
  // solo "ImportExpression".
  it('import() di qualunque altro modulo resta lecito da ogni layer: il selector guarda il VALORE, non la sintassi', async () => {
    expect(IMPORT_LECITI_OVUNQUE).toHaveLength(5);

    for (const percorso of PERCORSI_SOGGETTI_ADMIN) {
      for (const { forma, source } of IMPORT_LECITI_OVUNQUE) {
        const errori = await erroriDelConfine(source, percorso);
        expect(errori, `${percorso} / ${forma}`).toEqual([]);
      }
    }
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
