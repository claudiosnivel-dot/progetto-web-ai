# SESSION-STATE — Belora · P2 (Generazione dei mockup)

> Fonte di verita sullo **stato vivo** del sotto-progetto P2. Letta da BUILD a ogni
> apertura e aggiornata a ogni chiusura (`prompts/session-end.md`). Distinta dalla
> SESSION-STATE della skill trueline e da quelle di P0 e P1.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (JS/TS + Supabase) |
| **Ultimo aggiornamento** | 2026-08-04 (BUILD del macrotask **`generation-llm`**: T-220..T-225 costruiti, checkpoint **VERDE 4/4**, mergeato su `main` con `4f36e16`) |
| **Sessione corrente** | **BUILD di `generation-llm`**, il terzo macrotask di P2. Sei task atomici. **Suite da 858 a 976 test.** Sette decisioni dell'utente, sei registrate come `P2-D26`..`P2-D31`. Checkpoint di macrotask VERDE 4/4, `degraded: []`, merge autonomo su `main` |
| **Sessione precedente** | BUILD di `generation-engine` (30/07): T-210..T-215, checkpoint VERDE 4/4 |

---

## 1. Stato dei macrotask

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| generation-model | **done** | **VERDE 4/4** (2026-07-28) | T-200..T-204 |
| generation-engine | **done** | **VERDE 4/4** (2026-07-30) | T-210..T-215 |
| generation-llm | **done** | **VERDE 4/4** (2026-08-04) | T-220..T-225. 9 commit sul branch + 1 di merge. `degraded: []` |
| generation-ui | **todo** | — | T-230..T-237 — il macrotask piu' esposto. **Prossimo BUILD** |
| generation-e2e | **todo** | — | T-240..T-241 — il primo end-to-end vero |

**→ 27 task atomici, 5 macrotask. Tre costruiti e chiusi, due da costruire.**

### 1-bis. I sei task di `generation-llm`, e cosa ha prodotto il verde

| Task | Output | Mutazioni del verifier | Esito dopo le fix |
|---|---|---|---|
| T-220 | `projection.ts` — `PROJECTION_ALLOWLIST` enumerata, `PROJECTION_LIMITS`, `briefProjection` | 52 | 15 test (erano 11); 14 mutazioni ridiventate PRESE |
| T-221 | `normalize.ts` — `normalizeForPrompt`, conservativo e idempotente | **42: 29 prese, 13 SOPRAVVISSUTE** | 13 test; le 4 ALTA chiuse |
| T-222 | `tool.ts` — `buildPoolTool`, guardia ricorsiva del sottoinsieme | 30: 20 prese, 10 sopravvissute | 13 test; `P2-D28` implementata |
| T-223 | `prompt.ts` + `budget.ts` — `SYSTEM_PROMPTS`, `buildGenerationPayload`, `GENERATION_BUDGET` | 48 | 28 test; `P2-D26` e `P2-D30` implementate |
| T-224 | `runGenerationTurn` in `src/data/anthropic.ts` + `getAnthropicGenerationModel` | **58** | 28 test; `P2-D29` implementata |
| T-225 | `scripts/measure-generation-usage.ts` — harness di misura | 57 | 16 test; `P2-D27` e `P2-D31` implementate |

**Il dato che riassume il macrotask, ed e' lo stesso di `generation-engine`**: sei suite VERDI con
~287 mutazioni girate contro, e **nessun giro di fix ha corretto un bug di produzione**. I difetti
stavano tutti nell'ORACOLO. `src/` e' stato modificato **oltre la costruzione** solo per le decisioni
esplicite dell'utente (`P2-D26`, `P2-D27`, `P2-D29`, `P2-D31`) piu' due commenti.

### Verdetto del checkpoint, letterale (dal JSON, non dall'exit code)

```
checkpoint=VERDE | 1:dead-code=green 2:security=green 3:regressions=green 4:conformance=green
  1 dead-code  green  nessuna regressione d'igiene NUOVA [dead-code:0 dup:66 cycle:0 twin:0]
  2 security   green  nessun finding di sicurezza NUOVO >= HIGH [gitleaks:0 osv:7 semgrep:0 rls:0]
  3 regressions green  test verdi
  4 conformance green  test verdi
degraded = []
```

