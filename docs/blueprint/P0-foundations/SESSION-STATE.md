# SESSION-STATE — Belora · P0 (Fondamenta)

> Fonte di verità sullo **stato vivo** del sotto-progetto P0. Letta da BUILD a ogni
> apertura e aggiornata a ogni chiusura (`prompts/session-end.md`). Distinta dalla
> SESSION-STATE della skill trueline.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (JS/TS + Supabase) |
| **Ultimo aggiornamento** | 2026-07-24 (chiusura sessione build-P0-sites+T-083) |
| **Sessione corrente** | build-P0-sites+T-083 — **CHIUSA**. **P0 COMPLETO** (6/6 macrotask verdi). Riprendere con `prompts/project-start.md` (il prossimo passo è P1, vedi §7). |

---

## 1. Stato dei macrotask

> Stati: `todo` | `in_progress` | `done`. Ordine = piano di build (00-INDEX §2).

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| infra | **done** | **VERDE 4/4** | T-001..T-006 |
| design-system | **done** | **VERDE 4/4** | T-020..T-022; `7fd35fd` |
| i18n | **done** | **VERDE 4/4** | T-080..T-082 (`a679b6c`) + **T-083 chiuso** (`9dad560`) |
| auth | **done** | **VERDE 4/4** | T-040..T-044; `d4fe1a8` (+ hardening `33ab0e0`) |
| tenancy | **done** | **VERDE 4/4** | T-060..T-063 (`dd1e905`) + emendamento `UNIQUE(owner_id)` (`463678d`) |
| sites | **done** | **VERDE 4/4** | T-100..T-105 (`6c4c9e2`) |

**→ P0 COMPLETO: tutti e 6 i macrotask del blueprint sono `done` e verdi, mergeati su `main`.**

## 2. Macrotask corrente

- **Ultimo chiuso**: `sites` (T-100..T-105, checkpoint verde 4/4, `6c4c9e2`) + carry-over **`T-083`** dell'i18n (checkpoint verde 4/4, `9dad560`).
- **Prossimo eseguibile in P0**: **NESSUNO** — il blueprint P0 è interamente costruito. Il passo successivo è il sotto-progetto **P1** (onboarding/import GBP·Instagram), che richiede modalità **BOOTSTRAP** (raccolta-intento + nuove decisioni di ledger) e **non** è un "next macrotask" di questo blueprint (§7).

