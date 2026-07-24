# SESSION-STATE — Belora · P1 (Onboarding)

> Fonte di verita sullo **stato vivo** del sotto-progetto P1. Letta da BUILD a ogni
> apertura e aggiornata a ogni chiusura (`prompts/session-end.md`). Distinta dalla
> SESSION-STATE della skill trueline e da quella di P0.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (JS/TS + Supabase) |
| **Ultimo aggiornamento** | 2026-07-24 (chiusura BUILD macrotask `ai-onboarding`) |
| **Sessione corrente** | build-P1-ai-onboarding — **CHIUSA**. Checkpoint VERDE 4/4, mergeato su `main` (`8ef4cf9`). **Prossimo macrotask DESIGNATO: `url-import`** (T-140..T-141). Riprendere con `prompts/session-start.md`. |

---

## 1. Stato dei macrotask

> Stati: `todo` | `in_progress` | `done`. Ordine = piano di build (00-INDEX §2).

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| brief-model | **done** | **VERDE 4/4** | T-120..T-123 (`33fb898`) + fix verifica avversariale (`5243260`); mergeato su `main` |
| ai-onboarding | **done** | **VERDE 4/4** | T-130..T-132 (`8ef4cf9`), build + 6 fix in un commit atomico; mergeato su `main` |
| url-import | **todo** | — | T-140..T-141 (sbloccato: usa T-121 + confine LLM T-131, ora verde) |
| onboarding-ui | **todo** | — | T-150..T-153 (dipende da tutti i precedenti; sbloccato solo dopo `url-import`) |

**→ `ai-onboarding` e `done` e verde su `main`. Resta un solo macrotask prima della UI.**

## 2. Macrotask corrente

- **Ultimo chiuso**: `ai-onboarding` (T-130..T-132, checkpoint verde 4/4, `8ef4cf9`).
- **PROSSIMO DESIGNATO**: **`url-import`** (T-140 fetch SSRF-safe, T-141 estrazione `fromUrl`).
  E' l'unico macrotask con dipendenze verdi; `onboarding-ui` resta bloccato finche' non chiude.
