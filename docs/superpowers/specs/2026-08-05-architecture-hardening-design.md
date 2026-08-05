# architecture-hardening — Gate di altitudine reale, repo-wide · Documento di Design (V1)

> **Progetto:** Belora · **Macrotask trasversale:** `architecture-hardening` · **Data:** 2026-08-05 · **Stato:** design approvato dall'utente; pronto per il bootstrap tecnico via skill *trueline*.
> **Poggia su:** P0, P1, P2 e P3 `editor-core` — tutti completi e verdi su `main` (`7844d8e`; kickoff `4547c15`).
> **Deliverable di questa sessione:** SOLO questo documento di design (nessun codice). Nasce dal brainstorming (skill `superpowers:brainstorming`) su `KICKOFF.md` §3, informato da una mappa di sola-lettura del blast radius reale dei 7 moduli.
> **Fonti:** handoff `docs/blueprint/architecture-hardening/KICKOFF.md`; contratto `architecture:` in `docs/blueprint/P3-editor/00-INDEX.md` §1bis (P3-D7 / ex P1-D11); gate scoped-P3 `tests/architecture-contract.test.ts` (con l'handoff `LEGACY_DOMAIN_DATA`); mappa del blast radius (workflow `arch-hardening-map`, 4 agenti, sola lettura).
> **Convenzione:** prosa in italiano, identificatori/nomi-file in inglese (come i design P0–P3).

---

## 0 · Indice

1. Obiettivo e confini
2. Il difetto misurato (perché esiste)
3. Decision ledger (AH-D*)
4. I 4 gruppi di violazione → i fix (per modulo)
5. Il gate: da scoped-P3 a repo-wide
6. Fasatura di build (1 macrotask, 6 task)
7. Testing & oracoli (acceptance del verde)
8. Invarianti non negoziabili da preservare
9. Fuori scope / carry-over

---

## 1 · Obiettivo e confini

**Cos'è.** Un macrotask **trasversale** (non un modulo di P3) che rende il contratto di altitudine `architecture:` un **gate reale, alias-aware, repo-wide**, e bonifica gli archi di layer vietati **già in `main`**. Attiva sul serio ciò che P3-D7 ha dichiarato: strati (`ui`/`domain`/`data`/`app`) e archi `forbidden` (`domain→ui`, `domain→data`, `domain→app`, `data→ui`) verificati contro il **grafo import reale**.

**Confini netti.**
- **Solo altitudine.** Nessun cambiamento di comportamento osservabile: refactor a **iso-comportamento** su codice P0/P1/P2 già verde. La suite (oggi 1214 test) resta il guardrail di regressione.
- **Regola invariata (AH-D1 / ex D1-B):** `domain→data` **resta vietato**. Si conforma il **codice**, non si ammorbidisce il contratto. Nessun arco vietato entra in una `allow`.
- **Deploy-coupling `coupled` (confermato):** il merge su `main` è **human-gated anche sul verde** (mergiare può innescare il deploy della dashboard). Distruttive e deploy restano gated.

**Il difetto in una riga.** Il gate `arch_check.mjs` gira `madge` **senza `--ts-config`** → non risolve gli alias `@/` (usati da 318/318 import cross-module) → vede **0 archi cross-layer** → **blind-green** (falsa assicurazione di altitudine).

---

## 2 · Il difetto misurato (perché esiste)

Il verifier BLIND di **T-312** (editor-core) ha misurato che l'oracolo reale è cieco sugli alias. Reso il grafo **alias-aware** (risoluzione dei path di `tsconfig`) emergono **8 violazioni reali** del contratto `forbidden`. In editor-core sono già state chiuse:
- l'unica **`data→ui`** (`generation-choose` importava `@/ui/generation/variant-document` → il modulo è stato spostato in `src/domain/generation/variant-document.ts`);
- il gate T-312 è stato reso **alias-aware ma SCOPED alla superficie P3** (denti reali lì, 0 violazioni sulla superficie).

**Restano da chiudere qui le 7 `domain→data`.** Misura repo-wide di conferma (questa sessione):

```
rg "from ['\"]@/(ui|data|app)/" src/domain   → 7 match, tutti @/data ; 0 @/ui ; 0 @/app
rg "from ['\"]@/ui/" src/data                → 0 match (la data→ui è già bonificata)
```

I 7 archi diretti:

| # | Modulo (`from = domain`) | Import (`to = data`) |
|---|---|---|
| 1 | `src/domain/setLocale.ts` | `@/data/updateProfileLocale` |
| 2 | `src/domain/auth/login.ts` | `@/data/supabase-ssr` (`createServerSupabaseClient`) |
| 3 | `src/domain/auth/signup.ts` | `@/data/supabase-ssr` |
| 4 | `src/domain/onboarding/interview.ts` | `@/data/anthropic` (`runOnboardingTurn`) |
| 5 | `src/domain/import/fromUrl.ts` | `@/data/anthropic` (`runOnboardingTurn`) |
| 6 | `src/domain/generation/phase1.ts` | `@/data/anthropic` (`runGenerationTurn`) |
| 7 | `src/domain/generation/phase2.ts` | `@/data/anthropic` (`runGenerationTurn`) |

**Conseguenza per il flip repo-wide.** Poiché in `src/domain` non esiste **alcun** `domain→ui`/`domain→app`, non sopravvive alcun percorso *transitivo* verso `data`: ogni catena `domain→…→data` deve terminare in un salto diretto `domain→data`, che è uno dei 7. **Rimossi i 7 archi diretti, l'insieme vietato repo-wide collassa a 0.**

---

## 3 · Decision ledger (AH-D*)

> Le decisioni si modificano SOLO con emendamento esplicito registrato qui.

| ID | Decisione | Scelta | Stato |
|---|---|---|---|
| **AH-D1** | Come togliere gli archi `domain→data` | **Conformare il codice, regola invariata** (ex D1-B). Vietato aggiungere `domain→data` alla `allow`. | chiusa |
| **AH-D2** | Gruppo A — Server Actions (`setLocale`, `auth/login`, `auth/signup`) | **relayer → `src/app`**: sono `use server` framework-bound (cookie/redirect/auth); DI sarebbe finta purezza e non c'è un chiamante server-side app in cui iniettare (i chiamanti sono client component). La validazione resta in `domain`. | chiusa |
| **AH-D3** | Gruppo B — LLM onboarding (`interview`, `fromUrl`) | **DI**: una **porta LLM** iniettata, tipizzata solo su `@anthropic-ai/sdk`. Sono pure-logic con **una sola** IO; `src/app` è vietato da ESLint dall'importare `@/data/anthropic`, quindi relayer-to-app è impossibile per `interview`. | chiusa |
| **AH-D4** | Gruppo C — LLM generation (`phase1`, `phase2`) | **relayer → `src/data`**: sposta le funzioni I/O accanto ai loro chiamanti (già in `src/data`); i **builder puri** restano in `domain`. Scelta dell'utente fra "either". | chiusa |
| **AH-D5** | Dove vive l'enforcement del gate | **Nel test vitest `tests/architecture-contract.test.ts`**, non nell'oracolo. L'oracolo vive in una plugin-cache immutabile fuori repo e non è correggibile in modo durevole dal repo. | chiusa |
| **AH-D6** | Scope del gate dopo la bonifica | **Repo-wide**: `evaluateContract().violations` vuoto su tutte e 4 le regole, non più `surfaceViolations()`. Drop del pin `LEGACY_DOMAIN_DATA`. | chiusa |
| **AH-D7** | Testimone di non-vacuità post-bonifica | **Positivo**: il grafo alias-aware risolve ≥N archi `@/` cross-layer **leciti** (es. `app→domain`/`ui→domain`) mentre il grafo cieco ne vede 0. Sostituisce l'ex testimone "esattamente questi 7 `domain→data`" (che muore coi 7). | chiusa |

---

## 4 · I 4 gruppi di violazione → i fix (per modulo)

> Natura **misurata** dalla mappa, non presunta. Ogni fix è iso-comportamento; i test esistenti restano il guardrail.

### Gruppo A — Server Actions → `src/app` (relayer) · AH-D2

I tre moduli sono `use server` inerentemente framework-bound: leggono `next/headers`, scrivono cookie via l'adapter SSR, chiamano `redirect()`. Per **auth**, la parte pura (validazione zod) vive già in `src/domain/auth/validation.ts` (data-free) e vi **resta** (app→domain lecito); per **`setLocale`** la validazione è inline (allowlist `hasLocale` + regex del path interno) e si sposta col modulo. Spostare l'intera Server Action in `src/app` cancella l'arco **onestamente** (app→data è lecito; ui→app e app→domain sono leciti).

| Modulo | Destinazione proposta | Chiamante (import da aggiornare) | Invariante da preservare |
|---|---|---|---|
| `setLocale.ts` | `src/app` (es. `src/app/[locale]/_actions/set-locale.ts`, `use server`) | `src/ui/LocaleSwitcher.tsx` (unico chiamante prod; nessun wrapper app oggi) | Best-effort try/catch (fallimento DB **non** blocca il cambio lingua); ordine `validate → updateProfileLocale → cookie.set → redirect`; `redirect()` lancia (happy path ritorna `never`) |
| `auth/login.ts` (`login`, `logout`, `signInWithGoogle`) | `src/app/[locale]/login/actions.ts` (`use server`) | `src/app/[locale]/login/page.tsx` (solo path; `login.bind`/`useActionState` invariati) | **Session client, mai `service_role`**: il modulo continua a chiamare `createServerSupabaseClient()` — nessun nuovo seam d'iniezione dove sostituire un client admin |
| `auth/signup.ts` (`signup`) | `src/app/[locale]/signup/actions.ts` (`use server`) | `src/app/[locale]/signup/page.tsx` (solo path; `signup` usato **unbound** in `useActionState`) | Stessa invariante session-client; firma `(prevState, formData)` fissata dal contratto React (DI la romperebbe) |

**Perché non DI qui.** I chiamanti sono **client component**: non possono costruire un client Supabase di sessione (server-only, da `next/headers`) da iniettare. DI forzerebbe comunque a inventare wrapper server in `app` (cioè relayer con indirezione in più) **e** lascerebbe `cookies()/redirect()` dentro un modulo "domain" — purezza finta. La validazione resta in `domain` (app→domain lecito).

**Nota `logout`:** esportato e testato ma **senza chiamante prod** in `src/app` oggi; si sposta col file.

### Gruppo B — LLM onboarding → DI porta iniettata · AH-D3

`interview.runInterviewTurn` e `fromUrl.fromUrl` sono **quasi interamente puri** (assemblaggio prompt, dichiarazione tool, validazione zod dell'input non-fidato, merge deterministico del brief) con **una sola** chiamata IO al medesimo boundary `runOnboardingTurn`. Un'unica **porta** li serve entrambi:

- **Tipo porta** (in `domain`, riferisce **solo** `@anthropic-ai/sdk`, già importato):
  `type OnboardingLlmPort = (turn: { system: string; messages: Anthropic.MessageParam[]; tools: Anthropic.ToolUnion[] }) => Promise<Anthropic.Message>`.
- **`fromUrl`**: riceve la porta dal suo unico chiamante prod `src/data/import.ts` (layer `data`, già lecito a importare `@/data/anthropic`) — nessun provider nuovo.
- **`interview`**: il chiamante prod è la route app `src/app/api/onboarding/[siteId]/turn/route.ts`, **vietata** da ESLint dall'importare `@/data/anthropic`. Serve un provider `src/data/llm-ports.ts` (NON nominato `*anthropic*`) che importa `runOnboardingTurn` e ne esporta la porta legata; la route importa il provider (app→data lecito) e passa la porta.
- **Default rimosso**: nessun default `= runOnboardingTurn` nel modulo domain (ricreerebbe l'import vietato). Ogni chiamante fornisce la porta; i test passano una porta **fake** (più semplice del `vi.mock`).
- **Preserva**: istanziazione **lazy** del client (importare senza chiave non deve lanciare); la gestione dell'input non-fidato resta identica; in `fromUrl` il try/catch che rende opzionale il passo AI (un fallimento del boundary deve comunque restituire la proposta deterministica).

### Gruppo C — LLM generation → `src/data` (relayer) · AH-D4

`runGenerationPhase1` e `runGenerationPhase2Chunk` sono involucri `assemble → call → repackage` attorno al boundary **ricco** `runGenerationTurn` (che applica `GENERATION_BUDGET`, `cache_control`, request-options, e il gate `parsePool`). I loro chiamanti sono **già in `src/data`**. Si spostano le **funzioni I/O** in `src/data`; i **builder puri** restano in `domain`.

| Sposta in `src/data` | Resta puro in `domain` | Chiamanti (aggiornare) |
|---|---|---|
| `runGenerationPhase1` (da `phase1.ts`) | assemblaggio payload/pool tool, `DOCUMENT_LIMITS`, `briefProjection`, … | `src/app/api/generate/route.ts` (app→data lecito), `src/data/generation-regenerate.ts` |
| `runGenerationPhase2Chunk` (da `phase2.ts`) | **`buildPhase2ChunkPayload`** (puro; prefisso cache byte-identico pinnato da `generation-phase2-cache-prefix.test.ts`) | `src/data/generation-phase2.ts` (unico chiamante dell'export I/O) |

- **Tipo derivato**: `Phase1Failure`/`Phase2ChunkFailure` sono `Extract<Awaited<ReturnType<typeof runGenerationTurn>>, {ok:false}>['reason']`; **si spostano col boundary** in `data` (nessun import di tipo `domain→data` residuo). `GenerationTurnResult` resta accanto al boundary.
- **Preserva a ogni costo**: `maxRetries: 0` + `timeout` (secondo arg di `client.messages.create` — evitano retry silenziosi con doppia fatturazione); breakpoint `cache_control`; prefisso cache stabile (tool+system identici fra i chunk); client lazy.

---

## 5 · Il gate: da scoped-P3 a repo-wide · AH-D5, AH-D6, AH-D7

**Dove vive l'enforcement.** Nell'oracolo `arch_check.mjs`/`module_graph.mjs`? **No.** Vivono in una plugin-cache immutabile version-pinned (`…/trueline/0.4.1/skills/trueline/scripts/oracles/`), **fuori dal repo**: una modifica non sarebbe committata col codice e sarebbe persa a ogni reinstall/upgrade del plugin. Inoltre l'oracolo, così com'è, è **blind-green** su questo repo (niente `--ts-config`). L'enforcement reale è già `tests/architecture-contract.test.ts`, che:
- è **alias-aware** (passa `tsConfig` a `madge`);
- carica le stesse 4 regole `forbidden` dal blocco `architecture:` di `00-INDEX.md` §1bis;
- ha **vacuity guard** (ogni regola deve mappare ≥1 modulo per lato) e **fixture di falsificabilità** (import vietato deliberato → ROSSO);
- gira in CI.

**La transizione (tutta in T-AH6).**
1. **Da scoped a repo-wide**: sostituire `surfaceViolations()` (filtro su `SURFACE_GLOBS`/`SURFACE_DATA`) con l'asserzione che `evaluateContract(cleanGraph, contract).violations` è **vuoto su tutte e 4 le regole**, repo-wide.
2. **Drop del pin**: rimuovere `LEGACY_DOMAIN_DATA` (i 7 non esistono più) e la sua asserzione "il grafo vede esattamente questi 7".
3. **Nuovo testimone di non-vacuità (positivo, AH-D7)**: asserire che il grafo **alias-aware** risolve ≥N archi `@/` cross-layer **leciti** (es. `app→domain` e/o `ui→domain`, che esistono di sicuro), mentre il grafo **cieco** (`buildGraph(false)`, già presente nel file) ne vede **0**. Questo prova che la risoluzione alias è viva anche dopo che i 7 archi rossi sono spariti.
4. **Mantieni**: grafo alias-aware (`tsConfig`), fixture di falsificabilità, vacuity guard di layer, caricamento delle regole dal blueprint.
5. **Aggiorna la documentazione** che enumera i 7 (righe di `KICKOFF.md` §2; commenti "SCOPE ONESTO" nel test).

**Ordine e file condivisi.** I task di refactor (T-AH1..T-AH5) **non toccano** `architecture-contract.test.ts`: l'intera transizione del gate è di **T-AH6**, che `depends_on` tutti e cinque. Così nessun builder concorrente muta il file del gate (niente worktree). Il gate test è "in quarantena" (fuori dal set di test rilevanti dei refactor) finché T-AH6 non lo riconcilia; il checkpoint completo gira al **confine del macrotask**, dopo T-AH6.

---

## 6 · Fasatura di build (1 macrotask, 6 task)

Un solo macrotask `architecture-hardening` (un modulo del blueprint). DAG interno:

```
architecture-hardening
 ├─ T-AH1 relayer setLocale → src/app                         [ ]
 ├─ T-AH2 relayer auth login/logout/signInWithGoogle → src/app [ ]
 ├─ T-AH3 relayer auth signup → src/app                        [ ]
 ├─ T-AH4 DI porta LLM onboarding (interview + fromUrl)        [ ]
 ├─ T-AH5 relayer generation phase1/phase2 (I/O → src/data)    [ ]
 └─ T-AH6 gate repo-wide (flip + drop pin + testimone positivo) [T-AH1,T-AH2,T-AH3,T-AH4,T-AH5]
```

- **T-AH1..T-AH5** sono indipendenti fra loro (file disgiunti); ciascuno esegue **solo i propri** file di test rilevanti (metodo: mai `npm test` in build; rate-limit auth → suite/checkpoint una volta per finestra).
- **T-AH6** è l'unico a toccare `architecture-contract.test.ts` e chiude il gate repo-wide.
- Il **checkpoint** gira al confine del macrotask, poi commit atomico sul branch `trueline/build/architecture-hardening` (**mai** su `main`), merge **human-gated** sul verde.

**Bootstrap atteso (skill trueline).** `docs/blueprint/architecture-hardening/`: `00-INDEX` (mappa + piano + ledger AH-D*), un modulo `01-architecture-hardening.md` con i 6 task in schema atomico (`definition_of_done` + `acceptance_criteria` + `target_tests`), `SESSION-STATE`, `prompts/`. Validare con `validate_blueprint.mjs` (exit 0) + self-check semantico.

---

## 7 · Testing & oracoli (acceptance del verde)

> **ORACLE-AS-JUDGE, mai LLM-AS-JUDGE.** Il verdetto viene dagli oracoli, non da un agente.

- **Gate di altitudine**: grafo import **alias-aware repo-wide** con **0 archi `forbidden`**; testimone di non-vacuità **positivo** verde; **falsificabilità** verde (import vietato deliberato → ROSSO, poi pulizia della fixture).
- **Regressione**: **suite completa verde** (oggi 1214 test) — i refactor DI/relayer non rompono P0/P1/P2; per-modulo, i test esistenti (con import/mock aggiornati) restano verdi.
- **Checkpoint deterministico VERDE 4/4**: `run_checkpoint.mjs --in-place --mode build --baseline <baseline sicurezza>` **SENZA `--blueprint`** (manifest supabase-jsts incompatibile con vitest+jsdom → falso rosso); verdetto letto dal **JSON `.green`** (mai da exit code o `| tail`); scrivi l'output intero su file e leggilo da lì.
- **Igiene**: baseline d'igiene ri-attribuita (le impronte sono sensibili alla posizione; spostare file ri-fingerprinta). Ricattura: `baseline.mjs capture <dir> --hygiene --out <hygiene path>` (il default scrive in `baseline.json`).
- **Batteria di mutazione** fra i task: sanità palesemente fatale + **ripristino verificato per sha256** (EOL CRLF su disco: normalizza i pattern multi-riga).

---

## 8 · Invarianti non negoziabili da preservare

- **Regola invariata**: `domain→data` resta vietato; nessun arco vietato in `allow`. Il gate non si ammorbidisce per assorbire un refactor.
- **Session client, mai `service_role`** (auth): il codice spostato continua a costruire il client di sessione via `createServerSupabaseClient()`; nessun nuovo seam d'iniezione.
- **Anthropic key boundary**: `src/app` non importa mai `@/data/anthropic`; l'accesso passa da un provider `src/data/*` non-`anthropic`.
- **Generation**: `maxRetries: 0` + `timeout`, `cache_control`, prefisso cache byte-identico, client lazy.
- **setLocale**: fallimento di persistenza best-effort **non** blocca cookie/redirect.
- **Renderer/parse**: nessun cambiamento di comportamento osservabile; i test di comportamento restano il guardrail (non si indeboliscono le asserzioni).
- **Git a strati**: branch autonomo, merge su `main` gated dal verde **e** dal deploy-coupling `coupled`; distruttive mai autonome; deploy non supervisionato bloccato.
- **Nessun falso "via libera"; copertura sempre dichiarata; prima di credere a un verde, prova che lo strumento sa diventare rosso.**

---

## 9 · Fuori scope / carry-over

- **Fix upstream dell'oracolo** `arch_check.mjs`/`module_graph.mjs` (passare `--ts-config` a `madge`): non azionabile dal repo (plugin-cache immutabile) — va registrato come **carry-over** in `SESSION-STATE`. Riguarda ogni repo alias-heavy che usa i gate trueline; **complementa**, non sostituisce, l'enforcement nel test vitest.
- **Carry-over ereditati** (non introdotti qui): `osv` 2 advisory MODERATE (`next`, `postcss`); CI mai provata da una run reale (`gh` non installato); e2e solo Chromium.
- **Nessuna nuova feature, nessuna nuova superficie DB, nessuna nuova rotta**: solo altitudine.
