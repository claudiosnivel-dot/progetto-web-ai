# SESSION-STATE — Belora · `architecture-hardening`

> Fonte di verità sullo **stato vivo** del macrotask trasversale `architecture-hardening`,
> consumata da BUILD e aggiornata a ogni chiusura di sessione (`prompts/session-end.md`). Istanza
> distinta dalle SESSION-STATE di P0/P1/P2/P3 e da quella della skill trueline. Prosa in italiano,
> identificatori/nomi-file in inglese.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Ultimo aggiornamento** | 2026-08-05 (BOOTSTRAP: blueprint generato e validato; nessun codice) |
| **Sessione corrente** | — (blueprint pronto; prossima azione: **BUILD** del macrotask `architecture-hardening`) |

---

## 1. Stato dei macrotask

> Aggiornato a ogni `session-end`. Stati: `todo` | `in_progress` | `done`.

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| `architecture-hardening` | todo | — | 6 task (T-AH1…T-AH6). 5 refactor indipendenti + gate `T-AH6` che dipende da tutti. Dipendenze P0/P1/P2/P3 verdi su `main` |

## 2. Macrotask corrente

- **`architecture-hardening`**: **TODO** — blueprint pronto e validato, non ancora costruito.
- **Task** (DAG in `00-INDEX` §2): `T-AH1` relayer setLocale → `src/app`; `T-AH2` relayer auth
  login/logout/oauth → `src/app`; `T-AH3` relayer auth signup → `src/app`; `T-AH4` DI porta LLM
  onboarding (interview + fromUrl); `T-AH5` relayer generation phase1/phase2 (I/O → `src/data`);
  `T-AH6` gate repo-wide (flip + drop pin `LEGACY_DOMAIN_DATA` + testimone di non-vacuità positivo)
  — `depends_on [T-AH1..T-AH5]`.
- **Criteri/test di riferimento**: i `target_tests` dei task sono l'oracolo del controllo 4 in BUILD
  (tutti test **esistenti** aggiornati, tranne `T-AH6` che riscrive `architecture-contract.test.ts`).

## 3. Stato git

> Registrato a ogni `session-end`. Mai lavorare su `main`.

| Campo | Valore |
|---|---|
| Branch di lavoro | — (da creare in BUILD: `trueline/build/architecture-hardening`). `main` include il blueprint (docs) |
| Ultimo commit | (bootstrap) blueprint `architecture-hardening` generato e validato — docs su `main` |
| Stato merge su `main` | **N/A** (nessun codice prodotto in BOOTSTRAP) |
| Deploy-coupling | **`coupled` — CONFERMATO** (ereditato). Il merge del macrotask resta **human-gated anche sul verde** |

## 4. Baseline & budget

- **Baseline di sicurezza**: da **riusare** quella corrente del repo (`.trueline/baseline.json`,
  gitignored = 1 finding osv MODERATE carry-over) + baseline d'igiene versionata
  (`.trueline/hygiene-baseline.json`). **Attenzione (R-04)**: i refactor SPOSTANO file (setLocale,
  auth, generation) → le impronte d'igiene sono **sensibili alla posizione**; **ri-attribuire**
  prima di ricatturare. Gotcha: `baseline.mjs capture <dir> --hygiene --out <hygiene path>` (il
  default scrive in `baseline.json`).
- **Budget consumato**: 0 macrotask costruiti (solo BOOTSTRAP).

## 5. Esiti dell'ultima sessione (framing onesto)

> Solo fatti: "generato e validato il blueprint", mai "il repo è a norma di altitudine" (`L-COL-006`).

- Design **approvato e committato** (`e37c205`): `docs/superpowers/specs/2026-08-05-architecture-hardening-design.md`.
- Blueprint **generato** (BOOTSTRAP): `00-INDEX`, `01-architecture-hardening` (6 task), `VISION`,
  questa `SESSION-STATE`, i 3 prompt di lifecycle.
- **Oracolo strutturale** `validate_blueprint.mjs`: **exit 0, 6 task, 6/6 controlli OK**
  (TASKS_PRESENT, REQUIRED_FIELDS, AC_COVERAGE, DAG aciclico, UNIQUE_IDS, MACROTASK_OWNERSHIP);
  check (6) ARCH_CONTRACT_WELL_FORMED **skip legittimo** (nessun blocco `architecture:` duplicato).
- **De-risking** (grep alias-diretto): set vietato repo-wide = **esattamente i 7 `domain→data`**
  (0 `domain→ui`, 0 `domain→app`, 0 `data→ui`). Nessun codice prodotto.

## 6. Copertura dichiarata (cosa è verificato, cosa NO)

> In BOOTSTRAP l'unico oracolo è `validate_blueprint` (strutturale). Il resto è **piano**, non
> ancora provato: si chiude solo in BUILD con gli oracoli del checkpoint.

- **Verificato ora**: forma strutturale del blueprint (campi obbligatori, copertura AC→test, DAG
  aciclico, id univoci, ownership del macrotask). Il check (6) `ARCH_CONTRACT_WELL_FORMED` è skip
  legittimo (il blocco `architecture:` non è duplicato qui). De-risking del set vietato repo-wide.
- **NON ancora coperto** (attende BUILD): l'assenza effettiva degli archi (grafo alias-aware
  repo-wide 0-violazioni); l'iso-comportamento dei refactor (suite 1214 verde); la falsificabilità
  del gate esteso; il testimone di non-vacuità positivo; il checkpoint VERDE 4/4. Nessuno di questi
  è un verde finché un oracolo non lo produce.

## 7. Carry-over ereditati (rilevanti)

**Aperti:**
- **Fix upstream dell'oracolo** `arch_check.mjs`/`module_graph.mjs` (`--ts-config` per risolvere gli
  alias `@/`): **non azionabile dal repo** (plugin-cache immutabile version-pinned). Complementa,
  non sostituisce, l'enforcement nel test vitest.
- `osv`: advisory **MODERATE** carry-over (`next`, `postcss`) — non introdotti qui.
- **CI mai provata da una run reale** (`gh` non installato); e2e solo Chromium.

**Chiusi (da onorare, non riaprire):**
- Il gate T-312 di editor-core è **alias-aware ma scoped alla superficie P3**: questo macrotask lo
  estende repo-wide e rimuove il pin `LEGACY_DOMAIN_DATA`.
- L'unica `data→ui` è **già bonificata** (editor-core: `variant-document` spostato in
  `src/domain/generation/`).
- Invarianti di sicurezza (session-client, chiave Anthropic confinata, maxRetries:0/timeout,
  cache-prefix, best-effort try/catch): da **preservare** nei refactor.

## 8. Prossimi passi

1. **BUILD** del macrotask `architecture-hardening` (aprire con `prompts/session-start.md`): branch
   `trueline/build/architecture-hardening` (mai su `main`); 1 workflow build (builder + verifier
   BLIND per task) → 1 fermata umana → 1 workflow fixer.
2. **Checkpoint** al confine: `run_checkpoint.mjs --in-place --mode build --baseline <sicurezza>`
   **senza `--blueprint`**, verdetto dal JSON `.green`; batteria di mutazione con sanità fatale +
   ripristino per sha256.
3. **Deploy-coupling `coupled` CONFERMATO**: merge su `main` resta human-gated anche sul verde.
