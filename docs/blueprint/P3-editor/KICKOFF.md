# KICKOFF — Belora · P3 (Editor inline)

> **Handoff di PRE-BOOTSTRAP.** P3 non e' ancora stato bootstrappato: questo file NON e' un
> blueprint ne' una SESSION-STATE di lavoro costruito. E' il punto d'ingresso pulito per la
> **prossima sessione**, che avviera' P3. Impostato alla chiusura della sessione che ha completato
> **P2 (5/5 macrotask verdi su `main`)**.

| | |
|---|---|
| **Sotto-progetto** | P3 — Editor (il 4o dei 10: P0 base · P1 onboarding · P2 generazione · **P3 editor** · P4 pubblicazione · P5 billing · P6 vetrina · P7 blog · P8 GEO · P9 roadmap) |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Poggia su** | P0, P1 **e P2** — tutti completi e verdi su `main` |
| **Stato** | **DA BOOTSTRAPPARE.** Nessun `00-INDEX`, nessun modulo, nessun task atomico ancora. |

---

## 1. Cos'e' P3 (dallo spec di design APPROVATO)

**Editor = inline + blocchi guidati.** L'utente modifica i CONTENUTI (testi, foto, colori, font) e
puo' **aggiungere / riordinare / sostituire** blocchi dalla libreria. **Niente drag-and-drop
pixel-libero** (romperebbe i guardrail di qualita' — "sempre belli"). Fonte:
`docs/superpowers/specs/2026-07-22-ai-website-builder-design.md` §5 (righe ~100, 110, 128, 139, 166).

Vincolo di prodotto: **l'editing e' sempre GRATIS (0 crediti)** — testi/foto/colori/layout,
micro-modifiche, ripubblicazione. I crediti si spendono solo nella generazione (P2), non nell'editing.

## 2. Cosa P3 EREDITA (il substrato, verde su `main`)

- **L'artefatto che P3 edita: `site_generations.document`** — il `SiteDocument` CONGELATO alla scelta
  (P2-D5, `chooseVariant`/`selectVariant`). Oggi e' il **punto di consegna**; *dove vive il contenuto
  EDITATO e' una decisione di P3* (`docs/blueprint/P2-generation/00-INDEX.md` §7: "Editor inline dei
  contenuti → P3. La sede definitiva del documento e' una decisione di P3").
- **Il renderer UNICO** `SiteView` (`src/ui/site/SiteView.tsx`) + la libreria blocchi
  (`src/domain/generation/**`, `src/ui/site/blocks/**`): 8 blocchi (hero, chi-siamo, faq,
  cta-whatsapp, offerte, orari, contatti, recensioni), 5 temi. L'anteprima rende dal DOCUMENTO
  (`src/app/[locale]/preview/[siteId]/page.tsx`), non dal pool.
- **Sicurezza gia' costruita**: RLS per-tenant sulle tabelle generazione + FK composita, guardie di
  ownership (`enterSiteRoute`, `src/app/[locale]/_shared/site-route-guard.tsx`), i18n it/es, auth.
- **La disciplina del testo NON FIDATO** (carry-over da P1 §7 p.5, chiuso sull'EFFETTO da P2/T-241):
  il testo del brief e input non fidato in rendering. P2 sanifica (escaping React, niente
  `dangerouslySetInnerHTML` in `src/ui/site/**` — asserito da `tests/site-blocks-style.test.ts`, href
  solo da campi validati). **Le modifiche di P3 devono PRESERVARE questa proprieta'** — e l'e2e di P2
  (`e2e/`, canary + `assertNoInjectionEffect`) e' il modo di provarlo sull'effetto in Chromium.

## 3. Decisioni che P3 POSSIEDE (flaggate esplicitamente da P2 — non reinventarle, deciderle)

- **La RISCELTA distrugge le modifiche dell'editor.** `src/data/generation-choose.ts` (header +
  security_note di AC-233-4) dichiara: *"quando P3 esistera', riscegliere DISTRUGGERA' le modifiche
  dell'utente all'editor. E' una decisione di P3 e una guardia di P3."* Oggi la conferma di AC-233-4
  copre il costo in chiamate, **non ancora la perdita di lavoro editoriale.** P3 deve decidere e
  GUARDARE questo (avviso esplicito? versioning? blocco?).
- **La sede definitiva del documento editato** (§2): oggi `site_generations.document` come consegna;
  P3 decide dove/come vive il contenuto modificato (stessa colonna? versioni? tabella di revisioni?).
- **`P1-D11` — contratto di altitudine (`architecture:`)**: ancora RINVIATO da P0/P1/P2. Le condizioni
  sono ora piu' favorevoli (`cycle:0` misurato, guardie ESLint di layering reali). P3 potrebbe attivarlo.
- **Confine free/paid dell'editing** (design spec): l'editing e' gratis; P3 non deve introdurre gate a
  crediti sulle micro-modifiche.

## 4. Carry-over di P0/P1/P2 potenzialmente rilevanti per P3
- `readyForReview` verifica presenza e non provenienza; la history della chat non e' persistita;
  `upsertBrief` non riporta i campi scartati; T-122 fonde le offerte per nome (P1 §7 di P2 SESSION-STATE).
- **`osv`: chiuso i 2 HIGH** (undici 7.29.0, brace-expansion 5.0.9); restano 2 MODERATE (`next`,
  `postcss`), carry-over separato.
- **CI mai provata da una run reale** (`gh` non installato); lo script `test:e2e` esiste ma non e'
  ancora cablato in `ci.yml` (dopo `supabase start`).

## 5. Prossima azione (per la prossima sessione)

1. **Design di P3 prima del codice** — `superpowers:brainstorming`: cosa e' editabile e come, dove
   vive il documento editato, la guardia sulla riscelta (§3), versioning/undo, il confine free, la
   preservazione della sanificazione del testo non fidato.
2. **BOOTSTRAP via skill `trueline`** (modalita' bootstrap) → genera in `docs/blueprint/P3-editor/`:
   `00-INDEX.md` (mappa + piano di build + decision ledger P3-D*), i moduli dei macrotask,
   `VISION-AND-CONSTRAINTS.md`, `SESSION-STATE.md`, e `prompts/` (project-start · session-start ·
   session-end). Valida con `validate_blueprint.mjs` (exit 0) + self-check semantico avversariale.
3. **BUILD per macrotask** con la disciplina consueta: dynamic workflow (builder + verifier BLIND) →
   una fermata umana → fixer; oracolo `run_checkpoint.mjs` unico giudice (senza `--blueprint`);
   batteria di mutazione con sanita' fatale + ripristino per hash; git a strati (branch → merge sul
   verde); deploy-coupling `false` da RICONFERMARE (P3 aggiunge rotte/azioni di editing).

## 6. Input da leggere all'avvio
- `docs/superpowers/specs/2026-07-22-ai-website-builder-design.md` (§5 editor).
- `docs/blueprint/P2-generation/` (00-INDEX + `SESSION-STATE.md`: il documento come punto di consegna,
  la nota P3 su `generation-choose.ts`, le coperture dichiarate §6).
- `src/ui/site/SiteView.tsx`, `src/domain/generation/document.ts` (lo schema del `SiteDocument`).
