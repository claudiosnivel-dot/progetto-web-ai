# REFERTO — Audit degli oracoli delle superfici di sicurezza di P0 e P1

> **STATO DELLE FIX** (aggiornato il 2026-07-29)
>
> | Schema | Stato | Esito misurato |
> |---|---|---|
> | **A** — il comando che nessuno esercita | **CHIUSO** su `main` | catalogo **6/6** e runtime **4/4** da VERDE a ROSSO, piu il raggio d'azione di `deleteSite`. Chiude **T-02, S2-01, S45-01, S45-02** |
> | **B** — presenza invece di valore | **CHIUSO** su `main` | **7/7** da VERDE a ROSSO. Chiude **T-01, S2-03, A3-07** e il lato (b) di **S2-05** |
> | **C** — solo il negativo, mai il positivo | **CHIUSO** su `main` | la mutazione «nessuno puo scrivere» da VERDE 16/16 a ROSSO. Chiude **T-03** |
> | **D** — caso nominale invece della proprieta | **CHIUSO** su `main` | **7/7** da VERDE a ROSSO. Chiude **A3-01…A3-06, A3-08** |
>
> | **Estensione a P2** | **CHIUSO** su `main` | **4/4** da VERDE a ROSSO su `site_generations.DELETE`, `generation_pools.UPDATE/DELETE` |
> | **CI con Supabase** | **CHIUSO** su `main` | **8/8** sul workflow. I 139 test DB-backed smettono di skipparsi |
>
> **Tutto chiuso.** Suite: **593 → 643 test**. Checkpoint **VERDE 4/4**, `degraded: []`,
> `dup:63` invariato a ogni passo: **~2700 righe di test aggiunte, zero duplicazioni
> introdotte**. **`src/` non e stato modificato una sola volta**: nessuna proprieta ha
> richiesto un cambio al codice di produzione — il codice era corretto, mancava chi se ne
> accorgesse se smettesse di esserlo.
>
> **Bilancio delle mutazioni rieseguite dopo le fix**: **36 su 36** passate da VERDE a ROSSO
> (24 sui quattro schemi, 4 su P2, 8 sul workflow di CI).
>
> **L'unica cosa NON misurata di tutta la sessione**: la correttezza del workflow di CI. Non
> posso eseguire GitHub Actions da qui (`gh` non e installato), quindi e argomentata sulla
> documentazione dell'action e sul comportamento della CLI provato in locale, **non provata da
> una run reale**. La prima run vera puo far emergere fallimenti mai visti prima, perche quei
> 139 test in CI girerebbero per la prima volta — il che e desiderabile, non un rischio.
>
> **Due buchi NUOVI trovati durante le fix**, non presenti in questo referto:
> una **GUC estranea** attaccata a una funzione SECURITY DEFINER (`set role`,
> `set row_security`) passava l'asserzione esistenziale su `proconfig`; e togliere la guardia
> `if v_account_id is null` dall'auto-provision era **invisibile all'intera suite**, perche la
> stringa cercata dai `toContain` sta nella SELECT di lookup che la mutazione non tocca.
>
> **Costi e limiti dichiarati**
> - **A**: l'uguaglianza esatta rende l'oracolo **rigido** alle riscritture equivalenti del
>   testo delle policy (misurato: 2 su 2 ora rosse). Compromesso gia accettato da P2, ed e lo
>   stesso difetto contestato in S2-05: va dichiarato, non nascosto.
> - **B**: il lato **(a)** di S2-05 — la rigidita dei tre `toContain` sull'idempotenza —
>   **non e chiuso**. Il nuovo test strutturale tollera le riscritture equivalenti, i tre
>   preesistenti no.
> - **Deviazione di processo, dichiarata**: il commit dello schema C (`2ccdda6`) e finito
>   **direttamente su `main`** senza passare da un branch. Il gate sostanziale ha tenuto — il
>   checkpoint era verde prima del push — ma lo strato branch previsto dall'invariante e stato
>   saltato. Non e stata riscritta la storia: il rimedio sarebbe peggiore del difetto.
>
> - **CORREZIONE a un rilievo di questo referto (A3-04)**: la mutazione con cui l'avevo
>   registrato era **inefficace**. `|_vercel|dashboard|` nel lookahead del matcher esclude
>   `/dashboard`, **non** `/{locale}/dashboard`, che comincia col locale: il regex cambiava
>   senza escludere le rotte protette. Rifatta nella forma corretta (`.*/dashboard`) e
>   misurata contro gli oracoli **pre-fix**: **VERDE 30/30**, quindi **il rilievo regge** —
>   il matcher non aveva davvero alcun oracolo. Ma la prova che avevo prodotto non lo
>   dimostrava. Conclusione giusta, misura sbagliata: le due cose vanno tenute distinte.
>
> **Emerso dallo scout su P2** (sola lettura, da decidere se estendere): su
> `site_generations.DELETE`, `generation_pools.UPDATE` e `generation_pools.DELETE` la policy e
> il GRANT sono asseriti a catalogo ma **non sono mai esercitati a runtime**, ne in positivo ne
> in negativo. Stessa famiglia dello schema A/C, su tabelle costruite dopo.