**Il verde e' credibile per una ragione che viene da questa sessione**: lo stesso oracolo e' stato
**ROSSO due volte di fila** (4 duplicazioni nuove, poi 1) ed e' diventato verde solo dopo una
modifica reale. Non e' una promessa che sappia diventare rosso: e' un fatto osservato tre volte.

## 2. Macrotask corrente

- **Selezionato**: nessuno. Il prossimo BUILD e' **`generation-ui`** (T-230..T-237), le cui
  dipendenze (`generation-model`, `generation-engine`, `generation-llm`) sono ora tutte verdi.
- **Attenzione**: e' il macrotask **piu' esposto** di P2 — il rendering del testo non fidato del
  brief nel sito generato (carry-over P1 §7 p.5) — e il primo che aggiunge rotte e un endpoint
  `/api`. Il deploy-coupling andra' riconsiderato, non solo riconfermato.
- **Task atomici in corso**: nessuno.

## 3. Stato git

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/generation-llm` — 9 commit, tutti pushati |
| Stato merge su `main` | **Mergeato sul verde** (`4f36e16`, `--no-ff`). `main == origin/main`. Working tree pulito |
| Deploy-coupling | **`main_deploy_coupled: false` RICONFERMATO dall'utente al confine del macrotask**, non all'apertura: la richiesta fatta all'apertura non aveva avuto una risposta esplicita e **non e' stata data per concessa**. Il rilevatore dice `true` (segnale unico: `supabase/config.toml`); l'override e' una decisione umana ripetuta. Nessun deploy, nessuna operazione distruttiva |
| Nota | `generation-llm` non ha aggiunto migrazioni, rotte o endpoint `/api`: dominio puro, piu' un'aggiunta al confine esistente, un accessor di config, e la configurazione di lint/knip |

## 4. Baseline & budget

- **Baseline di sicurezza**: **INVARIATA**, hash identico prima e dopo (`gitleaks:0 semgrep:0 rls:0`).
  Verificato **dopo** la cattura d'igiene, non prima: e' la trappola di §8.5 (senza `--out`,
  `capture --hygiene` scrive proprio su questo file).
- **La riserva del 29/07 su `rls:0` RESTA VALIDA e questo macrotask non la chiude**: `rls:0`
  significa «nessun rilievo prodotto», non «tutte le tabelle auditate» — su **2 tabelle su 7**
  l'oracolo statico non guarda (`generation_pools`, `profiles`). Dettagli in
  `docs/blueprint/audit-oracoli/00-copertura-oracolo-rls.md`. `generation-llm` **non aggiunge alcuna
  tabella**: il «`rls` va riconquistato» di `00-INDEX` §3 riguardava `generation-model` (T-200), non
  questo macrotask. Qui non c'era nulla da provare a runtime, e **nulla e' stato provato**.
  *(Questa voce era sparita nella prima stesura della SESSION-STATE di oggi, ed e' stata rimessa al
  session-end: una copertura dichiarata che svanisce riscrivendo il file e' il modo peggiore di
  chiuderla, perche' non lascia traccia.)*
- **Batteria di mutazione dell'ORCHESTRATORE**, trasversale: ogni mutazione girata contro **tutti** i
  file di test del macrotask insieme, che e' l'unica forma capace di vedere i difetti **fra** un task
  e l'altro — quelli che nessun verifier per-task puo' vedere.
  **Primo giro, prima delle fix: 11 mutazioni — 2 INVALIDE** (ancorate a una stringa presente anche
  in un JSDoc: hanno mutato il commento, vedi §5), **6 prese, 3 sopravvissute**. Le tre: il nome del
  tool (l'handshake T-222<->T-224, che nessuno dei due sorvegliava), l'allowlist degli slug
  allargata, e il system prompt italiano a un cliente spagnolo.
  **Secondo giro, dopo le fix: 7 mutazioni, 6 PRESE.** L'unica sopravvissuta e' stata chiusa in
  orchestrazione (vedi §5) e rigirata: **PRESA**.
  **Ripristino verificato per sha256 in entrambi i giri**: gli hash coincidono.
- **`osv` e' passato da 0 a 7** fra la cattura della baseline (30/07) e oggi. **Non viene da questo
  macrotask**: sono avvisi su dipendenze pubblicati nel frattempo. Il controllo 2 li lascia passare
  con la sua regola («nessun finding NUOVO >= HIGH»), ma `npm audit` ne classifica **due come HIGH**:
  `undici` (diretta, response desynchronization) e `brace-expansion` (transitiva, DoS), piu' `next` e
  `postcss` moderate. **Carry-over aperto per decisione dell'utente**: si trattano dopo il merge, per
  non mescolare un aggiornamento del lockfile con la generazione in un solo commit.
- **Baseline d'igiene**: `.trueline/hygiene-baseline.json`, **64 impronte**. **Attribuita PRIMA di
  ricatturare**, mai il contrario:
  - Il primo checkpoint dava **4 duplicazioni nuove** (`dup:69`).
  - **3 erano VERE e sono state RIMOSSE, non benedette**: i corpi `rules:` di `eslint.config.mjs`
    erano ricopiati da un blocco all'altro. Estratti in tre costanti condivise
    (`CONFINI_PRIVILEGIATI`, `SOLO_SERVICE_ROLE`, `CONFINI_DEL_SITO_GENERATO`). Misurato: `dup` da
    **69 a 66**.
  - **1 e' SPURIA e resta, dichiarata**: `05-generation-e2e.md:142`. Il file **non e' modificato**
    (git lo conferma) e il blocco duplicato e' il `## Self-check`, **byte-identico nei cinque
    moduli** da prima della sessione: editando `03` sono cambiate le POSIZIONI e `jscpd` ha
    ri-accoppiato. E' **R-04**, e ha colpito **lo stesso file** anche al checkpoint precedente.
