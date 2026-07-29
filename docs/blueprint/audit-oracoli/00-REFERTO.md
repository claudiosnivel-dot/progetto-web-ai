# REFERTO — Audit degli oracoli delle superfici di sicurezza di P0 e P1

> Esecuzione completa del piano `docs/blueprint/AUDIT-ORACOLI-P0-P1.md`.
> Data: **2026-07-29**. Branch `trueline/audit/oracoli-p0-p1`.
> Ledger per superficie: `01-tenancy.md` · `02-profili-auto-provisioning.md` ·
> `03-auth-e-sessione.md` · `04-05-siti-e-brief.md` · `06-import-ssrf.md` ·
> `00-copertura-oracolo-rls.md` (trasversale).

## 1. La cosa più importante, in una riga

**Non è stato trovato nessun difetto attivo.** In 72 mutazioni su sei superfici, nessuna ha
rivelato una policy sbagliata, un vincolo mancante o una guardia difettosa **oggi**. Tutti i
19 rilievi sono **oracoli deboli**: modi in cui una regressione *futura* non verrebbe vista.

La distinzione va tenuta ferma leggendo il resto: il codice di P0 e P1 è corretto. Ciò che
non è affidabile è la rete che dovrebbe accorgersi se smettesse di esserlo.

## 2. Numeri

| | |
|---|---|
| Mutazioni **applicate** ed eseguite | **72** |
| Prese da un oracolo | **43** |
| **Non** prese (buchi) | **19** |
| Prove di equivalenza (attese verdi) | **9**, di cui 8 verdi e **1 rossa** (oracolo rigido) |
| Ripristini verificati (hash o sha256) | **72 su 72** |
| Mutazioni **rifatte** invece che registrate | 5 (non applicate: CRLF, stringa non trovata) |
| Difetti attivi | **0** |
| Superfici senza alcun rilievo | **1 su 6** (import/SSRF) |

## 3. Classifica delle superfici, per fatti

| # | Superficie | Mutazioni | Buchi | Giudizio |
|---|---|---|---|---|
| 6 | Import da URL (SSRF) | 9 | **0** | **esemplare** |
| 4-5 | Siti e brief | 10 | 2 | solida |
| 2 | Profili e auto-provisioning | 16 | 4 | buona |
| 1 | Tenancy e appartenenza | 22 | 4 | media |
| 3 | **Auth e sessione** | 15 | **8** | **la peggiore** |

Che la superficie peggiore sia **auth** è il fatto più scomodo del referto: è l'unica dove
**non c'è la RLS come seconda linea**. Sulle altre, una guardia applicativa che cade trova
ancora il database a dire di no. Lì no.

## 4. I quattro schemi che si ripetono

I 19 rilievi non sono 19 problemi: sono **quattro schemi** che ricorrono su superfici diverse.
È questo che rende la fase di fix un lavoro di pattern e non una lista della spesa.

### Schema A — «Il comando che nessuno esercita» (5 occorrenze)
La policy **DELETE** è neutralizzabile senza che nulla protesti su **`account_members`**,
**`profiles`**, **`sites`** e **`site_briefs`**. Nessun test dell'intero repo esegue un
`.delete()` come utente non autorizzato: l'unico `.delete()` che esiste è su `accounts`.

*Causa isolata su sites*: un test c'è, ma asserisce che l'espressione della policy **contenga
la sottostringa** `account_id` — e `account_id is not null`, che è completamente permissivo,
la contiene.

