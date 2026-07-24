# SESSION-STATE — Belora · P1 (Onboarding)

> Fonte di verita sullo **stato vivo** del sotto-progetto P1. Letta da BUILD a ogni
> apertura e aggiornata a ogni chiusura (`prompts/session-end.md`). Distinta dalla
> SESSION-STATE della skill trueline e da quella di P0.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (JS/TS + Supabase) |
| **Ultimo aggiornamento** | 2026-07-24 (chiusura BUILD macrotask `brief-model`) |
| **Sessione corrente** | build-P1-brief-model — **CHIUSA**. Checkpoint VERDE 4/4 (pre- e post-fix), mergeato su `main`. **Prossimo macrotask DESIGNATO: `ai-onboarding`** (T-130..T-132). Riprendere con `prompts/session-start.md`. |

---

## 1. Stato dei macrotask

> Stati: `todo` | `in_progress` | `done`. Ordine = piano di build (00-INDEX §2).

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| brief-model | **done** | **VERDE 4/4** | T-120..T-123 (`33fb898`) + fix verifica avversariale (`5243260`); mergeato su `main` |
| ai-onboarding | **todo** | — | T-130..T-132 (sbloccato: usa T-122) |
| url-import | **todo** | — | T-140..T-141 (sbloccato: usa T-121 + confine LLM T-131) |
| onboarding-ui | **todo** | — | T-150..T-153 (dipende da tutti i precedenti) |

**→ `brief-model` (la spina dorsale) e `done` e verde su `main`.**

## 2. Macrotask corrente

- **Ultimo chiuso**: `brief-model` (T-120..T-123, checkpoint verde 4/4, `5243260`).
- **PROSSIMO DESIGNATO**: **`ai-onboarding`** (T-130..T-132) — confine LLM server-only mockabile
  + intervista tool-use. Dipendenze P1 verdi (usa `brief.ts`/T-121-T-122). Primo nell'ordine di
  build (00-INDEX §2) ed e il cuore dell'intervista.
- **Alternativa equivalente**: **`url-import`** (T-140..T-141, SSRF-safe + estrazione) — indipendente
  da ai-onboarding; se si preferisce si puo costruire prima o in parallelo (worktree). `onboarding-ui`
  resta bloccato finche **entrambi** ai-onboarding e url-import non sono verdi.
- **PREPARAZIONE per ai-onboarding** (T-130/T-131): introduce l'SDK Anthropic — **`@anthropic-ai/sdk`
  NON e ancora in package.json**. Il BUILD dovra aggiungerlo (nuova devDependency/dependency → **osv
  delta da verificare** al checkpoint) e aggiungere allo schema env `ANTHROPIC_API_KEY` (server-only)
  + `ANTHROPIC_MODEL_ONBOARDING` (default `claude-haiku-4-5`, decisione P1-D4). Modello onboarding =
  Haiku 4.5; il confine LLM `src/data/anthropic.ts` va reso mockabile (guardia ESLint no-restricted-imports).

