import tseslint from 'typescript-eslint';

// Config ESLint flat (ESLint 9). Il linting mira a src/ e tests/.
// La regola no-restricted-imports impedisce di importare il client service_role
// (supabase-admin) fuori dai moduli server designati in src/data/** (R7 / A01:2025).
const supabaseAdminMessage =
  'Il client service_role (supabase-admin) bypassa la RLS: importalo solo dai moduli server designati in src/data/**.';

const supabaseAdminPaths = [{ name: '@/data/supabase-admin', message: supabaseAdminMessage }];
const supabaseAdminPatterns = [
  { group: ['**/data/supabase-admin', '**/supabase-admin'], message: supabaseAdminMessage },
];

// T-131 (P1): il confine LLM (src/data/anthropic) e server-only e usa la chiave
// Anthropic. In App Router un componente client puo' vivere ovunque sotto src/
// (src/app/**/page.tsx con 'use client', non solo src/ui/**): il percorso NON
// dice se un modulo finisce nel bundle del browser. Quindi si nega per default
// su tutto src/** e si riapre SOLO al layer che deve chiamarlo (src/domain/**,
// dove vive l'orchestrazione dell'intervista T-132) e ai moduli server di
// src/data/**. Un import accidentale lato client e' cosi' un errore di lint.
const anthropicBoundaryMessage =
  'Il confine LLM (src/data/anthropic) e server-only e usa il segreto Anthropic: non importarlo da codice client/browser.';

const anthropicBoundaryPaths = [{ name: '@/data/anthropic', message: anthropicBoundaryMessage }];
const anthropicBoundaryPatterns = [
  { group: ['**/data/anthropic'], message: anthropicBoundaryMessage },
];

// T-211 (P2): il design system del BUILDER (src/ui/theme/tokens.ts) e i temi del SITO
// GENERATO (src/domain/generation/themes.ts) sono due layer distinti. I token dell'app
// cambiano quando cambia il pannello — e i loro colori sono per costruzione riferimenti
// a CSS custom property, cioe' valori decisi altrove a runtime: se un componente del
// sito generato li leggesse, ritoccare il design system del builder riscriverebbe i siti
// GIA' PUBBLICATI dei clienti (P2-D14). La separazione e' imposta dal meccanismo, con lo
// stesso pattern del confine LLM qui sopra.
//
// LE QUATTRO FORME CHE IL CONFINE DEVE COPRIRE, perche' tutte e quattro risolvono allo
// stesso file e nessuna e' teorica: l'ALIAS ('@/ui/theme/tokens'); il percorso RELATIVO
// ('../theme/tokens'), che e' il primo che scrive chi lavora dentro src/ui/ e che l'alias
// non intercetta; la forma con ESTENSIONE ('.js'), che moduleResolution 'bundler' risolve
// e che il typecheck accetta senza fiatare; e l'IMPORT DINAMICO, che ha bisogno di
// un'altra regola (vedi `siteThemeDynamicImport` qui sotto).
//
// RIDONDANZA DELIBERATA fra `paths` e i due pattern piu' stretti. Il pattern largo
// '**/theme/tokens' li SUSSUME entrambi: toglierli oggi non cambierebbe nessun verdetto,
// e nessun test se ne accorgerebbe. Restano perche' il pattern largo e' anche quello col
// costo dichiarato qui sotto — se un giorno lo si stringesse per riammettere un modulo
// omonimo, l'alias e il percorso canonico devono restare chiusi senza che serva
// ricordarselo. Non e' una divisione di lavoro fra `paths` e `patterns`: e' una cintura
// in piu' su una regola che qualcuno stringera'.
// COSTO DICHIARATO del pattern largo: '**/theme/tokens' vieta a src/ui/site/** anche un
// eventuale modulo PROPRIO che si chiamasse allo stesso modo ('./theme/tokens'). E'
// preferibile al buco opposto — due moduli di token con lo stesso nome dentro src/ui/
// sarebbero comunque il primo passo verso l'errore che questa regola esiste per rendere
// impossibile.
const siteThemeBoundaryMessage =
  'Il sito generato ha i propri temi (src/domain/generation/themes): non importare il design system del builder (src/ui/theme/tokens) da src/ui/site/**.';

const siteThemeBoundaryPaths = [{ name: '@/ui/theme/tokens', message: siteThemeBoundaryMessage }];
const siteThemeBoundaryPatterns = [
  {
    group: ['**/ui/theme/tokens', '**/theme/tokens', '**/theme/tokens.*'],
    message: siteThemeBoundaryMessage,
  },
];

