# P3 — Editor inline · Documento di Design (V1)

> **Progetto:** Belora · **Sotto-progetto:** P3 (Editor inline) — il 4° dei 10 · **Data:** 2026-08-05 · **Stato:** design approvato; pronto per il bootstrap tecnico via skill *trueline*.
> **Poggia su:** P0, P1 e P2 — tutti completi e verdi su `main`.
> **Deliverable di questa sessione:** SOLO questo documento di design (nessun codice). Nasce dal brainstorming che ha risolto 5 decisioni keystone + 4 default confermati.
> **Fonti:** spec di prodotto `docs/superpowers/specs/2026-07-22-ai-website-builder-design.md` §5 (editor); handoff `docs/blueprint/P3-editor/KICKOFF.md`; substrato P2 (`docs/blueprint/P2-generation/`, `src/ui/site/**`, `src/domain/generation/**`, `src/data/generation-*.ts`).

---

## 0 · Indice

1. Obiettivo e confini
2. Decision ledger (P3-D*)
3. Dati & persistenza — tabella revisioni
4. Modello di editing (isole inline)
5. Azioni & data flow
6. Sicurezza — disciplina da preservare
7. Confine free/paid
8. Contratto di altitudine `architecture:`
9. Testing & oracoli
10. Fasatura di build (due macrotask)
11. Invarianti non negoziabili
12. Default confermati e voci rimandate

---

## 1 · Obiettivo e confini

**Cos'è P3.** L'editor che sta **tra la scelta del mockup (P2) e la pubblicazione (P4)**. L'utente modifica i **contenuti** (testi, colori/font via tema) e — come secondo macrotask — può **aggiungere / riordinare / sostituire** blocchi dalla libreria. Modello: **"inline + blocchi guidati"**, **niente drag-and-drop pixel-libero** (romperebbe il guardrail *always-beautiful*, cuore del posizionamento — spec §2 #1, §5 riga 110).

**Vincolo di prodotto:** l'editing è **sempre GRATIS (0 crediti)** su tutti i piani (spec §7.3). I crediti si spendono solo nella generazione (P2), mai nell'editing.

**Confini netti (decomposizione in sotto-progetti):**
- **Upload di foto reali → P4.** `ImageSlot source:'uploaded'` (con `asset_id` uuid) è già tipizzato nello schema ma **riservato a P4**. In P3 le immagini restano token `theme-placeholder` (div decorativi, nessun URL). ⟹ **niente image-editing in v1**.
- **Azioni AI dentro l'editor (copy AI di sezione, riscrittura SEO) → P5.** Richiedono il ledger crediti di P5, che non esiste ancora. ⟹ **fuori v1**.
- **T3 — multi-pagina / aggiungi pagina → rimandato.** Gated ai piani a pagamento e con re-layout a credito: dipende da P4 (pubblicazione) e P5 (billing/gating).

---

## 2 · Decision ledger (P3-D*)

| ID | Decisione | Sintesi |
|---|---|---|
| **P3-D1** | **Persistenza via tabella revisioni** | `site_document_revisions` append-only; la riscelta e ogni edit sono **non distruttivi**; la storia è la rete di sicurezza. |
| **P3-D2** | **Undo client + revisioni ai save-point** | Stack undo/redo in memoria (fine, istantaneo) nell'editor; revisioni **persistite** ai save-point (autosave con debounce + "Salva" esplicito). Cap **20** per sito, potatura FIFO. |
| **P3-D3** | **Guardia riscelta soft** | Dopo edit manuale, la riscelta **non blocca**: crea una revisione `source:'rechosen'`, mostra una conferma **rassicurante** ("le tue modifiche restano nella storia"). La conferma-di-**costo** AC-233-4 (rifare fase 2 da `complete`) resta un **layer ortogonale**. |
| **P3-D4** | **Scope T1 + T2, T3 rimandato** | Design copre inline (T1) + operazioni sui blocchi (T2); build in **due macrotask** (T1 poi T2). T3 rimandato a dopo P4/P5. |
| **P3-D5** | **Editing = isole inline nel renderer reale** | `SiteView` con modalità `editable`; gli slot di testo diventano client component `<EditableText>` (children React → escaping preservato). **Renderer unico**, mai duplicato in client. |
| **P3-D6** | **Sicurezza estesa alla superficie editor** | Estendere lo scan statico e i payload e2e alla dir dell'editor; ogni revisione ri-validata da `parseDocument` in scrittura; **RLS riconquistata** sulla tabella nuova. |
| **P3-D7** | **Attivare il contratto `architecture:`** | Il rinviato P1-D11 si attiva in P3 (condizioni favorevoli: `cycle:0`, guardie ESLint di layering reali). |
| **P3-D8** | **Pointer "published" = decisione di P4** | In v1 "ultima revisione = corrente"; un pointer esplicito di pubblicazione lo decide P4. |
| **P3-D9** | **Sorgente di verità a strati** | `site_generations.document` resta la **baseline congelata** di P2 (semantica invariata); le revisioni sono il **layer editoriale** sopra. Read path: "ultima revisione se esiste, altrimenti baseline". |