- **Suite**: **976 test in 77 file**, 0 falliti, 0 skippati. Erano 858 in 68.
- **Budget/forma**: un workflow di BUILD da **12 agenti** (6 builder + 6 verifier BLIND; 0 errori,
  2,7M token) e uno di **FIX da 6 agenti** (0 errori, 1,1M token). Il metodo di §8.1 ha retto.

## 5. Esiti del BUILD di `generation-llm` (framing onesto)

**Tre cose che il checkpoint e la verifica avversariale hanno trovato e che nessuna review avrebbe
visto.**

1. **`normalizeForPrompt` non aveva ALCUN consumatore di produzione.** `grep -rn "generation/normalize"
   src/` dava **zero** righe: `buildGenerationPayload` serializzava la proiezione GREZZA. La
   riduzione di superficie dichiarata dalle security_notes di T-221 **non era in vigore sul percorso
   reale**, e nessun oracolo poteva accorgersene — `knip` vede il file di test come consumatore,
   quindi il controllo dead-code sarebbe restato VERDE su un modulo di igiene inutilizzato. Misurato
   due volte: spegnendo la rimozione dei tag cadevano **solo i 5 test di normalize su 86**; dopo
   `P2-D26` la stessa mutazione ne rompe **9 su 133, in 2 file**. Il blueprint non nominava il
   consumatore in nessuno dei tre task a valle: era un buco della SPECIFICA, non del codice.
2. **`scripts/**` era fuori dai confini di lint e dall'oracolo dead-code.** Misurato sulla stessa
   sorgente lintata a percorsi diversi: `src/ui/**` **6 messaggi**, `src/app/**` **6**, `scripts/**`
   **ZERO**. Non era aperta per decisione — non era mai stata considerata. E il primo file nato li'
   costruisce `new Anthropic({ apiKey })`, cioe' il **secondo detentore della chiave grezza** del
   repo, contro `P1-D7`. Precisazione che vale: `scripts/**` **era gia' typecheckato** (verificato
   iniettando un errore di tipo), quindi il buco era di lint e dead-code, non di tipi.
