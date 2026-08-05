# 00-INDEX — Blueprint P3 · Editor inline di Belora

> Mappa, piano di build, decision ledger e manifest del sotto-progetto **P3**
> (Editor inline, 4o dei 10) del progetto Belora (AI website builder, Next.js 16 +
> Supabase). Generato in modalità BOOTSTRAP dalla skill *trueline*. **Nessun codice**:
> solo il piano. Fonte dell'intento: `docs/superpowers/specs/2026-08-05-p3-editor-design.md`.
> Handoff d'origine: `KICKOFF.md` (pre-bootstrap, ora superato da questo indice + SESSION-STATE).

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Sotto-progetto** | P3 — Editor inline (inline + blocchi guidati) |
| **Poggia su** | P0 (Fondamenta), P1 (Onboarding) e P2 (Generazione) — **tutti completi e verdi su `main`** |
| **Ingresso** | `site_generations.document` congelato alla scelta (P2-D5), renderer unico `SiteView`, 8 blocchi × 5 temi × 5 ricette |
| **Uscita** | Documento editabile a revisioni; consumato dalla pubblicazione (P4) |
| **Schema task** | schema atomico trueline (`L-COL-019`): definition_of_done + acceptance_criteria + target_tests |

---

## 1. Mappa dei macrotask

| # | File | Macrotask | Cosa costruisce |
|---|---|---|---|
| 01 | `01-editor-core.md` | `editor-core` | **La scrittura post-scelta**: tabella `site_document_revisions` (RLS riconquistata, FK composita), `saveRevision` dietro `parseDocument`, cap/potatura FIFO (20), read-path "ultima revisione else baseline", `SiteView` editable + isola `EditableText`, scan statico esteso, draft+undo client, switch tema, save-point (autosave+esplicito), **guardia riscelta soft**, **ripristino da storia**, contratto `architecture:` |
| 02 | `02-editor-blocks.md` | `editor-blocks` | **Le operazioni sui blocchi (T2)**: `renderDraftPage` (anteprima strutturale server, renderer unico), aggiungi / riordina / sostituisci blocchi dalla libreria entro i guardrail (precondition dati, label i18n, `brief_fields_rendered`), e la **prova sull'effetto** e2e estesa alla superficie editor |

## 1bis. Contratto di altitudine (attivo — abilita `arch_check` in BUILD, P3-D7)

Attiva il rinviato **P1-D11**: le condizioni sono ora favorevoli (`cycle:0` misurato,
guardie ESLint di layering reali) e P3 introduce un layer nuovo (`src/ui/editor`). Gli
strati e le dipendenze **vietate** fra strati; in BUILD `arch_check` (madge) le verifica
contro il grafo import reale come **gate assoluto**, con vacuity guard. La messa in opera
(più il test falsificabile) è **T-312**.

```yaml
architecture:
  layers:
    ui: "src/ui/**"
    domain: "src/domain/**"
    data: "src/data/**"
    app: "src/app/**"
  forbidden:
    - { from: domain, to: ui }
    - { from: domain, to: data }
    - { from: domain, to: app }
    - { from: data, to: ui }
```

## 2. Piano di build (ordine topologico del DAG)

Il DAG dei `depends_on` è **interno a P3**; P0/P1/P2 sono substrati già costruiti,
referenziati in prosa nei moduli e non nel DAG (eredita `P2-D18`/`P1-D6`), così
`validate_blueprint` resta pulito sulla dir P3.

