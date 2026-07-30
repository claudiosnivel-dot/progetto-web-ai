# SESSION-STATE — Belora · P2 (Generazione dei mockup)

> Fonte di verita sullo **stato vivo** del sotto-progetto P2. Letta da BUILD a ogni
> apertura e aggiornata a ogni chiusura (`prompts/session-end.md`). Distinta dalla
> SESSION-STATE della skill trueline e da quelle di P0 e P1.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (JS/TS + Supabase) |
| **Ultimo aggiornamento** | 2026-07-30/31 (BUILD del macrotask **`generation-engine`**: T-210..T-215 costruiti, checkpoint **VERDE 4/4**, mergeato su `main`) |
| **Sessione corrente** | **BUILD di `generation-engine`**, il secondo macrotask di P2. Cinque task atomici piu' due lavori nati da rilievi misurati. **Suite da 643 a 858 test.** Tre decisioni dell'utente registrate: `P2-D24`, `P2-D25` e la correzione del contratto di `PageSpec`. Checkpoint di macrotask VERDE 4/4, `degraded: []`, merge autonomo su `main` |
| **Sessione precedente** | Audit degli ORACOLI di P0/P1 + la sua fase di fix (29/07): 72 mutazioni, 26 rilievi, ZERO difetti attivi, `src/` mai modificato |

---

## 1. Stato dei macrotask

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| generation-model | **done** | **VERDE 4/4** (2026-07-28) | T-200..T-204 |
| generation-engine | **done** | **VERDE 4/4** (2026-07-30) | T-210..T-215. 8 commit sul branch + 1 di merge. `degraded: []` |
| generation-llm | **todo** | — | T-220..T-225 — il confine. **Prossimo BUILD** |
| generation-ui | **todo** | — | T-230..T-237 — il macrotask piu' esposto |
| generation-e2e | **todo** | — | T-240..T-241 — il primo end-to-end vero |

**→ 27 task atomici, 5 macrotask. Due costruiti e chiusi, tre da costruire.**

### 1-bis. I sei task di `generation-engine`, e cosa ha prodotto il verde

| Task | Output | Mutazioni del verifier | Batteria dell'orchestratore |
|---|---|---|---|
| T-210 | `blocks.ts` — catalogo di 8 blocchi, `blocksFor`, `slotsForBlocks`, `resolveOfferings` | **37: 13 prese, 24 SOPRAVVISSUTE** | 14/14 dopo le fix |
| T-211 | `themes.ts` — 5 temi versionati + la regola ESLint del confine | 33: 32 prese, 1 mutante equivalente | 7/7 |
| T-212 | `recipes.ts` — 5 direzioni, `recipeFor`, `applyRecipe` | 53: 48 prese, 5 sonde | 7/7 |
| T-213 | `pages.ts` — `pagesFor`, `navigationFor`, `PAGE_CATALOG`, `PAGES_MIN = 3` | 49: 44 prese, 4 sopravvissute | 18/18 |
| T-214 | `resolve.ts` — da pool+ricetta+tema al `SiteDocument` | 54: 47 prese, 7 sopravvissute | 9/9 + 3 sonde |
| T-215 | `generatable.ts` — `GENERATABLE_MIN_BLOCKS = 4` | 54: 50 prese, 4 equivalenti | 5/5 |