---

## 3 · Dati & persistenza — tabella revisioni (P3-D1, P3-D2, P3-D9)

Nuova tabella **`site_document_revisions`** (append-only):

| Colonna | Tipo | Note |
|---|---|---|
| `id` | uuid pk | |
| `site_generation_id` | uuid | parte della **FK composita per-tenant** verso `site_generations` (stesso pattern delle tabelle di generazione) |
| `account_id` | uuid | per la RLS per-tenant e la FK composita |
| `document` | jsonb | passa il gate `parseDocument` (strict, ≤ 8 MiB, slug unici, esattamente una `home`) |
| `source` | enum | `generated` \| `edited` \| `rechosen` |
| `seq` | int/bigint | ordinale monotono per (site_generation_id) — determina il "corrente" |
| `created_at` | timestamptz | |

**RLS — da RICONQUISTARE, non ereditare** (KICKOFF §2): `is_account_member`, batteria R1–R9, FK composita. La copertura RLS di P3 va **guadagnata** con oracolo, non presunta (nota: `rls:0` su una tabella significa "nessun rilievo statico", non "auditata a runtime").

**Sorgente di verità a strati (P3-D9):**
- `site_generations.document` resta la **baseline congelata** di P2 — la sua semantica (congelamento alla scelta via `chooseVariant`/`applyRechoose`, estensione fase 2 via `appendPages`) **non cambia**.
- Le revisioni sono il **layer editoriale** sopra la baseline.
- **Documento corrente** = revisione con `seq` massimo per il sito; se non esistono revisioni, la **baseline**.
- **Read path**: `readGenerationDocument` (oggi legge `site_generations.document`; usato da `/preview` e domani da P4) diventa "ultima revisione else baseline". La preview **pre-editing** continua a funzionare con zero revisioni.

**Cap & potatura (P3-D2):** teniamo le ultime **20** revisioni per sito; potatura **FIFO** delle più vecchie. Motivazione: il `document` è jsonb che "può pesare megabyte" — una storia illimitata di snapshot pieni non è dimensionabile.

**Ogni scrittura**: ri-validata da `parseDocument` **lato server** + mantiene sincronizzato `brief_fields_rendered` con `data` (contratto di sicurezza, §6).

---

## 4 · Modello di editing — isole inline (P3-D5)

- **`SiteView` guadagna una modalità `editable`.** In edit mode ogni slot di testo è avvolto in un client component **`<EditableText block slot>`**: il testo resta **children React** → **escaping preservato**, **mai `innerHTML`**. L'anteprima **è** il sito vero (renderer unico, P2-D8).
- **Stato draft client.** Il `SiteDocument` di lavoro vive in stato client; le edit mutano il draft; **stack undo/redo** di draft in memoria (fine, istantaneo, zero storage).
- **Tre modalità di aggiornamento anteprima — tutte a renderer unico:**
  1. **Testo** → l'isola client aggiorna in loco, istantaneo, nessun round-trip.
  2. **Switch tema** (fra i 5) → si scambiano i valori delle **CSS custom property** alla radice (i blocchi usano solo `var(--site-...)`, mai colori letterali) → istantaneo, blocchi invariati, **nessuna ri-implementazione**.
  3. **Strutturale (T2: aggiungi/riordina/sostituisci)** → cambia il set di blocchi → **`SiteView` ri-eseguito lato server sul draft** (server action, debounce/on-commit) che ritorna la pagina renderizzata. **Il client non renderizza mai i blocchi.**
- **Chrome editor (client):** toolbar (switch tema, Salva, Annulla/Rifà, storia revisioni) + pannello blocchi per T2 (lista ordinabile, "aggiungi dalla libreria", sostituisci).
- **Nota RSC:** i blocchi di `SiteView` sono Server Component async (`getTranslations`). Le isole `<EditableText>` sono client component figlie (un RSC può rendere figli client). La struttura (T2) si ri-renderizza server, non client.

