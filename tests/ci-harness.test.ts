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

// --- Audit degli oracoli · §6 «Fragilità dell'harness» ------------------------
// MISURA che motiva questo blocco: `.github/workflows/ci.yml` eseguiva soltanto
// `npm ci`, `npm run typecheck`, `npm test`, `npm run knip`. Nessun database, e
// quindi 139 test su 632 si SKIPPANO: l'INTERA superficie di sicurezza (RLS,
// tenancy, auth, siti, brief, generazioni) non è mai stata eseguita da una run di
// CI. Il buco non era solo nel workflow, era negli oracoli: `supabase-local.test.ts`
// è a sua volta `skipIf(!DB)`, e il test strutturale qui sopra verifica che il
// workflow INVOCHI `npm test` — cosa che faceva, saltando 139 test in silenzio.
// «Invocato» e «eseguito» non sono la stessa cosa, ed è la seconda che conta.

// I quattro nomi che il codice legge DAVVERO: tests/helpers/supabase-test.ts
// (url + anon + service_role), tests/helpers/pg.ts (DATABASE_URL) e le guardie
// `skipIf` dei test DB-backed. Sono la sorgente unica di questo blocco: la guardia
// a runtime e l'asserzione strutturale sul workflow leggono entrambe da qui, così
// rinominare una variabile da un lato solo rende rosso l'altro lato.
const DB_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
] as const;

const CI_WORKFLOW = '.github/workflows/ci.yml';

