# 02-ai-onboarding — Macrotask `ai-onboarding` · Confine LLM & intervista

> Modulo del blueprint P1 (Onboarding) di Belora. Un modulo = un macrotask.
> Task atomici secondo lo schema trueline.
>
> **Substrato P0:** modulo brand/config (`src/config/env.ts`, T-006/T-002), convenzione
> di layering `src/ui · src/domain · src/data`, guardia ESLint no-restricted-imports gia
> usata per confinare il client `supabase-admin` (decision ledger P0). I `depends_on` qui
> referenziano solo task P1.
>
> **Prima integrazione LLM del progetto.** L'unica cosa non-deterministica (la chiamata
> al modello) e isolata in `src/data/anthropic.ts`, un confine server-only **mockabile**:
> i test iniettano turni/tool-call preconfezionati, cosi gli oracoli restano deterministici
> (ORACLE-AS-JUDGE intatto). Modello di default Haiku 4.5, configurabile via env.

## Obiettivo del macrotask

Introdurre la chat AI di onboarding: la config del segreto Anthropic e del modello
(server-only), il confine LLM unico e mockabile, e l'orchestrazione dell'intervista che
riempie il Brief via tool-use tipato (`update_brief` strict), applicando gli aggiornamenti
con la logica pura del macrotask brief-model.

## Task atomici

