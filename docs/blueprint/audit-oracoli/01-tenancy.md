# Audit degli oracoli — Superficie 1: TENANCY E APPARTENENZA

> Esecuzione del piano `docs/blueprint/AUDIT-ORACOLI-P0-P1.md` §3, sulla superficie
> T-060 / T-063. Data: 2026-07-29. Branch `trueline/audit/oracoli-p0-p1`.
>
> **Cosa si misura**: non se il codice e corretto (lo e, ed e verde), ma se i test
> saprebbero diventare rossi se smettesse di esserlo.

## 0. Validita della misura (prima di credere a qualunque esito)

| Controllo | Esito |
|---|---|
| Baseline dei 19 file di oracolo in scope | **148 test passati, 0 falliti, 0 skippati** — i test DB-backed hanno davvero girato |
| Stato DB pristino, catturato e hashato | 71 righe, sha256 `876f0e97…` (policy + RLS + vincoli + funzione + GRANT) |
| Banco di mutazione: mutazione NO-OP | `MUTAZIONE-INEFFICACE` — il banco riconosce una mutazione che non cambia nulla |
| Banco di mutazione: mutazione palesemente fatale (RLS disabilitata) | **ROSSO** — il banco sa diventare rosso |
| Ripristino dopo OGNI mutazione | **verificato per hash**, 22 volte su 22, mai dedotto |
| Guardia anti-falso-rosso | il banco dichiara `INVALIDO` se trova rate limit auth o test skippati: un rosso non attribuibile alla mutazione non e una mutazione presa |

## 1. Le mutazioni applicate, tutte, con l'esito reale

Legenda: **ROSSO** = presa da un oracolo · **VERDE** = non presa (buco, salvo sia attesa verde).

### 1a. Mutazioni sui vincoli — oracolo `accounts_schema.test.ts` (catalogo)

| ID | Mutazione applicata | Atteso | Esito |
|---|---|---|---|
| SELFTEST-FATAL | `alter table accounts disable row level security` | ROSSO | **ROSSO** |
| A2 | `CHECK (role in ('owner','editor'))` rimosso | ROSSO | **ROSSO** |
| A3 | FK `account_id`: `ON DELETE CASCADE` → `NO ACTION` | ROSSO | **ROSSO** |
| A4 | `UNIQUE (owner_id)` rimosso | ROSSO | **ROSSO** |
| A7 | `TO authenticated` tolto da `accounts_select_member` | ROSSO | **ROSSO** |
| A6 | FK `user_id → auth.users` rimossa | — | **VERDE** → rilievo T-05 |
| A8 | predicato allargato con `or true` | — | **VERDE** (il catalogo non puo vederlo: vedi A8-RT) |
| A10 | `set search_path` tolto da `is_account_member` | — | **VERDE** → rilievo T-01 |
| A12 | **ATTESA-VERDE** — riscrittura equivalente (disgiunti invertiti) | VERDE | **VERDE** — l'oracolo e forte, non rigido |

### 1b. Mutazioni di escalation — oracolo `tenant_isolation.test.ts` (runtime, JWT reale)

Mutazioni *plausibili*: non `true` (che il controllo statico gia intercetta), ma l'errore
che un umano scriverebbe davvero — **owner scambiato per membro**.

| ID | Mutazione applicata | Atteso | Esito |
|---|---|---|---|
| A8-RT | `accounts_select_member` allargata con `or true` | ROSSO | **ROSSO** (2 test) |
| B1 | INSERT: `with check` da owner-only a `is_account_member(account_id)` | ROSSO | **ROSSO** |
| B2 | UPDATE: `using` da owner-only a `is_account_member(account_id)` | ROSSO | **ROSSO** |

### 1c. Mutazioni contro TUTTI E QUATTRO gli oracoli (21 test)

| ID | Mutazione applicata | Esito |
|---|---|---|
| A6 | FK `user_id → auth.users` rimossa | **VERDE — 21/21** |
| A10 | `set search_path` tolto da `is_account_member` | **VERDE — 21/21** |
| C1 | policy DELETE neutralizzata: `using (account_id is not null)` | **VERDE — 21/21** |
| C2 | INSERT + UPDATE + DELETE tutte a `false` (nessuno puo scrivere) | **VERDE — 21/21** |

### 1d. Mutazioni sui FILE, contro l'oracolo RLS statico del checkpoint

