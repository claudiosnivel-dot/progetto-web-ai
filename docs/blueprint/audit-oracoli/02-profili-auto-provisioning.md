# Audit degli oracoli — Superficie 2: PROFILI E AUTO-PROVISIONING (T-061 / T-062)

> Piano `AUDIT-ORACOLI-P0-P1.md` §3. Data: 2026-07-29. Branch `trueline/audit/oracoli-p0-p1`.
> Baseline: **6 file, 21 test, 0 falliti, 0 skippati**.
> **16 mutazioni applicate, 16 esiti registrati, 16 ripristini verificati per hash.**

## 0. Il banco ha dovuto essere riparato tre volte — e conta

Prima di qualunque rilievo, va detto come il banco e diventato affidabile, perche e la stessa
disciplina che l'audit chiede al codice.

Il ripristino della funzione `handle_new_user` e fallito la prima volta. **Causa reale,
isolata per misura**: Python su Windows decodifica l'output di `psql` in **cp1252**, e il body
della funzione contiene **9 byte non-ASCII** (em-dash nei commenti). Il "ripristino" riscriveva
una funzione con i commenti in mojibake (`â€"`): SQL valido, semantica intatta, **1044 byte
invece di 1059**.

Due ipotesi intermedie sono state **smentite dalla misura** e vanno registrate come tali:
1. *"E il CRLF"* — falso: nel body non c'e alcun `\r`.
2. *"Il round-trip via stdin e byte-identico, quindi il problema e altrove"* — l'esperimento
   era **viziato**: girava sulla funzione GIA corrotta, quindi confrontava una copia con se
   stessa. Solo il `db reset` ha rimesso a fuoco il confronto.

Il difetto e stato preso **solo perche il ripristino era verificato per hash invece che
dichiarato**. Un banco che avesse detto "ripristinato" sulla fiducia avrebbe misurato tutte
le mutazioni successive contro una funzione corrotta.

**Autotest permanente aggiunto al banco**: prima di ogni sessione verifica che il round-trip
sia byte-identico e che lo snapshot torni al pristino; se no, si ferma.

**Controverifica indipendente**: dopo il `db reset` (che ricostruisce dalle migrazioni), lo
snapshot della superficie 1 torna a `876f0e97...`, **lo stesso valore** usato per tutte le sue
22 mutazioni. Prova che quei ripristini erano genuini.

## 1. Le mutazioni applicate, tutte, con l'esito reale

### 1a. Prese dagli oracoli (10)

| ID | Mutazione | Esito | Chi l'ha presa |
|---|---|---|---|
| P07 | `set search_path` **tolto** da `handle_new_user` | **ROSSO** | `auto_provision_secdef` — *controllo positivo riuscito* |
| P09 | trigger `on_auth_user_created` **droppato** | **ROSSO** (13 test) | tutta la superficie |
| P10 | trigger `AFTER` → `BEFORE` insert | **ROSSO** | 4 file: la creazione utente fallisce (FK non ancora soddisfatta). *Si manifesta come errore in `beforeAll`, non come asserzione fallita* |
| P11 | il profilo nasce con `locale='es'` invece di `'it'` | **ROSSO** (3 test) | `auto_provision` |
| P12 | la membership nasce `'editor'` invece di `'owner'` | **ROSSO** | `auto_provision` |
| P13 | l'auto-provision **riusa l'account di uno sconosciuto** (`where true`) | **ROSSO** | `auto_provision` |
| P16 | `ON CONFLICT` rimossi: idempotenza persa | **ROSSO** | `auto_provision` |
| PR1 | `profiles_select_own` allargata a `id is not null` | **ROSSO** (3 test) | `profiles_rls` + `profiles_schema` |
| PR2 | **nessuno** puo scrivere il proprio profilo (policy a `false`) | **ROSSO** | `profiles-locale-rls` |
| PR3 | `CHECK` sui locale rimosso | **ROSSO** | `profiles_schema` |

### 1b. NON prese — buchi d'oracolo (4)

| ID | Mutazione | Esito |
|---|---|---|
| PR4 | `locale` reso **nullable** | **VERDE 21/21** |
| PD1 | **aggiunta** una policy DELETE permissiva su `profiles` | **VERDE 21/21** |
| PD2 | trigger con `when (new.email is not null)` | **VERDE 21/21** |
| PD4 | `search_path = pg_temp, public` (ordine **hijackabile**) | **VERDE 21/21** |

### 1c. Prove di equivalenza (2)

| ID | Mutazione | Atteso | Esito |
|---|---|---|---|
| PR5 | uguaglianza invertita nella policy (`id = auth.uid()`) | VERDE | **VERDE** — l'oracolo delle policy e forte, non rigido |
| PD3 | idempotenza riscritta **equivalente** (`on conflict on constraint profiles_pkey`) | VERDE | **ROSSO** — l'oracolo dell'idempotenza e **rigido** |

## 2. Rilievi

Nessun **difetto attivo**: nessuna policy, nessun vincolo e nessun trigger e sbagliato oggi.

