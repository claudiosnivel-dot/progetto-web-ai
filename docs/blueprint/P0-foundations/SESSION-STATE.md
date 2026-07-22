# SESSION-STATE — Belora · P0 (Fondamenta)

> Fonte di verità sullo **stato vivo** del sotto-progetto P0. Letta da BUILD a ogni
> apertura e aggiornata a ogni chiusura (`prompts/session-end.md`). Distinta dalla
> SESSION-STATE della skill trueline.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (JS/TS + Supabase) |
| **Ultimo aggiornamento** | 2026-07-22 (chiusura BOOTSTRAP) |
| **Sessione corrente** | bootstrap-P0 |

---

## 1. Stato dei macrotask

> Stati: `todo` | `in_progress` | `done`. Ordine = piano di build (00-INDEX §2).

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| infra | todo | — | Radice del DAG; primo eseguibile |
| design-system | todo | — | Dipende da infra |
| i18n | todo | — | Dipende da infra |
| auth | todo | — | Dipende da infra |
| tenancy | todo | — | Dipende da auth + infra |
| sites | todo | — | Dipende da tenancy + design-system + i18n + auth |

## 2. Macrotask corrente

- **Selezionato**: nessuno ancora costruito. Primo eseguibile (dipendenze vuote): **`infra`**.
- **Task atomici in corso**: —
- **Criteri/test di riferimento**: vedi `01-infra.md` e i `target_tests` dei suoi task.

## 3. Stato git

| Campo | Valore |
|---|---|
| Branch di lavoro | — (da creare al primo BUILD; mai lavorare su `main`) |
| Ultimo commit | `cc271ad` (Initial commit — solo docs) |
| Stato merge su `main` | — (gated dal verde del checkpoint) |
| Deploy-coupling | `unknown` (da rilevare al primo BUILD; assumere coupled se ambiguo) |

## 4. Baseline & budget

- **Baseline di sicurezza**: vuota (popolata al primo BUILD).
- **Budget consumato**: 0 / (da definire per-ciclo in BUILD).

## 5. Esiti dell'ultima sessione (framing onesto)

- BOOTSTRAP completato: blueprint P0 generato — **28 task atomici** in 6 macrotask,
  ciascuno con DoD + acceptance_criteria + target_tests + security_notes.
- Oracolo strutturale `validate_blueprint.mjs`: **passato** (exit 0), tutti e 5 i
  controlli OK (campi, copertura AC→test, DAG aciclico, id univoci, macrotask).
- Self-check semantico (punti 6–10) eseguito con 2 critici avversariali
  (copertura/atomicità + sicurezza): **21 rilievi**, tutti applicati al piano
  (fra cui: `account_members` write owner-only, slug `UNIQUE(account_id,slug)`,
  middleware unico composto, naming client Supabase inequivocabile, helper
  Postgres diretto per le asserzioni di catalogo, modulo brand, split UI/dati).

## 6. Prossimi passi

- Aprire la prossima sessione con `prompts/session-start.md`.
- Il dispatch di trueline rileverà blueprint + SESSION-STATE → modalità **BUILD**.
- Primo macrotask: **`infra`** (scaffold Next.js + Supabase, env/segreti, CI, migrazioni locali).
- Prima del primo BUILD: eseguire `scripts/preflight.mjs` (gitleaks/osv/semgrep/knip) e
  rilevare il deploy-coupling di `main`.
