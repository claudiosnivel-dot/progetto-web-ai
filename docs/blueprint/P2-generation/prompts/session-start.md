# session-start — Belora · P2 (Generazione dei mockup)

> Da incollare **all'apertura di ogni sessione** di lavoro su P2 (dopo la prima).
> Legge SESSION-STATE, sceglie il macrotask corrente, ripete task/criteri/test,
> prepara il branch.

```
Riprendiamo il lavoro su **P2 (Generazione dei mockup)** di **Belora** (supabase-jsts). Il
blueprint P2 e il piano: si costruisce secondo i task, non si ridiscute il design.

1) RECUPERO CONTESTO — leggi PRIMA di qualunque azione:
   • docs/blueprint/P2-generation/SESSION-STATE.md → stato vivo: macrotask fatti/in corso,
     baseline, budget, stato git, §6 copertura dichiarata, §7 carry-over ereditati.
   • docs/blueprint/P2-generation/ → il piano (00-INDEX + moduli) per il macrotask di oggi.

2) SELEZIONA IL MACROTASK CORRENTE rispettando il DAG interno a P2:
   - generation-model (nessuna) → generation-engine (usa i contratti) · generation-llm (usa
     i contratti) → generation-ui (usa engine E llm) → generation-e2e (usa la ui)
   Scegli il primo macrotask non chiuso le cui dipendenze P2 sono gia verdi.

3) RIPETI i task atomici del macrotask scelto. Per ciascuno enuncia, dal blueprint:
   • definition_of_done — gli artefatti osservabili che provano che il lavoro c'e;
   • acceptance_criteria — le asserzioni comportamentali (given/when/then);
   • target_tests — i test che rendono eseguibili i criteri (l'ORACOLO del controllo 4).

4) PREPARA IL BRANCH DI LAVORO per questo macrotask. Lavora SU BRANCH, MAI su main
   (es. trueline/build/generation-model).

5) PROMEMORIA: al CONFINE DEL MACROTASK gira il CHECKPOINT prima di committare. Il merge su
   main e AUTONOMO sul verde del checkpoint (override deploy-coupling da RICONFERMARE a
   inizio BUILD P2: P2 aggiunge rotte, un endpoint /api e migrazioni); distruttive e deploy
   restano gated.

6) METODO DI ESECUZIONE — DYNAMIC WORKFLOW MULTI-AGENTE (obbligatorio per ogni macrotask).
   Tu (ORCHESTRATORE) coordini agenti con ruoli DISTINTI via il Workflow tool, MA l'ORACOLO
   resta l'unico giudice del verde (i verifier informano, non assolvono — L-COL-002).
   • BUILDER — implementano i task (in ordine di DAG). Disciplina: TEST-FIRST con asserzioni
     DERIVATE dagli acceptance_criteria (mai inventate), tag `// covers: <AC-id>`, diff
     minimo, nessun dead-code nuovo, security_notes onorate nel codice.
     RICHIESTA ESPLICITA IN OGNI PROMPT DI BUILDER (lezione di P1, il difetto che si e
     ripetuto TRE volte con la suite verde): le fixture devono avere PIU DI UN ELEMENTO,
     valori DISCORDANTI, e almeno un id che sia PREFISSO di un altro. Una fixture con un solo
     elemento non prova nulla sull'identita di quell'elemento.
   • VERIFIER (agenti DIVERSI) — revisione AVVERSARIALE di ogni task: (a) l'AC e davvero
     asserito e soddisfatto, o e vero per costruzione della fixture? (b) sicurezza — RLS
     R1–R9 sulle DUE tabelle nuove, FK composita, OWASP 2025, service_role solo server,
     rendering del testo non fidato (nessun dangerouslySetInnerHTML, nessun href/src dal
     testo libero, whatsapp/phone/email validati), allowlist della proiezione, conformita
     del sottoinsieme JSON Schema, segreto Anthropic server-only; (c) disciplina trueline
     (niente comportamento inventato, niente astrazioni speculative, niente orfani).
     Emettono RILIEVI; NON dichiarano "verde".
   • FIXER (agenti DIVERSI ancora) — su checkpoint ROSSO o rilievi confermati: diagnosi della
     CAUSA RADICE (systematic-debugging) + patch minima proposta.
   • ORCHESTRATORE (tu) — selezioni macrotask/branch, lanci le fasi, APPLICHI le patch
     approvate (human-in-the-loop), ESEGUI gli oracoli, committi/merge, aggiorni SESSION-STATE.
     Fra un task e l'altro esegui una BATTERIA DI MUTAZIONE: e lo strumento che in P1 ha
     trovato i buchi d'oracolo, non i bug di produzione. Includi sempre un controllo di
     sanita palesemente fatale e verifica il ripristino CON L'HASH.

   Sequenza: (1) preflight + selezione macrotask + branch → (2) BUILD (builder) → (3) VERIFY
   (verifier diversi) → (4) CHECKPOINT DETERMINISTICO run_checkpoint.mjs = IL GIUDICE
   (dead-code · sicurezza · regressioni · conformita), MAI un agente → (5) se ROSSO/rilievi:
   FIX (fixer diversi) → applichi → RIESEGUI LO STESSO ORACOLO + i test (L-COL-003), accetti
   solo se azzerato e nulla rotto; budget retry ≤2 per finding, poi terminale all'umano →
   (6) verde: commit atomico + merge autonomo su main + push, aggiorni SESSION-STATE.
   La forma che tiene, per esperienza di P1: **2 agenti per workflow**, un task per volta.
   Un workflow da 5 agenti e morto per limite di sessione restituendo array vuoti che
   SEMBRAVANO un verde: controlla SEMPRE agents_error prima del valore di ritorno.