### Schema B — «Presenza invece di valore» (4 occorrenze)
- `search_path` di `handle_new_user`: si verifica che **ci sia**, non **quale sia**
  (`pg_temp, public`, l'ordine hijackabile, resta verde).
- `search_path` di `is_account_member`: non si verifica affatto.
- La regola ESLint del confine `service_role`: si cercano due **stringhe** nel file di config;
  metterla a `'off'` non fa protestare nulla.
- L'idempotenza dell'auto-provision: **grep testuale** sul sorgente della funzione.

### Schema C — «Solo il negativo, mai il positivo» (2 occorrenze)
Su `account_members`, mettere **tutte** le policy di scrittura a `false` — cioè *nessuno* può
scrivere — lascia 21 test su 21 verdi. Gli oracoli provano che l'attaccante non può, mai che
il legittimo può. Conseguenza doppia: una regressione di disponibilità è invisibile, **e** le
asserzioni negative valgono meno di quanto sembri, perché passerebbero anche se il meccanismo
fosse «nega tutto».
*Dove invece il percorso positivo c'è* — profili, siti, brief — la stessa mutazione è stata
presa immediatamente. È la prova che il rimedio funziona.

### Schema D — «Il caso nominale invece della proprietà» (8 occorrenze, tutte su auth)
Il test asserisce l'esito previsto e non la proprietà che rende quell'esito sicuro:
- si asserisce **che** si venga rediretti al login, non **dove** (open redirect: verde);
- si asserisce che `supabase-admin` abbia `server-only`, non che `supabase-ssr` **non** usi la
  `service_role` (verde);
- si asserisce che la guardia funzioni, non che venga **invocata** (matcher: verde);
- si asserisce che un cookie esista, non con quali **attributi** (httpOnly/Secure/SameSite: verde);
- si passa sempre un locale valido, mai uno ostile (verde).

## 5. Il rilievo trasversale: quanto vale `rls:0`

Prova differenziale su **tutte e 7** le tabelle con RLS: **5 sono davvero auditate, 2 no.**

- **`generation_pools`** — cecità vera. Il suo `CREATE TABLE` non parsa
  (`unique nulls not distinct`, PG15+, non supportato da `pgsql-ast-parser@12.0.2`), quindi
  l'oracolo non ne conosce le colonne e l'euristica multi-tenant non gira. **Il `rls:0` del
  checkpoint di P2 del 28/07 non ha auditato questa tabella.** Rimedio misurato e a semantica
  invariata: spostare il vincolo in un `alter table` separato.
- **`profiles`** — fuori copertura **per progetto** dell'euristica (isolamento per identità,
  chiave = PK `id`; nessuna colonna in `TENANT_COLUMNS`). Ipotesi del parse failure
  **smentita dalla misura**.
- **Difetto di forma**: un `parse_warning` non è fatale e nessun controllo del checkpoint lo
  legge. Qualunque tabella futura può uscire dall'audit RLS in silenzio.

## 6. Fragilità dell'harness

- **139 test su 593 non girano senza database**, e `.github/workflows/ci.yml` **non
  provisiona Supabase**: nessun test di RLS, tenancy, auth o sicurezza dati è mai stato
  eseguito da una run di CI.
  *Precisazione, contro la mia ipotesi iniziale*: in quella configurazione la suite **non** è
  silenziosamente verde — esce 1, perché `auth-callback.test.ts` fallisce. Ma quel rosso è
  **accidentale**, prodotto da un test non progettato per questo. Sui soli file di tenancy
  l'esito è `exit 0` con 21 test skippati.
  *Non verificato*: lo stato reale delle run su GitHub (`gh` non è installato).
- Nessun oracolo asserisce che i test DB-backed abbiano davvero girato.

## 7. Metodo, e cosa è costato

Per ogni superficie: due verifier avversariali con lenti distinte (via Workflow, in sola
lettura, `agents_error: 0` verificato prima di ogni valore di ritorno) → **l'orchestratore
applica ed esegue** → oracolo come unico giudice. Gli agenti hanno prodotto rilievi e proposto
mutazioni; **nessun verdetto è stato emesso da un LLM**.