### S2-01 — HIGH · `profiles` ha `GRANT DELETE` ma nessuna policy DELETE, e nessun oracolo copre il comando
Aggiungere `create policy profiles_delete_any ... using (id is not null)` lascia **21 test su
21 verdi** (PD1). Oggi la proprieta "nessuno cancella righe profilo" regge **solo** perche la
policy non esiste: il GRANT c'e gia. `profiles_schema.test.ts` interroga `byCmd` solo per
`SELECT`/`INSERT`/`UPDATE`, e nessun test del repo esegue un `.delete()` su `profiles`.
**E lo stesso identico schema del rilievo T-02 della superficie 1** (la policy DELETE di
`account_members`): non e un caso isolato, e un pattern.

### S2-02 — HIGH · il TRIGGER non e asserito da nessun catalogo
Un `when (new.email is not null)` lascia tutto verde (PD2), perche **ogni utente di test ha
un'email**. Restringerebbe il provisioning a un sottoinsieme: un signup anonimo o via telefono
(che `auth.users` ammette con email NULL) resterebbe **senza account, senza membership e senza
profilo** — cioe fuori dal modello di tenancy. In `tests/` non compare alcuna query a
`pg_trigger` / `information_schema.triggers`. La forma del trigger e scritta nella DoD del
blueprint, ma resta una frase non verificata.
*Nota*: l'esistenza del trigger e coperta indirettamente (P09, droppato → 13 test rossi).
Scoperti sono **timing, livello e condizione**.

### S2-03 — HIGH · l'oracolo su `search_path` verifica la PRESENZA, non il VALORE
`set search_path = pg_temp, public` — l'ordine **hijackabile**, con lo schema temporaneo
davanti — lascia 21 test su 21 verdi (PD4). Il security_note della migrazione (righe 9-11)
dichiara "search_path FISSO (public, pg_temp) per impedire hijack": e il *valore* la difesa,
non la sua esistenza.
**Distinzione col rilievo T-01 della superficie 1**: qui una copertura c'e (P07, rimozione
totale → ROSSO); e superficiale, non assente. Su `is_account_member` non c'e affatto.

### S2-04 — MEDIUM · il `NOT NULL` su `locale`, dichiarato PORTANTE, non e asserito
`alter column locale drop not null` lascia 21 test su 21 verdi (PR4). Il commento della
migrazione (righe 12-14) spiega che senza `NOT NULL` il CHECK e aggirabile — `NULL IN
('it','es')` vale NULL, che **soddisfa** il CHECK — quindi un client potrebbe scrivere
`locale = NULL` sulla propria riga (ha GRANT UPDATE e policy UPDATE sulla propria riga).
`profiles` e **l'unica tabella del progetto** la cui nullabilita non e mai controllata:
`accounts_schema`, `sites-schema`, `site-briefs-schema` e `site-generations-schema`
selezionano tutte `is_nullable` e lo asseriscono. Proprio quella il cui commento spiega
perche serve.

### S2-05 — MEDIUM · l'oracolo dell'idempotenza e un grep testuale RIGIDO
`auto_provision.test.ts` normalizza il sorgente della funzione e cerca tre sottostringhe.
Misurato (PD3): una riscrittura **equivalente e legittima** (`on conflict on constraint
profiles_pkey do nothing`) lo fa diventare **ROSSO**. E rigido nei confronti del refactoring.
Simmetricamente — e questo il lato pericoloso — una stringa che comparisse dentro un
**commento** del corpo lo soddisferebbe, perche `pg_get_functiondef` restituisce `prosrc`
verbatim, commenti inclusi: si puo togliere la clausola vera e lasciarne una commentata.
Il test stesso dichiara il limite (un trigger `AFTER INSERT` non e ri-eseguibile dai test),
quindi la fessura e **nota**; ma il rimedio scelto e un grep, e un grep non prova un
comportamento.

## 3. Cosa e CONFERMATO solido

- **L'auto-provisioning e ben oracolato nel merito**: le mutazioni piu gravi — riusare
  l'account di uno sconosciuto (P13), nascere `editor` invece di `owner` (P12), locale
  sbagliato (P11), idempotenza persa (P16), trigger assente (P09) o al timing sbagliato
  (P10) — sono state **prese tutte**. I test asseriscono l'IDENTITA della riga creata
  ("esattamente 1 account con `owner_id` = nuovo utente"), non la sua semplice esistenza.
- **Il percorso POSITIVO esiste**, a differenza della superficie 1: `PR2` e stata presa perche
  c'e un test in cui l'utente **aggiorna davvero** la propria preferenza e la modifica risulta
  scritta. E il pattern da portare su `account_members` (rilievo T-03).
- **L'oracolo delle policy non e rigido** (PR5 verde su riscrittura equivalente).
- **La copertura SECURITY DEFINER esiste** (P07 rosso) — va approfondita, non creata.

## 4. Schemi che si ripetono fra le superfici (utili alla fase di fix)

| Schema | Superficie 1 | Superficie 2 |
|---|---|---|
| Il comando **DELETE** non ha oracolo | T-02 (`account_members`) | S2-01 (`profiles`) |
| `search_path` di una funzione SECURITY DEFINER | T-01: copertura **assente** | S2-03: copertura **superficiale** |
| Percorso **positivo** assente | T-03: si | no — qui c'e |
| Nullabilita / vincoli non asseriti | T-05 (FK) | S2-04 (`NOT NULL`) |

Il fix dovra essere **un pattern unico applicato a piu punti**, non cinque correzioni scollegate.
