# Rilievo trasversale — Quanto vale davvero `rls:0`

> Estensione decisa dall'utente il 2026-07-29 dopo il rilievo T-04 della superficie 1.
> Ampiezza: **tutte** le tabelle con RLS del progetto, non le due gia note.
> Riguarda P0, P1 **e P2**, cioe anche un macrotask chiuso verde il 2026-07-28.

## 1. La domanda

Il checkpoint riporta `rls:0`. Significa "nessuna tabella ha un difetto di isolamento",
oppure "nessun rilievo e stato prodotto"? Sono due frasi diverse, e la seconda e compatibile
con un oracolo che non ha guardato.

## 2. Il metodo: prova differenziale, tabella per tabella

Per ciascuna delle 7 tabelle con RLS, il predicato della policy SELECT e stato sostituito con
`created_at is not null` — un predicato che **non nomina** `auth.uid()` ne una colonna di
tenancy, quindi `RLS004_MISSING_TENANT_PREDICATE` **deve** protestare. Se tace, quella tabella
non e auditata.

Ogni mutazione verificata per differenza prima di essere creduta; ogni ripristino verificato
per sha256; repo pulito a fine batteria.

## 3. L'esito, misurato

| Tabella | Il suo `CREATE TABLE` parsa? | Colonna di tenancy | `RLS004` sulla mutazione | Auditata? |
|---|---|---|---|---|
| `accounts` | si | `owner_id` | **PROTESTA** | si |
| `account_members` | si | `account_id`, `user_id` | **PROTESTA** | si |
| `sites` | si | `account_id` | **PROTESTA** | si |
| `site_briefs` | si | `account_id` | **PROTESTA** | si |
| `site_generations` | si | `account_id` | **PROTESTA** | si |
| `profiles` | **no** | *nessuna* (la chiave e la PK `id`) | **SILENZIO** | **NO** |
| `generation_pools` | **no** | `account_id` | **SILENZIO** | **NO** |

**5 tabelle su 7 sono davvero auditate. Due no — e per due ragioni diverse.**

## 4. Le due cause sono distinte, e solo una e un difetto dello strumento

### `generation_pools` — cecita vera, causata dal parse failure
Ha `account_id`, quindi sarebbe classificata multi-tenant e `RLS004` la coprirebbe. Ma il suo
`CREATE TABLE` non parsa, l'oracolo non ne conosce le colonne, e l'euristica non puo girare.

- **Causa esatta**, isolata con un probe diretto sul parser: `pgsql-ast-parser@12.0.2` non
  supporta `unique nulls not distinct (...)` (riga 118), sintassi PG15+ qui **deliberata e
  portante** (senza `NULLS NOT DISTINCT` il pool condiviso potrebbe essere scritto due volte).
- **Rimedio misurato**: spostare quel vincolo dal `CREATE TABLE` a un `alter table ... add
  constraint` separato. Semantica identica. Dopo il rimedio, la stessa mutazione che prima dava
  `findings: 0` produce **`RLS004` HIGH**. Verificato, non ipotizzato.
- **Conseguenza da dichiarare**: il `rls:0` del checkpoint di `generation-model` (2026-07-28)
  **non ha auditato `generation_pools`**. La tabella non e per questo insicura — le sue policy
  sono scritte con `account_id` esplicito e sono state provate a runtime dai test di T-200 —
  ma il controllo statico non ha contribuito a quel verde.

### `profiles` — fuori dall'euristica per progetto, non per guasto
`TENANT_COLUMNS` dell'oracolo e un elenco dichiarato: `tenant_id, org_id, organization_id,
account_id, workspace_id, company_id, customer_id, user_id, owner_id`. Le colonne di `profiles`
sono `id, display_name, locale, created_at`: **nessuna** vi compare, perche l'isolamento e
per IDENTITA e la chiave e la primary key. `isMultiTenant` risulta falso e `RLS004` non viene
mai valutata.

- **Verificato**: applicando comunque il rimedio del parser (`references auth.users (id)`, che
  fa sparire il `parse_warning` — misurato), `RLS004` resta a `findings: 0`. Quindi **il parse
  failure non e la causa** della non copertura di `profiles`. Avevo formulato l'ipotesi
  sbagliata e la misura l'ha smentita.
- Restano due gap indipendenti su questa tabella: (a) l'euristica non copre le tabelle
  identity-scoped; (b) il suo `CREATE TABLE` non parsa comunque, il che diventerebbe rilevante
  il giorno in cui `profiles` acquisisse una colonna di tenancy.

## 5. Il difetto di forma che li rende entrambi invisibili

I `parse_warnings` sono **presenti nell'output e non fatali**. Il checkpoint riporta `rls:0`
senza che nessuno guardi quel campo. Qualunque tabella futura che usi un costrutto non
supportato dal parser esce dall'audit RLS **in silenzio**, e il verde resta identico.
E il modo di fallire piu insidioso: non un rosso da capire, ma un verde che vale meno di
quanto sembri.

## 6. Rilievi

| id | severita | tipo | rilievo |
|---|---|---|---|
| **R-01** | HIGH | oracolo debole | `generation_pools` non e auditata da `RLS004`; rimedio DDL misurato e a semantica invariata |
| **R-02** | MEDIUM | copertura dichiarata | `RLS004` non copre le tabelle identity-scoped (chiave = PK). `profiles` e fuori copertura **per progetto dell'euristica**, non per guasto |
| **R-03** | HIGH | fragilita di strumento | un `parse_warning` non e fatale: una tabella puo uscire dall'audit RLS senza che il verde cambi. Nessun controllo del checkpoint legge quel campo |

Nessuno dei tre e un **difetto attivo**: nessuna policy e sbagliata. Sono tre modi in cui una
regressione futura non verrebbe vista.
