# project-start — Belora · P3 (Editor inline)

> Da incollare **una volta**, all'avvio del sotto-progetto P3, per orientare l'agente al
> blueprint P3, alle decisioni chiuse, al piano di macrotask e alle invarianti. Con la
> skill trueline presente è **BUILD** a eseguire questa disciplina; questo prompt è il
> ponte di portabilità cross-tool.

```
Stai per costruire il sotto-progetto **P3 (Editor inline)** di **Belora** (supabase-jsts;
Next.js 16 + Supabase). P0 (fondamenta), P1 (onboarding) e P2 (generazione) sono COMPLETI e
verdi su main. Il PIANO È IL BLUEPRINT P3: da qui si scrive codice secondo i task, non si
reinventa il design.

PRIMA DI TUTTO — leggi, in quest'ordine:
  1. docs/blueprint/P3-editor/SESSION-STATE.md → fonte di verità sullo STATO VIVO di P3.
     Leggila prima di qualunque azione, sempre. §6 (copertura dichiarata) e §7 (carry-over
     ereditati) sono i due che contano.
  2. docs/blueprint/P3-editor/ → il PIANO: 00-INDEX (mappa, piano di build, decision ledger
     P3-D1..P3-D9, contratto architecture: in §1bis) + i moduli 01-editor-core e
     02-editor-blocks, ognuno un macrotask coi suoi task atomici. Ogni task porta
     definition_of_done + acceptance_criteria + target_tests: sono questi i criteri contro
     cui si misura "fatto".
  3. docs/superpowers/specs/2026-08-05-p3-editor-design.md → il design a monte (intento).
  4. Substrato già costruito: docs/blueprint/P2-generation/ (site_generations.document,
     SiteView, document.ts, generation-choose.ts) e P0/P1 — referenziati in prosa nei
     moduli P3, NON nel DAG P3.

CIÒ CHE P3 EREDITA — sono fatti, non opinioni:
  • L'artefatto che P3 edita: site_generations.document, il SiteDocument CONGELATO alla
    scelta (P2-D5). P3 vi mette SOPRA un layer di revisioni (P3-D1/D9): la baseline resta.
  • Il renderer UNICO SiteView + 8 blocchi × 5 temi × 5 ricette. L'anteprima passa SEMPRE da
    SiteView reale; MAI una ri-implementazione client (P2-D8).
  • Ogni scrittura del documento passa da parseDocument (strict, ≤8 MiB, slug unici, una
    home). Vale anche per P3: ogni revisione ri-valida.
  • **Il testo del brief è input NON FIDATO in RENDERING.** P2 lo sanifica (escaping React,
    niente dangerouslySetInnerHTML, href/src solo da campi validati) e lo prova sull'EFFETTO
    (T-241, Chromium + canary). P3 deve PRESERVARLO ed ESTENDERLO alla superficie editor
    (scan statico su src/ui/editor → T-306; e2e ostile sulla rotta editor → T-317).
  • brief_fields_rendered è il contratto dei campi non fidati resi: va tenuto sincronizzato
    con data a ogni edit (T-302/T-314/T-316).
  • Separazione layer temi (P2-D14): la UI editor NON importa src/ui/theme/tokens.
  • CAS TOCTOU-safe della riscelta (P2-D23): da preservare (T-310).
  • P3 introduce SUPERFICIE DB NUOVA (site_document_revisions) e SUPERFICIE DI RENDER NUOVA
    (src/ui/editor): rls:0 e lo scan anti-XSS vanno RICONQUISTATI, non ereditati.

DECISIONI BLOCCATE (ledger di 00-INDEX §4, P3-D1..P3-D9 — CHIUSE salvo emendamento
esplicito registrato lì):
  persistenza a tabella revisioni non distruttiva; undo client + revisioni ai save-point,
  cap 20 FIFO; guardia riscelta SOFT (revisione rechosen, conferma rassicurante, AC-233-4
  cost-confirm ortogonale); scope T1+T2 in due macrotask, T3 rimandato; editing = isole
  inline nel renderer reale (SiteView editable + EditableText, renderer unico); sicurezza
  estesa (scan statico + e2e alla superficie editor, parseDocument in scrittura, RLS
  riconquistata); contratto architecture: ATTIVATO (P3-D7, ex P1-D11); pointer published =
  decisione di P4; baseline site_generations.document + revisioni sopra.
  In dubbio, fermati e chiedi.

PIANO DI MACROTASK (rispetta il DAG interno a P3):
  - editor-core   (T-301..T-312, T-318) — la SCRITTURA post-scelta: tabella revisioni+RLS,
    saveRevision dietro parseDocument, cap/potatura, read-path, SiteView editable +
    EditableText, scan statico esteso, draft+undo, switch tema, save-point, guardia riscelta
    soft, contratto architecture:
  - editor-blocks (T-313..T-317) — le OPERAZIONI SUI BLOCCHI: renderDraftPage, aggiungi/
    riordina/sostituisci entro i guardrail, e2e ostile esteso
  Ordine: editor-core → editor-blocks. Un macrotask è l'unità al cui confine gira il
  CHECKPOINT ed è l'unità di commit atomico.

SUPERFICI DI SICUREZZA NUOVE IN P3:
  • RLS su UNA TABELLA NUOVA (site_document_revisions) + FK COMPOSITA (site_generation_id,
    account_id) come difesa in profondità; client di SESSIONE, mai service_role.
  • parseDocument come GATE IN SCRITTURA su ogni revisione (nessun documento non validato
    persistito; nessun URL di terzi nello slot immagine — AC-204-11).
  • RENDERING EDITABILE del testo non fidato: EditableText mantiene l'escaping React; niente
    dangerouslySetInnerHTML; niente WYSIWYG che memorizzi HTML. Lo SCAN STATICO va ESTESO a
    src/ui/editor (rischio n.1: superficie di render fuori sorveglianza).
  • ROTTA /editor protetta da enterSiteRoute (notFound anti-enumerazione P1-D21).

INVARIANTI NON NEGOZIABILI (regole della casa):
  • ORACLE-AS-JUDGE, MAI LLM-AS-JUDGE.
  • LOOP DI VERIFICA DELLA FIX OBBLIGATORIO (applica → riesegui STESSO oracolo → riesegui
    test → accetta solo se sparito e nulla rotto).
  • HUMAN-IN-THE-LOOP SULLE FIX; DEAD-CODE MAI CANCELLATO IN AUTONOMIA.
  • GIT A STRATI: branch autonomo; merge su main GATED dal verde; distruttive mai autonome;
    DEPLOY NON SUPERVISIONATO BLOCCATO (deploy-coupling da RICONFERMARE: P3 aggiunge la rotta
    /editor e nuove server action).
  • RENDERER UNICO: l'anteprima passa da SiteView reale, mai una copia client.
  • NESSUN FALSO "VIA LIBERA"; COPERTURA SEMPRE DICHIARATA; PRIMA DI CREDERE A UN VERDE,
    PROVA CHE LO STRUMENTO SA DIVENTARE ROSSO.

Conferma di aver letto SESSION-STATE e il blueprint P3, riepiloga in poche righe lo stato e
il primo macrotask eseguibile (editor-core), segnala incoerenze, e ATTENDI il mio via prima
di scrivere codice.
```
