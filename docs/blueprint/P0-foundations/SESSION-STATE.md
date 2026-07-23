# SESSION-STATE — Belora · P0 (Fondamenta)

> Fonte di verità sullo **stato vivo** del sotto-progetto P0. Letta da BUILD a ogni
> apertura e aggiornata a ogni chiusura (`prompts/session-end.md`). Distinta dalla
> SESSION-STATE della skill trueline.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (JS/TS + Supabase) |
| **Ultimo aggiornamento** | 2026-07-23 (BUILD macrotask `infra`) |
| **Sessione corrente** | build-P0-infra |

---

## 1. Stato dei macrotask

> Stati: `todo` | `in_progress` | `done`. Ordine = piano di build (00-INDEX §2).

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| infra | **done** | **VERDE 4/4** | T-001..T-006; commit `49a4c0e` sul branch |
| design-system | todo | — | Dipende da infra ✅ → **prossimo eseguibile** |
| i18n | todo | — | Dipende da infra ✅, design-system (tema) |
| auth | todo | — | Dipende da infra ✅, i18n, design-system |
| tenancy | todo | — | Dipende da infra ✅, auth |
| sites | todo | — | Dipende da tenancy, design-system, i18n, auth |

## 2. Macrotask corrente

- **Ultimo chiuso**: `infra` (checkpoint verde). **Prossimo eseguibile**: **`design-system`** (dipendenze verdi).
- **Criteri/test di riferimento**: `02-design-system.md` e i `target_tests` dei task T-020..T-022.

## 3. Stato git

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/infra` (pushato su origin) |
| Ultimo commit | `49a4c0e` (feat(infra): P0 macrotask infra) |
| Stato merge su `main` | **SOSPESO** — deploy-coupling rilevato (fail-safe `L-COL-025`); in attesa di conferma utente |
| Deploy-coupling | `main_deploy_coupled: true` (auto-detect, 1 segnale: `supabase/config.toml`) — **da confermare con l'utente** |

## 4. Baseline & budget

- **Baseline di sicurezza**: checkpoint `infra` verde con baseline vuota (0 finding nuovi ≥ HIGH).
- **Budget consumato**: n/d (build manuale in sessione).

## 5. Esiti dell'ultima sessione (framing onesto)

- Macrotask `infra` costruito test-first (T-001..T-006, 25 target_test) sul branch `trueline/build/infra`.
- **Checkpoint trueline VERDE 4/4** (l'oracolo decide): dead-code 0 nuovi (knip) · sicurezza [gitleaks/osv/semgrep/rls] 0 · regressioni verdi · conformità 25 target_test verdi.
- Vulnerabilità dipendenze (sharp/postcss) risolte via `overrides` npm → osv-scanner 0.
- gitleaks: falsi positivi su file **gitignorati** (`.env.local` = chiavi demo locali pubbliche; `.next/` = artefatti build) neutralizzati eseguendo il checkpoint su albero pulito con env Supabase **via shell** (non su disco).

## 6. Note operative (Supabase locale & checkpoint)

- **Supabase locale**: porte spostate a `546xx` (config.toml) per evitare collisione con altri stack locali (543xx/544xx/545xx occupati). Avvio: `supabase start`; parametri: `supabase status -o env`.
- **Env dei test**: `.env.local` (gitignorato) mappa API_URL/ANON_KEY/SERVICE_ROLE_KEY/DB_URL → NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL. Caricato da `tests/setup.env.ts`.
- **Per il checkpoint sicurezza**: eseguire senza `.env.local` e senza `.next/` su disco, esportando le env Supabase nella shell (il gitleaks bundled scansiona anche i gitignorati).

## 7. Prossimi passi

1. **Confermare il deploy-coupling di `main`** → se NON accoppiato (nessun deploy automatico su push; Supabase è solo locale), **merge `infra` su `main` + push**; altrimenti tenere sul branch.
2. Aprire la sessione BUILD di **`design-system`** (`prompts/session-start.md`).
