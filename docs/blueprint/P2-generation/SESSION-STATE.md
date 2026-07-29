# SESSION-STATE — Belora · P2 (Generazione dei mockup)

> Fonte di verita sullo **stato vivo** del sotto-progetto P2. Letta da BUILD a ogni
> apertura e aggiornata a ogni chiusura (`prompts/session-end.md`). Distinta dalla
> SESSION-STATE della skill trueline e da quelle di P0 e P1.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (JS/TS + Supabase) |
| **Ultimo aggiornamento** | 2026-07-28 (primo BUILD di P2: macrotask `generation-model` costruito e chiuso) |
| **Sessione corrente** | Ha costruito **l'intero macrotask `generation-model`** (T-200..T-204) con il metodo dynamic workflow a 2 agenti per ciclo (builder → verifier avversariale → fixer diversi), batteria di mutazione dell'orchestratore fra un task e l'altro, e **checkpoint deterministico VERDE 4/4** al confine. Cinque emendamenti al blueprint (`P2-D19`…`P2-D23`) nati da rilievi **misurati**, tutti approvati dall'umano. **+18 AC** rispetto al blueprint bootstrappato. Suite da 467 a **593 test**. |

---

## 1. Stato dei macrotask

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| generation-model | **done** | **VERDE 4/4** (2026-07-28) | T-200..T-204. `rls:0` **riconquistato** su superficie DB nuova. 126 test nuovi in 5 file |
| generation-engine | **todo** | — | T-210..T-215 — la trasformazione pura. Eredita tre precondizioni misurate da T-202/T-204, gia scritte in `02-generation-engine.md` |
| generation-llm | **todo** | — | T-220..T-225 — il confine. Indipendente da generation-engine |
| generation-ui | **todo** | — | T-230..T-237 — il macrotask piu esposto |
| generation-e2e | **todo** | — | T-240..T-241 — il primo end-to-end vero |

**→ 27 task atomici, 5 macrotask. Uno costruito e chiuso, quattro da costruire.**

### 1-bis. I cinque task chiusi, e cosa ha prodotto il verde

| Task | Output | Oracolo che ha prodotto il verde | Rilievi |
|---|---|---|---|
| T-200 | migrazione `20260728000100_site_generations.sql` | `tests/site-generations-schema.test.ts` — 15 test, catalogo + runtime ad auth reale | 8, tutti verified |
| T-201 | `slots.ts`, `pool.ts`, `gate.ts` | `tests/pool-schema.test.ts` — 26 test puri | 7 → 5 verified, 2 dichiarati |
| T-202 | `document.ts` | `tests/site-document-schema.test.ts` — 49 test | 9 → 8 verified, 1 dichiarato |
| T-203 | letture in `src/data/generations.ts`, `timeouts.ts` | `tests/generations-read-actions.test.ts` — 15 test DB-backed | 7 → 5 verified, 2 dichiarati |
| T-204 | scritture in `src/data/generations.ts` | `tests/generations-write-actions.test.ts` — 21 test DB-backed | 10 → 9 verified, 1 dichiarato |

**fix_state complessivo**: 41 rilievi → **35 verified**, **6 mitigated-residual dichiarati**
(V-201-06, V-201-07, V-202-01, F-203-06, F-203-07, V-204-06), **0 open non dichiarati**.

**Batteria di mutazione dell'orchestratore**: T-200 10/10 prese · T-201 13/13 sull'esito
atteso (2 deliberatamente attese VERDI) · T-202 8/8 prese, con una mutazione malformata
rifatta invece di essere registrata come buco inesistente. Ripristino verificato con hash
sha256 a ogni giro. **Su T-203 e T-204 la batteria dell'orchestratore NON e stata girata**:
le mutazioni le hanno eseguite builder, verifier e fixer (rispettivamente 20 e 24), con
ripristino verificato per hash. E una differenza di metodo, dichiarata e non dedotta.

### Verdetto del checkpoint, letterale (dal JSON, non dall'exit code)

```
checkpoint=VERDE | 1:dead-code=green 2:security=green 3:regressions=green 4:conformance=green
  1 dead-code  green  nessuna regressione d'igiene NUOVA [dead-code:0 dup:60 cycle:0 twin:0]
  2 security   green  nessun finding NUOVO >= HIGH [gitleaks:0 osv:0 semgrep:0 rls:0]
  3 regressions green  test verdi
  4 conformance green  test verdi
degraded = []
```

**Riserva onesta sul controllo 1**: e verde perche le 18 duplicazioni nuove sono state
**attribuite e catturate** nella baseline, non perche siano sparite — `dup:60` resta nel
dettaglio. L'attribuzione e in §4.