> Esecuzione completa del piano `docs/blueprint/AUDIT-ORACOLI-P0-P1.md`.
> Data: **2026-07-29**. Branch `trueline/audit/oracoli-p0-p1`.
> Ledger per superficie: `01-tenancy.md` · `02-profili-auto-provisioning.md` ·
> `03-auth-e-sessione.md` · `04-05-siti-e-brief.md` · `06-import-ssrf.md` ·
> `00-copertura-oracolo-rls.md` (trasversale).

## 1. La cosa più importante, in una riga

**Non è stato trovato nessun difetto attivo.** In 72 mutazioni su sei superfici, nessuna ha
rivelato una policy sbagliata, un vincolo mancante o una guardia difettosa **oggi**. Tutti i
**26 rilievi** sono **oracoli deboli**: modi in cui una regressione *futura* non verrebbe vista.

La distinzione va tenuta ferma leggendo il resto: il codice di P0 e P1 è corretto. Ciò che
non è affidabile è la rete che dovrebbe accorgersi se smettesse di esserlo.

## 2. Numeri

| | |
|---|---|
| Mutazioni **applicate** ed eseguite | **72** (22 · 16 · 15 · 10 · 9 sulle sei superfici) |
| **Rilievi numerati** | **26** — T-01…07 · S2-01…05 · A3-01…08 · S45-01…02 · R-01…04 |
| Esiti **VERDI non attesi** (la mutazione non è stata presa) | **22** |
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
| Checkpoint verde al termine e SESSION-STATE aggiornata | **eseguito, ed è NON-VERDE** — per una causa che pre-esiste a questo branch. Vedi §11 |

## 11. Il checkpoint di chiusura, e cosa ha rivelato

**Suite completa dopo la sweep**: 61 file, **593 test, 0 falliti, 0 skippati** — identica alla
baseline di SESSION-STATE. Nessun residuo delle 72 mutazioni.

**Checkpoint deterministico**: `1:dead-code=red · 2:security=green · 3:regressions=green ·
4:conformance=green`, `degraded: []`.

### Il rosso del controllo 2 al primo tentativo era MIO, non del codice
Il primo giro riportava **28 finding gitleaks CRITICAL**. Tutti e 28 erano dentro **`.next/`**,
la cache di build di Next: avevo saltato `rm -rf .next`, che la procedura documentata in
SESSION-STATE §8.5 elenca esplicitamente. Rieseguito con la procedura completa: **`gitleaks:0`,
controllo 2 verde**. È lo stesso genere di falso rosso del «kong non riavviato» già annotato
nel progetto, e va registrato come tale invece di essere raccontato come una scoperta.

### Il rosso del controllo 1 pre-esiste a questo branch — attribuito, non dedotto
`dup:63`, **8 duplicazioni «nuove»** in `05-generation-e2e.md`, `updateProfileLocale.ts`,
`sites.ts` e `generations.ts` — cioè **file che questo branch non tocca** (il diff contro
`main` è di 7 soli documenti nuovi, 840 righe, tutte in `docs/blueprint/audit-oracoli/`).

**Attribuzione per misura differenziale**, non per ragionamento: `run_dupcheck` eseguito due
volte, con e senza i 7 documenti nuovi.

| | blocchi |
|---|---|
| albero **con** i documenti dell'audit | 63 |
| albero **senza** (= `main`) | 63 |
| blocchi presenti **solo** con i miei documenti | **0** |