---

## 5 · Azioni & data flow

- **Route** `/[locale]/editor/[siteId]`, protetta da `enterSiteRoute` (ownership via `listSites` sotto RLS, `notFound()` anti-enumerazione — P1-D21). Client **legato alla sessione**, **mai `service_role`**.
- **`saveRevision(siteId, draft)`** — server action: guardia ownership → `parseDocument(draft)` → se ok, insert revisione `source:'edited'` con `seq` successivo → potatura FIFO oltre 20 → ritorna il corrente. Save-point = **autosave con debounce + "Salva" esplicito**.
- **Riscelta (soft, non distruttiva)** — estende `selectVariant`/`applyRechoose` (`src/data/generation-choose.ts`): crea una revisione `source:'rechosen'` dal design fresco; le revisioni editate **restano in storia**; dialog **rassicurante**. **Preserva** il CAS TOCTOU-safe (`.eq('status', fromStatus)` col valore esatto letto) e la **conferma-di-costo AC-233-4** per il caso da `complete` (rifare fase 2 = chiamate al modello) come layer ortogonale.
- **`renderDraftPage(siteId, draft, pageSlug)`** — server action per l'anteprima strutturale T2: esegue `SiteView` sul draft **validato** e ritorna la pagina renderizzata.

---

## 6 · Sicurezza — disciplina da preservare (P3-D6)

La disciplina del **testo non fidato** provata sull'EFFETTO in P2 (T-241, canary + `assertNoInjectionEffect`) deve essere **preservata ed ESTESA** alla nuova superficie:

- Testo non fidato **solo** come children React nelle isole; **zero `dangerouslySetInnerHTML`**; **mai memorizzare HTML serializzato** (niente WYSIWYG che salvi markup — avvelenerebbe il documento congelato e riaprirebbe l'XSS che P2 chiude). Il contenuto resta **testo/struttura dati**.
- href/src solo da campi validati coi **costruttori esistenti** (`safeHttpsHref`/`safeTelHref`/`safeMailtoHref`/`safeWhatsappHref`); non "correggere" il rifiuto di `http:`/`javascript:`. Le immagini restano placeholder (nessun url/src).
- **ESTENDERE lo scan statico:** `tests/site-blocks-style.test.ts` fa il walk della sola `src/ui/site/**`. La nuova **`src/ui/editor/**` non è sorvegliata** → un `dangerouslySetInnerHTML` o un colore letterale lì passerebbe la CI **in silenzio** (rischio n.1 per P3). Aggiungere la dir dell'editor al walk (o un test gemello con lo stesso scanner falsificabile).
- **ESTENDERE i payload e2e:** ogni **nuovo campo editabile** va aggiunto a `e2e/fixtures/hostile-brief.ts` + spec, altrimenti la prova sull'effetto resta vacua per le nuove superfici. `assertNoInjectionEffect` va girato **sulla route editor in edit-mode** (rende lo stesso testo ostile). **Canary confinato** (Chromium-only, marker canary definito solo in `e2e/canary/`, mai in `src/`/bundle; suite vitest/e2e disgiunte).
- Ogni revisione persistita **ri-validata da `parseDocument` lato server**: il client non può salvare documenti invalidi, > 8 MiB, o che rompono l'invariante **home-unica**. Mantenere `brief_fields_rendered` **sincronizzato** con `data` (è l'elenco dei campi non fidati resi direttamente — contratto di sicurezza, non decorativo).
- **RLS riconquistata** sulla tabella `site_document_revisions` (R1–R9, FK composita).

---

## 7 · Confine free/paid

Tutto l'editing di P3 = **0 crediti**. Nessun gate a crediti sulle micro-modifiche (testi/tema/layout/ripubblicazione). Le azioni che *costerebbero* (AI) non sono in v1 (§1). La UI non introduce alcun paywall sull'editing manuale.

---

## 8 · Contratto di altitudine `architecture:` (P3-D7)

Il contratto **P1-D11** (asserzione `architecture:` sui confini di layer), rinviato da P0/P1/P2, si **attiva in P3**: le condizioni sono favorevoli (`cycle:0` misurato, guardie ESLint di layering reali) e P3 introduce un layer nuovo (`src/ui/editor`) + azioni dati — buon momento per fissare l'altitudine. Da onorare nel blueprint di bootstrap.

