# SESSION-STATE — Belora · P2 (Generazione dei mockup)

> Fonte di verita sullo **stato vivo** del sotto-progetto P2. Letta da BUILD a ogni
> apertura e aggiornata a ogni chiusura (`prompts/session-end.md`). Distinta dalla
> SESSION-STATE della skill trueline e da quelle di P0 e P1.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (JS/TS + Supabase) |
| **Ultimo aggiornamento** | 2026-07-26 (sessione CHIUSA: fase A design + fase B bootstrap, nessun codice) |
| **Sessione corrente** | **CHIUSA.** Ha prodotto il design di P2 (17 decisioni chiuse in brainstorming, una domanda per volta), lo studio di fattibilita sull'ingest delle foto del cliente, e il blueprint completo: **5 macrotask, 27 task atomici, 156 acceptance criteria**. Self-check strutturale `validate_blueprint.mjs` **EXIT 0** prima e dopo l'applicazione dei rilievi semantici. **Nessun codice prodotto, nessun macrotask costruito, nessun checkpoint applicabile.** La prossima sessione riparte dal **primo BUILD su `generation-model`**. |

---

## 1. Stato dei macrotask

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| generation-model | **todo** | — | T-200..T-204 — i contratti: 2 tabelle con RLS, PoolSchema, SiteDocumentSchema, server action separate fra lettura/creazione e scrittura. **Introduce superficie DB nuova**: `rls:0` va riconquistato |
| generation-engine | **todo** | — | T-210..T-215 — la trasformazione pura: blocchi, temi, ricette, pagesFor, resolve, generatable. Il cuore, e l'unico strato con oracoli pieni senza chiave API |
| generation-llm | **todo** | — | T-220..T-225 — il confine: proiezione allowlist, normalizzatore, tool strict, prompt, `runGenerationTurn`, harness di misura |
| generation-ui | **todo** | — | T-230..T-237 — rotta e stream, blocchi narrativi (+ chiavi i18n) e blocchi di dati, selettore, congelamento, fase 2, anteprima, dashboard. **Il macrotask piu esposto** |
| generation-e2e | **todo** | — | T-240..T-241 — il primo end-to-end vero del progetto, canary compreso |

**→ 27 task atomici, 5 macrotask. Nessuno costruito.**

**Nessun checkpoint e applicabile in questa fase.** Il checkpoint gira al confine di un
macrotask *costruito*, e non e stato scritto codice: dead-code, sicurezza, regressioni e
conformita-logica sono **NON ESEGUITI**, cosi come `gitleaks`, `osv`, `semgrep` e `rls`.
L'unico oracolo che ha girato in questa sessione e `validate_blueprint.mjs`. La colonna
Checkpoint vuota va letta come **non eseguito**, non come "non ancora verde".

## 2. Macrotask corrente

- **Selezionato**: nessuno. Il primo BUILD deve partire da **`generation-model`**: e l'unico
  senza dipendenze, e sia `generation-engine` sia `generation-llm` ne consumano i contratti.
- **Task atomici in corso**: nessuno.
- **Criteri/test di riferimento**: vedi `01-generation-model.md` e i `target_tests` dei task
  (oracolo del controllo 4 in BUILD).