// L'IMPORT DINAMICO SI CHIUDE CON UN'ALTRA REGOLA, e non e' un dettaglio di gusto:
// 'no-restricted-imports' aggancia soltanto ImportDeclaration, ExportNamedDeclaration ed
// ExportAllDeclaration — non ha alcun handler per ImportExpression. Misurato sulla config
// vera: import('@/ui/theme/tokens') da src/ui/site/Hero.tsx non produceva NESSUN errore
// mentre la forma statica ne produceva due. Qui non c'e' seconda linea che rattoppi il
// buco (i token del builder sono un normale modulo client-safe: nessun 'server-only' li
// ferma a runtime), quindi la regola E' il meccanismo e un buco nella regola e' un buco
// nella promessa di P2-D14.
// NOTA SUL SELECTOR: esquery non accetta '/' dentro la regex di un attributo, per questo
// il separatore e' scritto '.' (un carattere qualunque). Il falso positivo teorico — un
// modulo chiamato 'themeXtokens' — non esiste nel repo e sarebbe comunque nel mirino.
// LIMITE RESIDUO DICHIARATO: si aggancia il solo specificatore LETTERALE. Un
// import(variabile) o un template con un buco dentro non e' leggibile da nessuna regola
// statica — non da questa e non da un plugin di import — e resta fuori dal confine. Non
// e' un buco che si chiude qui: si chiuderebbe vietando l'import() a specificatore
// calcolato in tutto il layer, che e' una decisione di T-231 e non di questo task.
const siteThemeDynamicImport = [
  {
    selector: "ImportExpression[source.type='Literal'][source.value=/theme.tokens/]",
    message: siteThemeBoundaryMessage,
  },
];

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      '.trueline/**',
      'supabase/**',
      '*.config.*',
      'next-env.d.ts',
    ],
  },
  ...tseslint.configs.recommended,
  {
    // Default: entrambi i confini privilegiati sono vietati ovunque sotto src/.
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...supabaseAdminPaths, ...anthropicBoundaryPaths],
          patterns: [...supabaseAdminPatterns, ...anthropicBoundaryPatterns],
        },
      ],
    },
  },
  {
    // Layer di dominio (server): puo' chiamare il confine LLM — l'orchestrazione
    // dell'intervista (T-132) lo richiede — ma NON il client service_role.
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: supabaseAdminPaths, patterns: supabaseAdminPatterns },
      ],
    },
  },
  {
    // Layer del SITO GENERATO (T-231): oltre ai due confini privilegiati, qui e' vietato
    // anche il design system del BUILDER. I due confini di P0 e P1 sono RIDICHIARATI
    // perche' in flat config le opzioni della stessa regola si sostituiscono invece di
    // sommarsi: ometterli aprirebbe in silenzio, proprio nel layer che finisce nel
    // browser, la strada al client service_role e alla chiave Anthropic.
    //
    // IL GLOB COPRE ANCHE I FILE NON-TS. tsconfig ha `allowJs`, quindi un .js/.jsx/.mjs
    // sotto src/ui/site/ e' codice che finisce nel bundle esattamente come un .tsx. Col
    // solo '{ts,tsx}' quei file non erano coperti NE' da questo blocco NE' da quello su
    // src/** (che ha lo stesso filtro): erano l'unico punto del repo dove un import dei
    // token del builder, del client service_role o del confine LLM non incontrava nulla.
    // Misurato, non dedotto. Il parser non e' un problema: la config base di
    // typescript-eslint non ha `files`, quindi vale per tutte le estensioni.
    //
    // COSA QUESTO BLOCCO NON PROVA, oggi: src/ui/site/ NON ESISTE ancora su disco — ci
    // arrivera' il rendering dei blocchi (T-231) — quindi 'eslint .', che e' il gate
    // della CI, non applica queste opzioni ad alcun file. Cio' che
    // tests/generation-theme-isolation.test.ts verifica e' che la CONFIGURAZIONE PRODUCA
    // l'errore, lintando sorgenti VIRTUALI a quei percorsi; che il rendering nasca
    // proprio li' e' pinnato dal blueprint di T-231, non da questo file. La regola
    // precede il codice apposta: e' l'unico ordine in cui il confine non arriva dopo la
    // prima violazione.
    files: ['src/ui/site/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...supabaseAdminPaths, ...anthropicBoundaryPaths, ...siteThemeBoundaryPaths],
          patterns: [
            ...supabaseAdminPatterns,
            ...anthropicBoundaryPatterns,
            ...siteThemeBoundaryPatterns,
          ],
        },
      ],
      // Solo il confine dei TEMI. I due confini privilegiati di P0 e P1 restano qui
      // ridichiarati NELLA FORMA CHE AVEVANO (paths/patterns): estenderli all'import
      // dinamico e' un lavoro separato, che li riguarda su tutto src/** e non solo qui.
      'no-restricted-syntax': ['error', ...siteThemeDynamicImport],
    },
  },
  {
    // Moduli server designati e helper di test: possono importare entrambi.
    files: ['src/data/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
