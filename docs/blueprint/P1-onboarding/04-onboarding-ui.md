# 04-onboarding-ui — Macrotask `onboarding-ui` · Flusso, chat, pannello live, conferma

> Modulo del blueprint P1 (Onboarding) di Belora. Un modulo = un macrotask.
> Task atomici secondo lo schema trueline.
>
> **Substrato P0:** AppShell/layout autenticato (T-022), guardia di route + sessione
> server-side (T-041), cataloghi next-intl con parita chiavi it/es (T-081), dashboard
> scheletro `sites` (T-102/T-105), primitive UI vincolate (T-021). I `depends_on` qui
> referenziano solo task P1.
>
> **Forma del flusso: chat-led + pannello brief live (opzione A).** Il wizard e
> realizzato come pannello editabile, non come modalita separata; l'import-URL e una
> porta d'ingresso opzionale che pre-riempie lo stesso pannello.

## Obiettivo del macrotask

Rendere il flusso di onboarding operativo e localizzato: una rotta protetta con turno
di chat in streaming che persiste il brief, i pannelli UI (chat + brief live + import),
la schermata Rivedi&conferma che imposta status='confirmed', e l'aggancio dalla
dashboard dei siti. Il brief confermato e l'artefatto che P2 consumera.

## Task atomici

```yaml
- id: T-150
  title: "Rotta onboarding protetta + turno chat in streaming"
  macrotask: "onboarding-ui"
  depends_on: [T-123, T-132]
  objective: >
    Realizzare la rotta localizzata e protetta src/app/[locale]/onboarding/[siteId]
    (dentro AppShell) e un route handler/server action che esegue un turno di chat:
    carica il brief del sito via getBrief (T-123), invoca l'orchestrazione interview
    (T-132), STREAMMA il testo assistente, e persiste l'aggiornamento del brief via
    upsertBrief (T-123). Senza sessione autenticata reindirizza al login; un utente non
    puo aprire l'onboarding di un sito di un altro account (RLS). Nei test il modello e
    mockato; l'RLS e verificata con auth reale.
  definition_of_done:
    - "Rotta localizzata src/app/[locale]/onboarding/[siteId]/page.tsx resa dentro AppShell"
    - "la rotta e protetta: senza sessione reindirizza al login"
    - "il brief corrente del sito e caricato via getBrief (T-123)"
    - "un endpoint/azione di turno chat che: prende il turno utente -> interview (T-132) -> streamma il testo assistente -> applica l'update e upsert via briefs (T-123)"
    - "l'accesso all'onboarding di un sito non del proprio account e negato (RLS: brief vuoto / redirect / 404)"
  acceptance_criteria:
    - id: AC-150-1
      given: "nessuna sessione autenticata"
      when: "si richiede /it/onboarding/<siteId>"
      then: "la risposta e un redirect al login e il contenuto dell'onboarding non viene reso"
    - id: AC-150-2
      given: "l'utente A autenticato, proprietario del sito S, con un brief draft"
      when: "apre /it/onboarding/S"
      then: "la pagina risponde 200 e rende lo stato corrente del brief (caricato via getBrief)"
    - id: AC-150-3
      given: "l'utente A sull'onboarding del sito S e un confine LLM mockato che ritorna una tool-call update_brief {business_name:'Bar Sole'}"
      when: "invia un turno di chat"
      then: "il brief di S risulta aggiornato (business_name='Bar Sole' via upsertBrief) e il testo assistente e restituito in streaming"
    - id: AC-150-4
      given: "l'utente B autenticato, non membro dell'account di A, e il sito S di A"
      when: "B richiede /it/onboarding/S"
      then: "l'accesso e negato: il brief non e caricato (RLS) e la pagina non espone i dati del sito di A (redirect/404)"
  target_tests:
    - file: "tests/onboarding-route.test.tsx"
      covers: [AC-150-1, AC-150-2, AC-150-3, AC-150-4]
  security_notes:
    - "OWASP A01:2025: la rotta onboarding e protetta lato server (redirect al login senza sessione, AC-150-1) e l'accesso cross-tenant e bloccato dalla RLS via getBrief/upsertBrief (AC-150-4); l'autorizzazione non e affidata al nascondere elementi UI."
    - "R7: nessuna service_role nel percorso; la persistenza usa briefs (client con sessione, RLS attiva)."
    - "OWASP A05:2025 (validation): l'update del brief e validato (T-121/T-122) prima della persistenza; l'output del modello e untrusted."
    - "OWASP A07:2025/A02:2025 (segreti): la chiamata al modello resta dietro il confine server-only (T-131); nel browser solo NEXT_PUBLIC_SUPABASE_ANON_KEY."
  out_of_scope:
    - "Componenti UI del pannello/chat (T-151)"
    - "Schermata Rivedi&conferma (T-152)"

- id: T-151
  title: "UI: ChatPanel + BriefPanel live + UrlImportBar"
  macrotask: "onboarding-ui"
  depends_on: [T-150, T-141]
  objective: >
    Realizzare in src/ui/onboarding i componenti: ChatPanel (rende i turni assistente/
    utente streammati), BriefPanel (rende lo stato del brief in tempo reale, con campi
    editabili a mano che invocano upsertBrief) e UrlImportBar (invia un URL a fromUrl e
    pre-riempie il pannello con la proposta). Tutte le stringhe da chiavi next-intl con
    traduzioni it ed es. Livello UI: la logica dati e delegata a briefs (T-123) e fromUrl
    (T-141).
  definition_of_done:
    - "ChatPanel rende i messaggi (assistente/utente) del turno di chat"
    - "BriefPanel rende i campi del brief corrente e consente l'edit manuale di un campo, che invoca upsertBrief (T-123) con il valore modificato"
    - "UrlImportBar invia un URL a fromUrl (T-141) e pre-riempie il pannello con i campi della proposta"
    - "tutte le stringhe UI provengono da chiavi next-intl presenti sia in it sia in es"
  acceptance_criteria:
    - id: AC-151-1
      given: "uno stato del brief con business_name='Bar Sole'"
      when: "renderizzo il BriefPanel"
      then: "il campo corrispondente mostra 'Bar Sole'"
    - id: AC-151-2
      given: "il BriefPanel con un campo editabile"
      when: "l'utente modifica il campo (es. whatsapp) e conferma"
      then: "upsertBrief viene invocata con il valore modificato per quel campo"
    - id: AC-151-3
      given: "la UrlImportBar e una fromUrl mockata che ritorna una proposta {business_name:'Bar Sole', phone:'...'}"
      when: "l'utente invia un URL"
      then: "fromUrl e invocata con l'URL e il pannello viene pre-riempito con i campi della proposta"
    - id: AC-151-4
      given: "i componenti resi in locale 'es'"
      when: "ispeziono etichette e testi di ChatPanel/BriefPanel/UrlImportBar"
      then: "i testi sono in spagnolo (chiavi i18n diverse dalla versione it)"
  target_tests:
    - file: "tests/onboarding-ui.test.tsx"
      covers: [AC-151-1, AC-151-2, AC-151-3, AC-151-4]
  security_notes:
    - "OWASP A01:2025: i componenti UI non sono il gate di sicurezza; l'autorizzazione cross-tenant e imposta dalla RLS nelle server action briefs (T-123) e dalla protezione di rotta (T-150)."
    - "Validazione input sempre server-side: l'edit del pannello passa da upsertBrief, che ri-valida; la UI non e l'unico gate."
    - "OWASP A07:2025/A02:2025 (segreti): nel browser solo NEXT_PUBLIC_SUPABASE_ANON_KEY; nessuna chiave Anthropic lato client."
  out_of_scope:
    - "Route handler di streaming e persistenza (T-150)"
    - "Schermata Rivedi&conferma (T-152)"

- id: T-152
  title: "Schermata Rivedi & conferma (status='confirmed')"
  macrotask: "onboarding-ui"
  depends_on: [T-150]
  objective: >
    Realizzare src/ui/onboarding/ReviewConfirm e lo step di rotta relativo: un recap
    editabile completo del brief (core + offerte); un controllo di conferma ESPLICITO
    che invoca confirmBrief (T-123) impostando status='confirmed' e riporta l'utente
    alla dashboard. Stringhe da next-intl (it/es). La conferma non e implicita.
  definition_of_done:
    - "La schermata Rivedi&conferma rende tutti i campi del brief (core + offerte) in forma editabile"
    - "un controllo di conferma esplicito invoca confirmBrief (T-123); confirmBrief NON e invocata finche la conferma esplicita non e attivata"
    - "dopo la conferma il brief ha status='confirmed' e l'utente torna alla dashboard"
    - "le stringhe (rivedi, conferma, torna alla dashboard) provengono da chiavi next-intl presenti sia in it sia in es"
  acceptance_criteria:
    - id: AC-152-1
      given: "un brief con business_name e almeno un'offerta"
      when: "renderizzo la schermata Rivedi&conferma"
      then: "i campi core e le offerte del brief sono resi in forma editabile"
    - id: AC-152-2
      given: "la schermata Rivedi&conferma"
      when: "l'utente attiva la conferma esplicita"
      then: "confirmBrief e invocata per quel sito; prima dell'attivazione della conferma esplicita confirmBrief NON e invocata"
    - id: AC-152-3
      given: "un brief draft sul sito S dopo la conferma"
      when: "eseguo getBrief(S)"
      then: "status='confirmed'"
    - id: AC-152-4
      given: "la schermata resa in locale 'es'"
      when: "ispeziono le etichette di rivedi/conferma"
      then: "sono in spagnolo (chiavi i18n diverse dalla versione it)"
  target_tests:
    - file: "tests/onboarding-review.test.tsx"
      covers: [AC-152-1, AC-152-2, AC-152-3, AC-152-4]
  security_notes:
    - "OWASP A01:2025: l'autorizzazione della conferma e imposta dalla RLS in confirmBrief (T-123); la UI non e il gate."
    - "Validazione input server-side: gli edit del recap passano da upsertBrief/confirmBrief (T-123), che ri-validano."
  out_of_scope:
    - "Server action confirmBrief e RLS (T-123)"
    - "Generazione dei 5 mockup (P2)"

- id: T-153
  title: "Dashboard: avvio/continua onboarding + stato brief"
  macrotask: "onboarding-ui"
  depends_on: [T-150]
  objective: >
    Estendere la dashboard dei siti (substrato P0 T-102/T-105) perche ogni sito mostri
    un CTA 'Avvia/Continua onboarding' che linka a /[locale]/onboarding/[siteId], e
    rifletta lo stato del brief: un sito con brief 'confirmed' mostra un badge localizzato
    'pronto per generare' (segnaposto; la generazione e P2). Stringhe da next-intl (it/es).
    Puro cablaggio UI: lo stato del brief e letto via client RLS (getBrief/join).
  definition_of_done:
    - "Ogni riga sito nella dashboard mostra un CTA 'Avvia/Continua onboarding' che linka a /[locale]/onboarding/<siteId>"
    - "un sito con brief 'confirmed' mostra un badge localizzato 'pronto per generare' (segnaposto, generazione = P2)"
    - "le stringhe (CTA, badge) provengono da chiavi next-intl presenti sia in it sia in es"
  acceptance_criteria:
    - id: AC-153-1
      given: "un sito senza brief o con brief draft nell'account dell'utente"
      when: "renderizzo la dashboard"
      then: "la riga del sito mostra un CTA 'Avvia/Continua onboarding' che punta a /it/onboarding/<siteId>"
    - id: AC-153-2
      given: "un sito con brief status='confirmed'"
      when: "renderizzo la dashboard"
      then: "la riga del sito mostra il badge localizzato 'pronto per generare'"
    - id: AC-153-3
      given: "la dashboard resa in locale 'es'"
      when: "ispeziono CTA e badge"
      then: "sono in spagnolo (chiavi i18n diverse dalla versione it)"
  target_tests:
    - file: "tests/dashboard-onboarding-cta.test.tsx"
      covers: [AC-153-1, AC-153-2, AC-153-3]
  security_notes:
    - "OWASP A01:2025: i link non sono il gate; l'autorizzazione e imposta a valle dalla protezione di rotta (T-150) e dalla RLS (briefs T-123); lo stato del brief e letto via client con sessione (RLS)."
  out_of_scope:
    - "Rotta e turno di chat (T-150)"
    - "Generazione AI dei mockup (P2)"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir del blueprint P1 — atteso exit 0.
- **Semantico** (checklist guidata): punti 6–10 su ogni task; i rilievi vanno all'human-in-the-loop.
