# SESSION-STATE — Belora · P0 (Fondamenta)

> Fonte di verità sullo **stato vivo** del sotto-progetto P0. Letta da BUILD a ogni
> apertura e aggiornata a ogni chiusura (`prompts/session-end.md`). Distinta dalla
> SESSION-STATE della skill trueline.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (JS/TS + Supabase) |
| **Ultimo aggiornamento** | 2026-07-23 (chiusura sessione build-P0-tenancy) |
| **Sessione corrente** | build-P0-tenancy — **CHIUSA** (riprendere con `prompts/session-start.md`) |

---

## 1. Stato dei macrotask

> Stati: `todo` | `in_progress` | `done`. Ordine = piano di build (00-INDEX §2).

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| infra | **done** | **VERDE 4/4** | T-001..T-006 |
| design-system | **done** | **VERDE 4/4** | T-020..T-022; `7fd35fd` |
| i18n | **done** (parziale) | **VERDE 4/4** | T-080..T-082; `a679b6c`. **T-083 rinviato** (ora sbloccato, vedi §7) |
| auth | **done** | **VERDE 4/4** | T-040..T-044; `d4fe1a8` (+ hardening `33ab0e0`) |
| tenancy | **done** | **VERDE 4/4** | T-060..T-063; `dd1e905` |
| sites | todo | — | Dipende da tenancy ✅, design-system ✅, i18n ✅, auth ✅ → **prossimo eseguibile** |

## 2. Macrotask corrente

- **Ultimo chiuso**: `tenancy` (T-060..T-063, checkpoint verde 4/4, `dd1e905`). **Prossimo eseguibile**: **`sites`** (tutte le dipendenze verdi).
- **Criteri/test di riferimento**: `06-sites.md`, task T-100 (schema sites + RLS + UNIQUE(account_id,slug)) → T-104 (utility slug unico) → T-101 (server actions create/list) → T-102 (scheletro dashboard) → T-103/T-105 (rinomina/elimina + UI). Richiede migrazioni Supabase + test RLS a runtime via client autenticato (stesso pattern di tenancy).
- **NB carry-over i18n**: **T-083** (persistenza `profiles.locale`) è ora sbloccato (dipende da T-061 ✅ + T-041 ✅) → da costruire come breve revisita i18n, prima o insieme a `sites`.