```
editor-core
 ├─ T-301 site_document_revisions (schema + RLS + FK composita)   [ ]
 ├─ T-302 saveRevision dietro parseDocument                       [T-301]
 ├─ T-303 cap + potatura FIFO (20 per sito)                       [T-302]
 ├─ T-304 read-path: ultima revisione else baseline              [T-302]
 ├─ T-305 SiteView editable + isola EditableText                  [ ]
 ├─ T-306 scan statico anti-XSS esteso a src/ui/editor            [T-305]
 ├─ T-307 stato draft + undo/redo client sui testi                [T-305]
 ├─ T-308 switch tema fra i 5 (CSS custom properties)             [T-307]
 ├─ T-309 save-point: autosave debounce + salvataggio esplicito   [T-302, T-307]
 ├─ T-310 guardia riscelta soft (revisione rechosen)             [T-302]
 ├─ T-311 rotta /[locale]/editor/[siteId] + guardia ownership     [T-304, T-305]
 ├─ T-312 attivazione contratto architecture: (P1-D11/P3-D7)      [T-305, T-311]
 └─ T-318 ripristina una revisione dalla storia (non distruttivo) [T-302, T-304]

editor-blocks
 ├─ T-313 renderDraftPage (anteprima strutturale server)          [T-305, T-311]
 ├─ T-314 aggiungi blocco (precondition dati + label i18n)        [T-307, T-313]
 ├─ T-315 riordina i blocchi (lista ordinabile)                   [T-314]
 ├─ T-316 sostituisci un blocco                                   [T-314]
 └─ T-317 e2e ostile esteso alla superficie editor                [T-311, T-313, T-314]
```

**Ordine dei macrotask:** `editor-core` → `editor-blocks`. Ogni macrotask si chiude al suo
confine col checkpoint (dead-code · sicurezza · regressioni · conformità-logica sui
`target_tests`), poi commit atomico sul branch (`L-COL-024`); merge su `main` gated dal
verde (asimmetria BUILD, salvo **deploy-coupling da RICONFERMARE**: P3 aggiunge una rotta
`/editor` e nuove server action — vedi `SESSION-STATE` §3).

**Nota sui `covers:` nei file di test.** In BUILD col controllo 4 attivo (`--blueprint`),
ogni blocco di test che esercita un AC porta `// covers: AC-xxx-n`: un AC non tracciato
rende il controllo 4 rosso prima di eseguire. Convenzione del file di test, non campo del
blueprint.

## 3. Aggancio alla sicurezza (`07`)

Entrambi i macrotask toccano dati/auth o superfici di rendering, quindi portano la
baseline di sicurezza (`11` §5.2 p.9). P3 **introduce superficie DB nuova** (una tabella)
e una **superficie di rendering nuova** (`src/ui/editor`): `rls:0` e la copertura dello
scan anti-XSS vanno **riconquistati**, non ereditati.

- **`editor-core`**: RLS per-tenant sulla **tabella nuova** `site_document_revisions`
  (R1–R9, OWASP A01:2025) + **FK composita** `(site_generation_id, account_id)` come difesa
  in profondità (lezione P2-D19); **`parseDocument` come gate in scrittura** (A05:2025) su
  ogni revisione; client di **sessione, mai `service_role`**; `EditableText` che preserva
  l'**escaping React** (nessun `dangerouslySetInnerHTML`) e lo **scan statico esteso** a
  `src/ui/editor` (il rischio n.1: una superficie di render fuori sorveglianza); la rotta
  `/editor` protetta da `enterSiteRoute` (**notFound** anti-enumerazione, P1-D21).
- **`editor-blocks`**: `renderDraftPage` con `parseDocument` come gate prima del render e
  **renderer unico**; le operazioni sui blocchi mantengono `brief_fields_rendered`
  sincronizzato (contratto dei campi non fidati resi) e le **label da catalogo i18n**; e la
  **prova sull'EFFETTO** (Chromium, `assertNoInjectionEffect` + canary) estesa alla rotta
  editor — il verde vale solo perché il canary sa diventare rosso.

## 4. Decision ledger

> Le decisioni si modificano SOLO con emendamento esplicito registrato qui.
> `P3-D1`…`P3-D9` vengono dal design approvato del 2026-08-05 (§2), in forma compatta:
> la motivazione integrale sta nella spec.