I due output sono perfino **byte-identici** (40 336 byte entrambi). Inoltre: la baseline
committata ha **59 impronte**, **nessuna** delle 8 bloccanti vi compare, e questo branch non
ha mai toccato `.trueline/hygiene-baseline.json` (ultimo commit a toccarla: `30c987d`, la
chiusura di P2).

### Attribuzione delle 8: appartengono a due classi già benedette in P2
Ricostruite le coppie di cloni: 4 sono l'**impalcatura YAML dei task** di
`05-generation-e2e.md` accoppiata agli altri quattro moduli del blueprint P2 (si ripete *per
costruzione* nello schema trueline); le altre 4 sono il **preambolo delle server action**, la
**derivazione dell'account**, il **`safeParse` + 400** e il **lookup del sito** fra
`updateProfileLocale.ts`, `sites.ts`, `generations.ts` e `briefs.ts`. Sono esattamente le due
classi che SESSION-STATE §4 documenta come attribuite e **tenute ripetute di proposito**.
Nessuna è dead-code, nessuna è un ciclo, tutte `LOW`.

### R-04 — MEDIUM · la baseline d'igiene è CATTURATA e VERIFICATA da due scanner diversi

Tre ipotesi sono state formulate e **due sono state smentite dalla misura**. Vale la pena
registrarle, perché l'ordine in cui sono cadute è il metodo:

1. *«La baseline committata è derivata»* — **falso**. Ricatturata con
   `baseline.mjs capture --hygiene`, produce un file **byte-identico** a quello in git
   (`git diff --quiet` → nessuna differenza). La baseline era ed è corretta.
2. *«È `.next` a inquinare la scansione»* — **falso**. `run_dupcheck` non esclude `.next/`
   (ignora solo `*.test.ts`, `*.spec.ts`, `*.d.ts`, `node_modules`) e il checkpoint rigenera
   `.next` durante la propria esecuzione, quindi l'ipotesi era ragionevole. Ma
   `baseline.mjs delta --hygiene` riporta **`new=0`** sia con `.next` presente sia assente.
3. *«Manca `--baseline` nell'invocazione»* — **falso**. Passato esplicitamente, l'esito non
   cambia: `1:dead-code=red, 8 duplication NUOVO`.

4. *«Sono due scanner diversi»* — **falso**, e anche questa formulazione (mia, in una stesura
   precedente) è stata smentita: `oracleInvocation` chiama `run_dupcheck.mjs` **in entrambe**
   le versioni, e `minTokens` vale **50** su tutti e due i percorsi.
5. *«La versione nuova lo risolve»* — **falso**, misurato su richiesta dell'utente. In 0.3.0
   `checkpoint.mjs`, `baseline.mjs` e `gitleaks.toml` sono cambiati ed è comparso
   `scan_scope.mjs`, ma l'esito è **identico**: `1:dead-code=red, 8 duplication NUOVO`, stesse
   posizioni. La ricattura con 0.3.0 produce anch'essa una baseline **invariata**
   (59 impronte, 0 aggiunte, 0 sparite).

**La causa vera, misurata**: dallo **stesso** output grezzo di jscpd, i due percorsi
**normalizzano in modo diverso**.

| Percorso | Finding | Impronte |
|---|---|---|
| `run_dupcheck.mjs` (output grezzo) | 63 coppie | — |
| `baseline.mjs capture/delta --hygiene` (**cattura**) | **61** | 59 → `new=0` |
| `checkpoint.mjs` (**verifica**) | **63** | → **8 non presenti in baseline** |

Le 8 impronte che il checkpoint segnala come «nuove» **non possono esistere nella baseline**,
perché la baseline non le produce nemmeno partendo dagli stessi dati. È lo stesso genere di
errore contro cui SESSION-STATE §8.4 mette in guardia — *«catturare con uno strumento e
verificare con un altro produce un verde che non significa nulla»* — con la differenza che qui
produce un **rosso** che non significa nulla.

**Conseguenza operativa**: il controllo 1 **non può essere reso verde da nessuna azione sul
repository**. Ricatturare non serve (la baseline è già corretta e la ricattura usa lo scanner
che *non* verifica); attribuire non serve (fatto: nulla di nuovo). Il rimedio è sullo
strumento — allineare i due scanner, oppure catturare la baseline con lo stesso che il
checkpoint usa.

**Non ho ricatturato per far passare il controllo**, e non ho forzato il merge: il gate è il
verde, e il verde oggi è irraggiungibile per una ragione che non riguarda questo branch.
