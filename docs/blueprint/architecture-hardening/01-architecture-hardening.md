# 01-architecture-hardening — Macrotask `architecture-hardening`

> Modulo (unico) del blueprint trasversale `architecture-hardening` di Belora. Un modulo =
> un macrotask (`L-COL-018`, `L-COL-024`). Task atomici secondo lo schema trueline
> (`L-COL-019`). Refactor a **iso-comportamento** su codice P0/P1/P2 già in `main` + attivazione
> repo-wide del gate `architecture:`. Il contratto `architecture:` è dichiarato **una volta**
> in `docs/blueprint/P3-editor/00-INDEX.md` §1bis (P3-D7); qui NON si duplica.
> Identificatori in inglese, prosa in italiano.

## Obiettivo del macrotask

Rendere il contratto di altitudine `architecture:` un **gate reale, alias-aware, repo-wide**,
conformando il **codice** (decisione `AH-D1`: la regola `domain→data` resta vietata, non si
ammorbidisce). Bonificare le **7** violazioni `domain→data` misurate — via **relayer** (Gruppo
A: Server Actions → `src/app`; Gruppo C: funzioni I/O di generazione → `src/data`) e
**dependency-inversion** (Gruppo B: porta LLM di onboarding iniettata) — e poi **estendere il
gate** dalla superficie P3 a tutto il repo (drop del pin `LEGACY_DOMAIN_DATA`, testimone di
non-vacuità positivo). I refactor sono `T-AH1..T-AH5`; il gate è `T-AH6`, che dipende da tutti.

**Nota sui `covers:` nei file di test.** Ogni blocco di test che esercita un AC porta
`// covers: AC-AHx-n`. Per i refactor, i `target_tests` sono i **test esistenti** aggiornati
(nuovi path di import); l'iso-comportamento è provato dal loro restare verdi.

## Task atomici