| ID | Mutazione applicata | Atteso | Esito |
|---|---|---|---|
| F1 | `set search_path` tolto dal file | — | **VERDE** (`findings: 0`) → conferma T-01 |
| F2 | predicato di tenancy nascosto dentro la funzione | ROSSO | **ROSSO** — `RLS004` HIGH |
| F3a | `site_generations`: predicato sbagliato (`site_id` invece di `account_id`) | ROSSO | **ROSSO** — `RLS004` HIGH |
| F3b | `generation_pools`: **identica** mutazione | ROSSO | **VERDE** → rilievo T-04 |

### 1e. Sparizione dell'oracolo (fragilita dell'harness)

| ID | Configurazione | Esito |
|---|---|---|
| D1 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` vuota | 2 file **ROSSI** — fallimento rumoroso, modo di fallire sicuro |
| D2 | le 4 variabili assenti, solo i 4 file di tenancy | **exit 0 · 21 skippati · 0 falliti** |
| CI-SIM | le 4 variabili assenti, suite intera (simulazione CI) | exit 1 · **139 skippati** su 593 · 2 falliti |

**Nessuna mutazione e stata saltata**: 22 applicate, 22 con esito registrato, 22 ripristini
verificati per hash. Una mutazione non applicata non prova nulla e non compare qui.

## 2. Rilievi

Ogni rilievo distingue **oracolo debole** (la regressione non verrebbe presa) da **difetto
attivo** (il codice e sbagliato ora). In questa superficie **non c'e nessun difetto attivo**.

### T-01 — HIGH · oracolo debole · `is_account_member` SECURITY DEFINER senza oracolo
Togliere `set search_path = public, pg_temp` lascia verdi **21 test su 21** (A10) **e**
l'oracolo RLS statico (F1, `findings: 0`). La funzione regge le policy di lettura di
`accounts`, `account_members`, `sites`, `site_briefs`, `site_generations` e
`generation_pools`: e la superficie piu condivisa del progetto, ed e l'unica proprieta
dell'hardening dichiarata nel commento (righe 33-38, "prevengono hijack/injection R8/R9")
che nessuno protegge.
**Il pattern di fix esiste gia nel repo**: `tests/auto_provision_secdef.test.ts` asserisce
`prosecdef` e `proconfig` per `handle_new_user`. E un'asimmetria fra due funzioni
SECURITY DEFINER dello stesso progetto, non un pattern da inventare.

### T-02 — HIGH · oracolo debole · la policy DELETE non ha alcun oracolo
`account_members_delete_owner` puo essere neutralizzata in `using (account_id is not null)`
con 21 test su 21 verdi (C1). Nessun file di test esegue mai un `.delete()` su
`account_members`. Proprieta scoperta: solo l'owner rimuove una membership — cioe nessun
de-provisioning dell'owner da parte di un editor, nessuna cancellazione cross-tenant.

### T-03 — HIGH · oracolo debole · nessun percorso POSITIVO sulle scritture
Con INSERT, UPDATE e DELETE tutte a `false` — *nessuno* puo scrivere — i 21 test restano
verdi (C2). Gli oracoli provano solo il negativo ("l'editor non puo") e mai il positivo
("l'owner puo"): **non sanno distinguere `owner-only` da `nessuno`**. Due conseguenze: una
regressione di disponibilita e invisibile, e le asserzioni negative valgono meno di quanto
sembrino, perche passerebbero anche se il meccanismo fosse "nega tutto".

### T-04 — HIGH · oracolo debole · l'oracolo RLS statico e CIECO su `generation_pools`
Esperimento differenziale, stessa mutazione su due tabelle dello **stesso file**:
`site_generations` (CREATE TABLE parsato) → `RLS004` HIGH; `generation_pools` (CREATE TABLE
**non** parsato) → `findings: 0`.
**Causa misurata** con un probe diretto sul parser: `pgsql-ast-parser@12.0.2` non supporta
`unique nulls not distinct (...)` (riga 118), sintassi PG15+ che qui e deliberata e
portante. Senza il `CREATE TABLE`, l'oracolo non conosce le colonne e la sua euristica
multi-tenant non puo classificare la tabella.
**Portata oltre la superficie in scope**: il `rls:0` del checkpoint di P2 (2026-07-28)
significa "nessun rilievo prodotto", non "la tabella e stata auditata". Lo stesso meccanismo
colpisce `profiles`, dove la causa e diversa e piu banale: `references auth.users` **senza
lista colonne** (con `(id)` il parser passa — misurato).
I `parse_warnings` sono presenti nell'output ma **non sono fatali**: qualunque tabella futura
con un costrutto non supportato esce dall'audit RLS in silenzio.

### T-05 — MEDIUM · oracolo debole · le FK verso `auth.users` non sono asserite
La query di `accounts_schema.test.ts` filtra `confrelid = 'public.accounts'::regclass`:
vede solo la FK verso `accounts`. `account_members.user_id → auth.users` e fuori dal filtro
(A6: VERDE su 21/21) e `accounts.owner_id → auth.users` non e coperta da alcun test.
Proprieta scoperta: alla cancellazione dell'utente account e membership spariscono (cascata,
quindi retention e assenza di righe orfane).

### T-06 — MEDIUM · oracolo debole · i GRANT non sono asseriti
Nessun test della superficie interroga `information_schema.role_table_grants`. Fatto
misurato nello stato pristino: **`anon` possiede `REFERENCES`, `TRIGGER` e `TRUNCATE`** su
`accounts` e `account_members`, mentre il commento della migrazione (riga 141) dichiara
"Nessun GRANT ad anon". Non e sfruttabile via PostgREST (che non espone quelle operazioni,
e nessuna policy e `TO anon`), quindi **non e un difetto attivo**: e una difesa in profondita
che si degraderebbe in silenzio. Anche qui il pattern di fix esiste gia in P2:
`site-generations-schema.test.ts` asserisce `privsOf(table,'anon') === []`.

### T-07 — MEDIUM · fragilita di harness · 139 test su 593 non girano senza database
**Misurato**: con le 4 variabili assenti — la configurazione esatta di `.github/workflows/ci.yml`,
che non provisiona Supabase — la suite skippa **139 test in 20 file**, cioe l'intera superficie
di sicurezza. Nessun oracolo asserisce che i test DB-backed abbiano girato: `supabase-local.test.ts`
e a sua volta `skipIf(!DB)` e `ci-harness.test.ts` verifica solo che CI *invochi* `npm test`.
**Precisazione onesta, contro la mia stessa ipotesi iniziale**: in quella configurazione la
suite **non** e silenziosamente verde — esce 1 perche `auth-callback.test.ts` fallisce
(`ssrEnv` lancia su env mancante). Ma quel rosso e **accidentale**: nasce da un test non
progettato per questo, su un'altra superficie. Sui soli 4 file di tenancy (D2) l'esito e
`exit 0` con 21 test skippati — verde pieno con la superficie assente.
*Non verificato*: se la CI su GitHub sia rossa oggi. `gh` non e installato su questa macchina,
quindi lo storico delle run non e stato letto e non lo affermo.

## 3. Cosa e stato CONFERMATO come solido (il rovescio del referto)

- **Vincoli**: `CHECK` su role, `ON DELETE CASCADE`, `UNIQUE(owner_id)`, `TO authenticated`,
  RLS abilitata — 5 mutazioni su 5 prese dal catalogo.
- **Escalation intra-tenant**: le 3 mutazioni *plausibili* (owner scambiato per membro) prese
  tutte, dai test sull'editor, con i guardrail service_role che rendono il verde attribuibile
  alla RLS e non all'assenza di dati.
- **La difesa a strati funziona come progettata**: F2 (predicato nascosto nella funzione) e
  **equivalente a runtime** — nessun test poteva prenderla — ed e stata presa dall'oracolo
  RLS statico. Il commento alle righe 60-66 della migrazione, che dichiara di tenere
  `auth.uid() = owner_id` nel testo della policy per l'auditabilita statica, **non e
  decorazione: e portante, e c'e un oracolo che lo tiene**.
- **L'oracolo non e rigido**: A12, riscrittura equivalente, resta verde.

## 4. Metodo, per riproducibilita

- Verifier avversariali: 2 agenti con lenti distinte (SQL/RLS/catalogo · costruzione del
  test), in sola lettura, `agents_error: 0` verificato prima del valore di ritorno.
  25 rilievi proposti, 30 mutazioni proposte; **l'orchestratore ha applicato ed eseguito**,
  gli agenti non hanno mai emesso un verdetto.
- Mutazioni DB via `psql` con inverso esplicito e ripristino verificato sullo snapshot hashato;
  mutazioni su file con ripristino `git checkout` e verifica `sha256` contro il valore pristino.
- Nessun verdetto dedotto da un exit code: sempre letto il sommario. (Il primo tentativo di
  snapshot e fallito con `EXIT=0` e un `ERROR` dentro il file: catturato solo leggendolo.)
