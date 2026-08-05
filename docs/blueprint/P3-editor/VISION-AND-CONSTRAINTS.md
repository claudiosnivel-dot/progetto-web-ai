# VISION & CONSTRAINTS — Belora · P3 (Editor inline)

> Perché P3 esiste, per chi, cosa NON fa, e i vincoli. Input dall'utente e dalla spec di
> design approvata (`docs/superpowers/specs/2026-08-05-p3-editor-design.md`), non invenzione
> dell'LLM. Prosa in italiano, identificatori in inglese.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Owner / stakeholder** | Fondatore non tecnico; costruisce con Claude Code (priorità: managed, bassa manutenzione, task atomici) |

---

## 1. Perché esiste (problema)

Dopo aver generato 5 mockup e sceltone uno (P2), l'utente deve poter **rendere suo** il
sito — correggere i testi, cambiare tema, aggiungere/riordinare i blocchi — **senza
scrivere codice e senza poter fare un sito brutto**. Oggi il documento scelto è congelato
e l'anteprima è in sola lettura (P2-D8): manca la scrittura post-scelta. P3 la introduce
mantenendo la promessa centrale del prodotto: la bellezza è **strutturalmente garantita**
("always-beautiful"), quindi niente drag-and-drop pixel-libero.

## 2. Per chi (utenti)

Micro-business locali di IT/ES/LATAM, titolari non tecnici, spesso da telefono. Vogliono
ritoccare i contenuti in pochi minuti e ripubblicare, senza "organizzare un sito". Per
loro l'editing è **inline** ("clicca il testo, scrivi") e **guidato** (blocchi dalla
libreria, non una tela vuota).

## 3. Obiettivo (cosa significa "fatto")

Un editor che, sul documento scelto: (a) modifica **inline** testi, SEO (`title`/`meta`) e
**tema** fra i 5; (b) **aggiunge / riordina / sostituisce** blocchi dalla libreria entro i
guardrail; (c) **persiste a revisioni** con undo, save-point e **guardia riscelta soft**
non distruttiva; (d) **preserva ed estende** la disciplina anti-XSS del testo non fidato
alla nuova superficie. Tutto **gratis (0 crediti)**.

Il blueprint scompone l'obiettivo in due macrotask; i `target_tests` dei task ne diventano
l'oracolo del checkpoint. "Fatto" = oracoli verdi al confine di ogni macrotask, **non** una
dichiarazione dell'LLM (`L-COL-002`, `L-COL-006`).

## 4. Non-goals (cosa NON facciamo in P3 v1)

- **Upload di foto reali**: è di **P4** (`ImageSlot source:'uploaded'` è tipizzato ma
  riservato). In P3 le immagini restano token `theme-placeholder` decorativi.
- **Azioni AI dentro l'editor** (copy AI di sezione, riscrittura SEO): dipendono dal ledger
  crediti di **P5**. L'editing manuale non è mai gated dietro i crediti.
- **T3 — multi-pagina / aggiungi pagina** con re-layout a credito e gating ai piani →
  **P4 + P5**.
- **Drag-and-drop pixel-libero / CSS arbitrario / override di tema fuori dai 5**: romperebbe
  il guardrail "always-beautiful". Deve essere **strutturalmente impossibile**.
- **WYSIWYG che memorizzi HTML**: il contenuto resta testo/struttura dati, mai markup
  serializzato.
- **Pointer di pubblicazione esplicito**: decisione di **P4** (P3-D8).

## 5. Vincoli

| Tipo | Vincolo |
|---|---|
| Ecosistema | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| Sicurezza — RLS | RLS per-tenant **riconquistata** sulla tabella nuova `site_document_revisions` (R1–R9, no `USING (true)`), FK composita; client di **sessione, mai `service_role`** (`07`) |
| Sicurezza — rendering | Testo non fidato solo come children React; **nessun `dangerouslySetInnerHTML`**; href/src solo dai costruttori validati; **scan statico esteso** a `src/ui/editor`; ogni revisione ripassa **`parseDocument`** in scrittura; prova sull'**effetto** e2e estesa alla rotta editor |
| Renderer | **Unico**: l'anteprima passa sempre dal `SiteView` reale; mai una ri-implementazione client (P2-D8) |
| Altitudine | Contratto `architecture:` **attivo** (P3-D7): `arch_check` gate assoluto in BUILD |
| Prodotto | Editing **sempre gratis (0 crediti)**; guardrail "always-beautiful" non aggirabile |
| Git | branch a strati; merge su `main` gated dal verde; deploy non supervisionato bloccato (deploy-coupling **da riconfermare**: P3 aggiunge rotta `/editor` e server action) (`L-COL-024`, `L-COL-025`) |

## 6. Parity gate (promessa forte)

Conformità alla specifica = i `target_tests` dei task del macrotask passano al checkpoint.
Nessuna promessa di "sicuro/pronto": si dichiara la **copertura**, e il verde di una prova
sull'effetto vale **solo** perché il canary sa diventare rosso.

## 7. Baseline & budget

- **Baseline di sicurezza**: da ricatturare a inizio BUILD (P3 introduce una tabella nuova →
  `rls` da riconquistare; nuova superficie di render → scan statico da estendere). Registrata
  in `SESSION-STATE` §4.
- **Budget**: limiti di spesa/tempo per ciclo in `SESSION-STATE` §4.

## 8. Fonti di verità

- **Piano**: il blueprint (`00-INDEX` + `01-editor-core`, `02-editor-blocks`).
- **Stato vivo**: `SESSION-STATE.md` (fonte di verità del sotto-progetto P3 — distinta dalle
  altre e da quella della skill trueline).
- **Design a monte**: `docs/superpowers/specs/2026-08-05-p3-editor-design.md`.
