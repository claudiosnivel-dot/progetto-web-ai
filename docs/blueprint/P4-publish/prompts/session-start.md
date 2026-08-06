# session-start — Belora · P4 (Pubblicazione, serving pubblico & media)

> Da incollare **all'apertura di ogni sessione** di lavoro su P4 (dopo la prima).
> Legge SESSION-STATE, sceglie il macrotask corrente, ripete task/criteri/test,
> prepara il branch.

```
Riprendiamo il lavoro su **P4 (Pubblicazione, serving pubblico & media)** di **Belora**
(supabase-jsts). Il blueprint P4 è il piano: si costruisce secondo i task, non si ridiscute il
design.

1) RECUPERO CONTESTO — leggi PRIMA di qualunque azione:
   • docs/blueprint/P4-publish/SESSION-STATE.md → stato vivo: macrotask fatti/in corso,
     baseline, budget, stato git, §6 copertura dichiarata, §7 carry-over ereditati.
   • docs/blueprint/P4-publish/ → il piano (00-INDEX + moduli) per il macrotask di oggi.

2) SELEZIONA IL MACROTASK CORRENTE rispettando il DAG interno a P4:
   - publish-core (nessuna dipendenza aperta) → public-serving (usa la tabella e publishSite)
     → seo-base (usa la rotta pubblica); media-storage → media-editor-render (usa l'URL asset
     e il render); e2e-public alla fine (richiede rotta pubblica + SEO + media).
   Scegli il primo macrotask non chiuso le cui dipendenze P4 sono già verdi.

3) RIPETI i task atomici del macrotask scelto. Per ciascuno enuncia, dal blueprint:
   • definition_of_done — gli artefatti osservabili che provano che il lavoro c'è;
   • acceptance_criteria — le asserzioni comportamentali (given/when/then);
   • target_tests — i test che rendono eseguibili i criteri (l'ORACOLO del controllo 4).

4) PREPARA IL BRANCH DI LAVORO per questo macrotask. Lavora SU BRANCH, MAI su main
   (es. trueline/build/publish-core).

5) PROMEMORIA: al CONFINE DEL MACROTASK gira il CHECKPOINT prima di committare. Il merge su main
   è GATED dal verde del checkpoint E dal DEPLOY-COUPLING = coupled (CONFERMATO in P3, valido in
   P4): P4 apre una ROTTA PUBBLICA /s/<slug>, tabelle nuove e un bucket Storage → il merge resta
   HUMAN-GATED anche sul verde (mergiare può innescare il deploy dell'hosting pubblico).
   Distruttive e deploy restano gated.

6) METODO DI ESECUZIONE — UN DYNAMIC WORKFLOW MULTI-AGENTE PER MACROTASK (obbligatorio).
   Tu (ORCHESTRATORE) coordini agenti con ruoli DISTINTI, MA l'ORACOLO resta l'unico giudice
   del verde (i verifier informano, non assolvono — L-COL-002).
   • BUILDER — implementano i task (in ordine di DAG). Disciplina: TEST-FIRST con asserzioni
     DERIVATE dagli acceptance_criteria (mai inventate), tag `// covers: <AC-id>`, diff minimo,
     nessun dead-code nuovo, security_notes onorate nel codice.
     RICHIESTA ESPLICITA IN OGNI PROMPT DI BUILDER (lezione di P1/P2/P3): le fixture devono
     avere PIÙ DI UN ELEMENTO, valori DISCORDANTI, e almeno un id/slug che sia PREFISSO di un
     altro. Una fixture con un solo elemento non prova nulla sull'identità. Cruciale in P4 per:
     public_slug (dedup globale + riservati — due nomi che collidono, uno slug prefisso di un
     altro), RLS runtime (un sito pubblicato + uno NON pubblicato + uno di ALTRO tenant), URL
     asset (due asset_id, uno prefisso dell'altro).
   • VERIFIER (agenti DIVERSI, BLIND rispetto all'implementazione) — revisione AVVERSARIALE di
     ogni task: (a) l'AC è davvero asserito e soddisfatto, o è vero per costruzione della
     fixture? (b) sicurezza — RLS R1–R9 sulle tabelle NUOVE site_publications/assets + bucket
     (anon = SELECT solo su is_published=true, colonne private mai esposte, scrittura
     tenant-scoped, client di sessione mai service_role), parseDocument in publish e in render,
     escaping React del SiteView pubblico (niente dangerouslySetInnerHTML, niente src/href da
     testo libero — URL asset da asset_id), JSON-LD escaped (< > & U+2028/2029), re-encode che
     neutralizza/rifiuta i payload ostili, notFound anti-enumerazione, canary che sa diventare
     rosso; (c) disciplina trueline (niente comportamento inventato, niente astrazioni
     speculative, niente orfani, RENDERER UNICO). Emettono RILIEVI; NON dichiarano "verde".
   • FIXER (agenti DIVERSI ancora) — su checkpoint ROSSO o rilievi confermati: diagnosi della
     CAUSA RADICE (systematic-debugging) + patch minima proposta.
   • ORCHESTRATORE (tu) — selezioni macrotask/branch, lanci le fasi, APPLICHI le patch approvate
     (human-in-the-loop), ESEGUI gli oracoli, committi/merge, aggiorni SESSION-STATE. Fra un task
     e l'altro esegui una BATTERIA DI MUTAZIONE: includi sempre un controllo di sanità
     palesemente fatale e verifica il ripristino CON L'HASH.

   Sequenza: (1) preflight + selezione macrotask + branch → (2) BUILD (builder) → (3) VERIFY
   (verifier diversi, BLIND) → (4) CHECKPOINT DETERMINISTICO run_checkpoint.mjs = IL GIUDICE
   (dead-code · sicurezza · regressioni · conformità), MAI un agente → (5) se ROSSO/rilievi:
   FIX (fixer diversi) → applichi → RIESEGUI LO STESSO ORACOLO + i test (L-COL-003), accetti
   solo se azzerato e nulla rotto; budget retry ≤2 per finding, poi terminale all'umano →
   (6) verde: commit atomico + merge su main (gated dal deploy-coupling coupled) + push, aggiorni
   SESSION-STATE.
   La forma che tiene, per esperienza di P1/P2/P3: **2 agenti per workflow**, un task per volta,
   UN workflow di build per MACROTASK. Controlla SEMPRE agents_error prima del valore di ritorno:
   un workflow morto per limite di sessione restituisce array vuoti che SEMBRANO un verde.

NOTE OPERATIVE (imparate sul campo in P1/P2/P3 — non riscoprirle):
  • NON dedurre il verdetto dall'exit code e NON leggere il checkpoint attraverso `| tail`: il
    verdetto si legge nel JSON (green, summary, controls[]). Scrivi l'output INTERO su file e
    leggilo da lì.
  • CHECKPOINT SU STATO PULITO: `rm -rf .next` + `db:reset` PRIMA del checkpoint monolitico, o
    gitleaks scansiona un .next stantio e l'auth esaurita fa scadere la finestra. `db reset`
    azzera anche il contatore di rate limit auth.
  • CHECKPOINT: env esportate via shell, .env.local FUORI dal repo, `--in-place --mode build`
    SENZA `--blueprint` (manifest supabase-jsts incompatibile con vitest+jsdom → falso rosso);
    il verdetto è .green nel JSON.
  • BASELINE D'IGIENE: il controllo 1 è rosso se manca, ANCHE con zero duplicazioni nuove.
    Attribuisci SEMPRE prima di ricatturare — le impronte sono sensibili alla POSIZIONE, e
    l'aggiunta di file (src/app/s, src/data media, e2e) ri-fingerprinta impronte pre-esistenti
    (R-04). `baseline.mjs capture <dir> --hygiene` scrive nel default → usa `--out <hygiene path>`.
  • RATE LIMIT AUTH: suite/checkpoint una volta per finestra. Durante il BUILD esegui solo i file
    di test rilevanti, mai `npm test`.
  • CRLF: i file su disco sono CRLF. Una batteria di mutazione con pattern multi-riga scritti con
    `\n` NON combacia: rileva l'EOL e normalizza.
  • gitleaks: una costante di test chiamata SECRET/TOKEN/KEY con un literal fa scattare un falso
    positivo. Nominala diversamente PRIMA. (Rilevante in P4: chiavi Storage/URL nei test.)
  • RLS su tabella NUOVA (site_publications, assets) + bucket: va provata A RUNTIME attraverso il
    client con auth reale su Supabase locale, mai nell'SQL editor. rls NON è ereditato da P3. La
    prova pubblica (T-407) richiede il client ANON: pubblicato sì / non-pubblicato/altrui no,
    colonne private non esposte.
  • ARCH_CHECK (repo-wide, P3-D7 + AH-D6): il contratto architecture: è attivo e assoluto; il
    serving va in src/app, la logica pura in src/domain, sharp/accesso-dati in src/data. Una
    regola forbidden che mappa a 0 moduli reali è non-verde (vacuity guard).
  • END-TO-END (Chromium) sulla ROTTA PUBBLICA /s/<slug>: gira al CHECKPOINT del macrotask
    e2e-public (T-417), con documento pubblicato ostile + ASSET CARICATO. Il CANARY viene prima
    del verde: se assertNoInjectionEffect non sa prendere il componente deliberatamente insicuro,
    non prova nulla. Estende T-241/T-317 alla superficie pubblica.
  • UPLOAD: la difesa è provata sull'EFFETTO (payload ostili → raster pulito o rifiuto, EXIF
    strippato, SVG rifiutato), non sul tipo dichiarato dal client.

INVARIANTI NON NEGOZIABILI — per OGNI task:
  • ORACLE-AS-JUDGE, MAI LLM-AS-JUDGE.
  • LOOP DI VERIFICA DELLA FIX OBBLIGATORIO.
  • HUMAN-IN-THE-LOOP SULLE FIX; DEAD-CODE MAI CANCELLATO IN AUTONOMIA.
  • GIT A STRATI (branch autonomo, merge su main gated dal verde E dal deploy-coupling coupled
    human-gated, distruttive mai autonome, DEPLOY NON SUPERVISIONATO BLOCCATO).
  • RENDERER UNICO; PARSEDOCUMENT IN SCRITTURA E IN RENDER; TESTO NON FIDATO SOLO COME CHILDREN
    REACT; NESSUN src/href DA TESTO LIBERO (URL asset da asset_id).
  • RLS PUBBLICA RICONQUISTATA (anon legge SOLO il pubblicato); UPLOAD SEMPRE RE-ENCODATO O
    RIFIUTATO (mai grezzo); JSON-LD ESCAPED.
  • NESSUN FALSO "VIA LIBERA"; COPERTURA SEMPRE DICHIARATA.
  • PRIMA DI CREDERE A UN VERDE, PROVA CHE LO STRUMENTO SA DIVENTARE ROSSO.

Posizioni: blueprint/stato → docs/blueprint/P4-publish/ ; baseline/budget →
…/SESSION-STATE.md §4 ; copertura dichiarata → …/SESSION-STATE.md §6.

Dopo aver letto SESSION-STATE: dichiara in poche righe lo stato, il macrotask scelto coi suoi
task/criteri/test, il branch preparato, ed eventuali blocchi. Poi attendi il mio via.
```
