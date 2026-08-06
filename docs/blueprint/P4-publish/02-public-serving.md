# 02-public-serving — Macrotask `public-serving`

> Modulo del blueprint P4 (Pubblicazione, serving pubblico & media) di Belora. Un
> modulo = un macrotask (`L-COL-018`, `L-COL-024`). Task atomici secondo lo schema
> trueline (`L-COL-019`). Costruisce **sopra** `publish-core` (M1): serve al **pubblico**
> lo snapshot congelato in `site_publications` (P4-D2). DAG: `publish-core` → `public-serving`.
> Identificatori in inglese, prosa in italiano. Fonte dell'intento:
> `docs/superpowers/specs/2026-08-06-p4-publish-media-design.md` (P4-D3, P4-D5, P4-D9).

## Obiettivo del macrotask

Il **serving pubblico** (P4-D3): la rotta top-level **`/s/<slug>`**, fuori dal routing
localizzato, legge in **anon via RLS** (`is_published = true`, solo colonne pubbliche) lo
snapshot pubblicato, lo **ripassa da `parseDocument`** (gate in render) e lo rende col
**`SiteView` reale standalone** (nessuna chrome Belora) nella **locale del sito** — mai in
quella negoziata dal browser. Il middleware di i18n **esclude `/s/*`** dalla negoziazione di
locale così che la rotta resti top-level. Slug ignoto o riga non pubblicata → **`notFound()`**,
indistinguibili (anti-enumerazione P1-D21). Sopra ogni sito pubblicato, il **badge "Made with
Belora"** (P4-D5), reso dal serving e non dal document non fidato. È la **prima superficie
pubblica** di Belora: la RLS pubblica va **riconquistata e provata a runtime** (anon legge solo
il pubblicato, mai il non pubblicato né le colonne private), non ereditata.

## Task atomici