## 3. Stato git

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/sites` e `trueline/build/t083` (entrambi pushati; mergeti su main; non cancellati) |
| Ultimo commit | `9dad560` su `main` (HEAD) — working tree pulito, `origin/main` allineato |
| Stato merge su `main` | **MERGED**: sites ff `c7c4ad3..6c4c9e2`; T-083 ff `6c4c9e2..9dad560`. Entrambi gated dal checkpoint verde 4/4 |
| Deploy-coupling | **Override umano confermato**: `main_deploy_coupled: false` (2026-07-23) → merge autonomi su verde. NB: `detect_deploy_coupling.mjs` **ri-flagga** `main` come coupled sul solo segnale `supabase/config.toml`, che è **config Supabase locale (dev)**, non un hook di deploy-on-push. Nessun `vercel.json`/GH-Actions-on-push/Cloudflare/Netlify presente → nessun deploy autonomo in produzione. L'override registrato governa (come per i merge di tenancy) |

## 4. Baseline & budget

- **Baseline di sicurezza**: checkpoint `sites` e `T-083` verdi con baseline vuota (0 finding nuovi ≥ HIGH). Controllo 2 (entrambi): `gitleaks 0 · osv 0 · semgrep 0 · rls 0`; `degraded: []` (semgrep ha girato, nessuna degradazione). Controllo 1 dead-code 0; controlli 3/4 verdi.
- **Suite**: 40→48 file di test, 155→**174** test verdi (28 nuovi sites + 5 nuovi T-083 + adeguamenti). typecheck/lint/knip puliti; `next build` verde; provenienza AC (`ac_assertion_trace_check`) OK su 42 target_test.
- **Budget**: `sites` costruito test-first dall'orchestratore + **dynamic workflow di verifica avversariale** (5 lenti + refutazione, 7 agenti, ~477k token subagente) → 1 rilievo test-fidelity confermato e corretto. `T-083` idem (3 lenti + refutazione, 4 agenti, ~248k token) → 0 rilievi confermati, 1 rafforzamento adottato. Nessun fallimento di sessione.

## 5. Esiti dell'ultima sessione (framing onesto)

### sites (T-100..T-105)
- **T-100** schema `public.sites` account-scoped + RLS: 4 policy (SELECT/INSERT/UPDATE/DELETE) `TO authenticated` ancorate a `is_account_member(account_id)`, `UNIQUE(account_id, slug)` per-account (no enumerazione cross-tenant), `CHECK(status)`, indice `account_id`, GRANT espliciti (auto_expose off). **RLS004 evitato per costruzione**: `account_id` (colonna di tenancy) compare nel testo di ogni policy → auditabile staticamente dall'oracolo. Vincoli provati a runtime (23505/23514/cross-account).
- **T-104** utility slug pura URL-safe (diacritici IT/ES via NFKD, `[a-z0-9-]`, troncamento, fallback). **T-101** `createSite`/`listSites` (client SSR con sessione/RLS, mai service_role; `account_id` derivato da `auth.uid()→owner_id` via `.single()` sicuro per `UNIQUE(owner_id)`; slug unico; metodi tipati). **T-103** `renameSite`/`deleteSite` (RLS come gate cross-tenant). **T-102** dashboard localizzata `/it,/es` in AppShell, protetta (redirect login), form crea-sito (adapter `createSiteForm`→`createSite`→`revalidatePath`). **T-105** `SiteRow` con rinomina ed **elimina-a-conferma-esplicita**.
- **Rilievo colto dalla verifica avversariale (pre-checkpoint)**: AC-102-4 coperto in modo **debole** (un test divergente + uno self-fulfilling; il vero adapter `createSiteForm` non era esercitato). **Fix alla radice**: (a) test del wiring reale dashboard→adapter (submit del form vero → `createSiteForm` col name inviato); (b) test di integrazione `createSiteForm`→`createSite`→comparsa in `listSites` contro DB reale + `revalidatePath`. Rilievo su `account_members`-vs-`owner_id`: **refutato** (l'emendamento ledger sancisce `owner_id.single()`; comportamento identico in P0 single-owner; DoD portante «mai da input client» soddisfatto). *Divergenza di sola prosa nel blueprint 06-sites.md T-101 DoD → vedi §7.5.*

### T-083 (carry-over i18n)
- `updateProfileLocale` (server action, client SSR/RLS, mai service_role; allowlist `['it','es']`→400, senza sessione→401, `.update().eq('id', auth.uid())` tipato). `getProfileLocale` (lettura propria via RLS). `resolveInitialLocale` (precedenza **cookie > profiles.locale > URL**, ogni sorgente validata). Layout: locale **effettivo** dal resolver (in assenza di cookie la preferenza persistita determina la lingua resa). `setLocale` (T-082) persiste «oltre al cookie» (best-effort). Isolamento RLS su `profiles` provato a runtime con auth reale (AC-083-2).
- Verifica avversariale: 0 rilievi confermati; **AC-083-5 rafforzato** (aggiunto il test del cablaggio layout→`<html lang>` del locale risolto, chiudendo la clausola "la UI rende in es").

### fix_state
- Tutte le fix **verified** (riverificate con lo STESSO oracolo — re-run checkpoint — + i test): finding sparito, nulla rotto, checkpoint 4/4. Nessuna rimozione di dead-code (controllo 1 verde a 0 → niente da far passare dall'umano).

## 6. Note operative (checkpoint & Supabase)

- **Checkpoint con test runtime Supabase**: script `scratchpad/run-checkpoint-sites.sh` → `set -a; . .env.local; set +a` (esporta le 4 env), **sposta `.env.local` FUORI dal repo** (gitleaks working-tree resta pulito) + `rm -rf .next`, poi `node <trueline>/scripts/checkpoint/run_checkpoint.mjs "<repo>" --in-place --mode build` (SENZA `--blueprint`), ripristino via trap EXIT. `db reset` prima di ogni checkpoint (rate-limit auth azzerato).
- **Provenienza AC**: `node <trueline>/scripts/blueprint/ac_assertion_trace_check.mjs docs/blueprint/P0-foundations .` (exit 0 = ogni AC valutato tracciato da un tag `covers:`).
- **`--blueprint` NON usarlo**: il manifest `supabase-jsts` ha `run_file="node --test {file}"`, incompatibile con vitest+jsdom → falso rosso.
- **Deploy-coupling detector**: `detect_deploy_coupling.mjs` ri-flagga `main` come coupled sul solo `supabase/config.toml` (dev locale); l'override umano registrato (false) governa (§3).
- **Rate limit auth** (`sign_in_sign_ups=30`/5min per IP): `createTestUser` usa l'admin API (esente); solo `signInAs` conta. Eseguire la suite/checkpoint **una volta per finestra**; un `db reset` prima del run azzera il contatore.
- **Test di Server Action a runtime**: mock di `@/data/supabase-ssr` `createServerSupabaseClient` → client iniettato da `signInAs` (JWT reale, RLS genuina); l'identità è `supabase.auth.getUser()` sul client iniettato. Server Component testati chiamandoli come funzione async e ispezionando/renderizzando l'albero.
- **DEPLOY-CHECKLIST (hardening prod, fuori P0 locale)**: GRANT/auto_expose (off è il default cloud; pattern replicato nelle migrazioni); `revoke execute` su `handle_new_user()` da PUBLIC (opzionale); voci auth pre-esistenti (`skip_nonce_check` Google solo dev; `redirectTo` OAuth da header host; refresh cookie sessione in RSC/route handler).

## 7. Prossimi passi & tracker task rinviati / decisioni aperte

1. **Sessione CHIUSA. P0 COMPLETO** (6/6 macrotask verdi, su `main`). Riprendere con `prompts/project-start.md`.
2. **Nessun macrotask P0 residuo.** Il passo successivo è **P1** (onboarding/import GBP·Instagram — 00-INDEX §5). È un **nuovo sotto-progetto** che richiede modalità **BOOTSTRAP**: raccolta-intento (obiettivo, scope, vincoli), nuove decisioni di ledger, generazione di un blueprint di task atomici. **Non avviabile in autonomia** senza le decisioni di scope dell'utente (BOOTSTRAP è consent-gated).
3. **TRACKER TASK RINVIATI**: **VUOTO** — T-083 (unico carry-over) è ora **chiuso**.
4. **DECISIONE CHIUSA (2026-07-23)**: `UNIQUE(owner_id)` su `accounts` — ADOTTATO (mig `20260723000400`, `463678d`). Le server action di `sites` risolvono l'account con `.eq('owner_id', uid).single()` (applicato in T-101).
5. **NOTA doc (non un difetto)**: `06-sites.md` T-101 DoD dice ancora «deriva l'account_id dall'appartenenza (account_members)», mentre il codice usa `owner_id.single()` per l'emendamento ledger 2026-07-23 (comportamento identico in P0 single-owner). Divergenza di sola **prosa**; da riallineare in un futuro tocco del blueprint, senza urgenza.
6. **NOTA doc**: SESSION-STATE e `project-start.md` rimandano a `prompts/session-start.md`, ma il file effettivo è `prompts/project-start.md` (esiste `session-end.md`, non `session-start.md`). Riferimento a file inesistente — da riallineare (rinominare o correggere i puntatori).
7. **Metodo attivo**: dynamic workflow multi-agente (orchestratore costruisce test-first + verifica avversariale multi-lente con refutazione), **oracolo unico giudice** (checkpoint 4/4). Merge su `main` autonomo su verde (override deploy-coupling confermato).
