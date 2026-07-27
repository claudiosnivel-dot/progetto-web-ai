# SESSION-STATE — Belora · P2 (Generazione dei mockup)

> Fonte di verita sullo **stato vivo** del sotto-progetto P2. Letta da BUILD a ogni
> apertura e aggiornata a ogni chiusura (`prompts/session-end.md`). Distinta dalla
> SESSION-STATE della skill trueline e da quelle di P0 e P1.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (JS/TS + Supabase) |
| **Ultimo aggiornamento** | 2026-07-26 (chiusura BOOTSTRAP: blueprint generato, nessun codice) |
| **Sessione corrente** | **BOOTSTRAP CHIUSO.** Blueprint P2 generato dalla spec approvata del 2026-07-26 e validato strutturalmente. **Nessun macrotask costruito.** Il prossimo passo e il primo BUILD, su `generation-model`. |

---

## 1. Stato dei macrotask

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| generation-model | **todo** | — | T-200..T-203 — i contratti: 2 tabelle con RLS, PoolSchema, SiteDocumentSchema, server action. **Introduce superficie DB nuova**: `rls:0` va riconquistato |
| generation-engine | **todo** | — | T-210..T-215 — la trasformazione pura: blocchi, temi, ricette, pagesFor, resolve, generatable. Il cuore, e l'unico strato con oracoli pieni senza chiave API |
| generation-llm | **todo** | — | T-220..T-225 — il confine: proiezione allowlist, normalizzatore, tool strict, prompt, `runGenerationTurn`, harness di misura |
| generation-ui | **todo** | — | T-230..T-236 — rotta e stream, blocchi sanificati, selettore, congelamento, fase 2, anteprima, dashboard. **Il macrotask piu esposto** |
| generation-e2e | **todo** | — | T-240..T-241 — il primo end-to-end vero del progetto, canary compreso |

**→ 25 task atomici, 5 macrotask. Nessuno costruito.**

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
| Ultimo commit | da registrare alla chiusura di questa sessione |
| Stato merge su `main` | **NON mergeato.** Il branch porta solo documenti (spec, ricerca, blueprint): nessun codice, quindi nessun checkpoint applicabile |
| Deploy-coupling | **`main_deploy_coupled: false` EREDITATO da P1, da RICONFERMARE a inizio BUILD.** P2 tocca aree deploy-sensibili in modo piu esteso di P1 (due rotte nuove, un endpoint `/api` nuovo, migrazioni DB): la riconferma non e una formalita |

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
- **Fase B (questo BOOTSTRAP)**: blueprint di 5 moduli e 25 task atomici generato dalla
  spec. **Nessun codice prodotto.**
- **Self-check strutturale**: `validate_blueprint.mjs` sulla dir P2 — esito da registrare
  in questa sessione.

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
2. **Primo BUILD su `generation-model`** (T-200..T-203), con riconferma esplicita del
   deploy-coupling all'apertura.
3. **Riconquistare `rls:0`** al checkpoint di `generation-model`: e superficie DB nuova, non
   ereditata.
4. **Non toccare la baseline d'igiene** senza attribuzione preventiva delle duplicazioni:
   catturarla per far passare il controllo 1 benedirebbe anche le proprie (lezione di P1).
5. **Decisioni ancora dell'utente**, non della skill: la taratura crediti/prezzi dopo la
   misura di T-225, e l'eventuale attivazione del contratto `architecture:` (`P1-D11`).
