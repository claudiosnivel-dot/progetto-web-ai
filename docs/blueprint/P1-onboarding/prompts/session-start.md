# session-start — Belora · P1 (Onboarding)

> Da incollare **all'apertura di ogni sessione** di lavoro su P1 (dopo la prima).
> Legge SESSION-STATE, sceglie il macrotask corrente, ripete task/criteri/test,
> prepara il branch.

```
Riprendiamo il lavoro su **P1 (Onboarding)** di **Belora** (supabase-jsts). Il blueprint P1
e il piano: si costruisce secondo i task, non si ridiscute il design.

1) RECUPERO CONTESTO — leggi PRIMA di qualunque azione:
   • docs/blueprint/P1-onboarding/SESSION-STATE.md → stato vivo: macrotask fatti/in corso,
     baseline, budget, stato git, note di carry-over.
   • docs/blueprint/P1-onboarding/ → il piano (00-INDEX + moduli) per il macrotask di oggi.

2) SELEZIONA IL MACROTASK CORRENTE rispettando il DAG interno a P1:
   - brief-model (nessuna) → ai-onboarding (usa brief-model) · url-import (usa brief-model +
     confine LLM) → onboarding-ui (usa tutti)
   Scegli il primo macrotask non chiuso le cui dipendenze P1 sono gia verdi.

3) RIPETI i task atomici del macrotask scelto. Per ciascuno enuncia, dal blueprint:
   • definition_of_done — gli artefatti osservabili che provano che il lavoro c'e;
   • acceptance_criteria — le asserzioni comportamentali (given/when/then);
   • target_tests — i test che rendono eseguibili i criteri (l'ORACOLO del controllo 4).

4) PREPARA IL BRANCH DI LAVORO per questo macrotask. Lavora SU BRANCH, MAI su main
   (es. trueline/build/brief-model).

5) PROMEMORIA: al CONFINE DEL MACROTASK gira il CHECKPOINT prima di committare. Il merge su
   main e AUTONOMO sul verde del checkpoint (override deploy-coupling false, da riconfermare
   una volta a inizio BUILD P1); distruttive e deploy restano gated.

6) METODO DI ESECUZIONE — DYNAMIC WORKFLOW MULTI-AGENTE (obbligatorio per ogni macrotask).
   Tu (ORCHESTRATORE) coordini agenti con ruoli DISTINTI via il Workflow tool, MA l'ORACOLO
   resta l'unico giudice del verde (i verifier informano, non assolvono — L-COL-002).
   • BUILDER — implementano i task (in ordine di DAG). Disciplina: TEST-FIRST con asserzioni
     DERIVATE dagli acceptance_criteria (mai inventate), tag `// covers: <AC-id>`, diff
     minimo, nessun dead-code nuovo, security_notes onorate nel codice.
   • VERIFIER (agenti DIVERSI) — revisione AVVERSARIALE di ogni task: (a) l'AC e davvero
     asserito e soddisfatto? (b) sicurezza — RLS R1–R9, OWASP 2025, service_role solo server,
     validazione server-side dell'input non fidato (output modello + HTML importato), SSRF
     (blocco IP privati + redirect re-check), segreto Anthropic server-only, no PostgREST
     filter injection; (c) disciplina trueline (niente comportamento inventato, niente
     astrazioni speculative, niente orfani). Emettono RILIEVI; NON dichiarano "verde".
   • FIXER (agenti DIVERSI ancora) — su checkpoint ROSSO o rilievi confermati: diagnosi della
     CAUSA RADICE (systematic-debugging) + patch minima proposta.
   • ORCHESTRATORE (tu) — selezioni macrotask/branch, lanci le fasi, APPLICHI le patch
     approvate (human-in-the-loop), ESEGUI gli oracoli, committi/merge, aggiorni SESSION-STATE.

   Sequenza: (1) preflight + selezione macrotask + branch → (2) BUILD (builder) → (3) VERIFY
   (verifier diversi) → (4) CHECKPOINT DETERMINISTICO run_checkpoint.mjs = IL GIUDICE
   (dead-code · sicurezza · regressioni · conformita), MAI un agente → (5) se ROSSO/rilievi:
   FIX (fixer diversi) → applichi → RIESEGUI LO STESSO ORACOLO + i test (L-COL-003), accetti
   solo se azzerato e nulla rotto; budget retry ≤2 per finding, poi terminale all'umano →
   (6) verde: commit atomico + merge autonomo su main + push, aggiorni SESSION-STATE.

   Nota checkpoint AI+Supabase: il confine LLM (src/data/anthropic.ts) e MOCKATO nei test;
   la RLS di site_briefs e provata a runtime con auth reale su Supabase locale (mai nell'SQL
   editor). Eseguire il checkpoint senza .env.local e senza .next su disco, con le env
   esportate via shell; `db reset` prima del run; NON usare `--blueprint` (manifest
   supabase-jsts incompatibile con vitest+jsdom → falso rosso).

INVARIANTI NON NEGOZIABILI — per OGNI task:
  • ORACLE-AS-JUDGE, MAI LLM-AS-JUDGE.
  • LOOP DI VERIFICA DELLA FIX OBBLIGATORIO.
  • HUMAN-IN-THE-LOOP SULLE FIX; DEAD-CODE MAI CANCELLATO IN AUTONOMIA.
  • GIT A STRATI (branch autonomo, merge su main gated dal verde, distruttive mai autonome,
    DEPLOY NON SUPERVISIONATO BLOCCATO).
  • NESSUN FALSO "VIA LIBERA"; COPERTURA SEMPRE DICHIARATA.

Posizioni: blueprint/stato → docs/blueprint/P1-onboarding/ ; baseline/budget →
…/SESSION-STATE.md §4.

Dopo aver letto SESSION-STATE: dichiara in poche righe lo stato, il macrotask scelto coi suoi
task/criteri/test, il branch preparato, ed eventuali blocchi. Poi attendi il mio via.
```
