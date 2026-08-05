# SESSION-STATE — Belora · `architecture-hardening`

> Fonte di verità sullo **stato vivo** del macrotask trasversale `architecture-hardening`,
> consumata da BUILD e aggiornata a ogni chiusura di sessione (`prompts/session-end.md`). Istanza
> distinta dalle SESSION-STATE di P0/P1/P2/P3 e da quella della skill trueline. Prosa in italiano,
> identificatori/nomi-file in inglese.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Ultimo aggiornamento** | 2026-08-05 (BUILD `architecture-hardening` CHIUSO; checkpoint VERDE 4/4; mergiato su `main` `7dd614f`) |
| **Sessione corrente** | — (macrotask costruito, verde e mergiato; prossimo P3: **`editor-blocks`** T-313…T-317) |

---

## 1. Stato dei macrotask

> Aggiornato a ogni `session-end`. Stati: `todo` | `in_progress` | `done`.

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| `architecture-hardening` | done | **VERDE 4/4** | Commit `7dd614f`, mergiato su `main` (ff). 6 task (T-AH1…T-AH6) + riconciliazione hygiene. Suite 1215/1215; batteria mutazione 1 uccisa/0 sopravvissute |

## 2. Macrotask corrente

- **`architecture-hardening`**: **DONE** — costruito, checkpoint VERDE 4/4, mergiato su `main` (`7dd614f`).
- I 7 archi `domain→data` sono **bonificati**: Gruppo A (setLocale, auth/login, auth/signup) relayer →
  `src/app`; Gruppo B (interview, fromUrl) DI porta LLM; Gruppo C (phase1, phase2) relayer I/O → `src/data`.
- Il gate `tests/architecture-contract.test.ts` è ora **repo-wide** (0 archi vietati su tutti i sorgenti,
  testimone di non-vacuità positivo, falsificabilità: fixture data→ui = unica violazione).
- **Prossimo** (dispatch trueline → BUILD): **`editor-blocks`** (T-313…T-317), l'altro modulo P3
  (`docs/blueprint/P3-editor/02-editor-blocks.md`). Aprire con `docs/blueprint/P3-editor/prompts/session-start.md`.

## 3. Stato git

