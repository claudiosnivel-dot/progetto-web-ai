# SESSION-STATE — Belora · P0 (Fondamenta)

> Fonte di verità sullo **stato vivo** del sotto-progetto P0. Letta da BUILD a ogni
> apertura e aggiornata a ogni chiusura (`prompts/session-end.md`). Distinta dalla
> SESSION-STATE della skill trueline.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (JS/TS + Supabase) |
| **Ultimo aggiornamento** | 2026-07-23 (chiusura sessione build-P0-i18n) |
| **Sessione corrente** | build-P0-i18n — **CHIUSA** (riprendere con `prompts/session-start.md`) |

---

## 1. Stato dei macrotask

> Stati: `todo` | `in_progress` | `done`. Ordine = piano di build (00-INDEX §2).

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| infra | **done** | **VERDE 4/4** | T-001..T-006; merged su `main` |
| design-system | **done** | **VERDE 4/4** | T-020..T-022; commit `7fd35fd` |
| i18n | **done** (parziale) | **VERDE 4/4** | T-080..T-082; commit `a679b6c`. **T-083 RINVIATO** (vedi §7 tracker) |
| auth | todo | — | Dipende da infra ✅, i18n ✅, design-system ✅ → **prossimo eseguibile** |
| tenancy | todo | — | Dipende da infra ✅, auth |
| sites | todo | — | Dipende da tenancy, design-system ✅, i18n ✅, auth |

## 2. Macrotask corrente

- **Ultimo chiuso**: `i18n` (T-080..T-082, checkpoint verde 4/4). **Prossimo eseguibile**: **`auth`** (dipendenze infra + i18n + design-system verdi).
- **Criteri/test di riferimento**: `04-auth.md`, task T-040 (config Supabase Auth email/password + Google) → T-041 (sessione server-side + guardia route nel middleware unico src/middleware.ts, ESTENDE next-intl di T-080) → T-042 (signup) → T-044 (callback OAuth) → T-043 (login/logout + Google).

## 3. Stato git

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/i18n` (pushato; mergeto su main; non cancellato) |
| Ultimo commit | `a679b6c` su `main` (HEAD) — working tree PULITO, `origin/main` allineato |
| Stato merge su `main` | **MERGED** (fast-forward `4e5f773..a679b6c`, pushato) — checkpoint verde + non deploy-coupled |
| Deploy-coupling | `main_deploy_coupled: **false**` — confermato dall'utente 2026-07-23 → **merge su main autonomi** su checkpoint verde |

## 4. Baseline & budget

- **Baseline di sicurezza**: checkpoint `i18n` verde con baseline vuota (0 finding nuovi ≥ HIGH). Controllo 2: `gitleaks 0 · osv 0 · semgrep 0 · rls 0`.
- **Budget consumato**: build via dynamic workflow multi-agente (6 agenti: 3 builder + 3 verifier) + 1 fixer, ~515k token subagente.

## 5. Esiti dell'ultima sessione (framing onesto)

- Macrotask `i18n` (T-080..T-082) costruito **test-first** via **dynamic workflow multi-agente** (builder sequenziali sul DAG → verifier avversariali diversi in parallelo → **fixer** su rilievo HIGH → orchestratore esegue l'oracolo).
- **Restructure architetturale**: routing sotto `src/app/[locale]/**` (next-intl v4.13.3, `defineRouting` locales ['it','es'] defaultLocale 'it' localePrefix 'always'); root `layout.tsx`/`page.tsx` **eliminati** (html/body + `NextIntlClientProvider` + `ThemeProvider` nel `[locale]/layout.tsx`, guardia `hasLocale→notFound`); middleware **unico** `src/middleware.ts` (matcher esclude /api,/_next; verrà ESTESO dalla guardia auth T-041); `createNextIntlPlugin` in `next.config.ts`; `vitest.config.ts` con `server.deps.inline:['next-intl']`.
- **RILIEVO HIGH di sicurezza corretto (fix human-gated)**: la server action `setLocale` validava il locale ma passava `currentPathname` **grezzo** a `redirect()` → **open redirect** (href assoluto/protocol-relative). Fix: validazione server-side del pathname a soli path interni (`'/'` o `/^\/(?![/\\])/`; rifiuta `//`, `\`, schemi → 400, no cookie/redirect) + 2 test di regressione. Loop di fix riverificato con lo STESSO oracolo → verde. **Lezione**: semgrep (detection-only) trovava 0 → l'oracolo NON avrebbe bloccato l'open redirect; è stato il verifier avversariale + fix human-gated a coglierlo.
- **Checkpoint trueline VERDE 4/4**; provenienza AC `ac_assertion_trace_check → ok, untracked:[]` (i test T-083 rinviati NON sono in-scope → nessun AC falsamente coperto).

## 6. Note operative (checkpoint & runner)

- **Invocazione checkpoint (IMPORTANTE)**: eseguire **senza `--blueprint`** (ramo legacy = suite vitest), come per `infra`/`design-system`.
  `node "<skill>/scripts/checkpoint/run_checkpoint.mjs" "<repo>" --in-place --mode build`.
  **Perché**: il manifest `supabase-jsts` ha `test_runner.run_file="node --test {file}"`, incompatibile coi test vitest+jsdom+alias `@/` mandati dal blueprint → col ramo AC-acceptance (`--blueprint`) tutti i file darebbero "vacuo"→rosso falso. Provenienza dei tag `// covers:` verificata separatamente via `ac_assertion_trace_check`. **Raccomandazione upstream** (fuori scope Belora): allineare `run_file` a vitest + adeguare il parser di `run_file.mjs`.
- **Prima del checkpoint**: `rm -rf .next` (gitleaks bundled scansiona i gitignorati; inoltre evita il lock `.next/turbopack` su Windows in build back-to-back); `.env.local` assente → i test Supabase si **skippano** dichiarati.
- **Supabase locale**: porte `546xx`. **auth/tenancy richiederanno Supabase in esecuzione** (test RLS runtime): `supabase start` + env via shell.
- **Convenzioni test**: file al path esatto del blueprint (`.test.ts`/`.test.tsx`); DOM → docblock `// @vitest-environment jsdom` + `React.createElement` nei `.test.ts`; ogni AC con tag `// covers: <AC-id>`.

## 7. Prossimi passi & tracker task rinviati

1. **Sessione CHIUSA.** Riprendere con `prompts/session-start.md`.
2. Prossimo macrotask BUILD: **`auth`** — branch `trueline/build/auth`; T-040 (config Supabase Auth email/password + Google OAuth) → T-041 (sessione server-side + guardia route nel middleware unico, estende next-intl) → T-042 (signup validazione server-side) → T-044 (route `/{locale}/auth/callback`) → T-043 (login/logout + Accedi con Google). **Richiede Supabase locale in esecuzione** per i test.
3. **TRACKER TASK RINVIATI**:
   - **T-083** (i18n — persistenza `profiles.locale`): dipende da **T-061** (tenancy: schema/RLS `profiles`) e **T-041** (auth), + test RLS runtime. **Da costruire dopo tenancy** (revisita del macrotask i18n). Al momento la persistenza della lingua è solo via cookie `NEXT_LOCALE` (T-082); manca la persistenza su DB per l'utente autenticato.
4. **Metodo di esecuzione attivo**: dynamic workflow multi-agente (builder → verifier diversi → fixer diversi + orchestratore), con l'**oracolo unico giudice**. Merge su `main` autonomo su verde.