```yaml
- id: T-AH1
  title: "Relayer setLocale: da src/domain a src/app (Server Action)"
  macrotask: "architecture-hardening"
  depends_on: []

  objective: >
    Spostare l'intera Server Action setLocale da src/domain a src/app (dove app->data e'
    lecito), cancellando l'arco domain->data verso @/data/updateProfileLocale a comportamento
    invariato; la sola parte pura (validazione inline) si sposta col modulo.

  definition_of_done:
    - "setLocale vive in un modulo 'use server' sotto src/app/** (non piu' in src/domain); src/ui/LocaleSwitcher.tsx lo importa dalla nuova sede"
    - "src/domain non contiene piu' alcun import di @/data/updateProfileLocale (arco domain->data di setLocale rimosso)"
    - "Ordine e semantica invariati: validate (allowlist locale + regex del path interno) -> updateProfileLocale best-effort -> cookie.set NEXT_LOCALE -> redirect"

  acceptance_criteria:
    - id: AC-AH1-1
      given: "un locale valido (es. 'es') e un pathname interno (es. '/dashboard')"
      when: "si chiama setLocale dalla nuova sede in src/app"
      then: "persiste il locale, setta il cookie NEXT_LOCALE e redirige (comportamento invariato)"
    - id: AC-AH1-2
      given: "updateProfileLocale che rigetta o lancia (es. utente anon 401, DB 500)"
      when: "si chiama setLocale con un locale valido"
      then: "il cambio lingua NON e' bloccato: cookie e redirect avvengono comunque (best-effort preservato)"
    - id: AC-AH1-3
      given: "un pathname esterno o malevolo ('https://evil.com', '//evil.com', '/\\t//evil.com')"
      when: "si chiama setLocale"
      then: "e' rifiutato con status 400 e nessun redirect fuori-origine (open-redirect/smuggling preservato)"
    - id: AC-AH1-4
      given: "il componente LocaleSwitcher renderizzato"
      when: "si ispezionano i controlli di lingua"
      then: "espone i pulsanti it/es con aria-current sul locale attivo (invariato dopo lo spostamento di setLocale)"

  target_tests:
    - file: "tests/i18n-locale-switch.test.ts"
      covers: [AC-AH1-1, AC-AH1-2, AC-AH1-3]
    - file: "tests/locale-switcher.test.tsx"
      covers: [AC-AH1-4]

  security_notes:
    - "updateProfileLocale resta invariato: usa il client Supabase di SESSIONE (RLS, id = auth.uid()), mai service_role; nessun nuovo seam d'iniezione. Il pathname resta input non fidato, validato prima di qualunque redirect (no open-redirect)."

- id: T-AH2
  title: "Relayer auth login/logout/signInWithGoogle: da src/domain a src/app"
  macrotask: "architecture-hardening"
  depends_on: []

  objective: >
    Spostare le tre Server Action di login (login, logout, signInWithGoogle) da
    src/domain/auth/login.ts a src/app, cancellando l'arco domain->data verso
    @/data/supabase-ssr a comportamento invariato; la validazione zod resta in domain.

  definition_of_done:
    - "login, logout, signInWithGoogle vivono in src/app/[locale]/login/actions.ts ('use server'); src/app/[locale]/login/page.tsx le importa dalla nuova sede (login.bind/useActionState invariati)"
    - "src/domain/auth/login.ts non esporta piu' verso @/data/supabase-ssr; src/domain non importa piu' quel modulo per queste azioni (arco rimosso). La validazione (loginSchema) resta in src/domain/auth/validation.ts (app->domain lecito)"
    - "Comportamento invariato: signInWithPassword -> scrittura cookie di sessione -> redirect /{locale}/dashboard; signOut -> pulizia cookie -> redirect /{locale}/login; signInWithOAuth con redirectTo assoluto da siteOrigin"

  acceptance_criteria:
    - id: AC-AH2-1
      given: "credenziali valide"
      when: "si chiama login dalla nuova sede"
      then: "supabase.auth.signInWithPassword e' invocato e si redirige a /{locale}/dashboard (client di sessione, cookie scritti dall'adapter)"
    - id: AC-AH2-2
      given: "credenziali errate"
      when: "si chiama login"
      then: "ritorna un messaggio d'errore generico non-enumerante (nessuna distinzione utente-esiste vs password-errata)"
    - id: AC-AH2-3
      given: "un utente con sessione attiva"
      when: "si chiama logout"
      then: "supabase.auth.signOut e' invocato e si redirige a /{locale}/login"
    - id: AC-AH2-4
      given: "una richiesta di accesso con Google"
      when: "si chiama signInWithGoogle"
      then: "supabase.auth.signInWithOAuth e' invocato con provider google e un redirectTo assoluto derivato da siteOrigin"

  target_tests:
    - file: "tests/auth-login-logout.test.ts"
      covers: [AC-AH2-1, AC-AH2-2, AC-AH2-3]
    - file: "tests/auth-google-oauth.test.ts"
      covers: [AC-AH2-4]

  security_notes:
    - "Le azioni costruiscono il client con createServerSupabaseClient() (anon key + cookie, RLS attiva), mai service_role: lo spostamento non introduce un seam dove sostituire un client admin. Messaggio di login generico (anti-enumerazione, CWE-204). redirect() resta dentro una Server Action ('use server')."

- id: T-AH3
  title: "Relayer auth signup: da src/domain a src/app"
  macrotask: "architecture-hardening"
  depends_on: []

  objective: >
    Spostare la Server Action signup da src/domain/auth/signup.ts a src/app, cancellando
    l'arco domain->data verso @/data/supabase-ssr a comportamento invariato; la validazione
    zod (signupSchema, che scarta role/account_id) resta in domain.

  definition_of_done:
    - "signup vive in src/app/[locale]/signup/actions.ts ('use server'); src/app/[locale]/signup/page.tsx lo importa dalla nuova sede (useActionState unbound invariato)"
    - "src/domain/auth/signup.ts non importa piu' @/data/supabase-ssr (arco rimosso); signupSchema resta in src/domain/auth/validation.ts"
    - "Comportamento invariato: validazione -> supabase.auth.signUp; errore generico non-enumerante in caso di conflitto"

  acceptance_criteria:
    - id: AC-AH3-1
      given: "un input invalido (email malformata o password debole)"
      when: "si chiama signup"
      then: "supabase.auth.signUp NON e' raggiunto e ritorna un errore di validazione"
    - id: AC-AH3-2
      given: "un input valido"
      when: "si chiama signup"
      then: "supabase.auth.signUp e' invocato col client di sessione e ritorna lo stato di successo"
    - id: AC-AH3-3
      given: "un errore lato auth (es. email gia' registrata)"
      when: "si chiama signup"
      then: "ritorna un messaggio generico non-enumerante (nessuna enumerazione degli account)"

  target_tests:
    - file: "tests/auth-signup-validation.test.ts"
      covers: [AC-AH3-1]
    - file: "tests/auth-signup-flow.test.ts"
      covers: [AC-AH3-2, AC-AH3-3]

  security_notes:
    - "Client di sessione via createServerSupabaseClient(), mai service_role; la validazione (signupSchema) che scarta i campi privilegiati resta in domain; messaggio generico anti-enumerazione (CWE-204); hashing password delegato a Supabase Auth."

- id: T-AH4
  title: "Dependency-inversion della porta LLM di onboarding (interview + fromUrl)"
  macrotask: "architecture-hardening"
  depends_on: []

  objective: >
    Rimuovere gli archi domain->data verso @/data/anthropic da interview.ts e fromUrl.ts
    iniettando una porta LLM di onboarding tipizzata solo sul SDK Anthropic; i chiamanti
    costruiscono e passano la porta, il domain resta puro.

  definition_of_done:
    - "Un tipo OnboardingLlmPort e' definito in src/domain e riferisce SOLO @anthropic-ai/sdk: (turn: {system, messages, tools}) => Promise<Anthropic.Message>"
    - "runInterviewTurn e fromUrl ricevono la porta come argomento; rimosso ogni default che re-importi @/data/anthropic. src/domain/onboarding/interview.ts e src/domain/import/fromUrl.ts non importano piu' @/data/anthropic"
    - "fromUrl riceve la porta dal chiamante src/data/import.ts; interview la riceve via provider src/data/llm-ports.ts (non nominato *anthropic*), importato dalla route src/app/api/onboarding/[siteId]/turn/route.ts (app->data lecito)"

  acceptance_criteria:
    - id: AC-AH4-1
      given: "una porta LLM iniettata che ritorna una risposta con tool_use update_brief valido"
      when: "runInterviewTurn riceve turn e porta"
      then: "il brief e' aggiornato e readyForReview e' corroborato da isBriefComplete (comportamento invariato)"
    - id: AC-AH4-2
      given: "una porta fake che ritorna un tool_use update_brief con input invalido"
      when: "runInterviewTurn interpreta la risposta"
      then: "l'update e' rifiutato dalla validazione zod (input non fidato) e il brief non e' corrotto"
    - id: AC-AH4-3
      given: "una pagina che non si auto-dichiara (nessun JSON-LD LocalBusiness ne og:title)"
      when: "si chiama fromUrl(rawUrl, porta)"
      then: "la porta e' invocata per l'estrazione e la proposta riflette i campi estratti"
    - id: AC-AH4-4
      given: "una porta che lancia durante l'estrazione"
      when: "si chiama fromUrl"
      then: "ritorna comunque la proposta deterministica (il passo AI e' opzionale/best-effort)"

  target_tests:
    - file: "tests/interview-orchestration.test.ts"
      covers: [AC-AH4-1, AC-AH4-2]
    - file: "tests/import-fromurl.test.ts"
      covers: [AC-AH4-3, AC-AH4-4]

  security_notes:
    - "La porta e' tipizzata solo sul SDK Anthropic: il domain non importa @/data/anthropic (boundary della chiave server-only). src/app non importa mai @/data/anthropic: l'accesso passa dal provider src/data/llm-ports.ts. Client Anthropic lazy (importare senza chiave non deve lanciare). L'output del modello resta input NON FIDATO: la validazione zod dei tool_use e' invariata."

- id: T-AH5
  title: "Relayer delle funzioni I/O di generazione (phase1/phase2) in src/data"
  macrotask: "architecture-hardening"
  depends_on: []

  objective: >
    Spostare le funzioni I/O runGenerationPhase1 e runGenerationPhase2Chunk da src/domain a
    src/data (accanto ai loro chiamanti), cancellando gli archi domain->data verso
    @/data/anthropic; i builder puri e il prefisso di cache restano in domain.

  definition_of_done:
    - "runGenerationPhase1 e runGenerationPhase2Chunk vivono in src/data (accanto ai chiamanti); i builder PURI (buildPhase2ChunkPayload e gli helper di assemblaggio payload/pool tool) restano in src/domain/generation e non importano @/data"
    - "src/domain/generation non importa piu' @/data/anthropic (archi domain->data di phase1/phase2 rimossi); i tipi di fallimento derivati da runGenerationTurn si spostano col boundary in src/data"
    - "Chiamanti aggiornati: src/app/api/generate/route.ts e src/data/generation-regenerate.ts usano runGenerationPhase1 dalla nuova sede; src/data/generation-phase2.ts usa runGenerationPhase2Chunk dalla nuova sede"

  acceptance_criteria:
    - id: AC-AH5-1
      given: "un brief valido"
      when: "si chiama runGenerationPhase1 dalla nuova sede in src/data"
      then: "chiama runGenerationTurn con phase 'phase1' e ritorna {ok:true, pool, allowedSlugs} (comportamento invariato)"
    - id: AC-AH5-2
      given: "runGenerationTurn che ritorna {ok:false, reason}"
      when: "si chiama runGenerationPhase1"
      then: "propaga {ok:false, reason} senza alterarlo (repackage invariato)"
    - id: AC-AH5-3
      given: "innerPages e un chunk di pagine"
      when: "si chiama runGenerationPhase2Chunk dalla nuova sede in src/data"
      then: "chiama runGenerationTurn con phase 'phase2_chunk' e ritorna {ok:true, pool, allowedSlugs}"
    - id: AC-AH5-4
      given: "buildPhase2ChunkPayload (puro, resta in domain) e piu' chunk dello stesso brief"
      when: "si assembla il payload per chunk diversi"
      then: "il prefisso di cache (tool + system) e' byte-identico fra i chunk (proprieta' preservata)"

  target_tests:
    - file: "tests/generate-route.test.tsx"
      covers: [AC-AH5-1, AC-AH5-2]
    - file: "tests/generation-phase2.test.ts"
      covers: [AC-AH5-3]
    - file: "tests/generation-phase2-cache-prefix.test.ts"
      covers: [AC-AH5-4]

  security_notes:
    - "Il boundary runGenerationTurn resta l'unico punto che parla con l'LLM: preserva le request-options maxRetries:0 + timeout (niente retry silenziosi con doppia fatturazione), il breakpoint cache_control e il client lazy. parsePool resta il gate dentro il boundary; nessun documento non validato persistito. Lo spostamento non tocca la sanificazione a valle."

- id: T-AH6
  title: "Gate di altitudine repo-wide: flip da scoped-P3 a tutto il repo"
  macrotask: "architecture-hardening"
  depends_on: [T-AH1, T-AH2, T-AH3, T-AH4, T-AH5]

  objective: >
    Estendere l'enforcement del contratto architecture: (nel test vitest, alias-aware) dalla
    superficie P3 a TUTTO il repo: 0 archi forbidden su tutti i sorgenti, drop del pin
    LEGACY_DOMAIN_DATA, e un testimone di non-vacuita' positivo che sostituisce l'ex "esattamente 7".

  definition_of_done:
    - "tests/architecture-contract.test.ts asserisce evaluateContract(cleanGraph, contract).violations vuoto su tutte e 4 le regole forbidden, per TUTTI i sorgenti (non piu' surfaceViolations scoped alla superficie P3)"
    - "Il pin LEGACY_DOMAIN_DATA e' rimosso (i 7 archi non esistono piu'); nessuna deroga/allowlist per essi; la fixture di falsificabilita' e il vacuity guard di layer restano"
    - "Testimone di non-vacuita' POSITIVO: il grafo alias-aware risolve >=1 arco @/ cross-layer lecito (es. app->domain / ui->domain) mentre il grafo cieco (senza tsConfig) ne vede 0; aggiornata la documentazione che enumerava i 7 (KICKOFF §2, commenti SCOPE ONESTO del test)"

  acceptance_criteria:
    - id: AC-AH6-1
      given: "il grafo import alias-aware costruito su tutti i sorgenti del repo"
      when: "si valuta il contratto architecture: (4 regole forbidden)"
      then: "l'insieme delle violazioni e' vuoto: 0 archi domain->ui, domain->data, domain->app e 0 data->ui, repo-wide"
    - id: AC-AH6-2
      given: "una fixture che introduce un import deliberatamente vietato (es. un data->ui via alias @/)"
      when: "gira il gate sulla fixture"
      then: "diventa ROSSO; rimossa la fixture, il gate torna verde (falsificabilita')"
    - id: AC-AH6-3
      given: "il grafo alias-aware e il grafo cieco costruito senza tsConfig"
      when: "si contano gli archi @/ cross-layer leciti (es. app->domain)"
      then: "l'alias-aware ne conta >=1 e il cieco ne conta 0 (testimone di non-vacuita': il resolver alias non e' cieco)"

  target_tests:
    - file: "tests/architecture-contract.test.ts"
      covers: [AC-AH6-1, AC-AH6-2, AC-AH6-3]

  security_notes:
    - "Gate di ALTITUDINE (confini architetturali, OWASP A04/A05): impedisce che il dominio dipenda dai dettagli di IO/persistenza. L'enforcement vive nel test versionato perche' l'oracolo trueline arch_check e' esterno/immutabile e cieco sugli alias @/; la regola resta invariata (domain->data vietato), e' il codice a essere stato conformato. Prima del verde, la fixture di falsificabilita' prova che il gate sa diventare ROSSO (no falso verde)."
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir `docs/blueprint/architecture-hardening`
  — atteso exit 0 / tutti i controlli OK (`11` §5.1). Il check (6) ARCH_CONTRACT_WELL_FORMED è
  **skip legittimo** qui: il blocco `architecture:` non è duplicato (vive in P3 `00-INDEX` §1bis).
- **Semantico** (checklist guidata): `self-check-checklist.md` punti 6–10 su ogni task; i rilievi
  vanno all'human-in-the-loop (`11` §5.2–§5.3).
