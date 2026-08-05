# project-start — Belora · `architecture-hardening`

> Da incollare **una volta**, all'avvio del macrotask trasversale `architecture-hardening`, per
> orientare l'agente al blueprint, alle decisioni chiuse (AH-D*), al piano di task e alle
> invarianti. Con la skill trueline presente è **BUILD** a eseguire questa disciplina; questo
> prompt è il ponte di portabilità cross-tool.

```
Stai per costruire il macrotask TRASVERSALE **architecture-hardening** di **Belora**
(supabase-jsts; Next.js 16 + Supabase). P0/P1/P2/P3 editor-core sono COMPLETI e verdi su main.
Il PIANO È IL BLUEPRINT: si conforma il codice secondo i task, non si ridiscute il design.
Questo NON è un sotto-progetto Pn: è un refactor a ISO-COMPORTAMENTO su codice già in main +
l'attivazione repo-wide del gate architecture:.

PRIMA DI TUTTO — leggi, in quest'ordine:
  1. docs/blueprint/architecture-hardening/SESSION-STATE.md → stato VIVO. §6 (copertura
     dichiarata) e §7 (carry-over) sono i due che contano.
  2. docs/blueprint/architecture-hardening/ → il PIANO: 00-INDEX (mappa, DAG, ledger AH-D1..AH-D7)
     + 01-architecture-hardening (i 6 task atomici, ognuno con definition_of_done +
     acceptance_criteria + target_tests). VISION-AND-CONSTRAINTS per i non-goals.
  3. docs/superpowers/specs/2026-08-05-architecture-hardening-design.md → il design a monte.
  4. docs/blueprint/architecture-hardening/KICKOFF.md → l'handoff d'origine (superato).
  5. Il contratto architecture: e il gate: docs/blueprint/P3-editor/00-INDEX.md §1bis (fonte
     UNICA del blocco) e tests/architecture-contract.test.ts (alias-aware, scoped-P3 → repo-wide,
     con l'handoff LEGACY_DOMAIN_DATA).

CIÒ CHE È GIÀ MISURATO — sono fatti, non opinioni:
  • 7 archi domain->data (diretti, alias @/), tutti in codice P0/P1/P2 in main:
    setLocale->@/data/updateProfileLocale; auth/login,auth/signup->@/data/supabase-ssr;
    onboarding/interview,import/fromUrl->@/data/anthropic; generation/phase1,phase2->@/data/anthropic.
  • Set vietato repo-wide = ESATTAMENTE questi 7 (0 domain->ui, 0 domain->app, 0 data->ui: la
    data->ui è già bonificata in editor-core). Rimossi i 7, l'insieme vietato collassa a 0.
  • L'oracolo arch_check.mjs è CIECO sugli alias (madge senza --ts-config) e vive in una
    plugin-cache immutabile fuori repo: l'enforcement REALE è il test vitest versionato.

DECISIONI BLOCCATE (ledger 00-INDEX §4, AH-D1..AH-D7 — chiuse salvo emendamento esplicito):
  regola invariata, si conforma il codice (AH-D1); Gruppo A (setLocale, auth/login, auth/signup)
  relayer -> src/app (AH-D2); Gruppo B (interview, fromUrl) DI porta LLM (AH-D3); Gruppo C
  (phase1, phase2) relayer I/O -> src/data (AH-D4); enforcement nel test vitest (AH-D5); gate
  repo-wide + drop pin LEGACY_DOMAIN_DATA (AH-D6); testimone di non-vacuità positivo (AH-D7).
  In dubbio, fermati e chiedi.

PIANO DEI TASK (DAG interno):
  T-AH1..T-AH5 = 5 refactor su file DISGIUNTI (indipendenti). T-AH6 = gate repo-wide, dipende da
  TUTTI (0 archi vietati richiede che tutti gli archi siano rimossi). I refactor NON toccano
  tests/architecture-contract.test.ts: la transizione del gate è tutta di T-AH6.

INVARIANTI DI SICUREZZA DA PRESERVARE (refactor a iso-comportamento):
  • session-client mai service_role (auth): il codice spostato costruisce createServerSupabaseClient();
    lo spostamento NON apre un seam d'iniezione. Messaggi generici (anti-enumerazione).
  • chiave Anthropic confinata a data: src/app non importa mai @/data/anthropic (accesso via
    provider src/data/llm-ports.ts). La porta LLM è tipizzata solo sul SDK; output del modello =
    input NON FIDATO (validazione zod invariata). Client LLM lazy.
  • generation: maxRetries:0 + timeout (no doppia fatturazione), cache_control, cache-prefix
    byte-identico; parsePool resta il gate dentro il boundary.
  • setLocale: best-effort try/catch (fallimento DB non blocca cookie/redirect); no open-redirect.

INVARIANTI NON NEGOZIABILI (regole della casa):
  • ORACLE-AS-JUDGE, MAI LLM-AS-JUDGE.
  • LOOP DI VERIFICA DELLA FIX OBBLIGATORIO (applica → riesegui STESSO oracolo → riesegui test →
    accetta solo se sparito e nulla rotto).
  • HUMAN-IN-THE-LOOP SULLE FIX; DEAD-CODE MAI CANCELLATO IN AUTONOMIA.
  • GIT A STRATI: branch autonomo; merge su main GATED dal verde E dal deploy-coupling coupled
    (human-gated anche sul verde); distruttive mai autonome; DEPLOY NON SUPERVISIONATO BLOCCATO.
  • NESSUN FALSO "VIA LIBERA"; COPERTURA SEMPRE DICHIARATA; PRIMA DI CREDERE A UN VERDE, PROVA CHE
    LO STRUMENTO SA DIVENTARE ROSSO (falsificabilità del gate, T-AH6).

Conferma di aver letto SESSION-STATE e il blueprint, riepiloga in poche righe lo stato e i task,
segnala incoerenze, e ATTENDI il mio via prima di scrivere codice.
```
