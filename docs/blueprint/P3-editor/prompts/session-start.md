# session-start — Belora · P3 (Editor inline)

> Da incollare **all'apertura di ogni sessione** di lavoro su P3 (dopo la prima).
> Legge SESSION-STATE, sceglie il macrotask corrente, ripete task/criteri/test,
> prepara il branch.

```
Riprendiamo il lavoro su **P3 (Editor inline)** di **Belora** (supabase-jsts). Il blueprint
P3 è il piano: si costruisce secondo i task, non si ridiscute il design.

1) RECUPERO CONTESTO — leggi PRIMA di qualunque azione:
   • docs/blueprint/P3-editor/SESSION-STATE.md → stato vivo: macrotask fatti/in corso,
     baseline, budget, stato git, §6 copertura dichiarata, §7 carry-over ereditati.
   • docs/blueprint/P3-editor/ → il piano (00-INDEX + moduli) per il macrotask di oggi.

2) SELEZIONA IL MACROTASK CORRENTE rispettando il DAG interno a P3:
   - editor-core (nessuna dipendenza aperta) → editor-blocks (usa renderer editabile,
     persistenza e rotta di editor-core)
   Scegli il primo macrotask non chiuso le cui dipendenze P3 sono già verdi.

3) RIPETI i task atomici del macrotask scelto. Per ciascuno enuncia, dal blueprint:
   • definition_of_done — gli artefatti osservabili che provano che il lavoro c'è;
   • acceptance_criteria — le asserzioni comportamentali (given/when/then);
   • target_tests — i test che rendono eseguibili i criteri (l'ORACOLO del controllo 4).

4) PREPARA IL BRANCH DI LAVORO per questo macrotask. Lavora SU BRANCH, MAI su main
   (es. trueline/build/editor-core).

5) PROMEMORIA: al CONFINE DEL MACROTASK gira il CHECKPOINT prima di committare. Il merge su
   main è AUTONOMO sul verde del checkpoint, MA il DEPLOY-COUPLING è da RICONFERMARE a inizio
   BUILD (P3 aggiunge la rotta /editor e nuove server action): in ambiguità si assume coupled
   e il merge resta human-gated anche sul verde. Distruttive e deploy restano gated.

6) METODO DI ESECUZIONE — DYNAMIC WORKFLOW MULTI-AGENTE (obbligatorio per ogni macrotask).
   Tu (ORCHESTRATORE) coordini agenti con ruoli DISTINTI, MA l'ORACOLO resta l'unico giudice
   del verde (i verifier informano, non assolvono — L-COL-002).
   • BUILDER — implementano i task (in ordine di DAG). Disciplina: TEST-FIRST con asserzioni
     DERIVATE dagli acceptance_criteria (mai inventate), tag `// covers: <AC-id>`, diff
     minimo, nessun dead-code nuovo, security_notes onorate nel codice.
     RICHIESTA ESPLICITA IN OGNI PROMPT DI BUILDER (lezione di P1/P2): le fixture devono
     avere PIÙ DI UN ELEMENTO, valori DISCORDANTI, e almeno un id che sia PREFISSO di un
     altro. Una fixture con un solo elemento non prova nulla sull'identità. (Gli AC di
     T-301/T-303/T-304/T-307/T-315 lo pretendono già: rispecchialo nel test.)
   • VERIFIER (agenti DIVERSI) — revisione AVVERSARIALE di ogni task: (a) l'AC è davvero
     asserito e soddisfatto, o è vero per costruzione della fixture? (b) sicurezza — RLS
     R1–R9 sulla tabella NUOVA site_document_revisions, FK composita, parseDocument in
     scrittura, client di sessione (mai service_role), escaping React nell'editor (niente
     dangerouslySetInnerHTML, niente href/src dal testo libero), scan statico che copre
     davvero src/ui/editor, canary che sa diventare rosso; (c) disciplina trueline (niente
     comportamento inventato, niente astrazioni speculative, niente orfani, RENDERER UNICO).
     Emettono RILIEVI; NON dichiarano "verde".
   • FIXER (agenti DIVERSI ancora) — su checkpoint ROSSO o rilievi confermati: diagnosi della
     CAUSA RADICE (systematic-debugging) + patch minima proposta.
   • ORCHESTRATORE (tu) — selezioni macrotask/branch, lanci le fasi, APPLICHI le patch
     approvate (human-in-the-loop), ESEGUI gli oracoli, committi/merge, aggiorni SESSION-STATE.
     Fra un task e l'altro esegui una BATTERIA DI MUTAZIONE: includi sempre un controllo di
     sanità palesemente fatale e verifica il ripristino CON L'HASH.

   Sequenza: (1) preflight + selezione macrotask + branch → (2) BUILD (builder) → (3) VERIFY
   (verifier diversi) → (4) CHECKPOINT DETERMINISTICO run_checkpoint.mjs = IL GIUDICE
   (dead-code · sicurezza · regressioni · conformità), MAI un agente → (5) se ROSSO/rilievi:
   FIX (fixer diversi) → applichi → RIESEGUI LO STESSO ORACOLO + i test (L-COL-003), accetti
   solo se azzerato e nulla rotto; budget retry ≤2 per finding, poi terminale all'umano →
   (6) verde: commit atomico + merge su main (gated dal deploy-coupling) + push, aggiorni
   SESSION-STATE.
   La forma che tiene, per esperienza di P1/P2: **2 agenti per workflow**, un task per volta.
   Controlla SEMPRE agents_error prima del valore di ritorno: un workflow morto per limite di
   sessione restituisce array vuoti che SEMBRANO un verde.