3. **I corpi `rules:` di `eslint.config.mjs` erano copie.** Il costo non e' la ripetizione: e' che
   due blocchi che DEVONO dire la stessa cosa possono divergere in silenzio, e un confine che vieta
   di piu' in un layer e di meno in un altro **si aggira scegliendo dove mettere il file**. Ora
   «`scripts/**` e' trattato come `src/**`» e' un fatto del file. Comportamento verificato invariato,
   non affermato: la sonda da' gli stessi **6/6/3/6/0** di prima e i 45 test di confine restano verdi.

**Una mutazione e' sopravvissuta anche alle fix, ed e' stata chiusa in orchestrazione.** Allargare
l'allowlist degli slug con uno slug che nessuna fixture scrive (`'pagina-mai-chiesta'`, ma la forma
plausibile e' l'aggiunta di comodo di `'home'`) lasciava verdi **133 test su 133**. Il fixer aveva
chiuso il verso comportamentale — una pagina fuori allowlist cade — ma **nessun esito puo' osservare
un'allowlist allargata con uno slug che nessuno scrive**: la proprieta' va vista sull'ARGOMENTO. Una
spia non invasiva su `parsePool` la rende falsificabile.

**Un errore dell'orchestratore, dichiarato perche' e' istruttivo.** Due mutazioni della batteria
trasversale erano ancorate a una stringa (`strict: true`, `additionalProperties: false`) che compare
**anche nei JSDoc**, e `String.replace` ha mutato il COMMENTO invece del codice: entrambe risultavano
«SOPRAVVISSUTE» ed erano **misure invalide**. Rifatte ancorate alla riga di codice, sono PRESE. E'
la stessa famiglia dei 37 falsi positivi di P1: **una mutazione non verificata sulla riga non e' una
misura**. La batteria stampa ora il numero di riga e il suo testo, e rifiuta le ancore su commento.

## 6. Copertura dichiarata (cosa NON e coperto, da subito)

> Le voci 1-30 sono ereditate dalle sessioni precedenti e restano valide. Qui le NUOVE.

31. **Le asserzioni anti-fuga sono match per SOTTOSTRINGA, e ora il limite ha un numero.** Su T-220 il
    prefisso comune cercato e' lungo 9: una fuga piu' corta, o presa dalla CODA invece che dalla
    testa, non e' vista (misurato con due mutazioni dedicate). Su T-224 la granularita' scende a 6, e
    sotto i 6 il confronto comincerebbe a colpire testo legittimo. Una fuga **trasformata** (base64,
    percent-encoding, collasso degli spazi) sfugge a tutte.
32. **`AC-224-5` non puo' fallire per colpa di `runGenerationTurn`**, ed e' corretto che sia cosi':
    la funzione riceve `{ payload, phase, allowedSlugs }` e **non ha mai il Brief in mano**. Cio' che
    non entra non puo' uscire. E' una proprieta' della FIRMA, non un'asserzione: l'oracolo prova che
    T-220 e T-223 non perdono, non che questo modulo non possa.
33. **`AC-221-5` e' VACUO sul modulo di produzione**: `normalizeForPrompt(text: string): string`
    riceve e ritorna stringhe, che in JS sono immutabili, quindi **nessuna** implementazione puo'
    mutare il brief. Le sue righe non possono diventare rosse per alcuna mutazione di `normalize.ts`.
    Dichiarato nel file.
34. **«il test riporta il valore misurato» non e' soddisfatto col reporter di default** (AC-220-4,
    AC-223-4, AC-223-6): vitest 4 non stampa il `console.log` di un test PASSATO, quindi il numero si
    vede solo sul rosso o con `--reporter=verbose`. **Decisione dell'utente**: si dichiara il limite
    invece di cambiare il meccanismo, che vive identico in quattro file gia' checkpointati.
