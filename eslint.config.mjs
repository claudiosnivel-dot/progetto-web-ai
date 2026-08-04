import tseslint from 'typescript-eslint';

// Config ESLint flat (ESLint 9). Il linting mira a src/ e tests/.
// La regola no-restricted-imports impedisce di importare il client service_role
// (supabase-admin) fuori dai moduli server designati in src/data/** (R7 / A01:2025).
const supabaseAdminMessage =
  'Il client service_role (supabase-admin) bypassa la RLS: importalo solo dai moduli server designati in src/data/**.';

// LA FORMA CON ESTENSIONE non e' teorica: '@/data/supabase-admin.js' e
// '../data/supabase-admin.js' risolvono allo STESSO file sotto moduleResolution 'bundler' e
// 'npm run typecheck' li accetta senza fiatare, ma sfuggivano sia a `paths` (che confronta
// la stringa ESATTA) sia ai pattern qui sotto (che non terminano con l'estensione).
// Misurato sulla config vera: 0 messaggi da ogni percorso del repo, contro i 2 della forma
// senza estensione. E' lo stesso buco che T-211 ha chiuso per i token del builder con
// '**/theme/tokens.*'; qui si chiude allo stesso modo per i due confini privilegiati.
const supabaseAdminPaths = [{ name: '@/data/supabase-admin', message: supabaseAdminMessage }];
const supabaseAdminPatterns = [
  {
    group: ['**/data/supabase-admin', '**/supabase-admin', '**/supabase-admin.*'],
    message: supabaseAdminMessage,
  },
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

// Il pattern con estensione e' qui ANCORATO a 'data/' — e non e' pignoleria di simmetria
// col confine service_role qui sopra: un '**/anthropic.*' colpirebbe anche
// '@anthropic-ai/sdk', che e' una dipendenza vera del progetto e che nessuna regola di
// questo file vieta (il confine e' il MODULO src/data/anthropic, non il nome del fornitore).
const anthropicBoundaryPaths = [{ name: '@/data/anthropic', message: anthropicBoundaryMessage }];
const anthropicBoundaryPatterns = [
  { group: ['**/data/anthropic', '**/data/anthropic.*'], message: anthropicBoundaryMessage },
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
// DUE SELECTOR PER OGNI CONFINE DINAMICO, e il secondo non e' zelo: un template literal
// SENZA BUCHI ha source.type === 'TemplateLiteral', non 'Literal', quindi la sola voce
// [source.type='Literal'] lo lasciava passare. Misurato: la forma col backtick dava 0
// messaggi da tutti e otto i layer del repo contro 1 della forma con gli apici, TypeScript
// la risolve allo stesso modulo (nessuna diagnostica; TS2307 solo su un percorso
// inesistente, cioe' la risoluzione avviene davvero) e costa UN CARATTERE a chi la scrive.
// Non era il limite residuo dichiarato: un template senza buchi e' perfettamente leggibile
// staticamente. Sul confine dei TEMI questo pesava piu' che sugli altri due, perche' li'
// non c'e' alcuna seconda linea a runtime — i token del builder sono un normale modulo
// client-safe e nessun 'server-only' li ferma.
// PERCHE' TemplateElement[value.raw=...] e non source.quasis: si guarda il testo GREZZO
// del pezzo di template, ed e' cio' che tiene fuori i template CON buchi legittimi —
// misurato su import(`../../messages/${locale}.json`), che e' un caso vero del repo
// (src/i18n/request.ts) e resta PULITO.
// LIMITE RESIDUO DICHIARATO, ora nella sua misura vera: fuori dal confine resta ogni
// specificatore che non sia leggibile staticamente — import(variabile), un template il cui
// buco copra il nome del modulo — e resta `require()`, che nessuna delle due regole
// aggancia. Non e' un buco che si chiude qui: si chiuderebbe vietando l'import() a
// specificatore calcolato in tutto il layer, che e' una decisione di T-231 e non di questo
// task.
// NOTA SUL SELECTOR: esquery non accetta '/' dentro la regex di un attributo, per questo
// il separatore e' scritto '.' (un carattere qualunque). Il falso positivo teorico — un
// modulo chiamato 'themeXtokens' — non esiste nel repo e sarebbe comunque nel mirino.
const siteThemeDynamicImport = [
  {
    selector: "ImportExpression[source.type='Literal'][source.value=/theme.{1,3}tokens/]",
    message: siteThemeBoundaryMessage,
  },
  {
    selector: 'ImportExpression > TemplateLiteral > TemplateElement[value.raw=/theme.{1,3}tokens/]',
    message: siteThemeBoundaryMessage,
  },
];

// LO STESSO BUCO VALE PER I DUE CONFINI PRIVILEGIATI, e su TUTTO src/** invece che sul solo
// layer del sito: 'no-restricted-imports' non ha un handler per ImportExpression, quindi
// import('@/data/supabase-admin') e import('@/data/anthropic') passavano indenni da qualunque
// percorso. Misurato sulla config PRIMA di questa modifica: 0 messaggi da src/ui/site/Hero.tsx, da
// src/ui/onboarding/**, da src/app/[locale]/page.tsx — mentre le forme statiche ne davano 2.
//
// QUANTO E' GRAVE, detto senza gonfiarlo. Entrambi i moduli protetti hanno import
// 'server-only' come PRIMA riga, quindi se finissero in un bundle client il BUILD
// fallirebbe comunque: questo strato non e' l'ultima difesa. E' pero' l'unico che da' un
// errore LEGGIBILE, che nomina il confine e che arriva PRIMA del build — ed e' un gate della
// CI dal 29/07, cioe' il punto in cui l'errore costa un minuto invece di un'ora. Difesa in
// profondita', non una falla aperta.
//
// I DUE SELECTOR NON SONO SIMMETRICI, di proposito. Quello del service_role guarda il solo
// 'supabase-admin' perche' i pattern statici hanno la stessa larghezza ('**/supabase-admin'),
// cosi' prende anche il relativo '../supabase-admin'. Quello del confine LLM deve invece
// restare ANCORATO a 'data', perche' un '/anthropic/' nudo colpirebbe '@anthropic-ai/sdk',
// che e' una dipendenza vera del progetto e che nessuna regola statica di questo file vieta:
// allargarlo vorrebbe dire vietare per via dinamica cio' che per via statica e' lecito, ed e'
// esattamente il modo in cui una regola smette di rispecchiare il layering che dichiara.
//
// L'ANCORAGGIO PERO' NON PUO' ESSERE 'data' + UN carattere. Misurato: con
// /data.anthropic/ le forme '@/data//anthropic' e '@/data/./anthropic' — che TypeScript
// risolve allo stesso modulo, nessun TS2307 — passavano in tutte e nove le caselle provate
// (tre layer client x statica/dinamica/template), mentre le stesse forme su 'supabase-admin'
// erano prese, perche' il suo selector e' nudo. Cioe' il confine LLM era piu' STRETTO di
// quello del service_role di una classe di path equivalenti, il contrario di quanto il
// commento dichiarava. Ora l'ancoraggio ammette da uno a tre caratteri fra i due nomi
// ('/', '//', '/./'), che copre le forme equivalenti e continua a NON prendere
// '@anthropic-ai/sdk' (verificato).
//
// COSTO DICHIARATO: la regex e' su SOTTOSTRINGA mentre i pattern statici sono su segmento di
// percorso, quindi un ipotetico 'foo/supabase-admin-helpers' sarebbe preso qui e non li'. E'
// il verso giusto in cui sbagliare, e nel repo non esiste un modulo simile.
//
// APERTO E DICHIARATO, la META' STATICA dello stesso difetto: '@/data//anthropic' sfugge
// ancora a 'no-restricted-imports'. Non e' pigrizia — tre gruppi di glob sono stati provati e
// nessuno chiude la doppia barra: il pacchetto `ignore` che ESLint usa non fa combaciare il
// segmento VUOTO, quindi ne '**/data/**/anthropic' (che copre il solo '/./') ne la variante
// extglob la prendono. Chiuderla richiede un meccanismo che NORMALIZZI il percorso — un
// plugin di import con resolver — e non un confronto di stringhe. Vale identicamente per il
// confine dei temi ('@/ui/theme//tokens'). Sta in SESSION-STATE come copertura dichiarata.
// LIMITE RESIDUO sugli specificatori: vedi il commento dei temi qui sopra (template col buco
// sul nome, import(variabile), require()).
const supabaseAdminDynamicImport = [
  {
    selector: "ImportExpression[source.type='Literal'][source.value=/supabase-admin/]",
    message: supabaseAdminMessage,
  },
  {
    selector: 'ImportExpression > TemplateLiteral > TemplateElement[value.raw=/supabase-admin/]',
    message: supabaseAdminMessage,
  },
];

const anthropicBoundaryDynamicImport = [
  {
    selector: "ImportExpression[source.type='Literal'][source.value=/data.{1,3}anthropic/]",
    message: anthropicBoundaryMessage,
  },
  {
    selector: 'ImportExpression > TemplateLiteral > TemplateElement[value.raw=/data.{1,3}anthropic/]',
    message: anthropicBoundaryMessage,
  },
];

// LE TRE POLICY DI CONFINE, DICHIARATE UNA VOLTA SOLA E CONDIVISE FRA I LORO LAYER.
//
// PERCHE' ESISTONO (estratte al checkpoint di `generation-llm`, su decisione dell'utente).
// In flat config le opzioni della stessa regola si SOSTITUISCONO invece di sommarsi: ogni
// blocco deve percio' ridichiarare l'INTERA policy, e prima di questa estrazione i corpi
// `rules:` erano ricopiati per intero da un blocco all'altro. L'oracolo d'igiene l'ha
// misurato — 3 duplicazioni NUOVE appena `scripts/**` e' entrato nel perimetro (P2-D27) —
// ma il costo vero non e' la ripetizione: e' che due blocchi che DEVONO dire la stessa cosa
// possono DIVERGERE in silenzio, e un confine che vieta di piu' in un layer e di meno in un
// altro si aggira scegliendo dove mettere il file. Con la costante condivisa "scripts/** e'
// trattato esattamente come il layer base" e' un FATTO, non una coincidenza da mantenere a
// mano.
//
// La modifica e' falsificabile e non e' stata data per buona: il comportamento di questi tre
// oggetti e' coperto da 42+ caselle in tests/anthropic-boundary.test.ts, dal ramo del sito in
// tests/generation-theme-isolation.test.ts e da tests/supabase-clients.test.ts.

/** Entrambi i confini privilegiati, nelle due meta' (statica e dinamica). Layer base e script. */
const CONFINI_PRIVILEGIATI = {
  'no-restricted-imports': [
    'error',
    {
      paths: [...supabaseAdminPaths, ...anthropicBoundaryPaths],
      patterns: [...supabaseAdminPatterns, ...anthropicBoundaryPatterns],
    },
  ],
  // La META' DINAMICA degli stessi confini. E' allineata voce per voce con
  // 'no-restricted-imports' qui sopra — le due regole descrivono lo STESSO layering con due
  // meccanismi — e ora l'allineamento e' tenuto dalla condivisione dell'oggetto, non dalla
  // buona volonta' di chi edita.
  'no-restricted-syntax': ['error', ...supabaseAdminDynamicImport, ...anthropicBoundaryDynamicImport],
};

/**
 * Il SOLO client service_role. E' la policy dei layer server a cui il confine LLM e' APERTO:
 * il dominio (l'orchestrazione dell'intervista, T-132) e l'harness di misura di T-225.
 * Aggiungere il confine LLM alla sola 'no-restricted-syntax' spegnerebbe T-132 per via
 * dinamica lasciando verde ogni test che guarda la forma statica.
 */
const SOLO_SERVICE_ROLE = {
  'no-restricted-imports': ['error', { paths: supabaseAdminPaths, patterns: supabaseAdminPatterns }],
  'no-restricted-syntax': ['error', ...supabaseAdminDynamicImport],
};

/**
 * I due confini privilegiati PIU' il design system del builder (T-211): la policy del layer
 * del SITO GENERATO. I primi due sono qui perche' le opzioni si sostituiscono, e ometterli
 * aprirebbe in silenzio — proprio nel layer che finisce nel browser — la strada al client
 * service_role e alla chiave Anthropic. Le voci stanno in un elenco solo perche' e' l'unica
 * forma in cui il difetto si vede: se un giorno se ne aggiunge una quarta ai confini
 * privilegiati e non qui, il ramo del sito dei test di confine diventa rosso.
 */
const CONFINI_DEL_SITO_GENERATO = {
  'no-restricted-imports': [
    'error',
    {
      paths: [...supabaseAdminPaths, ...anthropicBoundaryPaths, ...siteThemeBoundaryPaths],
      patterns: [...supabaseAdminPatterns, ...anthropicBoundaryPatterns, ...siteThemeBoundaryPatterns],
    },
  ],
  'no-restricted-syntax': [
    'error',
    ...supabaseAdminDynamicImport,
    ...anthropicBoundaryDynamicImport,
    ...siteThemeDynamicImport,
  ],
};

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
    //
    // IL GLOB COPRE ANCHE I FILE NON-TS: un .js/.jsx/.mjs sotto src/** e' codice che NEXT
    // COMPILA NEL BUNDLE esattamente come un .tsx, e questa — non `allowJs` — e' la ragione.
    // Va detta giusta: `include` di tsconfig.json elenca solo '**/*.ts' e '**/*.tsx', quindi
    // `allowJs` non fa entrare alcun .js nel typecheck e 'npm run typecheck' non ha mai
    // guardato un file non-TS. Col solo '{ts,tsx}' quei file non incontravano NESSUNA
    // restrizione — misurato: da src/ui/onboarding/Legacy.jsx e da src/app/[locale]/legacy.jsx
    // anche l'import STATICO di '@/data/supabase-admin' dava 0 messaggi, mentre dai .tsx
    // fratelli ne dava 2. T-211 lo aveva chiuso per il solo src/ui/site/**, che era il suo
    // scope; il buco valeva per tutto il resto di src/**.
    // NB: 'tests/**' NON compare qui, e non e' una dimenticanza. C'era, ed era INERTE: il
    // blocco OFF in fondo al file spegne entrambe le regole sugli stessi percorsi e, venendo
    // dopo, vince. Misurato (35 caselle su 35 pulite dalla colonna `tests`). Una riga che
    // sembra proteggere e non protegge e' peggio della sua assenza: chi legge ci costruisce
    // sopra.
    files: ['src/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}'],
    rules: CONFINI_PRIVILEGIATI,
  },
  {
    // Layer di dominio (server): puo' chiamare il confine LLM — l'orchestrazione
    // dell'intervista (T-132) lo richiede — ma NON il client service_role.
    // Le due regole dicono la STESSA cosa: qui compare solo il service_role, in entrambe.
    // Aggiungere il confine LLM alla sola 'no-restricted-syntax' spegnerebbe T-132 per via
    // dinamica lasciando verde ogni test che guarda la forma statica.
    files: ['src/domain/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}'],
    rules: SOLO_SERVICE_ROLE,
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
    rules: CONFINI_DEL_SITO_GENERATO,
  },
  {
    // P2-D27 — LA DIRECTORY DEGLI SCRIPT ENTRA NEL PERIMETRO. Fino a T-225 `scripts/**` non
    // compariva ne' fra i blocchi che vietano i due confini privilegiati ne' fra quelli che li
    // spengono: non era aperta per decisione, non era mai stata considerata. MISURATO sulla
    // stessa sorgente (import statico E dinamico di '@/data/anthropic' e
    // '@/data/supabase-admin') lintata a percorsi diversi: src/ui/** 6 messaggi, src/app/** 6,
    // scripts/** ZERO. E il primo file che ci e' nato costruisce un client SDK con la chiave
    // grezza, cioe' il secondo detentore della chiave del repo (P1-D7): un perimetro non
    // sorvegliato sarebbe stato un secondo confine nato per omissione.
    //
    // Il glob copre le stesse otto estensioni del blocco base, per la stessa ragione: un
    // programma di manutenzione scritto in .mjs raggiungerebbe gli stessi due moduli di uno
    // scritto in .ts, e un confine che dipende dall'estensione del file non e' un confine.
    files: ['scripts/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}'],
    // LA STESSA policy del layer base, e ora e' la STESSA COSTANTE: che scripts/** sia
    // trattato esattamente come src/** e' un fatto del file, non una copia da mantenere.
    rules: CONFINI_PRIVILEGIATI,
  },
  {
    // L'UNICA ECCEZIONE, DICHIARATA QUI E NON OTTENUTA COL SILENZIO (P2-D27, AC-225-5).
    // L'harness di misura di T-225 deve costruire un'istanza del client SDK per leggere
    // `usage`: e' il costo che il file dichiara in testa a se stesso, ed e' il solo motivo per
    // cui questa riga esiste. Un file NUOVO sotto scripts/ non eredita nulla di tutto cio' —
    // il blocco qui sopra continua a valere per lui — e questa e' la differenza fra
    // un'eccezione e un buco.
    //
    // L'ECCEZIONE E' STRETTA QUANTO SERVE, e ricalca il blocco di src/domain/**: cade il solo
    // confine LLM, mentre il client service_role resta VIETATO anche qui (in entrambe le sue
    // meta', statica e dinamica). Un harness di misura dei token non ha alcun motivo di
    // bypassare la RLS, e in flat config le opzioni della stessa regola si SOSTITUISCONO
    // invece di sommarsi: ridichiarare il service_role e' cio' che impedisce a questa
    // eccezione di aprire in silenzio anche l'altro confine.
    files: ['scripts/measure-generation-usage.ts'],
    rules: SOLO_SERVICE_ROLE,
  },
  {
    // Moduli server designati e helper di test: possono importare entrambi.
    //
    // ANCHE 'no-restricted-syntax' VA SPENTA QUI, e non e' una precauzione: src/data/** E'
    // il posto dove quei client si importano per mestiere, e tests/** dove si mockano.
    // Lasciando accesa qui la sola meta' dinamica, il giorno in cui un modulo di src/data/
    // caricasse il client admin con un import() — il modo naturale di rimandare un client
    // pesante — il gate di lint della CI diventerebbe rosso su codice corretto. Il blocco
    // spegne le stesse due regole che il blocco base accende: la simmetria e' il punto.
    files: [
      'src/data/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}',
      'tests/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}',
    ],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': 'off' },
  },
);
