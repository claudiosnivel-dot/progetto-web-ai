# 04-auth — Macrotask `auth` · Autenticazione

> Modulo del blueprint P0 (fondamenta) di Belora. Un modulo = un macrotask:
> l'unita al cui confine gira il checkpoint e l'unita di commit atomico.
> Task atomici secondo lo schema trueline (id/AC/target_tests/security_notes).

## Obiettivo del macrotask

Supabase Auth con email/password + Google OAuth, sessione server-side, guardia di route sulle aree autenticate, flussi di signup/login/logout.

## Task atomici

```yaml
- id: T-040
  title: "Configurazione Supabase Auth (email/password + Google)"
  macrotask: "auth"
  depends_on: [T-002, T-004]
  objective: "Abilitare i provider di autenticazione email/password e Google OAuth in Supabase ed estendere il supabase/config.toml gia creato da T-004 con la configurazione dei provider. Il provider email deve consentire il signup; il provider Google deve leggere client id e client secret ESCLUSIVAMENTE da variabili d'ambiente server-side (mai valori hardcoded). Vanno definiti gli URL di redirect autorizzati (site_url + additional_redirect_urls) che includono la callback OAuth per i locali /it e /es, e un file .env.example che documenta tutte le chiavi (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY solo server, GOOGLE client id/secret) con soli placeholder."
  definition_of_done:
    - "File supabase/config.toml con blocco [auth] presente e email provider abilitato al signup (enable_signup = true)"
    - "In supabase/config.toml blocco [auth.external.google] con enabled = true e client_id/secret referenziati via env('...') (nessun valore letterale)"
    - "In supabase/config.toml site_url e additional_redirect_urls includono le URL di callback /it/auth/callback e /es/auth/callback"
    - "File .env.example alla radice con placeholder per NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID, SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET e nessun segreto reale"
    - "File tests/auth-config.test.ts che parsa config.toml e .env.example e verifica le asserzioni"
    - "supabase/config.toml abilita/definisce i rate limit di Supabase Auth per le operazioni di sign-in/sign-up (mitigazione brute-force/credential stuffing)"
  acceptance_criteria:
    - id: AC-040-1
      given: "Il file supabase/config.toml presente nel repo"
      when: "Il test parsa il TOML e legge il blocco [auth.email]"
      then: "enable_signup risulta === true e il provider email risulta attivo"
    - id: AC-040-2
      given: "Il file supabase/config.toml presente nel repo"
      when: "Il test legge il blocco [auth.external.google]"
      then: "enabled === true e i campi client_id e secret contengono la stringa che inizia con 'env(' (riferimento a variabile d'ambiente) e NON un valore letterale che assomiglia a una credenziale"
    - id: AC-040-3
      given: "Il file .env.example presente nel repo"
      when: "Il test lo legge riga per riga"
      then: "Sono presenti le chiavi NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID, SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET e ogni valore a destra di '=' e vuoto o un placeholder (nessuna stringa che matcha un pattern di segreto reale)"
    - id: AC-040-4
      given: "Il file supabase/config.toml presente nel repo"
      when: "Il test legge auth.site_url e auth.additional_redirect_urls"
      then: "additional_redirect_urls e un array che contiene almeno una URL terminante con /it/auth/callback e una terminante con /es/auth/callback"
    - id: AC-040-5
      given: "il file supabase/config.toml presente nel repo"
      when: "il test legge la sezione dei rate limit relativi ad [auth]"
      then: "esiste una configurazione di rate limit per le operazioni di autenticazione con un valore numerico maggiore di 0"
  target_tests:
    - file: "tests/auth-config.test.ts"
      covers: [AC-040-1, AC-040-2, AC-040-3, AC-040-4, AC-040-5]
  security_notes:
    - "A07:2025/A02:2025 (secret/crypto): il client secret Google e le chiavi Supabase NON sono hardcoded; sono referenziati via env(...) in config.toml e via placeholder in .env.example. Nessun segreto reale committato."
    - "R7 (RLS standard): SUPABASE_SERVICE_ROLE_KEY e documentata come chiave solo server-side; il .env.example non la espone come NEXT_PUBLIC_* e non finisce mai nel bundle browser."
    - "OWASP redirect: additional_redirect_urls e una allow-list esplicita di URL di callback consentite, non un wildcard permissivo."
    - "A07:2025 (authentication failures): i rate limit di Supabase Auth sono configurati in config.toml per mitigare brute-force/credential stuffing su sign-in/sign-up."
  out_of_scope:
    - "Implementazione dei form/pagine di login e signup (T-042, T-043)"
    - "Route handler della callback (T-044)"

- id: T-041
  title: "Sessione server-side + guardia di route (middleware)"
  macrotask: "auth"
  depends_on: [T-040, T-080]
  objective: "Fornire l'accesso alla sessione lato server tramite un client Supabase SSR basato su cookie e un helper getUser() che VALIDA il token contro l'auth server (usando supabase.auth.getUser(), non getSession() che si fida del cookie non verificato). Aggiungere un middleware Next.js che protegge le route autenticate della dashboard: in assenza di utente valido reindirizza a /{locale}/login, mentre lascia passare le route pubbliche (login, signup, callback, asset statici) e le richieste con sessione valida. Il middleware unico src/middleware.ts ESTENDE quello di next-intl (T-080), componendo la guardia auth attorno al routing di locale, cosi che un solo file gestisca sia il locale sia la protezione delle route."
  definition_of_done:
    - "File src/data/supabase-ssr.ts che crea un client SSR con lettura/scrittura cookie e usa NEXT_PUBLIC_SUPABASE_ANON_KEY (mai service_role)"
    - "Funzione asincrona getUser() esportata da src/data/supabase-ssr.ts che ritorna l'utente validato o null"
    - "Il file unico src/middleware.ts ESTENDE il middleware next-intl di T-080 componendo la guardia auth: applica il routing di locale e, per /{locale}/dashboard e sotto-route, richiede una sessione valida; esclude asset statici e route pubbliche di auth (login/signup/callback)"
    - "File tests/auth-middleware.test.ts e tests/auth-server-session.test.ts"
    - "Il middleware reindirizza a /{locale}/login preservando il locale corrente"
  acceptance_criteria:
    - id: AC-041-1
      given: "Una richiesta HTTP senza cookie di sessione valido verso /it/dashboard"
      when: "Il middleware Next.js elabora la richiesta"
      then: "La response e un redirect (status 307) con header Location = /it/login"
    - id: AC-041-2
      given: "Una richiesta con cookie di sessione autenticato valido verso /it/dashboard"
      when: "Il middleware elabora la richiesta"
      then: "Il middleware NON reindirizza (nessun header Location verso /login) e la richiesta prosegue (NextResponse.next)"
    - id: AC-041-3
      given: "Un contesto server privo di sessione"
      when: "Viene invocata getUser()"
      then: "Ritorna null senza sollevare eccezioni"
    - id: AC-041-4
      given: "Un contesto server con sessione autenticata valida per un utente con id noto"
      when: "Viene invocata getUser()"
      then: "Ritorna un oggetto user il cui campo id e uguale all'id atteso, ottenuto tramite supabase.auth.getUser() (validazione del JWT lato auth server)"
    - id: AC-041-5
      given: "Una richiesta verso una route pubblica /it/login o /it/auth/callback"
      when: "Il middleware elabora la richiesta"
      then: "La richiesta prosegue senza redirect (route pubblica non protetta)"
    - id: AC-041-6
      given: "il middleware unico composto (next-intl + guardia auth) attivo, senza sessione"
      when: "GET /es/dashboard"
      then: "la response e un redirect 307 con Location = /es/login (il locale es e preservato dal middleware composto, provando che la guardia non corto-circuita il routing di locale)"
  target_tests:
    - file: "tests/auth-middleware.test.ts"
      covers: [AC-041-1, AC-041-2, AC-041-5, AC-041-6]
    - file: "tests/auth-server-session.test.ts"
      covers: [AC-041-3, AC-041-4]
  security_notes:
    - "A01:2025 (broken access control): il middleware e la guardia di route lato server che nega l'accesso alle route protette in assenza di identita valida; non ci si fida di flag client."
    - "Validazione identita server-side: getUser() usa supabase.auth.getUser() che rivalida il token contro l'auth server, invece di fidarsi del cookie di sessione non verificato (getSession)."
    - "R7 (RLS standard): il client SSR usa la anon key + cookie utente, MAI la service_role; nessun bypass di RLS nel middleware."
    - "OWASP redirect: il redirect di destinazione e una route interna fissa (/{locale}/login), non deriva da input utente."
    - "A01:2025 (composizione middleware): un solo src/middleware.ts compone next-intl e la guardia auth; il test verifica che la protezione di /{locale}/dashboard resti attiva per entrambi i locali con entrambi i comportamenti in un unico middleware."
    - "Naming client (R7): il middleware/SSR usa src/data/supabase-ssr.ts (anon + cookie, RLS attiva), mai src/data/supabase-admin.ts (service_role)."
  out_of_scope:
    - "Logica di login/logout e scambio credenziali (T-043)"
    - "Validazione dei dati di signup (T-042)"

- id: T-042
  title: "Signup email/password con validazione server-side"
  macrotask: "auth"
  depends_on: [T-040, T-041, T-021, T-080]
  objective: "Implementare il flusso di registrazione email/password con validazione ESCLUSIVAMENTE server-side tramite uno schema tipato (zod): email in formato valido e password conforme alla policy (lunghezza minima 8, requisiti di complessita). La creazione utente avviene in una Server Action / route handler che valida l'input prima di chiamare supabase.auth.signUp; nessun campo di identita o privilegio (es. role, account_id) proveniente dal client viene mai considerato. La pagina UI di signup fornisce il form."
  definition_of_done:
    - "File src/domain/auth/validation.ts con schema zod signupSchema (email + password policy) esportato"
    - "File src/domain/auth/signup.ts (o Server Action equivalente) che valida con signupSchema e, solo se valido, chiama supabase.auth.signUp"
    - "Pagina UI src/app/[locale]/signup/page.tsx con form email/password che invoca la Server Action"
    - "File tests/auth-signup-validation.test.ts e tests/auth-signup-flow.test.ts"
    - "Lo schema fa strip dei campi non previsti (nessun passthrough di role/account_id)"
  acceptance_criteria:
    - id: AC-042-1
      given: "Un payload di signup con email = 'notanemail' e password valida"
      when: "Il flusso di signup valida l'input server-side"
      then: "signupSchema.safeParse ritorna success === false con un issue sul campo email e supabase.auth.signUp NON viene chiamato"
    - id: AC-042-2
      given: "Un payload con email valida e password = 'abc' (sotto la policy di 8 caratteri)"
      when: "Il flusso valida l'input"
      then: "La validazione fallisce (success === false, issue sul campo password) e signUp NON viene chiamato"
    - id: AC-042-3
      given: "Un payload con email valida e password conforme alla policy"
      when: "Il flusso di signup viene eseguito con il client Supabase locale"
      then: "supabase.auth.signUp viene chiamato una volta con quelle credenziali e l'esito e success (utente creato / email di conferma inviata), senza errore di validazione"
    - id: AC-042-4
      given: "Un payload valido che include campi extra iniettati dal client { role: 'owner', account_id: '...' }"
      when: "signupSchema parsa il payload"
      then: "L'oggetto risultante contiene solo email e password; le chiavi role e account_id sono assenti (stripped) e non vengono mai propagate alla chiamata signUp"
  target_tests:
    - file: "tests/auth-signup-validation.test.ts"
      covers: [AC-042-1, AC-042-2, AC-042-4]
    - file: "tests/auth-signup-flow.test.ts"
      covers: [AC-042-3]
  security_notes:
    - "Validazione input SEMPRE server-side: email e password sono validati con zod in una Server Action prima di ogni chiamata ad auth; non ci si fida del client."
    - "A05:2025 (injection): input trattato tramite schema tipato zod e API client tipata (supabase.auth.signUp), nessuna interpolazione di stringhe in query/filtri."
    - "A01:2025 (broken access control): i campi privilegio (role, account_id) provenienti dal client sono scartati dallo schema; l'appartenenza all'account e gestita altrove server-side, mai fissata dal client in fase di signup."
    - "A04:2025 (crypto failures): l'hashing password e delegato a Supabase Auth (bcrypt); nessuna gestione custom di password in chiaro o hashing casalingo."
    - "A07:2025 (secret): il client usa la anon key da env; nessun segreto hardcoded."
  out_of_scope:
    - "Login e logout (T-043)"
    - "Creazione della riga accounts/account_members e del profilo (macrotask account/DB)"

- id: T-043
  title: "Login/logout email-password + Accedi con Google"
  macrotask: "auth"
  depends_on: [T-040, T-041, T-044, T-021, T-080]
  objective: "Implementare il flusso di login/logout email/password e l'avvio dell'OAuth Google. Il login valida presenza di credenziali server-side, chiama supabase.auth.signInWithPassword impostando i cookie di sessione e reindirizza alla dashboard; a credenziali errate mostra un messaggio d'errore generico (nessuna user enumeration) senza creare sessione. Il logout chiama signOut, pulisce i cookie di sessione e reindirizza al login. Il pulsante 'Accedi con Google' avvia signInWithOAuth({ provider: 'google' }) con redirectTo verso /{locale}/auth/callback."
  definition_of_done:
    - "Pagina UI src/app/[locale]/login/page.tsx con form email/password e pulsante 'Accedi con Google'"
    - "Server Action di login in src/domain/auth che valida input e chiama supabase.auth.signInWithPassword"
    - "Server Action di logout che chiama supabase.auth.signOut e pulisce i cookie di sessione"
    - "Handler/azione che avvia supabase.auth.signInWithOAuth con provider 'google' e redirectTo = URL assoluta di /{locale}/auth/callback"
    - "File tests/auth-login-logout.test.ts e tests/auth-google-oauth.test.ts"
  acceptance_criteria:
    - id: AC-043-1
      given: "Credenziali email/password valide di un utente esistente nell'ambiente Supabase locale"
      when: "Viene inviata la Server Action di login"
      then: "signInWithPassword ha successo, i cookie di sessione vengono impostati e la response reindirizza a /it/dashboard"
    - id: AC-043-2
      given: "Credenziali con password errata per un'email esistente"
      when: "Viene inviata la Server Action di login"
      then: "Non viene creata alcuna sessione (nessun cookie impostato) e viene restituito un messaggio d'errore generico (es. 'Credenziali non valide') identico a quello per email inesistente, senza rivelare quale campo e errato"
    - id: AC-043-3
      given: "Un utente autenticato con sessione attiva"
      when: "Viene invocata la Server Action di logout e successivamente si accede a /it/dashboard"
      then: "signOut viene chiamato, i cookie di sessione risultano cancellati, la response reindirizza a /it/login e la successiva richiesta a /it/dashboard viene reindirizzata a /it/login dal middleware"
    - id: AC-043-4
      given: "La pagina di login renderizzata per il locale it"
      when: "Viene attivata l'azione 'Accedi con Google'"
      then: "supabase.auth.signInWithOAuth viene chiamato con provider === 'google' e options.redirectTo terminante con /it/auth/callback"
  target_tests:
    - file: "tests/auth-login-logout.test.ts"
      covers: [AC-043-1, AC-043-2, AC-043-3]
    - file: "tests/auth-google-oauth.test.ts"
      covers: [AC-043-4]
  security_notes:
    - "A07:2025 (authentication failures): il messaggio d'errore a credenziali errate e generico e uniforme per prevenire user enumeration; nessuna distinzione tra email inesistente e password errata."
    - "A01:2025 (broken access control): dopo il logout la sessione e invalidata e il middleware (T-041) nega di nuovo l'accesso alle route protette."
    - "Validazione input server-side: presenza e formato di email/password verificati nella Server Action prima della chiamata auth; nessuna fiducia nel client."
    - "A05:2025 (injection): uso di API auth tipate (signInWithPassword/signInWithOAuth); nessuna interpolazione di input in filtri PostgREST (.or()/.filter())."
    - "R7 (RLS standard) / A02:2025 (secret): client SSR con anon key + cookie, mai service_role nel browser; il client secret Google resta server-side (T-040); redirectTo e una route interna dell'app."
    - "A07:2025 (authentication failures): oltre al messaggio d'errore generico anti-enumeration, il flusso si appoggia ai rate limit di Supabase Auth (configurati in T-040) contro brute-force/credential stuffing su signInWithPassword; valutare captcha se necessario."
  out_of_scope:
    - "Scambio del code e creazione sessione in callback (T-044)"
    - "Registrazione nuovi utenti (T-042)"
    - "Recupero/reset password"

- id: T-044
  title: "Route handler /{locale}/auth/callback (scambio code -> sessione)"
  macrotask: "auth"
  depends_on: [T-040, T-041, T-080]
  objective: "Implementare il route handler GET /{locale}/auth/callback che completa il flusso OAuth/PKCE: scambia il parametro ?code per una sessione (exchangeCodeForSession) impostando i cookie di sessione tramite il client SSR, poi reindirizza alla destinazione. La destinazione 'next' e validata per prevenire open-redirect (sono accettati solo path relativi same-origin). In assenza di code o in presenza di error, reindirizza al login con un messaggio d'errore senza impostare sessione."
  definition_of_done:
    - "File src/app/[locale]/auth/callback/route.ts con handler GET"
    - "Il handler chiama supabase.auth.exchangeCodeForSession con il code e imposta i cookie via client SSR (src/data/supabase-ssr.ts)"
    - "Funzione di sanitizzazione del parametro next che accetta solo path relativi che iniziano con '/' e non con '//'"
    - "File tests/auth-callback.test.ts"
  acceptance_criteria:
    - id: AC-044-1
      given: "Una richiesta GET a /it/auth/callback?code=valid-code&next=/it/dashboard con code valido nell'ambiente locale"
      when: "Il handler elabora la richiesta"
      then: "exchangeCodeForSession viene chiamato con 'valid-code', i cookie di sessione vengono impostati sulla response e la response e un redirect 307 con Location = /it/dashboard"
    - id: AC-044-2
      given: "Una richiesta GET a /it/auth/callback senza parametro code (o con ?error=access_denied)"
      when: "Il handler elabora la richiesta"
      then: "exchangeCodeForSession NON viene chiamato, nessun cookie di sessione viene impostato e la response e un redirect 307 verso /it/login con un parametro di errore"
    - id: AC-044-3
      given: "Una richiesta GET a /it/auth/callback?code=valid-code&next=https://evil.example.com"
      when: "Il handler calcola la destinazione del redirect"
      then: "La URL esterna viene rifiutata e il redirect punta al path di default sicuro (/it/dashboard), mai a evil.example.com"
  target_tests:
    - file: "tests/auth-callback.test.ts"
      covers: [AC-044-1, AC-044-2, AC-044-3]
  security_notes:
    - "OWASP open redirect: il parametro 'next' e validato come path relativo same-origin (deve iniziare con '/' e non con '//' o schema://); input esterni sono rifiutati verso un default sicuro."
    - "A01:2025 (broken access control): la sessione viene stabilita solo tramite exchangeCodeForSession con un code valido emesso dall'auth server; nessuna sessione viene creata senza code."
    - "R7 (RLS standard): il handler usa il client SSR con anon key + cookie, MAI la service_role."
    - "A07:2025 (secret): chiavi lette da env; nessun segreto nel codice."
  out_of_scope:
    - "Il pulsante 'Accedi con Google' e l'avvio di signInWithOAuth (T-043)"
    - "Configurazione dei provider e delle redirect URL (T-040)"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir del blueprint — atteso exit 0.
- **Semantico** (checklist guidata): punti 6–10 su ogni task; i rilievi vanno all'human-in-the-loop.