## 3. Stato git

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/design/p2-generation` (fase A + questo BOOTSTRAP; **non** mergeato) |
| Ultimo commit | `74293b4` — working tree pulito, `origin/trueline/design/p2-generation` allineato |
| Stato merge su `main` | **NON mergeato.** Il branch porta solo documenti (spec, ricerca, blueprint): nessun codice, quindi nessun checkpoint applicabile. La decisione di mergiare e dell'utente, non un gate da superare |
| Deploy-coupling | **`main_deploy_coupled: false` EREDITATO da P1, NON riconfermato in questa sessione** (nessun BUILD): da RICONFERMARE all'apertura del primo BUILD. P2 tocca aree deploy-sensibili in modo piu esteso di P1 (due rotte nuove, un endpoint `/api` nuovo, migrazioni DB): la riconferma non e una formalita. **Nessuna operazione distruttiva e nessun deploy in questa sessione** |

Commit della sessione, in ordine:
`d736dbe` studio di fattibilita sull'ingest delle foto · `67e419e` design di P2 (15 decisioni) ·
`7df5f4a` multi-pagina in v1 (P2-D13) + budget provvisorio (P2-D17) · `2b20a5c` blueprint
bootstrappato (25 task) · `74293b4` rilievi del self-check semantico applicati (27 task).

## 4. Baseline & budget

- **Baseline di sicurezza** (ereditata da P1): `gitleaks:0 · osv:0 · semgrep:0 · rls:0`.
  **`rls:0` non e ereditabile**: P2 introduce due tabelle nuove, quindi va riconquistato al
  checkpoint di `generation-model`.
- **Baseline d'igiene** (ereditata da P1): `.trueline/hygiene-baseline.json`, **41 impronte**,
  tracciata in git. Il controllo 1 e **rosso se la baseline manca**, anche con zero
  duplicazioni nuove: non toccarla senza attribuzione.
- **Suite ereditata**: 467 test in 56 file, 0 falliti, 0 skippati (di cui 56 DB-backed con
  auth reale su 11 file). Nessuna regressione ammessa.
- **Budget**: definito per-ciclo in BUILD. La forma che tiene, per esperienza di P1, e
  **2 agenti per workflow** (builder + verifier), un task per volta, con la batteria di
  mutazione dell'orchestratore fra un task e l'altro.

## 5. Esiti dell'ultima sessione (framing onesto)

- **Fase A (design)**: 17 decisioni chiuse in brainstorming con l'utente, una domanda per
  volta, e scritte in `docs/superpowers/specs/2026-07-26-p2-generation-design.md`.
- **Ricerca collegata**: studio di fattibilita sull'ingest delle foto del cliente (4 angoli,
  doppia refutazione, critico di completezza). Esito: iCloud non ha API per app web; gli
  scope di lettura di Google Photos sono stati **rimossi** il 2025-03-31; il picker di
  sistema del telefono raggiunge **già** entrambe le librerie cloud. Sede: **P4**. Una
  contraddizione sui termini d'uso e registrata **come irrisolta**, non arbitrata.
- **Rilievo che tocca P1.x**: le Business Profile API Policies vietano `pre-fetch, cache,
  index, or store` fuori dal progetto — le foto GBP **non sono ri-ospitabili**, e poiche la
  clausola dice `any content` il divieto va riletto anche contro l'import dei **dati**.
  Nota di aggiornamento aggiunta alla visione §12.
- **Fase B (questo BOOTSTRAP)**: blueprint di 5 moduli e **27 task atomici** generato dalla
  spec. **Nessun codice prodotto.**
- **Self-check strutturale**: `validate_blueprint.mjs` sulla dir P2 — **EXIT 0**, tutti e 5
  i controlli OK (campi obbligatori, copertura AC→test, DAG aciclico, id univoci, ownership).
- **Self-check semantico** (punti 6–10): eseguito, **4 rilievi + 3 minori**, tutti portati
  all'utente e da lui **approvati e applicati** nella stessa sessione:
  1. `T-203` era troppo largo (sei azioni, 9 AC) → **split in T-203** (creazione/lettura +
     riconciliazione) **e T-204** (scrittura + macchina a stati).
  2. `T-231` era troppo largo → **split lungo la linea del RISCHIO** e non del conteggio:
     **T-231** blocchi narrativi + fondamenta condivise, **T-237** blocchi di dati, dove si
     concentra il testo non fidato e dove nascono i link da campi liberi.
  3. **Gap di copertura chiuso**: le chiavi i18n delle etichette dei blocchi non erano di
     nessun task (artefatto consumato e prodotto da nessuno) → ora sono nella DoD di T-231,
     con un controllo **totale sul catalogo** che rompe se un blocco nuovo non porta la sua
     chiave (chiude anche P1 §6-bis p.13, dove i test catturavano rinomine e rimozioni ma
     non le aggiunte).
  4. `T-230` segnalato **al limite** ma non splittato: paragonabile a T-150 di P1, che ha tenuto.
  Minori applicati: `AC-223-6` ristretta a percorsi e valori esatti (evita falsi positivi),
  `AC-223-1` resa **totale sull'enum dei locale** col limite residuo dichiarato,
  `AC-240-1` ora nomina una risorsa attesa invece di asserire "non vuoto".
- **Nessuna fix applicata e nessuna batteria di mutazione**: entrambe operano sul codice, e
  in questa sessione non ne e stato scritto. Non sono state saltate: sono **inapplicabili**.
  L'equivalente di fase e stato il self-check semantico, con l'oracolo strutturale rieseguito
  dopo l'applicazione dei rilievi. Gli split hanno fatto emergere AC che nel task monolitico
  non esistevano: indice di variante respinto **prima** del DB, transizione di stato che e un
  **errore** e non un no-op silenzioso, payload ostile dentro il **nome** di un'offerta.

## 6. Copertura dichiarata (cosa NON e coperto, da subito)

> Il "fatto" si dichiara per fatti. Queste voci nascono **aperte** e non vanno confuse con
> un verde.

1. **Non esiste una chiave API.** Ogni oracolo di `generation-llm` mocka il confine. Gli
   schemi strict **non sono provati contro l'API reale** (eredita P1 §6-bis p.2), e la
   qualita del copy non e oracolata.
2. **Le costanti di `GENERATION_BUDGET` sono stime, non misure** (`P2-D17`). I due candidati
   piu probabili a essere rivisti **in alto**: la crescita del system prompt (1,5k → 3-5k
   token) e l'uscita della fase 2 (~300 → 400-600 parole per pagina). Sede della misura:
   **T-225**, che senza chiave si dichiara *non eseguito*.
3. **La taratura crediti↔prezzi non e decisa** e non va decisa su queste stime. Registrato
   che, con `build = 5 crediti`, il piano Studio a pieno consumo arriverebbe a **~49% del
   ricavo** (~80% su Opus 5); il rimedio che esiste gia nella visione §7.3 e "1 credito per
   pagina aggiunta". Decisione di **P5**.
4. **La latenza non e misurata**, ne per la fase 1 (obiettivo secondo flush < 60 s) ne per
   la fase 2. Il **tetto di durata delle funzioni** della piattaforma di hosting va
   verificato contro il budget, non supposto.
5. **L'anti-fuga e un match per sottostringa** su `JSON.stringify` (eredita P1 §6-bis
   p.6-bis): prova che *questa* implementazione non perde, non che nessuna implementazione
   possa perdere. Una fuga **trasformata** (base64, percent-encoding) le sfuggirebbe, e non
   esiste barriera di tipo fra il Brief e la proiezione.
6. **Lo stile non e asserito** (eredita P1 §6-bis p.8). I due controlli di `generation-engine`
   provano che il layer dei temi e cablato e distinto, **non** che i temi siano belli.
7. **Lo spagnolo eredita la debolezza dei cataloghi** (P1 §6-bis p.7): una traduzione
   sbagliata ma diversa passa l'oracolo. E `es` e **una lingua sola**: l'ingresso in LATAM
   chiedera varianti regionali.
8. **Nulla limita la frequenza** delle generazioni per account. L'indice UNIQUE parziale
   copre la concorrenza sul singolo sito, non la raffica su siti diversi: tetto complessivo
   a **P5**.
9. **L'end-to-end non percorre login e onboarding** (rate limit auth). Copre l'anteprima e
   il percorso genera→scegli→anteprima, non il flusso di P1.

## 7. Carry-over ereditati da P1 che P2 tocca

- **CHIUSO da P2 (se il blueprint viene costruito come scritto)**: P1 §7 p.5
  (sanificazione del testo importato nel sito generato → T-231 + T-241); P1 §6-bis p.2 per
  la parte del nested `additionalProperties` senza `required` (→ T-222 AC-222-1);
  P1 §7 p.16 (protezione del middleware su `/preview` riasserita → T-235);
  P1 §7 p.15 per la parte di P2 (N+1 in dashboard → T-236 AC-236-1).
- **RESTANO APERTI**: la corroborazione di `readyForReview` verifica la presenza e non la
  provenienza (P1 §7 p.1) — P2 non ci poggia (T-215 AC-215-4) ma non la chiude;
  la history della chat non e persistita (P1 §7 p.2); `upsertBrief` non riporta i campi
  scartati (P1 §7 p.3, sede T-123); T-122 fonde le offerte per nome (P1 §7 p.4);
  `P1-D11` sul contratto di altitudine, **ancora rinviato**.

## 8. Prossimi passi & decisioni

1. **Registrare l'esito del self-check strutturale** di `validate_blueprint.mjs` e
   committare il blueprint sul branch.
2. **Primo BUILD su `generation-model`** (T-200..T-204), con riconferma esplicita del
   deploy-coupling all'apertura.
3. **Riconquistare `rls:0`** al checkpoint di `generation-model`: e superficie DB nuova, non
   ereditata.
4. **Non toccare la baseline d'igiene** senza attribuzione preventiva delle duplicazioni:
   catturarla per far passare il controllo 1 benedirebbe anche le proprie (lezione di P1).
5. **Decisioni ancora dell'utente**, non della skill: la taratura crediti/prezzi dopo la
   misura di T-225, e l'eventuale attivazione del contratto `architecture:` (`P1-D11`).
6. **Nota operativa verificata**: gli script trueline sono presenti in due percorsi — la cache
   dei plugin (`~/.claude/plugins/cache/trueline-local/trueline/0.1.0/skills/trueline/`, quello
   registrato in P1 §6) e la dist su Desktop, da cui la skill si e risolta in questa sessione.
   `validate_blueprint.mjs` e **il medesimo file** nei due percorsi (stessa dimensione, stesso
   timestamp): il percorso registrato in P1 resta valido, non c'e nulla da correggere.