NOTE OPERATIVE (imparate sul campo in P1 — non riscoprirle):
  • NON dedurre il verdetto dall'exit code e NON leggere il checkpoint attraverso `| tail`:
    il verdetto si legge nel JSON (green, summary, controls[]). Scrivi l'output INTERO su
    file e leggilo da li.
  • BASELINE D'IGIENE: il controllo 1 e rosso se manca, ANCHE con zero duplicazioni nuove.
    Attribuisci SEMPRE prima di ricatturare — le impronte sono sensibili alla POSIZIONE, e
    editare il partner di una coppia produce un finding "nuovo" spurio. Catturare per far
    passare il controllo benedirebbe anche le tue.
  • Checkpoint: `db reset` (azzera anche il contatore di rate limit auth), env esportate via
    shell, .env.local FUORI dal repo, `rm -rf .next`, `--in-place --mode build` SENZA
    `--blueprint` (manifest supabase-jsts incompatibile con vitest+jsdom → falso rosso).
  • RATE LIMIT AUTH: suite/checkpoint una volta per finestra. Durante il BUILD esegui solo i
    file di test rilevanti, mai `npm test`.
  • CRLF: i file su disco sono CRLF. Una batteria di mutazione con pattern multi-riga scritti
    con `\n` NON combacia: rileva l'EOL e normalizza.
  • gitleaks: una costante di test chiamata SECRET/TOKEN/KEY con un literal fa scattare un
    falso positivo. Nominala diversamente PRIMA.
  • NUOVO IN P2: l'END-TO-END (Chromium) gira al CHECKPOINT di macrotask, non nel giro
    per-task. E il CANARY viene prima del verde: se le asserzioni sull'effetto non sanno
    prendere il componente deliberatamente insicuro, non provano nulla.

INVARIANTI NON NEGOZIABILI — per OGNI task:
  • ORACLE-AS-JUDGE, MAI LLM-AS-JUDGE.
  • LOOP DI VERIFICA DELLA FIX OBBLIGATORIO.
  • HUMAN-IN-THE-LOOP SULLE FIX; DEAD-CODE MAI CANCELLATO IN AUTONOMIA.
  • GIT A STRATI (branch autonomo, merge su main gated dal verde, distruttive mai autonome,
    DEPLOY NON SUPERVISIONATO BLOCCATO).
  • NESSUN FALSO "VIA LIBERA"; COPERTURA SEMPRE DICHIARATA.
  • PRIMA DI CREDERE A UN VERDE, PROVA CHE LO STRUMENTO SA DIVENTARE ROSSO.

Posizioni: blueprint/stato → docs/blueprint/P2-generation/ ; baseline/budget →
…/SESSION-STATE.md §4 ; copertura dichiarata → …/SESSION-STATE.md §6.

Dopo aver letto SESSION-STATE: dichiara in poche righe lo stato, il macrotask scelto coi suoi
task/criteri/test, il branch preparato, ed eventuali blocchi. Poi attendi il mio via.
```