35. **Un letterale al posto della costante non e' distinguibile da alcun oracolo di comportamento**
    (stesso valore, stesso esito). L'unica rete e' la scansione dei letterali di `AC-223-6`, che e'
    limitata per costruzione a `src/domain/generation/**`, `src/data/generations.ts` e
    `src/data/anthropic.ts` — e vede solo i LETTERALI: la stessa evasione scritta come ESPRESSIONE
    (`600 * 1000`) le sfugge.
36. **`scripts/measure-generation-usage.ts` puo' raggiungere il confine LLM**: e' l'eccezione
    dichiarata di `P2-D27`, stretta quanto serve (il client `service_role` resta vietato anche li').
    Un file NUOVO sotto `scripts/` non eredita l'eccezione. Resta vero che il repo ha ora **due**
    posti che costruiscono un client con la chiave grezza, e il secondo e' sorvegliato dalla
    configurazione, non da un oracolo di test.
37. **Gli schemi strict non sono provati contro l'API reale** (eredita P1 §6-bis p.2): senza chiave
    ogni oracolo mocka il confine. Cio' che e' provato e' la conformita' al sottoinsieme accertato da
    `P1-D20`, che e' la migliore approssimazione disponibile e **non** un via libera dell'API.
38. **La qualita' del copy e la lingua non sono oracolabili.** `AC-223-1` prova che i prompt
    per-locale esistono, sono non vuoti, sono diversi e sono legati al locale: una traduzione
    SBAGLIATA ma diversa passerebbe. Cio' che il controllo garantisce davvero e' la **totalita' sul
    tipo** — un locale nuovo rompe il typecheck e obbliga a decidere.

## 7. Carry-over

### Chiusi da questo macrotask
- **Copertura §6 p.24 di P2** (*il confine non vede `import(variabile)` e `require()`*): **resta
  aperta**, ma il perimetro si e' allargato — `scripts/**` non e' piu' fuori dai blocchi.
- Il rischio dichiarato **P1 §6-bis p.2** (nested `additionalProperties:false` SENZA `required`) e'
  ora **chiuso in entrambe le meta'** da `AC-222-1` emendato (`P2-D28`).

### Aperti, dichiarati
- **`osv:7`, di cui 2 HIGH** (`undici` diretta, `brace-expansion` transitiva): lavoro a se', dopo il
  merge, per decisione dell'utente.
- **R-01/R-03/R-04** vivono nella **skill trueline**, non nel repo. R-04 ha prodotto di nuovo
  un'impronta spuria su `05-generation-e2e.md`, il file gia' colpito al checkpoint precedente.
- Il lato (a) di **S2-05**; il costo di rigidita' dello schema A.
- **La CI non e' mai stata provata da una run reale** (`gh` non installato).
- Le voci 22-38 di §6.

### Restano aperti da P1
`readyForReview` verifica presenza e non provenienza; la history della chat non e' persistita;
`upsertBrief` non riporta i campi scartati; T-122 fonde le offerte per nome; `P1-D11` sul contratto
di altitudine, **ancora rinviato**.

## 8. Prossimi passi & decisioni

1. **IL PROTOCOLLO DI LETTURA DELL'ORACOLO CAMBIA, ed e' la lezione di metodo di questa sessione.**
   **La riga `Test Files` e' obbligatoria quanto la riga `Tests`.** Misurato: con un modulo che lancia
   all'import, vitest stampa `Tests  3 passed (3)` — **zero falliti** — mentre `Test Files  2 failed |
   1 passed (3)` dice che **due file su tre non sono nemmeno partiti**. Chi legge la sola riga
   «Tests», come prescriveva il protocollo, firmerebbe un verde su una suite che non e' partita. E'
   il gemello della trappola di `--reporter=basic` di P1: entrambe fanno sembrare misurato cio' che
   non e' stato eseguito.
2. **Il metodo di §8.1 ha retto e resta.** Un workflow per macrotask (builder + verifier BLIND per
   task), **una sola fermata umana**, poi un workflow di soli fixer. Due precisazioni misurate:
   - **I fixer stanno FUORI dal workflow di build**, perche' «una sola fermata umana» e
     «human-in-the-loop sulle fix» sono compatibili solo se i rilievi arrivano all'umano PRIMA che
     qualcuno li applichi. Ha funzionato: 7 decisioni in due blocchi, nessuna patch applicata prima.
   - **`isolation: 'worktree'` NON e' stato usato, ed e' stata la scelta giusta qui**: i file di ogni
     livello erano disgiunti e il macrotask non ha **un solo test DB-backed** (il confine e' mockato
     ovunque). Il rischio distruttivo della giunzione non era ripagato da alcun beneficio.
   - **Le onde vanno ordinate sul DAG anche per i FIXER**, non solo per i builder: `P2-D26` cambia
     `buildGenerationPayload`, cioe' il payload che T-224 cattura e che T-225 compone. Ogni fixer di
     valle ha ricevuto l'istruzione esplicita di **non ammorbidire un'asserzione** per riassorbire il
     movimento.
3. **Prossimo BUILD**: `generation-ui` (T-230..T-237). E' il macrotask piu' esposto e il primo che
   aggiunge **rotte e un endpoint `/api`**: il deploy-coupling va **riconsiderato**, non riconfermato
   per abitudine.
4. **Decisioni ancora dell'utente**: taratura crediti/prezzi dopo la prima misura reale (`P2-D17`,
   che T-225 puo' ora produrre appena esiste una chiave); attivazione del contratto `architecture:`
   (`P1-D11`); gli avvisi `osv`.
5. **INVOCAZIONE DEL CHECKPOINT — le trappole, tutte riconfermate sul campo il 04/08:**
   - **Il percorso del repo va passato ASSOLUTO.** Con `.` (o senza) lo script risolve il workspace
     sulla directory della skill: `run_checkpoint.mjs --help` restituisce
     `fixture canonico assente: .../skills/eval/reference-app`.
   - **`baseline.mjs capture <dir> --hygiene` scrive sulla baseline di SICUREZZA** a meno di passare
     `--out`. Invocazione giusta:
     `capture <dir> --hygiene --out .trueline/hygiene-baseline.json`. **Verificato dopo la cattura**
     che `.trueline/baseline.json` avesse l'hash invariato.
   - **`rm -rf .next` prima di OGNI checkpoint**, e va rifatto ogni volta: **il checkpoint stesso lo
     ricrea**, quindi il secondo giro parte sporco se non lo si rimuove di nuovo.
   - **`db reset` NON e' sempre necessario, misurato.** I controlli 3 e 4 sono risultati verdi senza
     reset. Serve quando la finestra di rate limit dell'auth e' stata consumata; se in sessione si
     sono eseguiti solo file di test non DB-backed, **provare il checkpoint prima** invece di
     dedurre. E' comunque un'operazione **distruttiva**: mai in autonomia.
   - **I percorsi nei blocker portano il prefisso `eval/reference-app/`** anche quando il workspace
     e' corretto: e' una normalizzazione dell'oracolo, non un altro repo. Lo conferma la baseline
     stessa, che ha `project: C:/Users/claud/Desktop/progetto-web-ai` e voci con quel prefisso. **Non
     dedurne che si stia misurando la directory sbagliata**: il segnale vero e' il campo `workspace`.
   - **Il verdetto si legge nel JSON**, mai dall'exit code: in questa sessione `exit=0` ha convissuto
     con `green: false` **due volte su tre**.
6. **TRAPPOLA DELL'ORACOLO DI MUTAZIONE, ora in due forme.** (a) `npx vitest run --reporter=basic`
   NON esiste in vitest 4.1.10: il processo muore ed esce sempre != 0, quindi *tutte* le mutazioni
   sembrano PRESE (37 falsi positivi in P1). (b) **NUOVA, pagata il 04/08**: una mutazione ancorata a
   una stringa che compare **anche in un commento** muta il commento, e il risultato «SOPRAVVISSUTA»
   e' una **misura invalida**, non un rilievo. Il driver deve stampare **il numero di riga e il suo
   testo** e rifiutare le ancore che cadono su un commento.