**Il dato che riassume il macrotask**: in T-210 la prima suite era VERDE con **24 mutazioni su 37
sopravvissute**, e il modulo era CORRETTO. Il difetto stava nell'oracolo, ed e' la forma che si e'
ripetuta in tutti e sei i task. Nessun giro di fix ha mai dovuto correggere un bug di produzione:
`src/` e' stato toccato **due volte in tutto**, entrambe su decisione esplicita dell'utente (il
contratto di `PageSpec`, la totalita' di `resolve`), piu' l'estrazione finale trovata dal checkpoint.

### Verdetto del checkpoint, letterale (dal JSON, non dall'exit code)

```
checkpoint=VERDE | 1:dead-code=green 2:security=green 3:regressions=green 4:conformance=green
  1 dead-code  green  nessuna regressione d'igiene NUOVA [dead-code:0 dup:66 cycle:0 twin:0]
  2 security   green  nessun finding di sicurezza NUOVO >= HIGH [gitleaks:0 osv:0 semgrep:0 rls:0]
  3 regressions green  test verdi
  4 conformance green  test verdi
degraded = []
```

**Il controllo 2 vale piu' di quanto sembri**: e' risultato verde mentre `.trueline/baseline.json`
conteneva ancora, per un difetto dello strumento (§8.5), uno snapshot d'IGIENE al posto della
baseline di sicurezza — cioe' con **zero impronte soppresse**. Ogni finding sarebbe stato riportato
come NUOVO. La cattura successiva della baseline vera ha confermato: **0 finding di sicurezza**.

## 2. Macrotask corrente

- **Selezionato**: nessuno. Il prossimo BUILD e' **`generation-llm`** (T-220..T-225), l'unico
  rimasto le cui dipendenze sono verdi. `generation-ui` viene dopo (dipende da llm e da engine).
- **Nota che vale per T-225**: senza chiave API il task si dichiara *non eseguito*, mai verde.
- **Task atomici in corso**: nessuno.

## 3. Stato git

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/generation-engine` — 9 commit, tutti pushati |
| Stato merge su `main` | **Mergeato sul verde** (`7596e66`, `--no-ff`). `main == origin/main`. Working tree pulito |
| Deploy-coupling | **`main_deploy_coupled: false` RICONFERMATO dall'utente all'apertura.** Il rilevatore dice `true` (segnale unico: `supabase/config.toml`), l'override e' una decisione umana ripetuta. Merge autonomi sul verde; **distruttive e deploy restano gated**. Nessun deploy, nessuna operazione distruttiva |
| Nota | `generation-engine` non ha aggiunto migrazioni, rotte o endpoint `/api`: e' tutto dominio puro piu' una regola ESLint |

## 4. Baseline & budget

- **Baseline di sicurezza**: `gitleaks:0 · osv:0 · semgrep:0 · rls:0`. Ricatturata il 30/07 e
  contiene **0 finding**. Resta valida la riserva del 29/07: `rls:0` significa «nessun rilievo
  prodotto», non «tutte le tabelle auditate» — su 2 tabelle su 7 l'oracolo statico non guarda
  (`generation_pools`, `profiles`). Dettagli in `docs/blueprint/audit-oracoli/00-copertura-oracolo-rls.md`.
- **Baseline d'igiene**: `.trueline/hygiene-baseline.json`, da 67 a **64 impronte**, tracciata in git.
  **Attribuita PRIMA di ricatturare**, mai il contrario:
  - **5 aggiunte**: 2 sono le `inner_page_rules` identiche fra quattro ricette su cinque
    (ripetizione DICHIARATIVA — le cinque direzioni differiscono nell'ordine della home, non nelle
    regole interne); 1 e' il blocco di import condiviso fra `recipes.ts` e `pages.ts` (non
    rimovibile); **2 sono SPURIE**, su `05-generation-e2e.md` che non e' stato toccato — sono
    impronte SPOSTATE perche' e' stato editato il partner della coppia (**R-04**: le impronte sono
    sensibili alla POSIZIONE).
  - **8 sparite, e NON sono copertura persa**: verificato che le stesse posizioni restano nella
    baseline sotto impronte diverse (17 in `src/data/**`, fra cui `sites.ts:70` che risultava
    "sparita"). `jscpd` ri-accoppia i blocchi quando il corpus cambia.
  - **2 duplicazioni sono state RIMOSSE davvero**, non benedette: `testoPresente` (vedi §5).
- **Suite**: **858 test in 68 file**, 0 falliti, 0 skippati. Erano 643.
- **Budget/forma**: 2 agenti per workflow, un task per volta. **Dal prossimo macrotask cambia**
  (§8.1).

## 5. Esiti del BUILD di `generation-engine` (framing onesto)

**Tre cose che il checkpoint ha trovato e che nessuna review avrebbe visto.**

1. **`testoPresente` era definita TRE VOLTE identica** in `blocks.ts`, `pages.ts` e `resolve.ts`.
   Non e' un'utilita': decide se un blocco ESISTE, quindi se il modello riceve i suoi slot
   (P2-D7), e poi se una pagina esiste (T-213) e se un campo entra nel documento (T-214). Estratta
   in `gate.ts`, la sede che esisteva gia' per le primitive condivise. **Verificato che l'estrazione
   non l'abbia spostata dove nessuno guarda**: togliere il trim da' 7 rossi, renderla sempre vera
   ne da' 20 — e ora una sola mutazione e' giudicata dai test di tre moduli insieme.
   **Perche' le tre copie esistevano**: i JSDoc lo DICHIARAVANO («l'alternativa sarebbe aprire un
   artefatto gia' passato dal checkpoint del proprio macrotask»). I builder sapevano; il vincolo
   «tocchi esattamente due file» lo imponeva. E' un costo del metodo, e il checkpoint di macrotask
   e' il posto giusto in cui pagarlo.
2. **La deduplicazione dei blocchi in `resolve` non e' difensiva, e' PORTANTE.** Su una one-pager
   le sequenze dei ruoli assorbiti si sovrappongono a `home_blocks` per costruzione (ogni blocco
   dichiara il ruolo `home`), quindi senza di essa OGNI one-pager avrebbe il blocco offerte due
   volte. Misurato spegnendola: il caso peggiore passa da **6.156.391 a 12.185.391 byte** (145,3%
   del tetto di 8 MiB), con 12 blocchi per pagina — esattamente `blocks_per_page`. Il documento
   viene rifiutato. `blocks_per_page` e' rispettato **per costruzione**, non da un controllo.
3. **La difesa sul `photo_ref` non e' la riga di `resolve`.** Togliendo il `delete`, l'URL non
   passa in silenzio: il gate di T-202 RIFIUTA il documento con `unrecognized_keys`.
   L'irrappresentabilita' per tipo e' la difesa; la riga di `resolve` serve a non trasformarla in
   una generazione fallita.

**Il confine di import, chiuso in ogni forma equivalente** (commit `ee9baa5`, fuori dal blueprint,
deciso dall'utente). `no-restricted-imports` di ESLint 10.7.0 **non ha alcun handler
`ImportExpression`**: `import('@/data/supabase-admin')` dava 0 messaggi da qualunque layer, page
comprese. Chiuse cinque forme: import dinamico, estensione `.js`, file non-TS, **template literal**
senza buchi, e segmento doppio/puntato. Sui due confini privilegiati regge comunque `server-only`
(il build fallisce); su quello dei TEMI no — li' la regola di lint **e'** il meccanismo.

**Emendamenti al blueprint**, tutti approvati dall'utente su misure: `P2-D24` (la galleria fuori
dal catalogo v1) · `P2-D25` (la DoD di T-215 allineata a cio' che il modulo puo' promettere con
verita': `effect: 'unlocks' | 'specializes'`). Piu' la correzione del contratto di `PageSpec`
(`section_roles` → `absorbed_roles`, `priority` e `justifying_blocks` tolti dove erano inerti),
fatta **prima** che T-214 lo consumasse. `validate_blueprint.mjs` **EXIT 0** dopo ognuno.

## 6. Copertura dichiarata (cosa NON e coperto, da subito)

> Le voci 1-21 sono ereditate dalle sessioni precedenti e restano valide. Qui le NUOVE.

22. **Il 404 interno e' irrappresentabile RELATIVAMENTE ALL'ARGOMENTO**, non al set generato.
    `PageSpec` e' esportato senza brand: `navigationFor` su una spec fabbricata a mano con uno slug
    inesistente restituisce quella destinazione. Che l'argomento sia il set generato e'
    **precondizione del chiamante**. La versione forte (`pagesFor` che restituisce set e
    navigazione insieme) e' stata valutata e SCARTATA: sarebbe un emendamento alla DoD.
23. **La meta' STATICA del segmento doppio resta aperta**: `@/data//anthropic` sfugge ancora ai
    `patterns` di ESLint. Tre gruppi di glob provati, nessuno chiude il segmento VUOTO (il
    pacchetto `ignore` non lo fa combaciare). Chiuderla richiede un resolver, non un confronto di
    stringhe. **Pinnata da un test** che diventera' rosso il giorno in cui qualcuno la chiude.
24. **Il confine non vede `import(variabile)`, il template col buco sul nome, e `require()`.**
    Dichiarato in `eslint.config.mjs`.
25. **`applyRecipe` NON deduplica**: per T-214 «nessun doppione» e' una PRECONDIZIONE, non un
    teorema. Il vincolo vale per le cinque ricette del catalogo, non per ogni `SiteRecipe` che un
    chiamante possa costruire.
26. **`resolve` lancia su due assi dichiarate**: un `role` o un ruolo assorbito fuori vocabolario
    (l'eccezione cade dentro `applyRecipe`, T-212), e i cinque argomenti nulli. Difendersene
    vorrebbe dire riscrivere qui la forma di cinque contratti di monte.
27. **La chiave della mappa degli orari e' TESTO DELL'UTENTE** che entra nel documento come chiave
    di oggetto. La forma la vincola T-202 e la lunghezza il brief, ma il contratto di sanificazione
    dei blocchi nomina il CAMPO `hours`, non le sue chiavi: **T-231 deve trattarle come dato**.
28. **`generatable` non da' la guida sulla soglia della pagina contatti ne' sulle materie FAQ.**
    Misurato: da uno stato intermedio (un recapito gia' scritto, due materie su tre) **un solo
    campo basterebbe** — 14 coppie fra i casi del file. Riscrivere qui quelle soglie sarebbe una
    seconda verita' sulla stessa cosa.
29. **L'identita' per riferimento delle voci restituite da `applyRecipe` e da `resolve` non e'
    giudicata**, per una ragione strutturale: `toEqual` e' un confronto STRUTTURALE e uno spread
    superficiale condivide array e closure, quindi una copia e' uguale per costruzione.
30. **La provenienza dei ruoli superstiti in `generatable` non e' osservabile**: leggerli dal
    risultato di `pagesFor` o ricalcolarli dalle precondizioni da' lo stesso risultato per ogni
    tetto. La scelta resta giusta (una sola verita' non puo' divergere) ma e' architettura, non
    un'asserzione.

## 7. Carry-over

### Chiusi da questo macrotask
- **P1 §7 p.1** (*«`isBriefComplete` verifica presenza e non provenienza»*): **CHIUSO** da
  `AC-215-4`. Il caso e' costruito passando dal validatore vero e asserito nei due versi; il
  verifier l'ha rimisurato su 11 brief: **sei sono accettati da P1 e rifiutati da P2**, e il verso
  opposto non esiste.
- **Copertura §11 di P2** (*il `page_role` di uno slot non e' pinnato*): **CHIUSO** in T-213, che
  pinna la corrispondenza fra i blocchi giustificanti e il `page_role` dei loro slot.

### Aperti, dichiarati
- **R-01/R-03** (cecita di `RLS004` su `generation_pools`, `parse_warnings` non fatali) e **R-04**
  (le due normalizzazioni divergenti): vivono nella **skill trueline**, non nel repo.
- Il lato (a) di **S2-05**; il costo di rigidita' dello schema A.
- **La CI non e' mai stata provata da una run reale** (`gh` non installato).
- Le voci 22-30 di §6.

### Restano aperti da P1
`readyForReview` verifica presenza e non provenienza (§7 p.1 — la parte su `readyForReview`, non
quella su `isBriefComplete`); la history della chat non e' persistita; `upsertBrief` non riporta i
campi scartati; T-122 fonde le offerte per nome; `P1-D11` sul contratto di altitudine, **ancora
rinviato**.

## 8. Prossimi passi & decisioni

1. **METODO NUOVO, deciso dall'utente il 2026-07-30 — vale DAL PROSSIMO MACROTASK.**
   **UN SOLO dynamic workflow per MACROTASK**, in `pipeline()` sul DAG interno: un **builder** per
   task atomico, un **verifier BLIND** per task (legge codice e AC, **non** il report del builder),
   un **fixer per TASK** (non per rilievo: due fixer sullo stesso file si sovrascrivono), e **UNA
   SOLA fermata umana** con tutti i rilievi insieme. In `generation-engine` quattro task su cinque
   hanno prodotto una decisione dell'utente: quattro fermate invece di una.
   - **`isolation: 'worktree'` e' praticabile, MISURATO il 30/07**: un worktree git non porta
     `node_modules` (gitignorato), ma una **giunzione** (`cmd /c mklink /J`) basta —
     `npx vitest run` 37 verdi e `npx tsc --noEmit` exit 0, **senza `npm ci`**.
   - **PERICOLO DISTRUTTIVO**: rimuovere la giunzione con `rmdir` **PRIMA** del worktree. Un
     `rm -rf` o un `git worktree remove --force` la attraverserebbero e cancellerebbero il
     `node_modules` **vero**.
   - Il worktree isola i FILE, non Supabase: i test DB-backed vanno **serializzati** e la suite
     intera si esegue **una volta sola, al checkpoint**.
   - **Lo schema di ritorno degli agenti: max ~6 campi di TESTO PIATTI.** Uno schema con 11 campi e
     due array annidati ha fatto sbattere un agente contro il tetto di 5 tentativi di
     `StructuredOutput`: **160 tool call e 493k token persi per un errore di forma**.
2. **Prossimo BUILD**: `generation-llm` (T-220..T-225).
3. **Riconfermare il deploy-coupling** all'apertura: non e' una formalita', e' la ragione per cui
   il merge e' autonomo.
4. **Decisioni ancora dell'utente**: taratura crediti/prezzi dopo T-225; attivazione del contratto
   `architecture:` (`P1-D11`).
5. **INVOCAZIONE DEL CHECKPOINT — due trappole misurate il 30/07, entrambe costose:**
   - **Il percorso del repo va passato ASSOLUTO.** Con `.` lo script risolve il workspace sulla
     **directory della skill** e misura il repo sbagliato: il primo giro ha prodotto un finding
     HIGH dentro `eval/reference-app/` della skill e tre controlli degradati.
   - **`baseline.mjs capture <dir> --hygiene` scrive sulla baseline di SICUREZZA.** Il flag
     seleziona gli ORACOLI d'igiene ma l'output va su `.trueline/baseline.json` a meno di passare
     `--out`; `hygieneBaselinePath` esiste nel file ma la CLI non la usa. Invocazione giusta:
     `capture <dir> --hygiene --out .trueline/hygiene-baseline.json`.
   - Restano valide: `db reset` + restart di kong + attesa che `/auth/v1/health` risponda 200 (un
     rosso da kong non pronto sarebbe FALSO); `.env.local` FUORI dal repo con le variabili
     esportate dalla shell; **`rm -rf .next` prima di ogni checkpoint** (senza, il controllo 2
     produce 28 finding CRITICAL falsi dentro la cache di build); `--in-place --mode build`
     **senza** `--blueprint`; e **il verdetto si legge nel JSON**, mai dall'exit code — al
     checkpoint finale `exit=0` conviveva con `green: false`.
6. **TRAPPOLA DELL'ORACOLO DI MUTAZIONE**, da non ricomprare: `npx vitest run --reporter=basic`
   NON esiste in vitest 4.1.10 — il processo muore al caricamento del reporter ed esce **sempre**
   != 0, quindi *tutte* le mutazioni risultano "PRESE". Un ri-verificatore ci ha firmato **37 falsi
   positivi** prima di accorgersene. Il rosso si riconosce dalla **riga di riepilogo**
   ("Tests N failed / N passed"); un'esecuzione senza quella riga e' **INVALIDA**, non rossa.
7. **Nota sull'infrastruttura, dichiarata**: in questa sessione i workflow sono morti tre volte per
   cause esterne (due 529 con 0 agenti partiti, un limite di sessione) e una per lo schema di
   ritorno. In due casi il giro di fix e la ri-verifica sono stati eseguiti
   **dall'orchestratore**, con l'albero verificato intatto per sha256 prima di procedere e le
   mutazioni del verifier rigirate una per una. E' una differenza di metodo, **dichiarata e non
   dedotta**. `resumeFromRunId` e' la mitigazione: gli agenti completati tornano dalla cache.