NOTE OPERATIVE (imparate sul campo in P1/P2 — non riscoprirle):
  • NON dedurre il verdetto dall'exit code e NON leggere il checkpoint attraverso `| tail`:
    il verdetto si legge nel JSON (green, summary, controls[]). Scrivi l'output INTERO su
    file e leggilo da lì.
  • BASELINE D'IGIENE: il controllo 1 è rosso se manca, ANCHE con zero duplicazioni nuove.
    Attribuisci SEMPRE prima di ricatturare — le impronte sono sensibili alla POSIZIONE, e
    l'aggiunta di file (src/ui/editor, e2e) ri-fingerprinta impronte pre-esistenti (R-04).
  • Checkpoint: `db reset` (azzera anche il contatore di rate limit auth), env esportate via
    shell, .env.local FUORI dal repo, `rm -rf .next`, `--in-place --mode build` SENZA
    `--blueprint` (manifest supabase-jsts incompatibile con vitest+jsdom → falso rosso).
  • RATE LIMIT AUTH: suite/checkpoint una volta per finestra. Durante il BUILD esegui solo i
    file di test rilevanti, mai `npm test`.
  • CRLF: i file su disco sono CRLF. Una batteria di mutazione con pattern multi-riga scritti
    con `\n` NON combacia: rileva l'EOL e normalizza.
  • gitleaks: una costante di test chiamata SECRET/TOKEN/KEY con un literal fa scattare un
    falso positivo. Nominala diversamente PRIMA.
  • RLS su tabella NUOVA: va provata A RUNTIME attraverso il client con auth reale su Supabase
    locale, mai nell'SQL editor. rls NON è ereditato da P2.
  • ARCH_CHECK (nuovo in P3, P3-D7): il contratto architecture: è ora ATTIVO. Il gate è
    assoluto in BUILD e ha un vacuity guard — una regola forbidden che mappa a 0 moduli reali
    è non-verde. T-312 lo mette in opera con un test falsificabile.
  • END-TO-END (Chromium) sulla ROTTA EDITOR: gira al CHECKPOINT del macrotask editor-blocks
    (T-317). Il CANARY viene prima del verde: se le asserzioni sull'effetto non sanno prendere
    il componente deliberatamente insicuro, non provano nulla.

INVARIANTI NON NEGOZIABILI — per OGNI task:
  • ORACLE-AS-JUDGE, MAI LLM-AS-JUDGE.
  • LOOP DI VERIFICA DELLA FIX OBBLIGATORIO.
  • HUMAN-IN-THE-LOOP SULLE FIX; DEAD-CODE MAI CANCELLATO IN AUTONOMIA.
  • GIT A STRATI (branch autonomo, merge su main gated dal verde e dal deploy-coupling,
    distruttive mai autonome, DEPLOY NON SUPERVISIONATO BLOCCATO).
  • RENDERER UNICO; PARSEDOCUMENT IN SCRITTURA; TESTO NON FIDATO SOLO COME CHILDREN REACT.
  • NESSUN FALSO "VIA LIBERA"; COPERTURA SEMPRE DICHIARATA.
  • PRIMA DI CREDERE A UN VERDE, PROVA CHE LO STRUMENTO SA DIVENTARE ROSSO.

Posizioni: blueprint/stato → docs/blueprint/P3-editor/ ; baseline/budget →
…/SESSION-STATE.md §4 ; copertura dichiarata → …/SESSION-STATE.md §6.

Dopo aver letto SESSION-STATE: dichiara in poche righe lo stato, il macrotask scelto coi suoi
task/criteri/test, il branch preparato, ed eventuali blocchi. Poi attendi il mio via.
```