## 3. Stato git

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/tenancy` (pushato; mergeto su main; non cancellato) |
| Ultimo commit | `dd1e905` su `main` (HEAD) — working tree pulito, `origin/main` allineato |
| Stato merge su `main` | **MERGED** (tenancy ff `8dae25c..dd1e905`) — checkpoint verde + non deploy-coupled |
| Deploy-coupling | `main_deploy_coupled: **false**` (confermato 2026-07-23) → **merge su main autonomi** su verde |

## 4. Baseline & budget

- **Baseline di sicurezza**: checkpoint `tenancy` verde con baseline vuota (0 finding nuovi ≥ HIGH). Controllo 2: `gitleaks 0 · osv 0 · semgrep 0 · rls 0`.
- **Budget**: tenancy via dynamic workflow (9 agenti: 4 builder + 4 verifier avversariali + 1 integration), ~545k token subagente + fix human-gated applicati dall'orchestratore. Nessun fallimento di sessione.

## 5. Esiti dell'ultima sessione (framing onesto)

- Macrotask `tenancy` (T-060..T-063) costruito **test-first** via **dynamic workflow multi-agente** (builder in ordine DAG → verifier avversariali DIVERSI per task + 1 integration → orchestratore/oracolo). Verdetto: **17 rilievi** (0 HIGH, 4 MEDIUM, 13 LOW).
- **Schema**: `accounts` + `account_members` (+ `is_account_member()` SECURITY DEFINER contro la ricorsione di policy) + `profiles`; RLS ancorata all'appartenenza; scritture `account_members` **owner-only** (blocca escalation editor→owner). Auto-provision `handle_new_user()` SECURITY DEFINER (search_path fisso, solo `NEW.id`) + trigger AFTER INSERT su `auth.users`, idempotente. Isolamento tenant provato a **runtime** attraverso client con auth reale + guardrail service_role-vs-authenticated.
- **Fix human-gated dai rilievi (pre-checkpoint)**: (a) AC-062-5 rilegato alla **funzione reale** (`pg_get_functiondef` + negative-PK check) — prima riesumava copie inline self-fulfilling; (b) guardrail service_role su AC-063-2; (c) `profiles.locale` **NOT NULL** (chiude il gap NULL del CHECK); (d) gate `SB` include `ANON_KEY`.
- **2 root-cause colti dall'ORACOLO (non dallo static review)**:
  1. **GRANT mancanti (42501)**: `config.toml` non attiva `auto_expose_new_tables` → le nuove tabelle in `public` NON sono raggiungibili da `authenticated`/`service_role` senza GRANT espliciti. Fix: GRANT DML espliciti nelle migrazioni (RLS = gate fine, GRANT = gate coarse) + `grant execute` su `is_account_member` (RPC + policy eval). I builder avevano assunto i default-privilege legacy.
  2. **`accounts_schema.test.ts` array parsing**: node-postgres non parsa `name[]` (OID 1003) → `'{...}'` come stringa. Fix: cast `::text[]` (come già faceva `profiles_schema`).
- **1 RILIEVO HIGH del checkpoint (RLS)**: `RLS004_MISSING_TENANT_PREDICATE` su `accounts_select_member` — lo static oracle non vede `auth.uid()` (nascosto in `is_account_member(id)`) né una colonna di tenancy nell'arg `id`. **Fix**: predicato di tenancy ESPLICITO `((select auth.uid()) = owner_id OR is_account_member(id))` — semantica invariata (owner ⊆ member), ma isolamento auditabile staticamente. **Lezione**: predicati d'isolamento nascosti in funzioni DEFINER → esplicitarli nel testo della policy accanto alla funzione.
- **Checkpoint VERDE 4/4**; provenienza AC ok (`ac_assertion_trace_check`, `untracked:[]`).

## 6. Note operative (checkpoint & Supabase)

- **Checkpoint con test runtime Supabase**: `set -a; source .env.local; set +a` per esportare le 4 env via shell (così i controlli 3/4 `npm test` fanno girare i test runtime); **spostare `.env.local` FUORI dal repo** (scratchpad, NON rinominare in `.env.local.hidden` che non è gitignored) + `rm -rf .next`, così gitleaks (controllo 2) resta pulito; ripristinare `.env.local` a fine (trap EXIT). Invocazione: `node <trueline>/scripts/checkpoint/run_checkpoint.mjs "<repo>" --in-place --mode build` (SENZA `--blueprint`).
- **Provenienza AC separata**: `node <trueline>/scripts/blueprint/ac_assertion_trace_check.mjs docs/blueprint/P0-foundations . ` (exit 0 = ogni AC valutato è tracciato da un tag `covers:`).
- **`--blueprint` NON usarlo**: il manifest `supabase-jsts` ha `run_file="node --test {file}"`, incompatibile coi test vitest+jsdom → falso rosso.
- **Supabase locale**: `supabase start` (docker, DB `127.0.0.1:54622`). `supabase db reset` applica le migrazioni + **riavvia i container** (azzera anche il contatore rate-limit in-memory di GoTrue). CLI v2.106 (chiavi legacy anon/service_role in `.env.local` restano valide; mostra anche le nuove `sb_publishable`/`sb_secret`).
- **Rate limit auth** (`sign_in_sign_ups=30`/5min per IP): `createTestUser` usa l'admin API (esente); solo `signInAs` conta. La suite fa ~16 sign-in: eseguire **una volta per finestra** (nessun retry entro 5 min); un `db reset` prima del run azzera il contatore.
- **DEPLOY-CHECKLIST (hardening prod, fuori P0 locale)**:
  - **GRANT/auto_expose**: in prod verificare che le tabelle abbiano i GRANT attesi (auto_expose off è il default cloud); il pattern è replicato nelle migrazioni.
  - **`revoke execute` su `handle_new_user()` da PUBLIC**: hardening opzionale (trigger function non invocabile direttamente; non necessario per l'isolamento).
  - Voci auth pre-esistenti: `skip_nonce_check=true` su Google (solo dev); `redirectTo` OAuth da header host; refresh cookie sessione in RSC/route handler (non nel middleware).

## 7. Prossimi passi & tracker task rinviati / decisioni aperte

1. **Sessione CHIUSA.** Riprendere con `prompts/session-start.md`.
2. **Prossimo macrotask BUILD: `sites`** — branch `trueline/build/sites`; T-100 (sites + RLS + UNIQUE(account_id,slug)) → T-104 (slug unico) → T-101 (server actions) → T-102 (dashboard) → T-103/T-105. Stesso pattern tenancy (migrazioni + test RLS runtime via client autenticato).
3. **TRACKER TASK RINVIATI**:
   - **T-083** (i18n — persistenza `profiles.locale`): **SBLOCCATO** (T-061 ✅ + T-041 ✅). Oggi la lingua persiste solo via cookie `NEXT_LOCALE`; ora `profiles.locale` (NOT NULL, IT/ES) esiste. Costruire come breve revisita i18n prima o insieme a `sites`.
4. **DECISIONE APERTA (non presa, richiede emendamento al ledger 00-INDEX §3 se adottata)**:
   - **`UNIQUE(owner_id)` su `accounts`**: raccomandato dai verifier (renderebbe l'idempotenza di auto-provision provabile per costruzione e i lookup `.single()` sull'account per-owner provabilmente sicuri, e permetterebbe `on conflict(owner_id) do nothing` conforme al DoD letterale). **NON aggiunto**: è una decisione di modello dati ("un utente possiede al più un account, per sempre") oltre il DoD di T-060 → serve un emendamento esplicito al ledger. Oggi l'idempotenza regge via guardia applicativa `EXISTS(owner_id)` nella funzione (provata dai test) e auto-provision crea esattamente 1 account/utente.
5. **Metodo attivo**: dynamic workflow multi-agente (builder → verifier diversi → fixer diversi + orchestratore), **oracolo unico giudice**. Merge su `main` autonomo su verde.