**Il banco ha dovuto essere reso affidabile prima di essere creduto**, e questo è il pezzo di
metodo che vale la pena tramandare. Il ripristino di una funzione è fallito perché Python su
Windows decodifica l'output di `psql` in **cp1252**, corrompendo i 9 byte non-ASCII (em-dash)
nei commenti del corpo: il «ripristino» riscriveva una funzione valida ma diversa. Due ipotesi
intermedie — il CRLF, e un round-trip che sembrava byte-identico — sono state **smentite dalla
misura**; la seconda era viziata perché confrontava la funzione già corrotta con se stessa.

Il difetto è stato preso **solo perché il ripristino era verificato per hash invece che
dichiarato**. Un banco che avesse detto «ripristinato» sulla fiducia avrebbe misurato tutte le
mutazioni successive contro uno stato corrotto — cioè avrebbe prodotto un referto pulito e
senza valore.

**Controverifica indipendente**: dopo un `db reset` che ricostruisce dalle migrazioni, lo
snapshot della superficie 1 torna a `876f0e97…`, lo stesso valore usato per tutte le sue 22
mutazioni.

## 8. Il modello da copiare esiste già in questo repo

Non serve inventare un pattern. Per ognuno dei quattro schemi, **la forma corretta è già
scritta da qualche parte in Belora**:

| Schema | Il rimedio, già presente |
|---|---|
| A — comando non esercitato | `site-generations-schema.test.ts` (P2) confronta l'espressione **esatta** di ogni policy per ogni comando |
| B — presenza invece di valore | `anthropic-boundary.test.ts` (P1) **esegue** ESLint sui moduli reali e verifica `severity === 2` |
| B — `search_path` | `auto_provision_secdef.test.ts` (P0) asserisce `prosecdef` e `proconfig` |
| C — percorso positivo | `sites-actions` / `briefs-actions` (P1): il proprietario crea e modifica **davvero**, l'effetto è riletto |
| D — proprietà invece di caso nominale | **`fetch-safe.test.ts`** (P1): i test sono nominati sulla proprietà che deve restare vera |

`fetch-safe.test.ts` merita una menzione a sé: 62 test per due moduli, ogni clausola difensiva
con il proprio caso, i casi limite scelti fra quelli che un attaccante userebbe davvero. Le
altre superfici asseriscono che il meccanismo **c'è**; quella asserisce che la difesa **non si
può togliere**.

## 9. Estensione oltre lo scope: la decisione, con i dati

Il piano (§5) chiedeva di decidere **con i dati raccolti** se allargare alle superfici fuori
scope (cataloghi i18n, design system, UI, harness di test).

**Raccomandazione: no, non ora.** I dati dicono che i buchi non si distribuiscono a caso — si
concentrano dove *manca il pattern giusto*, e i quattro schemi sono già identificati. Allargare
prima di applicarli produrrebbe altri rilievi della stessa forma senza cambiare cosa va fatto.
**Due estensioni mirate valgono invece più di un allargamento generico**, e sono già motivate
da misure:
1. la cecità di `RLS004` (già estesa a tutte le tabelle in questo audit, §5);
2. le superfici **di P2** — `generation-model` è stato costruito con le lezioni giuste e ha
   già l'espressione esatta delle policy, ma non è stato sottoposto a questa sweep.

## 10. Criterio di uscita del piano — stato

| Criterio (§5 del piano) | Stato |
|---|---|
| Ogni superficie ha una batteria eseguita, con le mutazioni **applicate** e il loro esito, mai saltate in silenzio | **fatto** — 72/72 registrate, 5 rifatte invece che dedotte |
| I rilievi confermati sono chiusi **o dichiarati aperti** | **dichiarati aperti** — le fix sono differite per decisione dell'utente (sweep completo, poi fix in blocco) |
| Si decide con i dati se estendere | **fatto** — §9 |
| Checkpoint verde al termine e SESSION-STATE aggiornata | il checkpoint appartiene alla **fase di fix**: in questa sessione nessun file di codice è stato modificato (solo documenti), e la suite completa è stata rieseguita come prova di assenza di residui |
