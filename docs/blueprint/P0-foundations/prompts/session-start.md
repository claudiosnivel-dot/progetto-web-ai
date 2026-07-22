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
   Il merge su main resta gated dal verde del checkpoint.

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
