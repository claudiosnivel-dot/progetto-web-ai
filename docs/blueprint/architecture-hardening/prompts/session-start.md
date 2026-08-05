# session-start — Belora · `architecture-hardening`

> Da incollare **all'apertura di ogni sessione** di lavoro sul macrotask (dopo la prima).
> Legge SESSION-STATE, conferma il macrotask, ripete task/criteri/test, prepara il branch.

```
Riprendiamo il lavoro su **architecture-hardening** di **Belora** (supabase-jsts). Il blueprint è
il piano: si conforma il codice secondo i task, non si ridiscute il design. È refactor a
ISO-COMPORTAMENTO su codice già in main + il flip del gate architecture: a repo-wide.

1) RECUPERO CONTESTO — leggi PRIMA di qualunque azione:
   • docs/blueprint/architecture-hardening/SESSION-STATE.md → stato vivo: task fatti/in corso,
     baseline, budget, stato git, §6 copertura dichiarata, §7 carry-over.
   • docs/blueprint/architecture-hardening/ → il piano (00-INDEX + 01-architecture-hardening).
   • Il contratto/gate: docs/blueprint/P3-editor/00-INDEX.md §1bis + tests/architecture-contract.test.ts.

2) MACROTASK CORRENTE: architecture-hardening (unico). Rispetta il DAG interno: T-AH1..T-AH5
   (refactor, indipendenti) prima; T-AH6 (gate repo-wide) SOLO dopo che tutti i 5 archi sono
   rimossi (depends_on [T-AH1..T-AH5]).

3) RIPETI i task atomici. Per ciascuno enuncia, dal blueprint:
   • definition_of_done — gli artefatti osservabili (file spostato, arco domain->data rimosso);
   • acceptance_criteria — le asserzioni comportamentali (given/when/then, iso-comportamento);
   • target_tests — i test che rendono eseguibili i criteri (l'ORACOLO del controllo 4). Per i
     refactor sono i test ESISTENTI aggiornati; per T-AH6 è tests/architecture-contract.test.ts.

4) PREPARA IL BRANCH DI LAVORO: trueline/build/architecture-hardening. Lavora SU BRANCH, MAI su main.

5) PROMEMORIA: al CONFINE DEL MACROTASK gira il CHECKPOINT prima di committare. Merge su main
   human-gated dal verde E dal deploy-coupling COUPLED (confermato). Distruttive e deploy gated.

6) METODO DI ESECUZIONE — DYNAMIC WORKFLOW MULTI-AGENTE (obbligatorio). Tu (ORCHESTRATORE)
   coordini agenti con ruoli DISTINTI, MA l'ORACOLO resta l'unico giudice del verde.
   • BUILDER — implementano i task in ordine di DAG. Disciplina: per i refactor, aggiorna i path
     di import dei test ESISTENTI e mantienili verdi (le asserzioni derivano dagli AC, non si
     inventano né si indeboliscono); diff minimo; nessun dead-code nuovo (attento ai file di
     origine svuotati: knip li segnalerà); security_notes onorate nel codice. NON toccare
     tests/architecture-contract.test.ts nei task di refactor.
   • VERIFIER (agenti DIVERSI) — revisione AVVERSARIALE: (a) l'iso-comportamento è davvero
     provato dai target_tests, o è vero per costruzione? (b) sicurezza — session-client mai
     service_role dopo lo spostamento; chiave Anthropic non raggiungibile da src/app; maxRetries:0/
     timeout e cache-prefix preservati; best-effort setLocale preservato; (c) disciplina trueline
     (niente comportamento inventato, niente astrazioni speculative, niente orfani). Emettono
     RILIEVI; NON dichiarano "verde".
   • FIXER (agenti DIVERSI) — su checkpoint ROSSO o rilievi confermati: diagnosi della causa
     radice (systematic-debugging) + patch minima proposta.
   • ORCHESTRATORE (tu) — selezioni task/branch, lanci le fasi, APPLICHI le patch approvate
     (human-in-the-loop), ESEGUI gli oracoli, committi/merge, aggiorni SESSION-STATE. Fra un task
     e l'altro esegui una BATTERIA DI MUTAZIONE: sanità palesemente fatale + ripristino CON L'HASH.

   Sequenza: (1) preflight + branch → (2) BUILD (builder) → (3) VERIFY (verifier diversi) →
   (4) CHECKPOINT DETERMINISTICO run_checkpoint.mjs = IL GIUDICE, MAI un agente → (5) se
   ROSSO/rilievi: FIX (fixer diversi) → applichi → RIESEGUI LO STESSO ORACOLO + i test, accetti
   solo se azzerato e nulla rotto; budget retry ≤2 per finding, poi terminale all'umano → (6)
   verde: commit atomico + merge su main (gated dal deploy-coupling) + push, aggiorni SESSION-STATE.
   La forma che tiene (P1/P2): **2 agenti per workflow**, un task per volta. Controlla SEMPRE
   agents_error PRIMA del valore di ritorno: un workflow morto restituisce array vuoti che
   SEMBRANO un verde.

NOTE OPERATIVE (imparate sul campo — non riscoprirle):
  • Il verdetto si legge nel JSON del checkpoint (green, summary, controls[]), MAI dall'exit code
    né attraverso `| tail`. Scrivi l'output INTERO su file e leggilo da lì.
  • BASELINE D'IGIENE (R-04): questi refactor SPOSTANO file (setLocale, auth, phase1/phase2) → le
    impronte sono sensibili alla POSIZIONE. ATTRIBUISCI (tue vs churn di posizione) PRIMA di
    ricatturare. `baseline.mjs capture <dir> --hygiene --out <hygiene path>` (il default scrive in
    baseline.json).
  • Checkpoint: `db reset` (azzera il rate-limit auth), env via shell, .env.local FUORI dal repo,
    `rm -rf .next`, `--in-place --mode build` SENZA `--blueprint` (manifest supabase-jsts
    incompatibile con vitest+jsdom → falso rosso).
  • RATE LIMIT AUTH: suite/checkpoint una volta per finestra. Durante il BUILD esegui solo i file
    di test rilevanti, mai `npm test`. I test di auth (login/signup) girano contro Supabase locale.
  • CRLF: i file su disco sono CRLF. Una batteria di mutazione con pattern multi-riga scritti con
    `\n` NON combacia: rileva l'EOL e normalizza.
  • gitleaks: una costante di test chiamata SECRET/TOKEN/KEY con un literal fa scattare un falso
    positivo. Nominala diversamente PRIMA.
  • ARCH_CHECK / T-AH6: il gate reale è il test vitest (l'oracolo trueline è cieco sugli alias). Il
    flip a repo-wide è verde SOLO dopo i 5 refactor; il CANARY (fixture di violazione deliberata)
    viene prima del verde: se non sa diventare rosso, non prova nulla. Il testimone di non-vacuità
    positivo (alias-aware vede ≥1 arco lecito, cieco 0) sostituisce l'ex "esattamente 7".

INVARIANTI NON NEGOZIABILI — per OGNI task:
  • ORACLE-AS-JUDGE, MAI LLM-AS-JUDGE.
  • LOOP DI VERIFICA DELLA FIX OBBLIGATORIO.
  • HUMAN-IN-THE-LOOP SULLE FIX; DEAD-CODE MAI CANCELLATO IN AUTONOMIA.
  • GIT A STRATI (branch autonomo, merge su main gated dal verde E dal deploy-coupling coupled,
    distruttive mai autonome, DEPLOY NON SUPERVISIONATO BLOCCATO).
  • ISO-COMPORTAMENTO: non si indeboliscono le asserzioni per assorbire un refactor.
  • NESSUN FALSO "VIA LIBERA"; COPERTURA SEMPRE DICHIARATA; PRIMA DI CREDERE A UN VERDE, PROVA CHE
    LO STRUMENTO SA DIVENTARE ROSSO.

Dopo aver letto SESSION-STATE: dichiara in poche righe lo stato, i task coi loro criteri/test, il
branch preparato, ed eventuali blocchi. Poi attendi il mio via.
```