```yaml
- id: T-405
  title: "Rotta pubblica /s/<slug> standalone: lettura anon -> parseDocument -> SiteView nella locale del sito; slug ignoto/non pubblicato -> notFound"
  macrotask: "public-serving"
  depends_on: [T-401, T-403]

  objective: >
    Esporre una rotta pubblica top-level /s/<slug> che, fuori dal routing localizzato, legge in
    anon (RLS is_published=true, sole colonne pubbliche document/public_slug/locale) lo snapshot
    pubblicato in site_publications, lo ripassa da parseDocument (gate in render) e lo rende col
    SiteView reale standalone nella locale del sito; slug ignoto o riga non pubblicata -> notFound().

  definition_of_done:
    - "Rotta App Router in src/app/s/[slug]/page.tsx (fuori dal segmento [locale]), render standalone senza chrome Belora"
    - "Lettura anon via client di sessione anon: SELECT su site_publications WHERE public_slug = <slug> AND is_published = true, con match ESATTO sullo slug (mai LIKE/prefisso) e proiezione delle sole colonne document, public_slug, locale"
    - "Il document letto ripassa parseDocument PRIMA del render (gate in render); reso dal SiteView reale (renderer unico) nella locale della riga (mai la locale del browser)"
    - "Slug ignoto O riga con is_published=false -> notFound() (404), senza distinzione osservabile fra i due casi (anti-enumerazione P1-D21)"

  acceptance_criteria:
    - id: AC-405-1
      given: "uno slug che corrisponde esattamente a una riga is_published=true con locale='it'"
      when: "GET /s/<slug>"
      then: "la pagina e resa dal SiteView reale in modalita standalone e nella locale della riga (lang='it'), non nella locale negoziata dal browser"
    - id: AC-405-2
      given: "una fixture con >1 pubblicazione, public_slug discordanti e uno slug PREFISSO di un altro (es. 'bar' e 'bar-centro'), tutte is_published=true"
      when: "GET /s/<slug> con uno slug inesistente che e prefisso di uno esistente"
      then: "notFound() (404); nessuna riga selezionata per match di prefisso (match esatto provato dalla coppia prefisso)"
    - id: AC-405-3
      given: "uno slug che corrisponde a una riga is_published=false"
      when: "GET /s/<slug>"
      then: "notFound() (404), risposta indistinguibile dal caso slug ignoto (stesso status, nessun corpo che riveli l'esistenza della riga)"
    - id: AC-405-4
      given: "uno snapshot il cui document NON supera parseDocument"
      when: "la rotta tenta di renderlo"
      then: "e rifiutato dal gate e nulla del document non validato e reso (nessun render fuori dal gate)"
    - id: AC-405-5
      given: "uno snapshot valido il cui brief contiene testo ostile (es. <script>, on-handler, javascript: URL)"
      when: "la rotta rende la pagina"
      then: "il payload compare come TESTO nell'HTML reso (escaping React del SiteView), nessun markup attivo iniettato e nessun src/href derivato dal testo libero"

  target_tests:
    - file: "tests/public-site-route.test.ts"
      covers: [AC-405-1, AC-405-2, AC-405-3, AC-405-4, AC-405-5]

  security_notes:
    - "Documento non fidato reso al PUBBLICO: gate parseDocument in render + escaping React del SiteView (renderer unico), nessun dangerouslySetInnerHTML, nessun src/href da testo libero (invariante sezione 10, preserva P2-D12); XSS/injection OWASP A03:2025"
    - "Lettura anon via RLS is_published=true con proiezione delle sole colonne pubbliche (document, public_slug, locale); account_id e source_generation_id mai selezionati ne esposti (OWASP A01:2025)"
    - "notFound() per slug ignoto E per is_published=false, indistinguibili (anti-enumerazione P1-D21); nessun 403 ne corpo che riveli l'esistenza della riga"
    - "Match ESATTO su public_slug (mai LIKE/prefisso) per non catturare righe non intese"
    - "Client di sessione anon, mai service_role nel path pubblico"
    - "Altitudine (gate repo-wide, T-312): serving in src/app, accesso dati in src/data, forma pura in src/domain; nessun arco vietato"

  out_of_scope:
    - "generateMetadata / Open Graph / canonical (T-409), JSON-LD LocalBusiness (T-410), sitemap/robots (T-411)"
    - "Prova sull'EFFETTO in Chromium della rotta pubblica (T-417)"
    - "Routing per-Host / sottodomini / domini custom (rimandato al pass hosting dedicato, P4-D1)"

- id: T-406
  title: "Middleware esclude /s/* dal routing di locale"
  macrotask: "public-serving"
  depends_on: [T-405]

  objective: >
    Configurare il middleware di i18n esistente perche /s/* sia escluso dal routing localizzato
    (nessun redirect a /[locale]/..., nessuna negoziazione di locale sul path pubblico), cosi che
    /s/<slug> resti top-level e la locale resti quella del sito, mentre il resto delle rotte
    localizzate continua invariato (nessuna regressione).

  definition_of_done:
    - "Il matcher/logica del middleware esclude /s/* (e i suoi sotto-path) dalla riscrittura/redirect di locale"
    - "GET /s/<slug> non viene mai riscritto in /[locale]/s/<slug> ne redirette per Accept-Language"
    - "Le rotte localizzate esistenti continuano a comportarsi come prima (nessuna regressione sul routing di locale)"

  acceptance_criteria:
    - id: AC-406-1
      given: "una richiesta a /s/<slug> con Accept-Language diverso dalla locale del sito"
      when: "passa dal middleware"
      then: "nessun redirect e nessun prefisso di locale aggiunto: l'URL resta /s/<slug>"
    - id: AC-406-2
      given: "una richiesta a una rotta localizzata esistente (es. la home o /editor) senza prefisso di locale"
      when: "passa dal middleware"
      then: "il routing di locale si comporta come prima (redirect/prefisso invariato) — nessuna regressione"
    - id: AC-406-3
      given: "il pattern del matcher del middleware e i path /s, /s/<slug>, /s/<slug>/<sub>"
      when: "si valuta quali path il middleware di locale intercetta"
      then: "nessun path sotto /s/* e intercettato e 's' non e mai interpretato come segmento di locale (slug riservato P4-D4)"

  target_tests:
    - file: "tests/middleware-public-exclusion.test.ts"
      covers: [AC-406-1, AC-406-2, AC-406-3]

  security_notes:
    - "L'esclusione di /s/* dalla negoziazione di locale non deve aprire un bypass: il middleware continua ad applicare le protezioni globali (header di sicurezza, ecc.) sul path pubblico — esclude SOLO la locale, non la sicurezza (OWASP A05:2025 misconfiguration)"
    - "Nessuna riscrittura verso segmenti autenticati: /s/* resta confinato alla rotta pubblica standalone"
    - "'s' e slug riservato (P4-D4): il middleware non deve mai interpretarlo come locale, evitando collisione fra namespace pubblico e localizzato"

  out_of_scope:
    - "Routing per-Host / sottodomini wildcard / domini custom (rimandato, P4-D1)"

- id: T-407
  title: "RLS pubblica provata a RUNTIME: anon legge il pubblicato, non il non-pubblicato ne di altri tenant; colonne private non esposte"
  macrotask: "public-serving"
  depends_on: [T-401]

  objective: >
    Provare a RUNTIME (contro un DB reale con RLS attiva, client anon, mai service_role) che la
    policy di site_publications concede all'anon la SELECT solo delle righe is_published=true,
    negando le righe non pubblicate (di qualunque tenant), e che le colonne private
    (account_id, source_generation_id) non sono mai leggibili dall'anon; con canary falsificabile.

  definition_of_done:
    - "Test di integrazione RUNTIME che esegue query anon reali (anon key) contro site_publications, RLS attiva e non bypassata"
    - "Prova che anon SELECT ritorna la riga pubblicata e insieme VUOTO per la riga non pubblicata (di ogni tenant nella fixture)"
    - "Prova che la proiezione anon espone solo document, public_slug, locale; account_id e source_generation_id non sono leggibili"
    - "Anti-placebo: la riga non pubblicata e leggibile dal proprietario autenticato (esiste davvero); canary: allargare la policy anon a USING(true) rende visibili le non pubblicate -> test ROSSO"

  acceptance_criteria:
    - id: AC-407-1
      given: "un DB con >1 pubblicazione — tenant A: una is_published=true e una is_published=false; tenant B: una is_published=true e una is_published=false — con public_slug discordanti e uno slug PREFISSO di un altro"
      when: "l'anon fa SELECT per il public_slug esatto della riga pubblicata del tenant A"
      then: "riceve esattamente quella riga (una sola), non le altre; nessun match di prefisso"
    - id: AC-407-2
      given: "la stessa fixture"
      when: "l'anon tenta la SELECT della riga is_published=false del tenant A (per slug e per id)"
      then: "riceve insieme VUOTO (RLS nega la lettura del non pubblicato)"
    - id: AC-407-3
      given: "la stessa fixture"
      when: "l'anon tenta la SELECT della riga is_published=false del tenant B (per slug e per id)"
      then: "riceve insieme VUOTO (il non pubblicato e nascosto per ogni tenant, non solo per quello di riferimento)"
    - id: AC-407-4
      given: "la riga pubblicata leggibile dall'anon"
      when: "l'anon tenta di leggere account_id o source_generation_id"
      then: "quelle colonne private non sono esposte (la proiezione pubblica non le include e la lettura diretta non le restituisce)"
    - id: AC-407-5
      given: "la riga is_published=false del tenant A"
      when: "un membro AUTENTICATO del tenant A la legge"
      then: "la riceve (la riga esiste ed e leggibile dal proprietario) — a prova che la negazione all'anon non e vacua"
    - id: AC-407-6
      given: "una variante del test con la policy anon allargata a USING(true) (canary insicuro)"
      when: "l'anon rilegge la fixture"
      then: "le righe non pubblicate diventano visibili e l'oracolo diventa ROSSO (falsificabilita della RLS)"

  target_tests:
    - file: "tests/public-rls-runtime.test.ts"
      covers: [AC-407-1, AC-407-2, AC-407-3, AC-407-4, AC-407-5, AC-407-6]

  security_notes:
    - "RLS pubblica RICONQUISTATA e provata a RUNTIME, non ereditata (OWASP A01:2025 Broken Access Control): policy anon = SELECT USING (is_published = true), nessuna clausola che esponga righe non pubblicate"
    - "Test con client ANON (anon key), mai service_role (che bypassa RLS): usare service_role qui darebbe un verde vacuo; service_role mai nel browser ne nel path pubblico (segreto lato server)"
    - "Colonne private account_id e source_generation_id mai esposte all'anon: la rotta proietta solo document, public_slug, locale; il test asserisce la non-leggibilita delle private"
    - "Cross-tenant sul PUBBLICATO e intenzionale (i siti pubblicati sono pubblici); il confine di tenant vale sulle righe NON pubblicate e sulle SCRITTURE (owner-only, T-401)"
    - "Falsificabilita: la riga non pubblicata e leggibile dal proprietario (anti-placebo) e il canary USING(true) rende l'oracolo ROSSO"
    - "DB pulito (db:reset) prima del test per RLS deterministica (nota operativa editor-blocks: checkpoint su stato pulito)"

  out_of_scope:
    - "Isolamento in SCRITTURA di site_publications (owner CRUD) — provato in T-401"
    - "RLS di assets e storage.objects (T-412)"

- id: T-408
  title: "Badge 'Made with Belora' sul sito pubblicato"
  macrotask: "public-serving"
  depends_on: [T-405]

  objective: >
    Rendere su ogni sito pubblicato v1 il badge "Made with Belora" (P4-D5) come elemento del
    serving pubblico (src/app), non del document del sito, con markup e href statici (mai derivati
    dal document non fidato), localizzato nella locale del sito.

  definition_of_done:
    - "Ogni pagina resa da /s/<slug> mostra il badge 'Made with Belora' (P4-D5: v1 tutti free-tier, pre-billing)"
    - "Il badge e renderizzato dal serving pubblico (src/app), NON dal document del sito, quindi non rimovibile ne spoofabile via editing del document"
    - "Il badge linka a Belora con markup e href STATICI (costanti), nessun dato dal document non fidato negli attributi"
    - "Testo del badge nella locale del sito (it/es) o brand neutro"

  acceptance_criteria:
    - id: AC-408-1
      given: "un sito pubblicato"
      when: "GET /s/<slug>"
      then: "l'HTML reso contiene il badge 'Made with Belora' con link a Belora"
    - id: AC-408-2
      given: "un document del sito che tenta di sopprimere o spoofare il badge (es. un blocco di testo chiamato 'badge' con href ostile javascript:)"
      when: "la pagina e resa"
      then: "il badge del serving e comunque presente e il suo href resta l'URL statico di Belora (mai derivato dal document)"
    - id: AC-408-3
      given: "una fixture con >1 sito e locale discordanti (uno it, uno es)"
      when: "si rende ciascun sito"
      then: "il badge appare nella locale del rispettivo sito (o brand neutro), non nella locale del browser"

  target_tests:
    - file: "tests/public-badge.test.ts"
      covers: [AC-408-1, AC-408-2, AC-408-3]

  security_notes:
    - "Badge renderizzato dal serving (src/app), non dal document non fidato: non rimovibile ne spoofabile via editing (integrita del confine free-tier P4-D5)"
    - "href e attributi del badge STATICI (costanti), mai derivati da testo libero del document (nessun src/href da testo libero — invariante sezione 10, preserva P2-D12); nessuno schema javascript: iniettabile"
    - "Nessun dangerouslySetInnerHTML nel badge; escaping React preservato (OWASP A03:2025)"

  out_of_scope:
    - "Rimozione del badge a pagamento e gating one-pager/multi-page (P5, billing)"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir `docs/blueprint/P4-publish`
  — atteso exit 0 / tutti i controlli OK (`11` §5.1). Ogni AC di questo modulo è coperto da ≥1
  `target_test`; i `depends_on` (T-401, T-403) puntano a id del modulo `01-publish-core`.
- **Semantico** (checklist guidata): `self-check-checklist.md` punti 6–10 su ogni task; i
  rilievi vanno all'human-in-the-loop (`11` §5.2–§5.3).
