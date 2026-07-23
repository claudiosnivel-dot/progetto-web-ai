# session-start — Belora · P0

> Da incollare **all'apertura di ogni sessione** di lavoro (dopo la prima).
> Legge SESSION-STATE, sceglie il macrotask corrente, ripete task/criteri/test,
> prepara il branch.

```
Riprendiamo il lavoro su **Belora** (supabase-jsts). Il blueprint è il piano: si
costruisce secondo i task, non si ridiscute il design.

1) RECUPERO CONTESTO — leggi PRIMA di qualunque azione:
   • docs/blueprint/P0-foundations/SESSION-STATE.md → stato vivo: macrotask fatti/in
     corso, baseline, budget, stato git, note di carry-over.
   • docs/blueprint/P0-foundations/ → il piano (00-INDEX + moduli) per il macrotask di oggi.

2) SELEZIONA IL MACROTASK CORRENTE rispettando il DAG:
   - infra (nessuna) → design-system (infra) → i18n (infra) → auth (infra)
     → tenancy (auth, infra) → sites (tenancy, design-system, i18n, auth)
   Scegli il primo macrotask non chiuso le cui dipendenze sono già verdi.

3) RIPETI i task atomici del macrotask scelto. Per ciascuno enuncia, dal blueprint:
   • definition_of_done — gli artefatti osservabili che provano che il lavoro c'è;
   • acceptance_criteria — le asserzioni comportamentali (given/when/then);
   • target_tests — i test che rendono eseguibili i criteri (l'ORACOLO del controllo 4).

4) PREPARA IL BRANCH DI LAVORO per questo macrotask. Lavora SU BRANCH, MAI su main.

5) PROMEMORIA: al CONFINE DEL MACROTASK gira il CHECKPOINT prima di committare.
   Il merge su main è AUTONOMO sul verde del checkpoint (deploy-coupling di main
   confermato FALSE il 2026-07-23); distruttive e deploy restano gated.

6) METODO DI ESECUZIONE — DYNAMIC WORKFLOW MULTI-AGENTE (obbligatorio per ogni macrotask).
   Tu (ORCHESTRATORE) non costruisci da solo: coordini agenti con ruoli DISTINTI via il
   Workflow tool, MA l'ORACOLO resta l'unico giudice del verde (i verifier informano, non
   assolvono — L-COL-002). Pool di agenti DIVERSI per ruolo: l'indipendenza è la forza.

   • BUILDER — implementano i task atomici (in ordine di DAG; paralleli con worktree solo
     se indipendenti e mutano file in parallelo). Disciplina: TEST-FIRST con asserzioni
     DERIVATE dagli acceptance_criteria del blueprint (mai inventate), tag `// covers:
     <AC-id>`, diff minimo, nessun dead-code nuovo, security_notes onorate nel codice.
   • VERIFIER (agenti DIVERSI dai builder) — revisione AVVERSARIALE di ogni task contro:
     (a) gli AC (il test asserisce davvero l'AC? il codice lo soddisfa?); (b) sicurezza
     (RLS R1–R9, OWASP 2025, service_role solo server, validazione server-side, no
     PostgREST filter injection); (c) disciplina trueline (niente comportamento inventato,
     niente astrazioni speculative, niente orfani). Emettono RILIEVI strutturati; NON
     dichiarano "verde".
   • FIXER (agenti DIVERSI ancora) — su checkpoint ROSSO o rilievi confermati: diagnosi
     della CAUSA RADICE (systematic-debugging) + patch minima proposta.
   • ORCHESTRATORE (tu) — selezioni macrotask/branch, lanci le fasi, APPLICHI le patch
     approvate (human-in-the-loop), ESEGUI gli oracoli, decidi il flusso, committi/merge,
     aggiorni SESSION-STATE.

   Sequenza: (1) preflight + selezione macrotask + branch → (2) fase BUILD (builder) →
   (3) fase VERIFY (verifier diversi) → (4) CHECKPOINT DETERMINISTICO `run_checkpoint.mjs`
   = IL GIUDICE (dead-code · sicurezza · regressioni · conformità), MAI un agente →
   (5) se ROSSO/rilievi reali: fase FIX (fixer diversi) → applichi → RIESEGUI LO STESSO
   ORACOLO + i test (L-COL-003), accetti solo se azzerato e nulla rotto; budget retry ≤2
   per finding, poi terminale all'umano → (6) verde: commit atomico + merge autonomo su
   main + push, aggiorni SESSION-STATE. Nota checkpoint sicurezza: eseguirlo senza
   .env.local e senza .next su disco, con le env Supabase esportate via shell.

INVARIANTI NON NEGOZIABILI — per OGNI task:
  • ORACLE-AS-JUDGE, MAI LLM-AS-JUDGE.
  • LOOP DI VERIFICA DELLA FIX OBBLIGATORIO (applica → riesegui stesso oracolo → riesegui
    test → accetta solo se sparito e nulla rotto).
  • HUMAN-IN-THE-LOOP SULLE FIX; DEAD-CODE MAI CANCELLATO IN AUTONOMIA.
  • GIT A STRATI (branch autonomo, merge su main gated dal verde, distruttive mai
    autonome, DEPLOY NON SUPERVISIONATO BLOCCATO).
  • NESSUN FALSO "VIA LIBERA"; COPERTURA SEMPRE DICHIARATA.

Posizioni: blueprint/stato → docs/blueprint/P0-foundations/ ; baseline/budget →
…/SESSION-STATE.md §4.

Dopo aver letto SESSION-STATE: dichiara in poche righe lo stato, il macrotask scelto coi
suoi task/criteri/test, il branch preparato, ed eventuali blocchi. Poi attendi il mio via.
```