---

## 9 · Testing & oracoli

- **Unit:** persistenza revisioni (append, potatura FIFO a 20, selezione del corrente per `seq`), gate `parseDocument` in scrittura, riscelta che crea `rechosen` **non distruttiva** (le edit precedenti restano leggibili), sync `brief_fields_rendered`, read-path "ultima revisione else baseline".
- **Disciplina fixture (lezione ripetuta in P1):** ogni fixture ha **>1 elemento**, **valori discordanti**, e almeno un **id prefisso** di un altro. Una fixture con un solo elemento non prova nulla sull'identità.
- **Sicurezza:** scan statico esteso (§6) + payload e2e estesi + **canary che resta capace di diventare ROSSO** (prima di credere a un verde, provare che lo strumento sa fallire).
- **Oracolo unico giudice:** al confine di ogni macrotask gira `run_checkpoint.mjs` (dead-code · sicurezza · regressioni · conformità), **mai un agente**. Fra i task, **batteria di mutazione** con controllo di sanità palesemente fatale + verifica del ripristino **con l'hash**.

---

## 10 · Fasatura di build — due macrotask (P3-D4)

Input per il bootstrap `trueline` (che genererà i moduli e i task atomici con `definition_of_done` / `acceptance_criteria` / `target_tests`):

- **M1 — `editor-core`**: tabella `site_document_revisions` + RLS + persistenza (P3-D1/D2/D9) · editing **inline** di testi (prosa `content` + campi `data`) e SEO (`title`/`meta_description`) · **switch tema** fra i 5 · **undo client** + save-point (autosave debounce + esplicito) · **guardia riscelta soft** (P3-D3) · **ripristino da storia** (T-318, append-only) · update del read-path · **estensione della sicurezza** (§6).
- **M2 — `editor-blocks`**: operazioni **T2** (aggiungi/riordina/sostituisci blocchi dalla libreria) entro i guardrail · **ri-render server** del draft per la struttura · label i18n dei blocchi aggiunti · rispetto delle **precondition dati** dei blocchi (es. `recensioni` ha `precondition:()=>false` in v1 — nessun dato brief da cui attingere) · manutenzione di `brief_fields_rendered`.

**DAG:** M1 → M2 (M2 usa la persistenza e il renderer editabile di M1).
**Deploy-coupling `false` da RICONFERMARE** a inizio build (P3 aggiunge rotte e server action).

---

## 11 · Invarianti non negoziabili

- **Renderer UNICO**: l'anteprima passa sempre dal `SiteView` reale; il client non re-implementa mai il rendering dei blocchi.
- **Gate in scrittura**: ogni documento persistito ripassa `parseDocument` (strict, ≤ 8 MiB, slug unici, una `home`).
- **Testo non fidato**: solo children React; niente `dangerouslySetInnerHTML`; niente HTML memorizzato; href/src solo dai costruttori validati; `brief_fields_rendered` sincronizzato.
- **Separazione layer temi (P2-D14)**: `src/ui/site/**` (e la UI editor) non importa `src/ui/theme/tokens` (guardia `no-restricted-imports`).
- **Sicurezza guadagnata**: RLS riconquistata su tabelle nuove; scan statico e payload e2e **estesi** alla superficie editor.
- **Oracolo = giudice, mai LLM**; loop di verifica della fix obbligatorio; git a strati (branch autonomo, merge su verde, distruttive/deploy gated); nessun falso "via libera"; copertura sempre dichiarata.

---

## 12 · Default confermati e voci rimandate

**Confermati (approvati in brainstorming):**
1. Cap revisioni per sito = **20** (potatura FIFO).
2. Nome tabella = **`site_document_revisions`**.
3. Contratto **`architecture:` (P1-D11) attivato** in P3.
4. Pointer "published" esplicito = **decisione di P4**; v1 usa "ultima revisione = corrente".

**Rimandato (fuori P3 v1):** upload foto reali (P4) · azioni AI/crediti nell'editor (P5) · T3 multi-pagina/aggiungi pagina (P4+P5).

**Carry-over ereditati da monitorare** (non introdotti da P3): `osv` 2 MODERATE (`next`, `postcss`); CI mai girata da run reale (`gh` non installato); e2e solo Chromium; `readyForReview` verifica presenza non provenienza; history chat non persistita; `upsertBrief` non riporta i campi scartati.