// Il workflow viene SPOGLIATO DEI COMMENTI prima di cercarci dentro. Non è un
// dettaglio: la prima stesura di questi test asseriva `toContain('npm run lint')` e
// la mutazione «togli lo step del lint» è rimasta VERDE, perché la stringa compariva
// in un commento del workflow. È lo stesso difetto — «presenza invece di valore» —
// che l'audit ha censito altrove, riprodotto qui dal rimedio stesso: un commento non
// esegue niente, e un oracolo che lo accetta come prova non prova niente.
// Stesso rimedio già adottato in tests/auto_provision.test.ts per il corpo SQL.
const readWorkflowEseguibile = () =>
  read(CI_WORKFLOW)
    .split('\n')
    .filter((riga) => !/^\s*#/.test(riga))
    .join('\n');

describe('AUDIT §6 — la CI provisiona Supabase e i test DB-backed GIRANO', () => {
  // MUTAZIONE CHE LO RENDE ROSSO, eseguibile da qui e senza database:
  //   CI=1 DATABASE_URL= npx vitest run tests/ci-harness.test.ts
  // (una qualunque delle quattro assente o vuota, con CI attiva → rosso, e il
  // messaggio dice QUALE manca).
  // La mutazione che difende sul serio è sul workflow: togliere `supabase start`
  // oppure lo step che esporta le variabili in GITHUB_ENV. In quel caso una run di
  // CI non ne ha nessuna delle quattro e diventa ROSSA E LEGGIBILE, invece di verde
  // con 139 test spariti in silenzio — che è esattamente lo stato misurato prima.
  // Fuori dalla CI (`CI` non impostata) `richieste` è vuoto: passa senza rumore,
  // senza `skipped` a referto e senza pretendere un database da chi non ce l'ha.
  it('quando CI è attiva, le quattro variabili dello stack Supabase sono presenti', () => {
    const richieste: readonly string[] = process.env.CI ? DB_ENV_VARS : [];
    const mancanti = richieste.filter((name) => !process.env[name]);
    expect(
      mancanti,
      "CI attiva ma lo stack Supabase non è provisionato: senza queste variabili i test di RLS, tenancy e auth si SKIPPANO in silenzio e la run resta verde senza aver verificato nulla dell'isolamento multi-tenant",
    ).toEqual([]);
  });

  // MUTAZIONE: togliere da .github/workflows/ci.yml lo step `- run: supabase start`
  // (o l'`uses: supabase/setup-cli@v1` che lo rende invocabile) → rosso.
  // È tollerante alla forma equivalente `npm run db:start`, che in package.json è
  // letteralmente `supabase start`: l'asserzione difende il FATTO che lo stack venga
  // avviato, non una stringa particolare con cui lo si avvia.
  it('il workflow avvia lo stack Supabase prima dei test', () => {
    const ci = readWorkflowEseguibile();
    expect(ci, 'la CLI supabase non è installata nel runner').toContain('supabase/setup-cli');
    expect(ci, 'nessuno step avvia lo stack: i test DB-backed si skipperebbero').toMatch(
      /run:\s*(npx\s+)?supabase\s+start\b|run:\s*npm run db:start\b/,
    );
  });

  // MUTAZIONE: togliere da .github/workflows/ci.yml la riga `- run: npm run lint`.
  // Misurato dall'audit (rilievo A3-07): né `npm test` né la CI invocavano mai il
  // lint, quindi la regola ESLint che difende il confine service_role non era
  // eseguita da ALCUN gate automatico. Ora `anthropic-boundary.test.ts` esegue la
  // regola dentro la suite; questa asserzione difende l'altro lato, cioè che il lint
  // vero — quello che vede TUTTO il repo, non i soli moduli scelti dal test — sia un
  // gate di CI e non un comando che qualcuno deve ricordarsi di lanciare a mano.
  //
  // Copre anche gli altri tre comandi come `run:` VERI e non come sottostringhe
  // qualsiasi: il test preesistente («il workflow CI invoca typecheck, test e knip»)
  // usa `toContain`, quindi da oggi che il workflow ha dei commenti sarebbe
  // soddisfatto anche da un comando soltanto NOMINATO. Questa è l'asserzione che
  // regge quella proprietà; il test preesistente non è stato toccato.
  // MUTAZIONE aggiuntiva: trasformare `- run: npm run knip` in un commento → rosso.
  it('il workflow invoca npm run lint (e gli altri gate) come step eseguiti', () => {
    const ci = readWorkflowEseguibile();
    for (const comando of ['npm run typecheck', 'npm run lint', 'npm test', 'npm run knip']) {
      expect(ci, `${comando} non è uno step eseguito del workflow`).toMatch(
        new RegExp(String.raw`^\s*-?\s*run:\s*${comando}\s*$`, 'm'),
      );
    }
  });

  // MUTAZIONE: cancellare dallo step di export una delle quattro righe
  // `--override-name <chiave>=<NOME>`, o cambiarne il nome di destinazione → rosso,
  // e l'errore nomina la variabile rimasta senza mappatura. È la cerniera fra il
  // workflow e ciò che il codice legge: senza questa asserzione, `supabase start`
  // potrebbe esserci e i test skipparsi lo stesso, perché le variabili arriverebbero
  // con i nomi della CLI (API_URL, ANON_KEY, SERVICE_ROLE_KEY, DB_URL) invece che
  // con quelli di Belora.
  it('il workflow mappa tutte e quattro le variabili e le esporta in GITHUB_ENV', () => {
    const ci = readWorkflowEseguibile();
    // I valori sono RICAVATI dalla CLI...
    expect(ci, 'le variabili non sono ricavate da `supabase status`').toMatch(
      /supabase status\s+-o\s+env\b/,
    );
    // ...e SCRITTI davvero nel file che i passi successivi leggono: l'append `>>` è
    // il meccanismo, non la parola GITHUB_ENV che comparirebbe anche in un titolo.
    expect(ci, 'nulla viene scritto in GITHUB_ENV: i passi successivi non vedranno nulla').toMatch(
      />>\s*"?\$GITHUB_ENV"?/,
    );
    const nonMappate = DB_ENV_VARS.filter(
      (name) => !new RegExp(String.raw`--override-name\s+[a-z_.]+=${name}\b`).test(ci),
    );
    expect(
      nonMappate,
      "variabili senza mappatura --override-name: arriverebbero con il nome della CLI e i test tornerebbero a skipparsi, perché nessuno le cerca con quel nome",
    ).toEqual([]);
  });

  // MUTAZIONE: sostituire lo step di export con valori letterali nel workflow —
  // la anon key scritta per esteso (un JWT, quindi con il prefisso che la regex
  // qui sotto intercetta) e la stringa di connessione col nome utente e la
  // password in chiaro — → rosso.
  // I due esempi NON sono riprodotti alla lettera in questo commento di
  // proposito: un literal di quella forma nel sorgente fa scattare gitleaks come
  // segreto CRITICAL (misurato: 1 finding, checkpoint NON-VERDE), e un falso
  // positivo che blocca il gate costa quanto un vero.
  // Un valore hardcodato funziona finché la CLI non cambia porta, chiave o
  // formato, e quando smette di funzionare il sintomo non è un errore ma il ritorno
  // dello skip silenzioso: i 139 test tornerebbero a non girare, in verde.
  it('le credenziali dello stack non sono hardcodate nel workflow', () => {
    const ci = readWorkflowEseguibile();
    expect(ci, 'JWT letterale nel workflow').not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(ci, 'stringa di connessione letterale nel workflow').not.toMatch(
      /postgres(ql)?:\/\/\S*:\S*@/,
    );
  });
});
