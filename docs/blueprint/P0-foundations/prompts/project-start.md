# project-start — Belora · P0

> Da incollare **una volta**, all'avvio del progetto, per orientare l'agente al
> blueprint, alle decisioni chiuse, al piano di macrotask e alle invarianti.
> Con la skill trueline presente è **BUILD** a eseguire questa disciplina; questo
> prompt è il ponte di portabilità cross-tool.

```
Stai per costruire **Belora** (supabase-jsts; JS/TS + Supabase), seguendo un metodo
blueprint-first con verifica oracle-first. Il PIANO È IL BLUEPRINT: da qui si scrive
codice secondo i task, non si reinventa il design.

PRIMA DI TUTTO — leggi, in quest'ordine:
  1. docs/blueprint/P0-foundations/SESSION-STATE.md  → la fonte di verità sullo STATO
     VIVO del progetto. Leggila prima di qualunque azione, sempre.
  2. docs/blueprint/P0-foundations/  → il PIANO: 00-INDEX (mappa, piano di build,
     decision ledger) + i moduli numerati (01-infra … 06-sites), ognuno un macrotask
     coi suoi task atomici. Ogni task porta definition_of_done + acceptance_criteria +
     target_tests: sono questi i criteri contro cui si misura "fatto", non un'impressione.

DECISIONI BLOCCATE
  Le decisioni nel ledger di 00-INDEX sono CHIUSE (modello account personale-pronto-team,
  login email/password + Google, scope P0 con entità sites, stack Next.js+Supabase,
  next-intl, Tailwind+shadcn/ui, hosting dashboard Vercel). Si modificano solo con un
  emendamento esplicito nel ledger, mai in silenzio. In dubbio, fermati e chiedi.

PIANO DI MACROTASK (rispetta il DAG delle dipendenze):
  - infra          (dipendenze: nessuna) — radice del DAG
  - design-system  (dipendenze: infra)
  - i18n           (dipendenze: infra)
  - auth           (dipendenze: infra)
  - tenancy        (dipendenze: auth, infra)
  - sites          (dipendenze: tenancy, design-system, i18n, auth)
  Ordine consigliato: infra → design-system → i18n → auth → tenancy → sites
  Un macrotask è l'unità al cui confine gira il CHECKPOINT ed è l'unità di commit atomico.

ECOSISTEMA E POSIZIONI
  • Ecosistema: supabase-jsts (JS/TS su Supabase).
  • Blueprint e stato vivo: docs/blueprint/P0-foundations/ / …/SESSION-STATE.md.
  • Baseline e budget: docs/blueprint/P0-foundations/SESSION-STATE.md §4 (vuota fino al 1° BUILD).

INVARIANTI NON NEGOZIABILI (regole della casa per l'intero progetto):
  • ORACLE-AS-JUDGE, MAI LLM-AS-JUDGE: "verde" solo per l'esito di un ORACOLO o di un
    test, mai perché dici "è sicuro" o "ho sistemato".
  • LOOP DI VERIFICA DELLA FIX OBBLIGATORIO: applica la fix → riesegui LO STESSO oracolo →
    riesegui i test → accetta SOLO se il finding è sparito E nulla si è rotto.
  • HUMAN-IN-THE-LOOP SULLE FIX; DEAD-CODE MAI CANCELLATO IN AUTONOMIA.
  • GIT A STRATI: lavora su BRANCH autonomo; merge su main GATED dal verde; distruttive
    mai autonome; DEPLOY NON SUPERVISIONATO BLOCCATO.
  • NESSUN FALSO "VIA LIBERA"; COPERTURA SEMPRE DICHIARATA: un controllo non eseguito NON
    è un verde. Usa "verificato X" / "il controllo Y è passato", mai "è sicuro".

Conferma di aver letto SESSION-STATE e il blueprint, riepiloga in poche righe lo stato e
il primo macrotask eseguibile (infra), segnala incoerenze, e ATTENDI il mio via prima di
scrivere codice.
```