| ID | Decisione | Scelta | Stato |
|---|---|---|---|
| `P3-D1` | Persistenza del documento editato | **Tabella revisioni** append-only `site_document_revisions` (RLS riconquistata, FK composita). La riscelta e ogni edit sono **non distruttivi**: la storia è la rete di sicurezza. `site_generations.document` resta la baseline congelata di P2 (P3-D9) | chiusa |
| `P3-D2` | Undo & granularità | **Undo/redo client** in memoria (fine, istantaneo) + revisioni **persistite ai save-point** (autosave con debounce + Salva esplicito). Cap **20** per sito, potatura FIFO delle più vecchie; ripristino cross-sessione da storia (T-318) | chiusa |
| `P3-D3` | Guardia sulla riscelta | **Soft**: dopo edit manuale la riscelta non blocca, crea una revisione `source:'rechosen'`, conferma **rassicurante** (le modifiche restano in storia). La conferma-di-**costo** AC-233-4 (rifare la fase 2 da `complete`) resta un layer **ortogonale**; CAS TOCTOU-safe preservato | chiusa |
| `P3-D4` | Scope | **T1 (inline) + T2 (blocchi)** in due macrotask (`editor-core` poi `editor-blocks`); **T3** (multi-pagina/aggiungi pagina) **rimandato** a dopo P4/P5 | chiusa |
| `P3-D5` | Modello di editing/rendering | **Isole inline nel renderer reale**: `SiteView` con modalità `editable`, gli slot di testo dentro il client component `<EditableText>` (children React, escaping preservato). **Renderer UNICO**, mai duplicato in client (P2-D8) | chiusa |
| `P3-D6` | Sicurezza estesa | Estendere lo **scan statico** (`src/ui/editor`) e i **payload e2e** (rotta editor) alla nuova superficie; ogni revisione ri-validata da **`parseDocument`** in scrittura; **RLS riconquistata** sulla tabella nuova | chiusa |
| `P3-D7` | Contratto di altitudine `architecture:` | **Attivato** in P3 (era `P1-D11`, rinviato da P0/P1/P2). Blocco `architecture:` in §1bis; `arch_check` gate assoluto in BUILD; messa in opera + test falsificabile in **T-312** | chiusa |
| `P3-D8` | Pointer di pubblicazione | In v1 **"ultima revisione = corrente"**; un pointer esplicito "published" è **decisione di P4**, non di P3 | chiusa |
| `P3-D9` | Sorgente di verità a strati | `site_generations.document` resta la **baseline congelata** di P2 (semantica invariata); le revisioni sono il **layer editoriale** sopra. Read-path: "ultima revisione se esiste, altrimenti baseline" (T-304) | chiusa |
| `P1-D11` | Contratto di altitudine (`architecture:`) | **ATTIVATO in P3** (vedi `P3-D7`). Non più rinviato: le condizioni erano favorevoli già a fine P2 (`cycle:0`, guardia ESLint di layering) | chiusa |

## 5. Fonti di verità

- **Piano**: questo blueprint (`00-INDEX` + moduli `01-editor-core`, `02-editor-blocks`).
- **Design a monte**: `docs/superpowers/specs/2026-08-05-p3-editor-design.md`.
- **Stato vivo**: `SESSION-STATE.md` (fonte di verità del sotto-progetto P3 — distinta da
  quelle di P0/P1/P2 e della skill trueline).
- **Substrato**: `docs/blueprint/P0-foundations/`, `docs/blueprint/P1-onboarding/`,
  `docs/blueprint/P2-generation/` (in particolare `site_generations.document`,
  `src/ui/site/SiteView.tsx`, `src/domain/generation/document.ts`,
  `src/data/generation-choose.ts`).

## 6. Self-check del blueprint

- **Strutturale**: `node <trueline>/scripts/blueprint/validate_blueprint.mjs docs/blueprint/P3-editor`
  — atteso exit 0 (`11` §5.1).
- **Semantico**: `self-check-checklist.md` punti 6–10 su ogni task (`11` §5.2); rilievi →
  human-in-the-loop.

## 7. Fuori scope di P3 v1 (rimandato)

- **Upload di foto reali** (`ImageSlot source:'uploaded'`) → **P4**. In P3 le immagini
  restano token `theme-placeholder` decorativi.
- **Azioni AI dentro l'editor** (copy AI di sezione, riscrittura SEO) → **P5** (ledger
  crediti). L'editing manuale di P3 è sempre **gratis (0 crediti)**.
- **T3 — multi-pagina / aggiungi pagina** (con re-layout a credito, gating ai piani) →
  **P4 + P5**.
- **Pointer di pubblicazione esplicito** → **P4** (P3-D8).