> Registrato a ogni `session-end`. Mai lavorare su `main`.

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/architecture-hardening` (pushato). `main` = `7dd614f` (mergiato ff) |
| Ultimo commit | `7dd614f` — chore: hygiene-baseline R-04; sopra i 6 build T-AH1…T-AH6, su `main` e pushato |
| Stato merge su `main` | **MERGIATO** (ff `54443da→7dd614f`, pushato) su via ESPLICITO dell'utente (deploy-coupled) |
| Deploy-coupling | **`coupled` — CONFERMATO**. Il merge di ogni macrotask resta **human-gated anche sul verde** |

## 4. Baseline & budget

- **Baseline di sicurezza**: **invariata** (`.trueline/baseline.json`, gitignored) = 1 finding
  (osv `postcss` MEDIUM, carry-over). Nessun segreto/SQL/dep nuovo (refactor iso-comportamento).
- **Baseline d'igiene ri-attribuita (R-04)**: `.trueline/hygiene-baseline.json` (versionata) **97 → 103**.
  Lo spostamento di file ha ri-fingerprintato 8 duplicazioni strutturali pre-esistenti (in file NON
  toccati — `git diff main` vuoto — + template dei doc arch-hardening): attribuite come churn di
  posizione, non duplicazione nuova. Gotcha: `baseline.mjs capture <dir> --hygiene --out <hygiene path>`
  (senza `--out` scrive nel `baseline.json` di sicurezza).
- **Budget consumato**: 1 macrotask (`architecture-hardening`), checkpoint VERDE 4/4.

## 5. Esiti dell'ultima sessione (framing onesto)

> Solo fatti: "checkpoint VERDE 4/4, questi controlli sono passati", mai "il repo è a norma" (`L-COL-006`).

- Design **approvato e committato** (`e37c205`); blueprint **bootstrappato e validato** (`54443da`,
  `validate_blueprint` 6/6); BUILD **completato e mergiato** (`7dd614f`).
- **Checkpoint deterministico VERDE 4/4**: dead-code green (0 nuove regressioni d'igiene; dup:104
  pre-esistenti segnalati) · security green (`gitleaks:0 osv:1 rls:0`) · regressions green (**1215/1215**) ·
  conformance green.
- **Batteria di mutazione**: iniettato un arco `domain→data` deliberato in `brief.ts` → gate ROSSO con
  **14 violazioni** (reachability transitiva) → ripristino **verificato per sha256** → verde ripristinato.
- **Verifier BLIND avversariale**: nessun rilievo ALTA/MEDIA; iso-comportamento byte-identico confermato,
  confine `@/data/anthropic` intatto (diff 0 righe).

## 6. Copertura dichiarata (cosa è verificato, cosa NO)

- **Verificato ora** (oracoli): 0 archi `forbidden` alias-aware **repo-wide**; iso-comportamento
  (suite 1215/1215 verde); falsificabilità del gate (fixture data→ui = unica violazione) + batteria
  di mutazione (domain→data → 14 violazioni transitive, ripristino per hash); testimone di
  non-vacuità positivo (app→data alias-risolti vs grafo cieco); security invariata.
- **NON coperto** (dichiarato): il gate prova l'assenza di archi nel grafo import **statico**
  alias-aware, non accoppiamenti a runtime via DI legittimi; l'iso-comportamento è provato dai
  target_tests esistenti, non da un'equivalenza esaustiva; l'oracolo trueline upstream resta cieco
  sugli alias (il verde viene dal test versionato, non da `arch_check.mjs`).

## 7. Carry-over ereditati (rilevanti)

**Aperti:**
- **Fix upstream dell'oracolo** `arch_check.mjs`/`module_graph.mjs` (`--ts-config` per risolvere gli
  alias `@/`): **non azionabile dal repo** (plugin-cache immutabile version-pinned). Complementa,
  non sostituisce, l'enforcement nel test vitest.
- `osv`: advisory **MEDIUM** carry-over (`postcss`, e `next`) — non introdotti qui.
- **CI mai provata da una run reale** (`gh` non installato); e2e solo Chromium.

**Chiusi (da onorare, non riaprire):**
- I 7 archi `domain→data` **bonificati** (relayer A+C, DI B); gate esteso da superficie-P3 a **repo-wide**;
  pin `LEGACY_DOMAIN_DATA` rimosso.
- Invarianti di sicurezza preservati nei refactor: session-client mai service_role; chiave Anthropic
  confinata a `src/data` (`src/app` non importa `@/data/anthropic`, accesso via `src/data/llm-ports.ts`);
  `maxRetries:0`/timeout/cache_control (nel confine intatto); best-effort try/catch di setLocale.
- **Conseguenza accettata** (AH-D2): nuovo arco `ui→app` da `LocaleSwitcher` — non vietato dal contratto.

## 8. Prossimi passi

1. **`architecture-hardening` chiuso e mergiato** (§1/§3). Baseline igiene ri-attribuita (§4).
2. **Prossimo macrotask**: **`editor-blocks`** (T-313…T-317), il modulo P3 rimasto. Aprire con
   `docs/blueprint/P3-editor/prompts/session-start.md`. Dipendenze P3 verdi.
3. **Deploy-coupling = `coupled` CONFERMATO** (§3): il merge di ogni macrotask resta human-gated.
4. Disciplina invariata: 1 workflow build (builder + verifier BLIND) → 1 fermata umana → 1 workflow
   fixer; checkpoint `run_checkpoint.mjs --in-place --mode build --baseline <sicurezza>` **senza
   `--blueprint`**, verdetto dal JSON `.green`; batteria di mutazione con sanità fatale + ripristino
   per sha256; `db reset` azzera il rate-limit auth; R-04 (attribuire prima di ri-baselinare l'igiene).