```yaml
- id: T-130
  title: "Config env Anthropic (chiave server-only + modello)"
  macrotask: "ai-onboarding"
  depends_on: []
  objective: >
    Estendere lo schema env (src/config/env.ts) con ANTHROPIC_API_KEY (segreto,
    server-only, mai NEXT_PUBLIC) e ANTHROPIC_MODEL_ONBOARDING (default
    'claude-haiku-4-5'). La chiave e letta solo lato server e non e mai esposta al
    bundle client; nessun segreto nel sorgente. L'accesso alla chiave quando assente
    fallisce in modo esplicito (config error), mai silenzioso.
  definition_of_done:
    - "Lo schema env include ANTHROPIC_API_KEY (server-only) e ANTHROPIC_MODEL_ONBOARDING con default 'claude-haiku-4-5'"
    - "ANTHROPIC_API_KEY NON e prefissata NEXT_PUBLIC e non compare in alcun oggetto/config esposto al client"
    - "l'accesso server-side alla chiave assente lancia un errore di configurazione chiaro (fail-fast), non un valore vuoto silenzioso"
    - "nessuna chiave hardcoded nel sorgente (solo lettura da process.env)"
  acceptance_criteria:
    - id: AC-130-1
      given: "ANTHROPIC_API_KEY e ANTHROPIC_MODEL_ONBOARDING impostate nell'ambiente server"
      when: "il modulo env viene valutato lato server"
      then: "la chiave e disponibile server-side e il modello risolve al valore impostato"
    - id: AC-130-2
      given: "lo schema/config env"
      when: "ispeziono i nomi delle variabili esposte al client (prefisso NEXT_PUBLIC) e l'oggetto di config client"
      then: "ANTHROPIC_API_KEY non e presente tra le variabili client (non e NEXT_PUBLIC e non e riesportata verso il browser)"
    - id: AC-130-3
      given: "ANTHROPIC_MODEL_ONBOARDING non impostata"
      when: "leggo il modello di onboarding dalla config"
      then: "il valore risolve al default 'claude-haiku-4-5'"
    - id: AC-130-4
      given: "ANTHROPIC_API_KEY assente"
      when: "un percorso server-side richiede la chiave"
      then: "viene lanciato un errore di configurazione esplicito (fail-fast) e nessun valore vuoto viene restituito"
  target_tests:
    - file: "tests/env-anthropic.test.ts"
      covers: [AC-130-1, AC-130-2, AC-130-3, AC-130-4]
  security_notes:
    - "OWASP A07:2025/A02:2025 (segreti / misconfiguration): ANTHROPIC_API_KEY vive solo in env server, mai NEXT_PUBLIC, mai nel sorgente — la baseline gitleaks deve restare a 0 (verificato in AC-130-2 e dall'oracolo secret del checkpoint)."
    - "ASVS Configuration & Secret Management: fail-fast su chiave assente, nessun degrado silenzioso a chiave vuota."
  out_of_scope:
    - "Istanza del client Anthropic (T-131)"
    - "Orchestrazione dell'intervista (T-132)"

- id: T-131
  title: "anthropic.ts — confine LLM server-only, mockabile"
  macrotask: "ai-onboarding"
  depends_on: [T-130]
  objective: >
    Creare src/data/anthropic.ts, il confine UNICO con l'LLM: un modulo server-only che
    istanzia il client dell'SDK Anthropic con la chiave e il modello dalla config
    (T-130) ed espone una singola funzione di turno (es. runOnboardingTurn(messages,
    tools)). E' il seam che i test mockano. Una regola ESLint no-restricted-imports
    impedisce l'import del modulo da codice client/browser (stesso pattern del client
    supabase-admin in P0). Nessun segreto nel sorgente.
  definition_of_done:
    - "Modulo src/data/anthropic.ts server-only che espone una sola funzione di turno LLM"
    - "il client Anthropic e istanziato con model = ANTHROPIC_MODEL_ONBOARDING e chiave da env (T-130)"
    - "una regola ESLint no-restricted-imports vieta l'import di src/data/anthropic da componenti client/browser (import accidentale = errore di lint)"
    - "nessuna chiave o segreto letterale nel sorgente (solo via config/env)"
  acceptance_criteria:
    - id: AC-131-1
      given: "un client SDK Anthropic mockato iniettato nel modulo"
      when: "chiamo la funzione di turno con un set di messaggi e tool"
      then: "il client mockato e invocato con model uguale ad ANTHROPIC_MODEL_ONBOARDING e con esattamente i messaggi e i tool passati"
    - id: AC-131-2
      given: "la configurazione ESLint del progetto"
      when: "ispeziono le regole no-restricted-imports"
      then: "esiste una regola che vieta l'import di src/data/anthropic (o 'server-only') da percorsi client/browser, cosi un import accidentale lato client fa fallire il lint"
    - id: AC-131-3
      given: "il sorgente di src/data/anthropic.ts"
      when: "cerco stringhe segrete (chiavi API) nel file"
      then: "non esiste alcuna chiave letterale: la chiave e letta solo da config/env (T-130)"
  target_tests:
    - file: "tests/anthropic-boundary.test.ts"
      covers: [AC-131-1, AC-131-2, AC-131-3]
  security_notes:
    - "OWASP A07:2025/A02:2025 (segreti): il confine LLM e server-only; la chiave privilegiata non raggiunge mai il browser (guardia ESLint, verificata in AC-131-2), analogamente al confinamento della service_role in P0."
    - "Il confine unico e mockabile mantiene ORACLE-AS-JUDGE: la non-determinazione del modello e isolata e non entra nei controlli deterministici."
  out_of_scope:
    - "Costruzione del prompt e interpretazione delle tool-call (T-132)"
    - "Streaming lato route (T-150)"

- id: T-132
  title: "interview.ts — orchestrazione intervista (update_brief strict, LLM mockato)"
  macrotask: "ai-onboarding"
  depends_on: [T-131, T-122]
  objective: >
    Implementare src/domain/onboarding/interview.ts: costruisce il system prompt
    localizzato (it/es), dichiara il tool update_brief con schema strict derivato dal
    Brief (T-121, additionalProperties:false + required) e il tool mark_ready_for_review,
    chiama il confine LLM (T-131), e interpreta le tool-call: ogni update_brief e validato
    (T-121) e applicato con applyBriefUpdate (T-122) producendo il nuovo stato del brief
    piu il testo assistente; mark_ready_for_review alza il flag di passaggio a
    Rivedi&conferma. Nei test il modello e mockato.
  definition_of_done:
    - "Modulo src/domain/onboarding/interview.ts con una funzione di orchestrazione: (messaggi precedenti, brief corrente, turno utente) -> (testo assistente, brief aggiornato, flag ready-for-review)"
    - "dichiara il tool update_brief con strict:true (additionalProperties:false, required) derivato dallo schema Brief (T-121) e il tool mark_ready_for_review"
    - "il system prompt e localizzato per locale (it/es)"
    - "l'input di ogni tool-call update_brief e validato (T-121) e fuso con applyBriefUpdate (T-122) prima di aggiornare lo stato"
    - "la chiamata al modello passa per src/data/anthropic.ts (T-131); nel test il confine e mockato"
    - "EMENDAMENTO P1-D24: il system prompt riporta lo STATO del brief corrente come SOLI NOMI dei campi (compilati / da raccogliere) piu i valori dei due enum chiusi (vertical, primary_goal); NESSUN valore di testo libero del brief entra nel payload"
    - "EMENDAMENTO P1-D24: il flag ready-for-review e vero solo se il modello lo segnala E isBriefComplete (T-122) e vero sul brief risultante dal turno"
  acceptance_criteria:
    - id: AC-132-1
      given: "un confine LLM mockato che ritorna testo assistente + una tool-call update_brief con {business_name:'Bar Sole'}"
      when: "eseguo un turno di orchestrazione partendo da un brief vuoto"
      then: "il brief restituito ha business_name='Bar Sole' e il testo assistente e riportato al chiamante"
    - id: AC-132-2
      given: "un turno di orchestrazione"
      when: "ispeziono i tool passati al confine LLM"
      then: "e presente update_brief con strict=true (additionalProperties:false, required valorizzato) e mark_ready_for_review"
    - id: AC-132-3
      given: "locale='es'"
      when: "eseguo un turno e ispeziono il system prompt passato al confine LLM"
      then: "il system prompt e in spagnolo (testo diverso dalla versione it)"
    - id: AC-132-4
      given: "un confine LLM mockato che ritorna una tool-call update_brief con vertical='casino' (fuori allowlist)"
      when: "eseguo il turno"
      then: "l'update invalido e rifiutato dalla validazione (T-121) e il campo vertical del brief resta invariato (nessuna corruzione)"
    - id: AC-132-5
      given: "un confine LLM mockato che ritorna una tool-call mark_ready_for_review, e un brief che dopo il turno ha i campi essenziali valorizzati (isBriefComplete vero)"
      when: "eseguo il turno"
      then: "il flag ready-for-review restituito e true"
    - id: AC-132-6
      given: "un confine LLM mockato che ritorna una tool-call mark_ready_for_review, e un brief che dopo il turno NON ha i campi essenziali (isBriefComplete falso)"
      when: "eseguo il turno"
      then: "il flag ready-for-review restituito e FALSE: il segnale del modello da solo non apre il passo di conferma (EMENDAMENTO P1-D24, corroborazione deterministica di 04 §7 p.8)"
    - id: AC-132-7
      given: "un brief con alcuni campi compilati (fra cui valori di testo provenienti da un import) e altri mancanti"
      when: "eseguo il turno e ispeziono il payload inviato al confine LLM"
      then: "il payload nomina i campi compilati e quelli da raccogliere e riporta i valori dei due enum chiusi, e NON contiene alcun valore di testo libero del brief (EMENDAMENTO P1-D24: nessuna superficie di prompt injection dai siti importati)"
  target_tests:
    - file: "tests/interview-orchestration.test.ts"
      covers: [AC-132-1, AC-132-2, AC-132-3, AC-132-4, AC-132-5, AC-132-6, AC-132-7]
  security_notes:
    - "OWASP A05:2025 (validation): l'output del modello e input NON FIDATO — l'input di update_brief e validato con BriefSchema (T-121) prima di essere fuso, e strict:true vincola la forma dell'input del tool."
    - "OWASP A07:2025/A02:2025 (segreti): l'orchestrazione non contiene segreti e chiama il modello solo tramite il confine server-only (T-131); nessuna service_role coinvolta."
  out_of_scope:
    - "Persistenza del brief (T-123) e streaming lato route (T-150)"
    - "Import da URL (macrotask url-import)"
```