## 3. Stato git

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/brief-model` (pushato; mergeato su main; non cancellato) |
| Ultimo commit | `5243260` su `main` (HEAD) — working tree pulito, `origin/main` allineato |
| Stato merge su `main` | **MERGED**: brief-model ff `7a9ae9a..5243260`, gated dal checkpoint verde 4/4 |
| Deploy-coupling | **`main_deploy_coupled: false`** — riconfermato dall'utente in questo BUILD (2026-07-24). `detect_deploy_coupling.mjs` ri-flagga sul solo `supabase/config.toml` (dev locale); nessun `vercel.json`/GH-Actions-on-push/Cloudflare/Netlify → nessun deploy-on-push. L'override governa |

## 4. Baseline & budget

- **Baseline di sicurezza**: checkpoint `brief-model` verde con baseline pulita. Controllo 2:
  `gitleaks:0 · osv:0 · semgrep:0 · rls:0`; `degraded: []` (semgrep ha girato, nessuna
  degradazione). Controllo 1 dead-code:0; controlli 3/4 verdi.
- **Suite**: **26 test brief-model** (4 file: brief-schema, brief-apply, site-briefs-schema,
  briefs-actions) — verdi, DB-backed su Supabase locale; full suite verde. typecheck/lint/knip
  puliti; `next build` (via checkpoint) verde.
- **Budget**: `brief-model` costruito test-first dall'orchestratore + **dynamic workflow di
  verifica avversariale** (4 lenti + refutazione 2x, **24 agenti, ~1.04M token subagente**) →
  10 candidati, **5 rilievi confermati** (1 sicurezza medium + 1 correttezza medium + 3 low),
  **tutti corretti e riverificati** con lo stesso oracolo (L-COL-003). Nessun fallimento di sessione.

## 5. Esiti dell'ultima sessione (framing onesto)

### brief-model (T-120..T-123)
- **T-120** schema `public.site_briefs` 1:1 con `site` (`UNIQUE(site_id)`), account-scoped, RLS
  4 policy `TO authenticated` su `is_account_member(account_id)` con `account_id` esplicito
  (RLS004 evitato), CHECK vertical/primary_goal/locale/status; vincoli provati a runtime.
- **T-121** `BriefSchema` zod (allowlist chiuse, strict) — gate dell'input non fidato (A05:2025).
  **T-122** `applyBriefUpdate` (merge offerings per `name`) + `isBriefComplete`, puri.
  **T-123** `briefs.ts` get/upsert/confirm via client RLS (mai service_role), account da
  `owner_id.single()`, site-ownership verificata, `upsert onConflict(site_id)`, metodi tipati.
- **Rilievi colti dalla verifica avversariale (post-checkpoint, oltre l'oracolo)** — 5 confermati,
  tutti corretti nel commit `5243260`:
  1. **[SICUREZZA medium]** la RLS ancorava solo `account_id` senza legare `site_id` all'account →
     **squatting cross-tenant del `site_id` altrui + DoS** via chiamata PostgREST diretta (bypass di
     `briefs.ts`). **Fix radice a livello DB**: `UNIQUE(account_id, id)` su `sites` + **FK composita**
     `site_briefs(account_id, site_id) → sites(account_id, id)` → impossibile ancorare il brief al
     sito di un altro tenant (test: own-account + other-site → `23503`). *Difetto che l'oracolo
     `rls_check` strutturale non poteva vedere (invariante cross-colonna).*
  2. **[CORRETTEZZA medium]** `confirmBrief` ritornava `{ok:true}` su 0 righe → falso successo. Fix:
     `.select()` + **404** su 0 righe (rende anche raggiungibile il `404` del tipo). Test: 404 su
     sito senza brief e cross-tenant.
  3. **[TEST-FIDELITY low]** AC-122-1 copriva l'invarianza solo nominalmente → test rinforzato
     (semina description/phone/offerings, asserisce l'invarianza reale).
  4. **[DISCIPLINA low]** indirection inutile `rowToBrief`/`emptyBriefMerged` → collassate.
- 5 candidati refutati (falsi positivi): tra cui "confirmBrief no-op = leak" (la RLS blocca, nessun
  leak), "content azzerato in lettura" (non raggiungibile per costruzione), immutabilita profonda
  delle offerings (nessun AC la richiede).

### fix_state
- Tutte le fix **verified**: riverificate con lo STESSO oracolo (re-run checkpoint) + i test → finding
  sparito, nulla rotto, checkpoint 4/4. Nessuna rimozione di dead-code (controllo 1 a 0).

## 6. Note operative (checkpoint & test)

- **Checkpoint**: `db reset` prima del run (rate-limit auth azzerato + migrazioni riapplicate),
  `set -a; . .env.local; set +a`, spostare `.env.local` FUORI dal repo (gitleaks pulito) +
  `rm -rf .next`, `node <trueline>/scripts/checkpoint/run_checkpoint.mjs "<repo>" --in-place
  --mode build` (SENZA `--blueprint`: manifest supabase-jsts usa `node --test`, incompatibile con
  vitest+jsdom → falso rosso), ripristino via trap EXIT.
- **RLS a runtime**: schema test via `pgQuery` (cataloghi) + vincoli via superuser (bypassa RLS,
  non i vincoli); **denial cross-tenant provata via `signInAs`** (auth reale), mai nell'SQL editor.
- **Rate limit auth** (`sign_in_sign_ups=30`/5min per IP): eseguire la suite/checkpoint **una volta
  per finestra**; `db reset` prima del run azzera il contatore. Riuso di `signInAs` per client.

## 7. Prossimi passi & decisioni

1. **BUILD del prossimo macrotask**: `ai-onboarding` (T-130..T-132) o `url-import` (T-140..T-141),
   indipendenti. `ai-onboarding` aggiunge `@anthropic-ai/sdk` (nuova dep → osv). **NON avviare in
   autonomia**: attendere il via dell'utente (consent-gated come da preferenza espressa).
2. **DECISIONE APERTA `P1-D11`**: contratto di altitudine (`architecture:`) ancora rinviato —
   attivare `arch_check` solo dopo audit del grafo import reale.
3. **Metodo attivo**: dynamic workflow multi-agente (orchestratore costruisce test-first + verifica
   avversariale multi-lente con refutazione), **oracolo unico giudice** (checkpoint 4/4). Merge su
   `main` autonomo su verde (deploy-coupling `false` riconfermato); distruttive/deploy gated.