## 2. Macrotask corrente

- **Selezionato**: nessuno. Il prossimo BUILD puo partire da **`generation-engine`**
  (T-210..T-215) o da **`generation-llm`** (T-220..T-225): sono indipendenti fra loro nel
  DAG e **entrambi** consumano solo i contratti di `generation-model`, che ora esistono.
  `generation-ui` viene dopo entrambi.
- **Consiglio operativo**: `generation-engine` prima, perche e l'unico strato con oracoli
  pieni **senza chiave API** — e senza chiave `generation-llm` lascera T-225 non eseguito.
- **Task atomici in corso**: nessuno.

## 3. Stato git

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/generation-model` (creato dal branch di design, che portava i soli documenti) |
| Stato merge su `main` | **mergeato** sul verde del checkpoint, con i documenti del blueprint P2 al seguito (decisione di apertura) |
| Deploy-coupling | **`main_deploy_coupled: false` RICONFERMATO** dall'utente all'apertura di questo BUILD. Merge autonomo sul verde; distruttive e deploy restano gated. Nessuna operazione distruttiva e nessun deploy in questa sessione |

## 4. Baseline & budget

- **Baseline di sicurezza**: `gitleaks:0 · osv:0 · semgrep:0 · rls:0`. **`rls:0` e stato
  RICONQUISTATO** al checkpoint su due tabelle nuove, non ereditato da P1.
- **Baseline d'igiene**: `.trueline/hygiene-baseline.json`, da **41 a 59 impronte**,
  tracciata in git. Ricattura **approvata dall'utente dopo attribuzione**, verificata per
  differenza: **+18 aggiunte, 0 sparite**, cioe esattamente i 18 blocker attribuiti — se
  ne fossero comparse di piu, si sarebbe benedetto qualcosa di mai guardato.
  **Cosa e stato benedetto, per fatti**:
  - **12 nelle `.md` del blueprint P2** (8 in `05-generation-e2e.md`, 2 in `00-INDEX.md`,
    1 in `prompts/project-start.md`, 1 in `VISION-AND-CONSTRAINTS.md`): impalcatura YAML
    dei task, che nello schema trueline si ripete **per costruzione**. Quei documenti sono
    entrati nell'albero col branch di design, **dopo** la cattura della baseline in P1.
  - **6 in `src/data/generations.ts`**: il preambolo delle server action
    (`createServerSupabaseClient` → `auth.getUser()` → `if (!user) return 401` → `safeParse`),
    **identico** a quello di `src/data/briefs.ts` (T-123, gia verde in P1). Sei azioni
    esportate in un modulo invece di tre superano la soglia di `jscpd`. Tenuto ripetuto
    di proposito: la stessa ragione per cui `account_id` compare esplicito nel testo di
    ogni policy RLS — una guardia di sicurezza nascosta in un helper non e piu visibile a
    chi legge l'azione.
  - Nessuna e dead-code (`dead-code:0`), nessuna e un ciclo, nessuna e un twin. Tutte `LOW`.
- **Suite**: **593 test in 61 file**, 0 falliti, 0 skippati (misurata con `npm test` dopo
  `db reset`, non dedotta). Erano 467 in 56 file: **+126 test in 5 file**
  (15 + 26 + 49 + 15 + 21). *Nota*: la SESSION-STATE precedente diceva 56 file ed era
  giusta — il "57" segnalato all'apertura di questa sessione era un errore di conteggio
  dell'orchestratore, chiuso col numero reale.
- **Budget**: la forma che ha tenuto e **2 agenti per workflow**, un task per volta, con
  builder → verifier avversariale e, sui rilievi confermati, due fixer **diversi ancora**
  in sequenza (modulo prima, oracolo poi). Nessun workflow e morto per limite di sessione;
  `agents_error` controllato a ogni ritorno, sempre 0.

## 5. Esiti dell'ultima sessione (framing onesto)

**Costruito**: T-200 (schema + RLS), T-201 (slot + `PoolSchema`), T-202
(`SiteDocumentSchema`), T-203 (letture + riconciliazione), T-204 (scritture + macchina a
stati). Piu due moduli non previsti dal blueprint e nati da rilievi:
`src/domain/generation/gate.ts` (le due primitive condivise dai due gate) e
`src/domain/generation/timeouts.ts` (perche un modulo `'use server'` non puo esportare
costanti, e senza export l'invariante non era asseribile).

**Il metodo ha funzionato dove serviva**: in **tutti e cinque** i task il verifier
avversariale ha trovato buchi che la suite verde non vedeva, e in quattro casi su cinque
il buco era nell'**oracolo**, non nel codice. I tre piu istruttivi:

1. **T-203 / F-01 — il test misurava la grandezza sbagliata.** AC-203-6 dice "il numero di
   chiamate al DB"; il doppio contava le invocazioni della propria trap `from`. Un N+1
   reale instradato via `supabase.schema('public')` produce 1+13 round-trip veri e lasciava
   la suite **14/14 verde**. Corretto misurando le **richieste HTTP** invece delle
   invocazioni di metodo (`AC-203-6` emendato).
2. **T-204 / V-204-01 — una difesa che esisteva ma non resisteva.** Rimuovendo *interamente*
   il gate `parseDocument` da `appendPages` la suite restava **16/16 verde**, e con quella
   mutazione si scriveva nel documento congelato uno slot immagine
   `{source:'external', url:'https://evil.example/x.png'}` — cio che `document.ts` dichiara
   irrappresentabile **per tipo**. Il gate c'era e funzionava: mancava l'oracolo.
3. **T-200 / F-01 — un buco di autorizzazione riprodotto a runtime.** Con la FK semplice su
   `generation_id`, un membro di un altro account poteva scrivere nel pool di una
   generazione altrui e, occupando lo slot UNIQUE, impedire al proprietario di scrivere il
   proprio. Riprodotto dall'orchestratore come ruolo `authenticated`, chiuso con la FK
   composita (la stessa difesa di T-120).

**Batterie di mutazione dell'orchestratore** (oltre a quelle degli agenti): 10/10 prese su
T-200, 13/13 sull'esito atteso su T-201 (due deliberatamente **attese verdi**), 8/8 su
T-202. Una mutazione malformata (`O7`) e stata rifatta invece di essere registrata come
buco inesistente; una mutazione fatale (`N13`) e stata verificata a parte perche il
classificatore la etichettava male.

**Emendamenti al blueprint** (tutti approvati dall'umano, tutti da rilievi misurati):
`P2-D19` FK composita sui pool + revoke ad anon · `P2-D20` catalogo asserito + errore
limitato alla fonte + forma dello slug · `P2-D21` `max_bytes` sul caso multibyte +
`recipe_id`/`theme_id` + home imposta + limitatore condiviso · `P2-D22` timestamp NOT NULL
+ N+1 misurato sul trasporto + invariante dei timeout · `P2-D23` firme reali + `max_pages`
imposto + stati terminali + pool preteso + prova di vita sul solo ramo riuscito.
`validate_blueprint.mjs` **EXIT 0** dopo ogni emendamento.

**Misure vere, non stime**: documento al caso peggiore **3.357.278 byte** in ASCII e
**6.397.198** in italiano/spagnolo accentato (rapporto **x1,905**); errore di `parsePool`
da **100.256 byte a 341** dopo il tetto alla fonte; scrittura al tetto di **8.388.608 byte**
attraverso il gateway, corpo HTTP **8.388.681 byte**, **accettata**.

## 6. Copertura dichiarata (cosa NON e coperto, da subito)

> Il "fatto" si dichiara per fatti. Queste voci nascono **aperte** e non vanno confuse con
> un verde. Le prime nove sono ereditate dal bootstrap e restano valide.

1. **Non esiste una chiave API.** Ogni oracolo di `generation-llm` mockera il confine; gli
   schemi strict non sono provati contro l'API reale; la qualita del copy non e oracolata.
2. **`GENERATION_BUDGET` sono stime, non misure** (`P2-D17`). Sede: T-225, che senza chiave
   si dichiara *non eseguito*.
3. **La taratura crediti↔prezzi non e decisa** e non va decisa su quelle stime (P5).
4. **La latenza non e misurata**, ne fase 1 ne fase 2.
5. **L'anti-fuga e un match per sottostringa**: una fuga trasformata (base64,
   percent-encoding) sfuggirebbe.
6. **Lo stile non e asserito**: i controlli di `generation-engine` provano che il layer dei
   temi e cablato e distinto, non che i temi siano belli.
7. **Lo spagnolo eredita la debolezza dei cataloghi**; `es` e una lingua sola.
8. **Nulla limita la frequenza** delle generazioni per account (tetto complessivo a P5).
9. **L'end-to-end non percorre login e onboarding** (rate limit auth).
10. **NUOVO — AC-204-7 certifica il gateway LOCALE, non la produzione.** La scrittura di un
    documento da 8 MiB passa da Kong della CLI Supabase. Un gateway diverso in produzione
    puo avere un `client_max_body_size` piu basso: **la misura va ripetuta la**, e il test
    e l'oracolo gia pronto. Il modo di fallire sarebbe insidioso — un documento che il gate
    ha dichiarato valido, respinto a livello HTTP con un errore opaco.
11. **NUOVO — il `page_role` di uno slot non e pinnato** (T-201): cambiarlo lascia la suite
    verde. Nessun AC lo chiede; **va pinnato dove qualcuno vi appoggera una decisione**
    (T-210 o T-213), non qui.
12. **NUOVO — `brief_fields_rendered` e una LISTA, non un insieme**: lo stesso nome ripetuto
    e accettato. Il tetto limita il numero di voci, non l'insieme dei campi. Misurato e
    pinnato al comportamento attuale; se deve essere un insieme, la sede e il modulo.
13. **NUOVO — il CJK non entra in `max_bytes`**: lo stesso caso peggiore in ideogrammi pesa
    9.437.118 byte contro un tetto di 8.388.608. Scelta dichiarata (non e un locale del
    prodotto) e resa **falsificabile**: un test legge il vocabolario dei locale da
    `BriefUpdateSchema` e diventa rosso il giorno in cui se ne aggiunge uno ideografico.
14. **NUOVO — l'invariante dei timeout e pinnata nella RELAZIONE, non nei numeri**
    (`AC-203-7`). Fessura dichiarata: un `max_request_lifetime` portato a 0 renderebbe
    l'invariante banalmente vera. I numeri restano stime (P2-D17).
15. **NUOVO — il ramo "il CAS perde la corsa" non e coperto**: la suite non ha concorrenza
    reale. Comportamento dichiarato nel JSDoc.
16. **NUOVO — `knip` NON puo testimoniare sugli export di `src/data/**`**, che sta in
    `entry` di `knip.json`: non e mai la prova dell'assenza di export orfani in quei file.
    (Serve `ts-prune` o una run con `src/data` fuori da `entry`.)
17. **NUOVO — il fallback di `comeStato` e irraggiungibile** finche il CHECK di T-200
    vincola il vocabolario: tenuto **per decisione dell'utente** come difesa contro un
    futuro allentamento del CHECK, e dichiarato tale nel codice.
18. **NUOVO — `social_links` accetta un URL di terzi nel documento.** L'irrappresentabilita
    per TIPO copre lo **slot immagine e `photo_ref`**, non il documento intero. E scritto
    nel modulo e pinnato da un test. La difesa sul link e del **validatore di campo**
    (T-237) piu l'asserzione sull'**effetto** (T-241): chi implementa T-237 non deve
    dedurre dallo schema che il valore sia gia sicuro.

## 7. Carry-over

### Chiusi da questo macrotask
- **P1 §6-bis p.10** (il peso della riga era un limite **senza oracolo**): il documento ha
  ora un bound **misurato e applicato**, in due unita e due lingue (`AC-202-6`, `AC-202-7`).
- **Anticipato su P1 §6-bis p.2** (nested `additionalProperties` senza `required`):
  `SiteDocumentSchema` e strict a **ogni** livello annidato, e la trappola "lo strict di
  zod non e ricorsivo" e stata provata con quattro mutazioni su quattro livelli distinti.
  La chiusura formale resta di T-222 (`AC-222-1`), sul tool.

### Precondizioni consegnate ai macrotask successivi (gia scritte nei moduli del blueprint)
- **T-214**: la **partizione e portante**. Se `resolve` rende lo stesso campo in piu blocchi
  della stessa pagina, il caso peggiore in italiano/spagnolo misura **11.813.858 byte** e il
  documento viene **rifiutato**. Partizionato misura 6.397.198 e passa col 31% di margine.
- **T-211/T-212**: gli id di temi e ricette devono nascere **versionati** (`nome-kebab@N`,
  max 64 code unit): un id senza `@N` fa cadere l'intero documento.
- **T-214/T-121**: nel documento la chiave di `hours` e vincolata per forma (alfanumerico
  Unicode ai bordi), mentre `brief.ts` non impone nulla: un brief valido con una chiave non
  conforme fa **rifiutare** il documento. `resolve` deve decidere se scartare o normalizzare.
- **T-230/T-232**: la mappa fine `scope`→stato di `writePool` (fase 1 contro fase 2, e la
  rigenerazione copy-on-write di `P2-D3`) **non** e stata indovinata qui.
- **T-204 → T-230**: i rami di errore di `parsePool` e `parseDocument` sono limitati alla
  fonte dallo **stesso** limitatore (24 issue, 120 code unit): dicono DOVE, non QUANTE volte.

### Restano aperti da P1
`readyForReview` verifica presenza e non provenienza (§7 p.1); la history della chat non e
persistita (p.2); `upsertBrief` non riporta i campi scartati (p.3); T-122 fonde le offerte
per nome (p.4); `P1-D11` sul contratto di altitudine, **ancora rinviato**.

## 8. Prossimi passi & decisioni

0. ~~PRIMA del prossimo BUILD — audit degli oracoli di P0 e P1~~ → **ESEGUITO E CHIUSO il
   2026-07-29**. Referto: **`docs/blueprint/audit-oracoli/00-REFERTO.md`** (+ un ledger per
   superficie). Mergeato su `main` col **checkpoint VERDE 4/4**, `degraded: []`.
   **Esito**: 72 mutazioni applicate su 6 superfici, 72 ripristini verificati per hash,
   **ZERO difetti attivi**; **26 rilievi, tutti oracoli deboli**. Classifica misurata:
   import/SSRF **0 buchi** (esemplare) · siti+brief 2 · profili 4 · tenancy 4 ·
   **auth 8** (la peggiore, ed e l'unica superficie senza RLS come seconda linea).
   I 26 rilievi si condensano in **quattro schemi ricorrenti** (comando DELETE mai
   esercitato · presenza invece di valore · solo il negativo mai il positivo · caso nominale
   invece della proprieta) e per ognuno **il rimedio esiste gia in questo repo**.
   **Due cecita che valgono per P2**: `RLS004` non audita `generation_pools` (parse failure su
   `unique nulls not distinct`, rimedio misurato e a semantica invariata), quindi il `rls:0`
   del checkpoint del 28/07 **non ha auditato quella tabella**; e la CI non provisiona
   Supabase, quindi 139 test su 593 non girano mai in CI.
   **Fase di fix**: decisa dall'utente **per schema (A → B → C → D)**, non superficie per
   superficie. Non ancora iniziata.
1. **Prossimo BUILD**: `generation-engine` (consigliato) oppure `generation-llm`.
2. **Riconfermare il deploy-coupling** all'apertura, come si e fatto qui: non e una
   formalita, e la ragione per cui il merge di questo macrotask e stato autonomo.
3. **Decisioni ancora dell'utente**: taratura crediti/prezzi dopo T-225; attivazione del
   contratto `architecture:` (`P1-D11`).
4. **Nota sullo strumento — AGGIORNATA al 2026-07-29**: il plugin e passato 0.1.0 → 0.2.0
   (28/07) e poi a **0.3.0** (29/07, durante l'audit). Percorso valido oggi:
   `~/.claude/plugins/cache/trueline-local/trueline/**0.3.0**/skills/trueline/`; 0.2.0 resta
   accanto. **Fra 0.2.0 e 0.3.0 cambiano solo** `checkpoint.mjs`, `baseline.mjs`, i due
   `loop*.mjs`, `gitleaks.toml`, e compare `scan_scope.mjs`: `run_dupcheck.mjs` e
   `rls_check.mjs` sono **byte-identici**. Misurato: 0.3.0 **non** cambia l'esito del
   controllo 1, e la ricattura della baseline con 0.3.0 produce un file **invariato**.
   **Difetto dello strumento da conoscere (R-04 del referto)**: `baseline.mjs` e
   `checkpoint.mjs` **normalizzano diversamente lo stesso output di jscpd** (61 finding /
   59 impronte contro 63), quindi il checkpoint segnala come "nuove" impronte che la baseline
   non puo contenere. **Rimedio applicato**: completare la baseline con le impronte **nella
   forma che la verifica** (+8, 0 sparite, tutte attribuite e `LOW`) → checkpoint VERDE.
   Baseline ora a **67 impronte**. La regola resta valida e va letta cosi: catturare con uno
   strumento e verificare con un altro non significa nulla, **nemmeno quando produce un rosso**.
5. **Invocazione del checkpoint** (funzionante, per non ricercarla):
   `node <trueline>/scripts/checkpoint/run_checkpoint.mjs <repo> --in-place --mode build`,
   **senza** `--blueprint`, con `.env.local` fuori dal repo e le variabili esportate dalla
   shell, dopo `db reset` + `docker restart supabase_kong_progetto-web-ai` e attesa che
   `/auth/v1/health` risponda 200 — un rosso da kong non spento sarebbe **falso**.
   **AGGIUNTA dall'audit**: `rm -rf .next` **prima** di ogni checkpoint. `run_dupcheck` e
   gitleaks **non escludono `.next/`**: con la cache di build presente il controllo 2 produce
   **28 finding CRITICAL falsi**, tutti dentro `.next`. Misurato il 29/07.