## Chiarimenti registrati in fase di BUILD (2026-07-24)

Emersi dalla verifica avversariale del macrotask e decisi dall'human-in-the-loop.
Non modificano gli `acceptance_criteria` sopra: ne fissano la lettura.

- **`P1-D12` — input di `update_brief`.** AC-132-1 e AC-132-2 sono in tensione: la patch di
  T-121 ha tutti i campi opzionali, quindi in forma FLAT non esiste un `required`
  **valorizzato** come AC-132-2 pretende. La patch vive percio' sotto l'unica chiave
  obbligatoria `updates` (`required: ['updates']`), e il `{business_name:'Bar Sole'}` del
  *given* di AC-132-1 si legge come **contenuto** della tool-call, non come involucro JSON.
- **`P1-D13` — `hours` assente dallo schema del tool.** Non esprimibile sotto strict tool use
  (`z.record` ⇒ `additionalProperties` valorizzato, vietato). **Limite noto: l'intervista non
  puo' raccogliere gli orari**, e `isBriefComplete` non li richiede, quindi un brief senza orari
  risulta comunque completo. **Vincolo ereditato da `onboarding-ui` (T-151): il pannello brief
  deve esporre un campo orari editabile.**
- **Non verificato: lo schema strict non e' mai stato validato contro l'API reale.** Tutti gli
  oracoli mockano il confine LLM (per costruzione: e' cio' che tiene deterministico il
  checkpoint). L'oggetto annidato `updates` chiude con `additionalProperties:false` ma non
  dichiara `required`: se l'API applicasse il vincolo ricorsivamente, la prima chiamata reale
  tornerebbe 400. **Da verificare al primo turno end-to-end (T-150), con chiave configurata.**

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir del blueprint P1 — atteso exit 0.
- **Semantico** (checklist guidata): punti 6–10 su ogni task; i rilievi vanno all'human-in-the-loop.
