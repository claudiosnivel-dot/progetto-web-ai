# SESSION-STATE — Belora · P0 (Fondamenta)

> Fonte di verità sullo **stato vivo** del sotto-progetto P0. Letta da BUILD a ogni
> apertura e aggiornata a ogni chiusura (`prompts/session-end.md`). Distinta dalla
> SESSION-STATE della skill trueline.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (JS/TS + Supabase) |
| **Ultimo aggiornamento** | 2026-07-23 (chiusura sessione build-P0-auth) |
| **Sessione corrente** | build-P0-auth — **CHIUSA** (riprendere con `prompts/session-start.md`) |

---

## 1. Stato dei macrotask

> Stati: `todo` | `in_progress` | `done`. Ordine = piano di build (00-INDEX §2).

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| infra | **done** | **VERDE 4/4** | T-001..T-006 |
| design-system | **done** | **VERDE 4/4** | T-020..T-022; `7fd35fd` |
| i18n | **done** (parziale) | **VERDE 4/4** | T-080..T-082; `a679b6c`. **T-083 rinviato** (vedi §7) |
| auth | **done** | **VERDE 4/4** | T-040..T-044; `d4fe1a8` (+ hardening `33ab0e0`) |
| tenancy | todo | — | Dipende da infra ✅, auth ✅ → **prossimo eseguibile** |
| sites | todo | — | Dipende da tenancy, design-system ✅, i18n ✅, auth ✅ |

## 2. Macrotask corrente

- **Ultimo chiuso**: `auth` (T-040..T-044, checkpoint verde 4/4). **Prossimo eseguibile**: **`tenancy`** (dipendenze infra + auth verdi).
- **Criteri/test di riferimento**: `05-tenancy.md`, task T-060 (schema accounts + account_members + RLS) → T-061 (schema profiles + RLS) → T-062 (auto-provision account/profilo su signup) → T-063 (test RLS a runtime, isolamento tenant). **Richiede Supabase locale + migrazioni** (test RLS runtime via client con auth reale, MAI SQL editor).

## 3. Stato git

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/auth` (pushato; mergeto su main; non cancellato) |
| Ultimo commit | `33ab0e0` su `main` (HEAD) — working tree PULITO, `origin/main` allineato |
| Stato merge su `main` | **MERGED** (auth ff `7525903..d4fe1a8`; hardening `33ab0e0` diretto su main) — checkpoint verde + non deploy-coupled |
| Deploy-coupling | `main_deploy_coupled: **false**` — confermato 2026-07-23 → **merge su main autonomi** su verde |

## 4. Baseline & budget

- **Baseline di sicurezza**: checkpoint `auth` verde con baseline vuota (0 finding nuovi ≥ HIGH). Controllo 2: `gitleaks 0 · osv 0 · semgrep 0 · rls 0`.
- **Budget**: auth via dynamic workflow (10 agenti: 5 builder + 5 verifier) + 1 fixer, ~776k token subagente. (NB: il 1° lancio del workflow auth fallì per session-limit; ripartito dopo il reset.)

## 5. Esiti dell'ultima sessione (framing onesto)

- Macrotask `auth` (T-040..T-044) costruito **test-first** via **dynamic workflow multi-agente** (5 builder sequenziali → 5 verifier avversariali di sicurezza → **fixer** → orchestratore/oracolo).
- **Supabase Auth**: email/password **pienamente funzionante**; **Google OAuth PREDISPOSTO** (config `env(...)`, pulsante + `signInWithOAuth` + route callback, testato via mock — si attiva aggiungendo le credenziali Google in `.env.local`). Client SSR (`@supabase/ssr`, anon+cookie, `getUser()` valida via `auth.getUser` **non** `getSession`); middleware **unico** esteso (guardia auth composta con next-intl, redirect `/{locale}/login`, locale preservato). Signup con validazione **server-side** zod + strip privilegi. Login con **errore generico** anti user-enumeration.
- **Test runtime REALI** contro Supabase locale (createTestUser/signInAs + cleanup): validazione JWT, signUp, signInWithPassword/signOut. `.env.local` (gitignored) creato da `supabase status -o env`.
- **2 RILIEVI HIGH di sicurezza corretti (fix human-gated)**: (a) `sanitizeNext` (T-044 callback) era bypassabile via **control-char smuggling** (`/%09//evil` → host esterno) → fix **origin-based** (`new URL` + `u.origin===origin`) + reject control-char + test coi vettori. (b) Follow-up: lo stesso regex in `setLocale` (i18n, su main) → hardening con reject `\p{Cc}` + test (`33ab0e0`). **Lezione ricorrente**: gli oracoli (semgrep detection-only) NON bloccano gli open-redirect → il verifier avversariale + fix human-gated è ciò che li coglie.
- **Checkpoint VERDE 4/4**; provenienza `untracked:[]`.

## 6. Note operative (checkpoint & Supabase)

- **Checkpoint con test runtime Supabase**: esportare le 4 env (`NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY/DATABASE_URL`) **via shell** prima di `run_checkpoint.mjs`, così i controlli 3/4 (`npm test`) fanno girare i test runtime; e **spostare `.env.local` FUORI dal repo** (es. nello scratchpad, NON rinominarlo in `.env.local.hidden` che non è gitignored) + `rm -rf .next`, così gitleaks (controllo 2) resta pulito. Ripristinare `.env.local` a fine. Invocazione: `run_checkpoint.mjs "<repo>" --in-place --mode build` (SENZA `--blueprint`, vedi sotto).
- **`--blueprint` NON usarlo**: il manifest `supabase-jsts` ha `run_file="node --test {file}"`, incompatibile coi test vitest+jsdom → falso rosso. Provenienza verificata a parte con `ac_assertion_trace_check`.
- **Supabase locale**: già in esecuzione (docker, porte 546xx). `supabase status -o env` per le chiavi. `config.toml` ora ha `[auth]`/`[auth.email]`/`[auth.external.google]` + rate limit + `minimum_password_length=8`.
- **DEPLOY-CHECKLIST (hardening prod, fuori P0 locale)**: `skip_nonce_check=true` su Google (solo dev); `redirectTo` OAuth derivato dagli header host (mitigato da `additional_redirect_urls`; valutare `SITE_URL` da env); refresh cookie sessione demandato a RSC/route handler (non nel middleware, fail-closed).

## 7. Prossimi passi & tracker task rinviati

1. **Sessione CHIUSA.** Riprendere con `prompts/session-start.md`.
2. Prossimo macrotask BUILD: **`tenancy`** — branch `trueline/build/tenancy`; T-060 (accounts + account_members + RLS, scritture solo owner) → T-061 (profiles + RLS) → T-062 (auto-provision account/profilo su signup) → T-063 (test RLS a runtime, isolamento tenant). Richiede migrazioni Supabase + test RLS via client autenticato.
3. **TRACKER TASK RINVIATI**:
   - **T-083** (i18n — persistenza `profiles.locale`): dipende da **T-061** (tenancy, ora prossimo) e **T-041** (auth ✅). **Sbloccabile dopo tenancy** → costruire come revisita i18n subito dopo `tenancy`. Oggi la lingua persiste solo via cookie `NEXT_LOCALE`.
4. **Metodo attivo**: dynamic workflow multi-agente (builder → verifier diversi → fixer diversi + orchestratore), **oracolo unico giudice**. Merge su `main` autonomo su verde.