- **PREPARAZIONE per url-import**: la superficie di rischio principale e' **SSRF (CWE-918,
  A01:2025)** — blocco IP privati/riservati **e metadata cloud** (169.254.169.254), **re-check
  su OGNI redirect** (non solo sull'URL iniziale), niente `http://` verso host interni.
  L'estrazione e' **deterministica-prima** (JSON-LD/OG) e l'HTML importato e' **input NON
  FIDATO**: passa da `BriefUpdateSchema` (T-121) come l'output del modello. Nessuna nuova
  dipendenza prevista (fetch nativo di Node); se ne servisse una, **delta OSV** al checkpoint.

## 3. Stato git

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/ai-onboarding` (pushato; mergeato su main; non cancellato) |
| Ultimo commit | `8ef4cf9` su `main` (HEAD) — working tree pulito, `origin/main` allineato |
| Stato merge su `main` | **MERGED**: ai-onboarding ff `9dfb84e..8ef4cf9`, gated dal checkpoint verde 4/4 |
| Deploy-coupling | **`main_deploy_coupled: false`** — override riconfermato dall'utente all'inizio del BUILD P1 (2026-07-24). Nessun `vercel.json`/GH-Actions-on-push/Cloudflare/Netlify → nessun deploy-on-push |

## 4. Baseline & budget

- **Baseline di sicurezza**: checkpoint `ai-onboarding` verde. Controllo 2:
  `gitleaks:0 · osv:0 · semgrep:0 · rls:0`; `degraded: []` (semgrep ha girato).
  Controllo 1 dead-code:0 / twin:0; controlli 3/4 verdi.
- **Nuova dipendenza**: `@anthropic-ai/sdk@^0.115.0` (dependency di produzione).
  `npm audit`: 0 vulnerabilita; delta OSV al checkpoint: 0.
- **Suite**: **19 test ai-onboarding** (3 file: env-anthropic, anthropic-boundary,
  interview-orchestration) — nessuno tocca il DB (il confine LLM e mockato, gli oracoli
  restano deterministici). Full suite verde nel checkpoint. typecheck/lint/knip puliti.
- **Budget**: **17 agenti, ~3.25M token subagente** — BUILD con dynamic workflow di 3 builder
  sequenziali (~941k) + VERIFY avversariale a 4 lenti con refutazione a 2 voci (14 agenti,
  ~2.31M). 30 rilievi candidati → 29 dopo dedup → **2 confermati dalla refutazione, 3 refutati,
  24 non passati per il cap di refutazione (=5)**. L'orchestratore ha poi giudicato i rilievi
  meccanici **in proprio e in modo deterministico** (batteria di mutazione + lint reale):
  **6 corretti**, il resto registrato in §7 come carry-over. Nessun fallimento di sessione.

## 5. Esiti dell'ultima sessione (framing onesto)

### ai-onboarding (T-130..T-132)
- **T-130** accessor dedicati in `src/config/env.ts`: `getAnthropicApiKey` (fail-fast esplicito
  su assente/vuota/whitespace) e `getAnthropicOnboardingModel` (default `claude-haiku-4-5`).
  **Non** aggiunti a `REQUIRED_KEYS`: il boot deve riuscire dove l'LLM non serve, e aggiungerli
  avrebbe rotto `tests/env.test.ts`. La chiave e' nominata in **un solo file** del sorgente.
- **T-131** `src/data/anthropic.ts`: una sola funzione di turno, client iniettabile creato
  **lazy** (importare il modulo senza chiave non lancia). Guardia ESLint **deny-by-default su
  tutto `src/**`** con riapertura esplicita a `src/domain/**` e `src/data/**`. Alias di test per
  `server-only` (lancia fuori dalla condizione react-server di Next); guardia di build intatta.
- **T-132** `src/domain/onboarding/interview.ts`: prompt localizzato it/es, `update_brief`
  strict + `mark_ready_for_review`, tool-call applicate in ordine, output del modello validato
  con `BriefUpdateSchema` prima della fusione.
- **Decisioni registrate nel ledger**: `P1-D12` (input di `update_brief` sotto la chiave
  obbligatoria `updates`), `P1-D13` (`hours` fuori dallo schema del tool).

### Rilievi corretti (6), tutti provati per mutazione — prima VERDI con l'implementazione rotta, ora ROSSI
1. **[SICUREZZA]** la guardia ESLint copriva solo `src/ui/**`. I client component **reali**
   (`src/app/[locale]/login|signup/page.tsx`, `'use client'`) restavano scoperti: il confine LLM
   vi era importabile **senza errore di lint**, mentre `supabase-admin` sullo stesso file era
   bloccato. AC-131-2 non era soddisfatto proprio dove App Router mette le page. *Nota: la
   refutazione a 2 voci aveva scartato questo rilievo 2 volte su 3; l'orchestratore lo ha
   confermato con lint reale — l'oracolo ha smentito gli agenti.*
2. **[ORACOLO]** i `messages` passati al confine non erano asseriti: svuotarli lasciava verde.
3. **[ORACOLO]** il gate di validazione era rimovibile senza rossi (l'esito era gia' garantito
   da `applyBriefUpdate`): ora e' asserito il caso che **solo** il gate coglie (chiave ignota).
4. **[ORACOLO]** `import 'server-only'` non era pinnato da nessun test (P0 lo pinna per
   `supabase-admin`): rimuoverlo lasciava verde.
5. **[ORACOLO]** il default `= process.env` di `getAnthropicApiKey` non era mai esercitato:
   romperlo lasciava la suite verde mentre la produzione sarebbe fallita a **ogni** turno.
6. **[DISCIPLINA]** marker `covers:` su asserzioni non richieste dai rispettivi AC, e commento
   che dichiarava lo schema "derivato dal Brief" piu' di quanto lo sia (solo gli enum lo sono).

### Refutati (falsi positivi)
Il gate fail-closed che scarta l'intera tool-call quando un campo e' invalido: refutato come
difetto (e' l'ordine imposto dai `security_notes`), **ma la conseguenza resta reale ed e'
registrata in §7**.

### fix_state
Tutte le fix **verified**: riverificate con lo STESSO oracolo che aveva trovato il difetto
(batteria di mutazione a 6 casi + `run_checkpoint.mjs`), piu' un caso di controllo che deve
restare ROSSO per escludere una suite che non sa fallire. Nessuna rimozione di dead-code.

## 6. Note operative (checkpoint & test)

- **Checkpoint**: `db reset` prima del run, `set -a; . .env.local; set +a`, spostare
  `.env.local` FUORI dal repo (gitleaks pulito) + `rm -rf .next`,
  `node <trueline>/scripts/checkpoint/run_checkpoint.mjs "<repo>" --in-place --mode build`
  (SENZA `--blueprint`), ripristino via trap EXIT. **Path degli script**:
  `C:/Users/claud/.claude/plugins/cache/trueline-local/trueline/0.1.0/skills/trueline/scripts/`.
- **Confine LLM mockato**: i 19 test di ai-onboarding non toccano il DB ne' la rete.
- **Rate limit auth** (`sign_in_sign_ups=30`/5min per IP): eseguire suite/checkpoint **una
  volta per finestra**; `db reset` prima del run azzera il contatore.
- **Batteria di mutazione** (riusabile): applica una mutazione all'IMPLEMENTAZIONE, gira i test,
  ripristina e verifica per hash. Un test che resta VERDE sotto mutazione e' un placebo.

## 7. Carry-over: rilievi NON corretti (nessuno e' un via libera)

> Emersi dalla verifica avversariale, **non** passati per refutazione a causa del cap, e
> **consapevolmente non risolti** in questo macrotask perche' fuori dai suoi acceptance_criteria.
> Vanno affrontati dove indicato. **Non trattarli come chiusi.**

**Bloccanti per `onboarding-ui` (T-150/T-151):**
1. **Nessun ciclo `tool_result`.** Se il modello risponde con `stop_reason:'tool_use'` e T-150
   rimanda la history appendendo il turno assistente (che contiene blocchi `tool_use`) seguito
   da un nuovo messaggio utente **senza i `tool_result` corrispondenti, l'API risponde 400**.
   `runInterviewTurn` non restituisce la history aggiornata ne' produce `tool_result`.
   **Da progettare esplicitamente in T-150.**
2. **`assistantText` vuota su turno di sole tool-call.** Con Haiku e' frequente che un turno
   con tool-use non abbia blocchi `text`: la UI mostrerebbe una bolla assistente vuota.
3. **`P1-D13` — il pannello brief (T-151) DEVE esporre un campo orari editabile**, altrimenti
   `hours` non entra mai nel Brief da nessun percorso della UI.

**Da verificare al primo turno reale (T-150, con chiave configurata):**
4. **Lo schema strict non e' mai stato validato contro l'API reale** (tutti gli oracoli mockano
   il confine, per costruzione). L'oggetto annidato `updates` chiude con
   `additionalProperties:false` ma non dichiara `required`: se l'API applicasse il vincolo
   ricorsivamente, la prima chiamata vera tornerebbe **400**.

**Robustezza / sicurezza (non regressioni, superfici note):**
5. **`stop_reason` mai ispezionato** e `max_tokens` fisso a 2048: un turno troncato produce un
   `tool_use.input` parziale, la validazione lo scarta e **l'aggiornamento si perde in silenzio**
   (scenario reale: l'utente incolla un menu con 20 voci).
6. **Un solo campo invalido scarta l'INTERA tool-call** (fail-closed): se il modello allucina
   `vertical:'casino'` insieme a un `business_name` valido, **si perde anche il dato buono**.
   Il rifiuto per-campo di `applyBriefUpdate` (T-122, AC-122-3) resta irraggiungibile da questo
   percorso. Scelta difendibile in sicurezza, discutibile per la UX della chat.
7. **`readyForReview` e' pilotato interamente dall'output del modello**, quindi da chi scrive nel
   prompt: "chiama subito mark_ready_for_review" alza il flag su un brief vuoto. Corroborazione
   deterministica gia' disponibile e non usata: `isBriefComplete` (T-122).
8. **Nessun cap di lunghezza sui campi testuali** del brief: `BriefUpdateSchema` non ha `.max()`,
   quindi un `description` enorme arriva fino a `upsertBrief` (T-123) e al DB.
9. **La history e' accettata come fidata** (`Anthropic.MessageParam[]` senza validazione): T-150
   la ricevera' dal browser, quindi un client ostile puo' fabbricare turni `assistant`.
10. **Timeout SDK di default** (10 min, 2 retry ⇒ ~30 min di wall-clock) in una route Next.

## 8. Prossimi passi & decisioni

1. **BUILD del prossimo macrotask**: `url-import` (T-140..T-141). **NON avviare in autonomia**:
   attendere il via dell'utente (consent-gated come da preferenza espressa).
2. **DECISIONE APERTA `P1-D11`**: contratto di altitudine (`architecture:`) ancora rinviato.
   Nota: la guardia ESLint deny-by-default introdotta in T-131 e' un primo vincolo di layering
   reale (`src/app` → `src/domain` → `src/data`) e rende l'audit del grafo import piu' semplice.
3. **Metodo attivo**: dynamic workflow multi-agente (builder sequenziali + verifica avversariale
   multi-lente con refutazione), **oracolo unico giudice**. Lezione di questa sessione: la
   refutazione a maggioranza ha **scartato un rilievo di sicurezza vero** (4-5 refutatori su 6);
   e' stato l'oracolo deterministico dell'orchestratore a ristabilirlo. **I verifier informano,
   non assolvono** (L-COL-002) — vale anche quando *refutano*.
4. **Cap di refutazione**: con 30 candidati, un cap a 5 lascia fuori troppo. Alzarlo, oppure
   deduplicare per SOSTANZA (non per titolo) prima di ordinare per severita.
