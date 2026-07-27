# project-start — Belora · P2 (Generazione dei mockup)

> Da incollare **una volta**, all'avvio del sotto-progetto P2, per orientare l'agente al
> blueprint P2, alle decisioni chiuse, al piano di macrotask e alle invarianti. Con la
> skill trueline presente e **BUILD** a eseguire questa disciplina; questo prompt e il
> ponte di portabilita cross-tool.

```
Stai per costruire il sotto-progetto **P2 (Generazione dei mockup)** di **Belora**
(supabase-jsts; JS/TS + Supabase). P0 (fondamenta) e P1 (onboarding) sono COMPLETI e verdi
su main. Il PIANO E IL BLUEPRINT P2: da qui si scrive codice secondo i task, non si
reinventa il design.

PRIMA DI TUTTO — leggi, in quest'ordine:
  1. docs/blueprint/P2-generation/SESSION-STATE.md → fonte di verita sullo STATO VIVO di P2.
     Leggila prima di qualunque azione, sempre. §6 (copertura dichiarata) e §7 (carry-over
     ereditati) sono i due che contano.
  2. docs/blueprint/P2-generation/ → il PIANO: 00-INDEX (mappa, piano di build, decision
     ledger P2-D1..P2-D18) + i moduli 01-generation-model … 05-generation-e2e, ognuno un
     macrotask coi suoi task atomici. Ogni task porta definition_of_done +
     acceptance_criteria + target_tests: sono questi i criteri contro cui si misura "fatto".
  3. docs/superpowers/specs/2026-07-26-p2-generation-design.md → il design a monte (intento).
  4. Substrato gia costruito: docs/blueprint/P1-onboarding/ (site_briefs, brief.ts coi tetti
     di P1-D17, confine LLM src/data/anthropic.ts, guard.ts, listSites) e
     docs/blueprint/P0-foundations/ — referenziati in prosa nei moduli P2, NON nel DAG P2.

CIO' CHE P2 EREDITA — sono fatti, non opinioni:
  • Ingresso: brief con status='confirmed'. Forma di T-121 coi tetti di P1-D17: fino a 200
    offerte, riga fino a ~405 KB. Il generatore deve reggerla.
  • **Il testo del brief e input NON FIDATO in RENDERING.** description, highlights e le
    offerte possono contenere HTML o javascript: presi da una pagina ostile via fromUrl.
    In P1 il rendering e sicuro; **il sito generato da P2 deve sanificare** (T-231), e la
    prova sull'EFFETTO e in T-241. E' il carry-over che si dimentica piu facilmente, perche
    quel testo "sembra nostro".
  • Confine LLM: pattern T-131, UNICO punto di chiamata, server-only e mockabile, guardia
    ESLint deny-by-default. runGenerationTurn va DENTRO src/data/anthropic.ts.
  • Lo strict tool use ha un sottoinsieme JSON Schema RISTRETTO (P1-D20): niente maxLength,
    maxItems, vincoli numerici. Non e una preferenza: e un 400 alla prima chiamata vera.
  • **Non esiste una chiave API.** Ogni oracolo mocka il confine, e "gli schemi strict non
    sono provati contro l'API reale" resta aperto anche per P2.
  • P2 introduce SUPERFICIE DB NUOVA: rls:0 va RICONQUISTATO, non ereditato.

DECISIONI BLOCCATE (ledger di 00-INDEX §4, P2-D1..P2-D18 — CHIUSE salvo emendamento
esplicito registrato la):
  varia tema+struttura con 5 direzioni dichiarate a mano e confronto sulla HOME; UNA
  chiamata che produce un pool condiviso; rigenerazione COPY-ON-WRITE per variante;
  allowlist in ingresso e nessuna leva in uscita; due tabelle con le varianti in CODICE e
  congelamento alla scelta; sincrona con stream di trasporto e durabilita dalla RIGA;
  blocchi condizionati ai dati (un blocco senza dati NON ESISTE); anteprima a piena pagina
  con UN SOLO renderer; end-to-end minimo CON CANARY; etichette dai cataloghi i18n e solo
  la prosa dal modello; Sonnet 5 via ANTHROPIC_MODEL_GENERATION e MAI thinking disabled;
  imagery del tema con slot immagine tipato per sorgente; multi-pagina DERIVATO in due fasi;
  separazione dei temi imposta da ESLint; riconciliazione dello stato con DUE meccanismi;
  guasto di lettura distinto da brief povero; costanti di budget PROVVISORIE per
  dichiarazione; DAG interno a P2. Piu P1-D11 (contratto di altitudine) ANCORA RINVIATO.
  In dubbio, fermati e chiedi.

PIANO DI MACROTASK (rispetta il DAG interno a P2):
  - generation-model  (nessuna dipendenza) — i CONTRATTI: 2 tabelle+RLS, PoolSchema,
    SiteDocumentSchema multi-pagina, server action con riconciliazione
  - generation-engine (usa i contratti) — la TRASFORMAZIONE PURA: blocchi, temi, ricette,
    pagesFor, resolve, generatable
  - generation-llm    (usa i contratti) — il CONFINE: proiezione, normalizzatore, tool
    strict, prompt, runGenerationTurn, harness di misura
  - generation-ui     (usa engine E llm) — rotta, blocchi sanificati, selettore,
    congelamento, fase 2, anteprima, dashboard
  - generation-e2e    (usa la ui) — il primo end-to-end vero del progetto
  Ordine consigliato: generation-model → generation-engine & generation-llm → generation-ui
  → generation-e2e. Un macrotask e l'unita al cui confine gira il CHECKPOINT ed e l'unita
  di commit atomico.

SUPERFICI DI SICUREZZA NUOVE IN P2:
  • RLS su DUE TABELLE NUOVE + FK COMPOSITA (account_id, site_id) come difesa in profondita
    oltre la RLS: senza, un tenant puo ancorare una generazione al sito di un altro.
  • RENDERING DI TESTO NON FIDATO nel sito generato (T-231): nessun dangerouslySetInnerHTML,
    nessun href/src dal testo libero, e attenzione ai campi whatsapp/phone/email — sono
    TESTO LIBERO nel brief e possono venire da un sito terzo.
  • PROMPT INJECTION: il brief entra nel prompt. La difesa e STRUTTURALE (allowlist in
    ingresso, nessuna leva in uscita), non una frase nel prompt.
  • Il modo di fallire SILENZIOSO del confine: una risposta senza blocco tool_use chiude il
    turno con successo e non produce alcun pool. Va intercettato (T-224).

INVARIANTI NON NEGOZIABILI (regole della casa):
  • ORACLE-AS-JUDGE, MAI LLM-AS-JUDGE. Il confine LLM e mockato nei test → la
    non-determinazione del modello NON entra negli oracoli.
  • LOOP DI VERIFICA DELLA FIX OBBLIGATORIO (applica → riesegui STESSO oracolo → riesegui
    test → accetta solo se sparito e nulla rotto).
  • HUMAN-IN-THE-LOOP SULLE FIX; DEAD-CODE MAI CANCELLATO IN AUTONOMIA.
  • GIT A STRATI: branch autonomo; merge su main GATED dal verde; distruttive mai autonome;
    DEPLOY NON SUPERVISIONATO BLOCCATO (override deploy-coupling da RICONFERMARE: P2 tocca
    piu aree deploy-sensibili di P1).
  • NESSUN FALSO "VIA LIBERA"; COPERTURA SEMPRE DICHIARATA.

Conferma di aver letto SESSION-STATE e il blueprint P2, riepiloga in poche righe lo stato e
il primo macrotask eseguibile (generation-model), segnala incoerenze, e ATTENDI il mio via
prima di scrivere codice.
```
