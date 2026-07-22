# 01-infra — Macrotask `infra` · Impianto infrastrutturale

> Modulo del blueprint P0 (fondamenta) di Belora. Un modulo = un macrotask:
> l'unita al cui confine gira il checkpoint e l'unita di commit atomico.
> Task atomici secondo lo schema trueline (id/AC/target_tests/security_notes).

## Obiettivo del macrotask

Scaffold Next.js (App Router, TypeScript) + wiring Supabase, gestione env/segreti, harness di test e gate qualita (CI), workflow migrazioni su DB locale. E la radice del DAG: gli altri macrotask poggiano qui.

## Task atomici

```yaml
- id: T-001
  title: "Scaffold Next.js (App Router, TypeScript)"
  macrotask: "infra"
  depends_on: []
  objective: "Inizializzare il progetto Next.js con App Router e TypeScript in modalita strict, creare la struttura di cartelle di dominio src/ui (componenti/pagine), src/domain (logica) e src/data (accesso Supabase), configurare ESLint + Prettier e definire gli script npm dev/build/typecheck/test/lint. Nessuna logica applicativa ne accesso a dati: solo lo scaffold verificabile che fa da base a tutti gli altri task infra."
  definition_of_done:
    - "package.json presente con dipendenze next/react/react-dom/typescript e campo scripts contenente le chiavi dev, build, typecheck, test, lint"
    - "tsconfig.json con 'strict': true e path alias @/* -> src/*"
    - "next.config (ts o mjs) presente e valido"
    - "cartelle src/ui, src/domain, src/data create e tracciate in git (con .gitkeep o file indice)"
    - "src/app/ con layout.tsx e page.tsx minima che builda"
    - "configurazione ESLint (eslint.config o .eslintrc) e Prettier (.prettierrc) presenti"
    - ".gitignore che esclude node_modules, .next, .env e .env.local"
  acceptance_criteria:
    - id: AC-001-1
      given: "il repo con lo scaffold Next.js completato"
      when: "si esegue `npm run typecheck`"
      then: "il processo termina con exit code 0"
    - id: AC-001-2
      given: "il repo con lo scaffold Next.js completato"
      when: "si esegue `npm run build`"
      then: "il processo termina con exit code 0 e viene creata la cartella .next"
    - id: AC-001-3
      given: "il repo scaffolded"
      when: "si ispeziona il filesystem"
      then: "esistono le tre cartelle src/ui, src/domain e src/data"
    - id: AC-001-4
      given: "il file package.json"
      when: "si legge il campo scripts"
      then: "l'oggetto contiene esattamente le chiavi dev, build, typecheck, test e lint"
    - id: AC-001-5
      given: "la configurazione ESLint dello scaffold"
      when: "si esegue `npm run lint`"
      then: "il processo termina con exit code 0"
  target_tests:
    - file: "tests/scaffold.test.ts"
      covers: [AC-001-1, AC-001-2, AC-001-3, AC-001-4, AC-001-5]
  security_notes:
    - "A07:2025/A02:2025 (gestione segreti): il .gitignore generato dallo scaffold DEVE escludere .env e .env.local e la cartella .next, per evitare che segreti o artefatti di build finiscano nel repo; nessun valore segreto e introdotto in questo task."
  out_of_scope:
    - "wiring dei client Supabase e loader env (T-002)"
    - "configurazione i18n next-intl e modulo brand (di competenza di altri macrotask)"
    - "qualsiasi tabella, policy RLS o logica applicativa"

- id: T-002
  title: "Wiring client Supabase + gestione env"
  macrotask: "infra"
  depends_on: [T-001]
  objective: "Predisporre l'accesso a Supabase da src/data con due client distinti e un loader di ambiente tipizzato. Il client browser usa esclusivamente la anon key (pubblica per design); il client server usa la service_role ed e importabile SOLO server-side tramite la direttiva `import 'server-only'` (la service_role bypassa RLS e non deve mai raggiungere il bundle client). Il loader env valida a startup la presenza delle variabili richieste e fallisce esplicitamente se mancano. Fornire .env.example con soli placeholder. Nessun segreto nel codice sorgente."
  definition_of_done:
    - "src/config/env.ts: loader tipizzato che legge e valida NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY, lanciando un errore che nomina la variabile mancante"
    - "src/data/supabase-browser.ts: factory del client browser che usa solo url e anon key, senza alcun riferimento a SUPABASE_SERVICE_ROLE_KEY"
    - "src/data/supabase-admin.ts: modulo con `import 'server-only'` in prima riga che costruisce il client con SUPABASE_SERVICE_ROLE_KEY"
    - ".env.example con le tre chiavi e soli placeholder (nessun valore reale)"
    - ".gitignore conferma l'esclusione di .env e .env.local (nessun file .env committato)"
    - "Regola ESLint no-restricted-imports che consente l'import di src/data/supabase-admin.ts (client service_role) solo dai moduli server designati in src/data/**, vietandolo altrove"
    - ".env.example documenta anche DATABASE_URL (connessione Postgres locale diretta usata SOLO dai test di schema/RLS)"
  acceptance_criteria:
    - id: AC-002-1
      given: "un ambiente privo della variabile NEXT_PUBLIC_SUPABASE_URL"
      when: "si invoca il loader env di src/config/env.ts"
      then: "viene lanciato un errore il cui messaggio contiene il nome della variabile mancante 'NEXT_PUBLIC_SUPABASE_URL'"
    - id: AC-002-2
      given: "il modulo src/data/supabase-browser.ts"
      when: "si analizza staticamente il sorgente del modulo"
      then: "non compare alcun riferimento alla stringa SUPABASE_SERVICE_ROLE_KEY e viene usata NEXT_PUBLIC_SUPABASE_ANON_KEY"
    - id: AC-002-3
      given: "il modulo src/data/supabase-admin.ts"
      when: "si legge la prima istruzione del file"
      then: "e presente `import 'server-only'` come prima riga eseguibile (l'import in un contesto client provoca errore a build-time)"
    - id: AC-002-4
      given: "l'intero sorgente e il file .env.example"
      when: "si esegue una scansione per chiavi/JWT/segreti hardcoded (pattern eyJ..., URL con credenziali, valori diversi da placeholder)"
      then: "l'insieme dei match e vuoto (in .env.example figurano solo placeholder)"
    - id: AC-002-5
      given: "un ambiente con le tre variabili valorizzate correttamente"
      when: "si invoca il loader env"
      then: "ritorna un oggetto tipizzato con i tre valori attesi e nessun errore"
    - id: AC-002-6
      given: "la configurazione ESLint dello scaffold"
      when: "un test cerca la regola no-restricted-imports"
      then: "esiste una regola che elenca il path src/data/supabase-admin tra gli import ristretti (import del client service_role vietato fuori dai moduli server designati)"
  target_tests:
    - file: "tests/env.test.ts"
      covers: [AC-002-1, AC-002-5]
    - file: "tests/supabase-clients.test.ts"
      covers: [AC-002-2, AC-002-3, AC-002-4, AC-002-6]
  security_notes:
    - "R7 (service_role confinata server-side + authz esplicita): il client service_role vive solo in src/data/supabase-admin.ts protetto da `import 'server-only'`; ogni handler futuro che lo usa dovra fare authz esplicita perche bypassa la RLS."
    - "A07:2025 e A02:2025 (gestione segreti): nessun segreto hardcoded; tutte le chiavi provengono da env; .env e in .gitignore e .env.example contiene solo placeholder."
    - "A04:2025 (crypto/uso improprio delle chiavi): la anon key e pubblica by design, mentre la service_role e sensibile e non deve mai finire nel bundle client (verificato da AC-002-2/AC-002-3)."
    - "A05:2025 (injection incl. PostgREST filter injection): i client tipati abilitano i metodi .eq()/.match() nei task a valle, evitando interpolazione di input in .or()/.filter()."
    - "Naming inequivocabile dei client (R7 / A01:2025): il client service_role vive in src/data/supabase-admin.ts (bypassa la RLS), il client SSR con sessione utente in src/data/supabase-ssr.ts (RLS attiva), il browser in src/data/supabase-browser.ts (anon). I nomi distinti e la regola ESLint no-restricted-imports prevengono l'import accidentale del client admin nella CRUD tenant."
  out_of_scope:
    - "creazione delle tabelle accounts/account_members/profiles/sites e delle policy RLS (macrotask db)"
    - "handler applicativi e logica di dominio"

- id: T-003
  title: "Harness di test e gate qualita (CI)"
  macrotask: "infra"
  depends_on: [T-001]
  objective: "Configurare l'harness di test con vitest (file in tests/*.test.ts) e i gate di qualita: knip per rilevare dead-code e dipendenze/export inutilizzati, e un workflow GitHub Actions che su push e pull_request esegue in sequenza typecheck, test e knip. Fornire un test di smoke verde che dimostra che l'harness funziona."
  definition_of_done:
    - "vitest.config.ts con ambiente node e pattern di include tests/**/*.test.ts"
    - "tests/smoke.test.ts: un test minimo verde che prova che vitest gira"
    - "knip.json configurato con entry e project coerenti con lo scaffold"
    - "script npm 'knip' che invoca knip"
    - ".github/workflows/ci.yml con job che esegue `npm run typecheck`, `npm test` e `npm run knip`, triggerato su push e pull_request"
  acceptance_criteria:
    - id: AC-003-1
      given: "il progetto con vitest e il test di smoke configurati"
      when: "si esegue `npm test`"
      then: "vitest gira e il test di smoke passa, con exit code 0"
    - id: AC-003-2
      given: "il file knip.json e lo scaffold"
      when: "si esegue `npm run knip`"
      then: "il processo termina con exit code 0 (nessun errore di configurazione ne dead-code residuo)"
    - id: AC-003-3
      given: "il file .github/workflows/ci.yml"
      when: "si legge il contenuto YAML"
      then: "contiene step che invocano typecheck, test e knip ed e triggerato sugli eventi push e pull_request"
    - id: AC-003-4
      given: "il file vitest.config.ts"
      when: "si legge la configurazione"
      then: "il pattern di include comprende tests/**/*.test.ts"
  target_tests:
    - file: "tests/smoke.test.ts"
      covers: [AC-003-1]
    - file: "tests/ci-harness.test.ts"
      covers: [AC-003-2, AC-003-3, AC-003-4]
  security_notes:
    - "A07:2025/A02:2025 (gestione segreti in CI): il workflow ci.yml non contiene segreti in chiaro; eventuali credenziali passano dai GitHub Actions Secrets, mai committate."
    - "R7 (perimetro service_role): il pipeline CI esegue typecheck/test/knip senza esporre la service_role reale; i test RLS a runtime di altri macrotask girano su Supabase locale (T-004/T-005), non contro ambienti con chiavi di produzione."
  out_of_scope:
    - "definizione dei test RLS specifici (macrotask db)"
    - "deploy su Vercel e pipeline di rilascio"

- id: T-004
  title: "Supabase locale + workflow migrazioni"
  macrotask: "infra"
  depends_on: [T-002]
  objective: "Predisporre Supabase locale e il workflow delle migrazioni SQL: configurazione della CLI supabase, cartella supabase/migrations, script npm per resettare/applicare le migrazioni su un Postgres locale di test, e una migrazione baseline verificabile. Questo abilita i test RLS a runtime attraverso il client (non nell'SQL editor). Le tabelle e policy reali sono di competenza del macrotask db: qui si fornisce solo l'infrastruttura e una baseline idempotente."
  definition_of_done:
    - "supabase/config.toml per l'istanza locale"
    - "cartella supabase/migrations/ con una migrazione baseline (es. 0000_baseline.sql) che crea un oggetto verificabile nel catalogo (es. schema o funzione segnaposto) o abilita un'estensione, in modo idempotente"
    - "script npm 'db:reset' che invoca `supabase db reset` applicando le migrazioni, ed eventuale 'db:start'"
    - "procedura documentata (README o docs) del flusso: supabase start -> db reset -> migrazioni applicate"
  acceptance_criteria:
    - id: AC-004-1
      given: "l'istanza Supabase locale avviata"
      when: "si esegue lo script db:reset che applica supabase/migrations"
      then: "termina con exit code 0 e la tabella supabase_migrations.schema_migrations risulta popolata con la versione della baseline"
    - id: AC-004-2
      given: "il DB locale con la baseline applicata"
      when: "si interroga il catalogo pg per l'oggetto creato dalla baseline"
      then: "l'oggetto esiste (query di verifica ritorna esattamente 1 riga)"
    - id: AC-004-3
      given: "il file package.json"
      when: "si legge il campo scripts"
      then: "esiste lo script db:reset il cui comando invoca la CLI supabase (supabase db reset)"
    - id: AC-004-4
      given: "la migrazione baseline gia applicata"
      when: "si esegue nuovamente db:reset (applicazione ripetuta)"
      then: "l'operazione e idempotente e termina con exit code 0 senza errori di oggetto gia esistente"
  target_tests:
    - file: "tests/supabase-local.test.ts"
      covers: [AC-004-1, AC-004-2, AC-004-3, AC-004-4]
  security_notes:
    - "R1 (RLS by default): la baseline e neutra e non introduce tabelle public senza RLS; ogni futura tabella nel macrotask db dovra abilitare RLS."
    - "R7 (perimetro service_role): le chiavi anon/service_role dell'istanza locale sono generate dalla CLI e valide solo in locale; non si committano chiavi di produzione."
    - "Contratto test RLS (metodologico): questo task fornisce l'infrastruttura affinche i test RLS a runtime girino ATTRAVERSO il client con auth reale contro Supabase locale e MAI nell'SQL editor (che gira come superuser e bypassa la RLS -> falso verde)."
    - "A07:2025/A02:2025 (segreti): eventuali chiavi locali gestite via env/output della CLI, mai hardcoded nel sorgente."
  out_of_scope:
    - "definizione delle tabelle accounts/account_members/profiles/sites, della funzione is_account_member e delle policy RLS (macrotask db)"
    - "i test delle singole policy RLS"

- id: T-005
  title: "Utility di test per client Supabase autenticati (auth reale locale)"
  macrotask: "infra"
  depends_on: [T-002, T-004]
  objective: "Fornire utility di test riusabili sotto tests/helpers per creare utenti di test e ottenere client Supabase autenticati con la sessione JWT reale dell'utente, contro l'istanza Supabase locale. Questo rende atomico T-004 (workflow migrazioni) separandolo dal test-harness di autenticazione, ed e il prerequisito trasversale affinche i test RLS di altri macrotask esercitino le policy come utente 'authenticated' con auth.uid() reale, non come superuser. Fornisce inoltre un helper di query Postgres diretta (via DATABASE_URL) per le asserzioni sui cataloghi di sistema (information_schema, pg_class, pg_policies, pg_proc) non esposti da PostgREST, usato dai test di schema/RLS."
  definition_of_done:
    - "tests/helpers/supabase-test.ts con: adminClient() (service_role, solo setup/teardown lato Node), createTestUser(email,password) -> user, signInAs(email,password) -> client autenticato"
    - "utility di cleanup che rimuove utenti/dati creati tra i test"
    - "un test che dimostra il round-trip auth: dopo signInAs, il client espone una sessione e l'id utente corretto"
    - "tests/helpers/pg.ts con pgQuery(sql, params) che apre una connessione Postgres diretta all'istanza locale usando DATABASE_URL (devDependency 'pg'), per interrogare i cataloghi di sistema che PostgREST non espone"
  acceptance_criteria:
    - id: AC-005-1
      given: "l'istanza Supabase locale con la baseline applicata"
      when: "si chiama createTestUser seguito da signInAs con le stesse credenziali"
      then: "il client restituito ha una sessione attiva e getUser() ritorna l'id dell'utente creato"
    - id: AC-005-2
      given: "un client autenticato ottenuto dall'helper signInAs"
      when: "si valuta il valore di auth.uid() nel contesto di quel client (via rpc/echo)"
      then: "il valore coincide con l'id dell'utente autenticato, dimostrando esecuzione come 'authenticated' e non come superuser"
    - id: AC-005-3
      given: "l'helper adminClient() che usa la service_role"
      when: "si verifica dove e importato"
      then: "e importato solo da moduli di test lato Node (tests/helpers) e non compare in alcun modulo del bundle applicativo client"
    - id: AC-005-4
      given: "l'istanza Supabase locale con la baseline applicata e DATABASE_URL impostata"
      when: "si chiama pgQuery('select 1 as ok')"
      then: "ritorna una riga con ok = 1 (connessione Postgres diretta funzionante per le asserzioni di catalogo)"
  target_tests:
    - file: "tests/test-harness-auth.test.ts"
      covers: [AC-005-1, AC-005-2, AC-005-3, AC-005-4]
  security_notes:
    - "R7 (service_role confinata + authz): la service_role e usata solo negli helper di test lato Node per setup/teardown, mai nel codice client; l'authz reale nei test e esercitata via JWT dell'utente."
    - "R4 e R9 (identita/tenant e cache auth.uid()): i client autenticati garantiscono che i test girino con auth.uid() reale, prerequisito per verificare correttamente le policy per identita/appartenenza nei macrotask a valle."
    - "Contratto test RLS: questi helper evitano il falso verde del superuser dell'SQL editor, forzando l'esecuzione come ruolo 'authenticated'."
    - "A07:2025/A02:2025 (segreti): le chiavi locali provengono da env/output CLI, nessun segreto committato."
    - "A07:2025/A02:2025 (segreti): DATABASE_URL e una credenziale locale di test letta da env, mai committata; usata solo negli helper di test lato Node."
  out_of_scope:
    - "le policy RLS effettive e i loro test specifici (macrotask db)"
    - "seeding di dati applicativi di dominio"

- id: T-006
  title: "Modulo brand configurabile"
  macrotask: "infra"
  depends_on: [T-001]
  objective: "Creare src/config/brand.ts che espone getBrandName() leggendo NEXT_PUBLIC_BRAND_NAME con default 'Belora': unico punto di configurazione del nome del brand riutilizzato dalla UI (AppShell) e dai metadati, cosi che il nome sia sostituibile senza toccare i componenti."
  definition_of_done:
    - "src/config/brand.ts esporta getBrandName(): string che ritorna process.env.NEXT_PUBLIC_BRAND_NAME se valorizzato, altrimenti 'Belora'"
    - ".env.example documenta NEXT_PUBLIC_BRAND_NAME con placeholder e commento (default Belora)"
    - "File di test tests/brand.test.ts eseguibile con vitest"
  acceptance_criteria:
    - id: AC-006-1
      given: "NEXT_PUBLIC_BRAND_NAME non impostata nell'ambiente"
      when: "si chiama getBrandName()"
      then: "ritorna esattamente la stringa 'Belora'"
    - id: AC-006-2
      given: "NEXT_PUBLIC_BRAND_NAME = 'Acme Sites'"
      when: "si chiama getBrandName()"
      then: "ritorna esattamente la stringa 'Acme Sites'"
  target_tests:
    - file: "tests/brand.test.ts"
      covers: [AC-006-1, AC-006-2]
  security_notes:
    - "A07:2025/A02:2025 (segreti): il brand e una configurazione PUBBLICA (NEXT_PUBLIC_*), non un segreto; il modulo non legge ne espone chiavi sensibili."
  out_of_scope:
    - "Uso del brand nei componenti (AppShell T-022) e nei metadati delle pagine"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir del blueprint — atteso exit 0.
- **Semantico** (checklist guidata): punti 6–10 su ogni task; i rilievi vanno all'human-in-the-loop.
