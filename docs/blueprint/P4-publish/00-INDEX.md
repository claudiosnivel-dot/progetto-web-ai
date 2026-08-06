# 00-INDEX — Blueprint P4 · Pubblicazione, serving pubblico & media di Belora

> Mappa, piano di build, decision ledger e manifest del sotto-progetto **P4**
> (Pubblicazione / hosting, 5o dei 10) del progetto Belora (AI website builder, Next.js 16 +
> Supabase). Generato in modalità BOOTSTRAP dalla skill *trueline*. **Nessun codice**: solo
> il piano. Fonte dell'intento: `docs/superpowers/specs/2026-08-06-p4-publish-media-design.md`.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Sotto-progetto** | P4 — Pubblicazione, serving pubblico & media (v1) |
| **Poggia su** | P0 (Fondamenta), P1 (Onboarding), P2 (Generazione), P3 (Editor) — **tutti completi e verdi su `main`** — più il pass trasversale `architecture-hardening` (gate `architecture:` reso **repo-wide**) |
| **Ingresso** | Il **documento corrente** di un sito (ultima revisione else baseline, P3-D9 / T-304), reso dal renderer unico `SiteView`; `ImageSlot source:'uploaded'` già tipizzato (T-202) |
| **Uscita** | Un sito **pubblicato** servito a `/s/<slug>` standalone, **indicizzabile** (SEO base), con **foto reali** caricate dall'utente al posto dei placeholder del tema |
| **Schema task** | schema atomico trueline (`L-COL-019`): definition_of_done + acceptance_criteria + target_tests |

---

## 1. Mappa dei macrotask

| # | File | Macrotask | Cosa costruisce |
|---|---|---|---|
| 01 | `01-publish-core.md` | `publish-core` | **Il layer pubblicato**: tabella `site_publications` (RLS anon-published riconquistata + `UNIQUE public_slug`), generazione/dedup/riservati di `public_slug` (dominio puro), `publishSite` (gate `parseDocument` → snapshot congelato + `is_published=true` + slug) e `unpublishSite` (snapshot preservato) |
| 02 | `02-public-serving.md` | `public-serving` | **Il serving pubblico**: rotta top-level `/s/<slug>` standalone (lettura **anon via RLS** → `parseDocument` → `SiteView` nella locale del sito), middleware che esclude `/s/*` dal routing di locale, **RLS pubblica provata a RUNTIME**, badge "Made with Belora", `notFound` anti-enumerazione |
| 03 | `03-seo-base.md` | `seo-base` | **La SEO base**: `generateMetadata` (title/description/Open Graph/canonical/lang/og:image dallo snapshot), **JSON-LD `LocalBusiness`** con serializzazione SICURA (escaping `< > &` + `U+2028/2029`, anti-breakout script), `sitemap.xml` per-sito + `robots.txt` (indicizza `/s/*`, editor/preview `noindex`) |
| 04 | `04-media-storage.md` | `media-storage` | **La pipeline media**: bucket Storage a lettura pubblica + RLS scrittura per-tenant + tabella `assets` + RLS, `uploadAsset` (sniff magic-bytes + re-encode `sharp` → strip EXIF, rifiuto SVG, resize → Storage + riga `assets`), URL pubblico costruito **da `asset_id`** (mai da testo libero, preserva P2-D12) |
| 05 | `05-media-editor-render.md` | `media-editor-render` | **Il render & l'editor delle foto**: `SiteImage` rende `ImageSlot source:'uploaded'` (src dal nostro URL, escaping preservato); affordance di upload nell'editor per slot immagine → `ImageSlot 'uploaded'` nel draft → salvato via `saveRevision` |
| 06 | `06-e2e-public.md` | `e2e-public` | **La prova di punta**: e2e ostile Chromium su `/s/<slug>` — documento pubblicato ostile + asset caricato → `assertNoInjectionEffect` (effetto nullo, payload come TESTO) + **canary ROSSO**; estende T-241/T-317 alla superficie pubblica |

## 1bis. Contratto di altitudine (repo-wide — già attivo)

Il contratto `architecture:` non è una novità di P4: è **attivato in P3** (P3-D7, ex P1-D11) e
reso **repo-wide** dal pass `architecture-hardening` (AH-D6, `0` archi `forbidden`). L'**enforcement**
vive nel gate versionato `tests/architecture-contract.test.ts` (alias-aware, repo-wide) — che carica
il contratto dalla sua fonte unica in `docs/blueprint/P3-editor/00-INDEX.md` §1bis. Lo dichiariamo
**anche qui** perché `validate_blueprint` valida la forma del blocco sulla dir P4 (check `(6)`): è
lo **stesso** contratto, non una seconda fonte di verità.

P4 aderisce senza eccezioni: il **serving pubblico** e le rotte SEO stanno in `src/app`; la **logica
pura** publish/media (generazione/dedup/riservati di `public_slug`, forma dello snapshot, costruzione
sicura del JSON-LD, costruzione dell'URL asset da `asset_id`) sta in `src/domain`; l'**accesso dati**
e l'**I/O** (`site_publications`/`assets`, Storage, `sharp` re-encode) stanno in `src/data`. Nessun
arco `forbidden`.

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

Il DAG dei `depends_on` è **interno a P4**; P0/P1/P2/P3 e `architecture-hardening` sono substrati
già costruiti, referenziati in prosa nei moduli e **non** nel DAG (eredita `P3-D9`/`P2-D12`), così
`validate_blueprint` resta pulito sulla dir P4.

```
publish-core
 ├─ T-401 site_publications (schema + RLS anon-published + UNIQUE public_slug)   [ ]
 ├─ T-402 public_slug: generazione da business_name + dedup globale + riservati  [ ]
 ├─ T-403 publishSite: gate parseDocument → snapshot + is_published + slug        [T-401, T-402]
 └─ T-404 unpublishSite: is_published=false, snapshot preservato                  [T-401]

public-serving
 ├─ T-405 rotta /s/<slug> standalone: anon → parseDocument → SiteView (locale)    [T-401, T-403]
 ├─ T-406 middleware esclude /s/* dal routing di locale                           [T-405]
 ├─ T-407 RLS pubblica provata a RUNTIME (pubblicato sì / non-pubblicato/altrui no) [T-401]
 └─ T-408 badge "Made with Belora" sul sito pubblicato                            [T-405]

seo-base
 ├─ T-409 generateMetadata: title/description/OG/canonical/lang/og:image          [T-405]
 ├─ T-410 JSON-LD LocalBusiness con serializzazione SICURA (anti-breakout)         [T-405]
 └─ T-411 sitemap.xml per-sito + robots.txt (indicizza /s/*, editor/preview noindex) [T-405]

media-storage
 ├─ T-412 bucket lettura pubblica + RLS scrittura per-tenant + tabella assets + RLS [ ]
 ├─ T-413 uploadAsset: magic-bytes + sharp re-encode (strip EXIF/reject SVG/resize) [T-412]
 └─ T-414 URL pubblico dell'asset da asset_id (mai da testo libero, P2-D12)         [T-412]

media-editor-render
 ├─ T-415 SiteImage rende ImageSlot source:'uploaded' (src dal nostro URL)         [T-414]
 └─ T-416 editor: affordance upload → ImageSlot 'uploaded' nel draft → saveRevision [T-413, T-415]

e2e-public
 └─ T-417 e2e ostile Chromium su /s/<slug> (documento ostile + asset) + canary rosso [T-405, T-409, T-410, T-416]
```

**Ordine dei macrotask:** `publish-core` → `public-serving` → `seo-base`; `media-storage` →
`media-editor-render` (indipendenti da M1–M3 salvo il render); `e2e-public` alla fine (richiede la
rotta pubblica e i media). Ogni macrotask si chiude al suo confine col checkpoint (dead-code ·
sicurezza incl. **nuova RLS** · regressioni · conformità-logica sui `target_tests`), poi commit
atomico sul branch (`L-COL-024`); merge su `main` gated dal verde **e** dal deploy-coupling
`coupled` (**human-gated anche sul verde**, confermato in P3 — vedi `SESSION-STATE` §3).

**Nota sui `covers:` nei file di test.** In BUILD col controllo 4 attivo (`--blueprint`), ogni
blocco di test che esercita un AC porta `// covers: AC-xxx-n`: un AC non tracciato rende il
controllo 4 rosso prima di eseguire. Convenzione del file di test, non campo del blueprint.

## 3. Aggancio alla sicurezza (`07`)

P4 è la **superficie a più alto rischio finora**: è il primo momento in cui un artefatto di Belora
**esce dall'area autenticata** e diventa pubblico, e la prima volta che entrano **byte non fidati
dell'utente** (foto). Tre superfici nuove, ognuna con oracolo (P4-D9); la baseline di sicurezza
(`11` §5.2) si porta su tutte, e `rls`/scan/e2e vanno **riconquistati**, non ereditati.

- **`publish-core`** (T-401/T-403/T-404): **RLS riconquistata** sulla tabella nuova `site_publications`
  (R1–R9, **OWASP A01:2025**) con policy **`anon = SELECT solo su `is_published = true``** e membri
  dell'account = CRUD sulle proprie righe; colonne private (`account_id`, `source_generation_id`)
  **mai esposte**; client di **sessione, mai `service_role`** nel browser. `publishSite`/`unpublishSite`
  sotto RLS con **gate `parseDocument`** in scrittura (**A05:2025**), ownership verificata, sito
  altrui → `404` (anti-enumerazione **P1-D21**). `public_slug` **UNIQUE globale** + lista riservati.
- **`public-serving`** (T-405/T-406/T-407/T-408): il documento pubblicato è **reso al pubblico** come
  input **non fidato** → `parseDocument` + **escaping React** del `SiteView` (nessun
  `dangerouslySetInnerHTML`, nessun `src/href` da testo libero); slug ignoto/non pubblicato →
  `notFound()`. La **RLS pubblica è provata a RUNTIME** (T-407): anon legge il pubblicato, **non** il
  non-pubblicato né di altri tenant, colonne private non esposte.
- **`seo-base`** (T-409/T-410/T-411): il **JSON-LD `LocalBusiness`** è un punto di sicurezza, non
  decorativo — i campi brief sono non fidati → serializzazione con **escaping di `< > &` +
  `U+2028/2029`** (anti-breakout dal tag `<script>`, **A03:2025 injection**). Metadata/OG/canonical
  dallo **snapshot** (non da testo libero arbitrario); `robots.txt` tiene editor/preview `noindex`.
- **`media-storage`** (T-412/T-413/T-414): **upload non fidato → il re-encode è la difesa**, provata
  sull'**effetto**: sniff **magic-bytes** + `sharp` re-encode in raster (**strip EXIF/metadata,
  rifiuto SVG, resize**) → byte puliti su Storage. **RLS di scrittura per-tenant** su
  `storage.objects` e su `assets` (A01:2025). URL pubblico costruito **da `asset_id`**, **mai da
  testo libero** (preserva **P2-D12**).
- **`media-editor-render`** (T-415/T-416): `SiteImage` costruisce il `src` dal **nostro** URL
  (`asset_id → URL`), escaping preservato; l'`ImageSlot 'uploaded'` nel draft ripassa
  `parseDocument` via `saveRevision`.
- **`e2e-public`** (T-417): la **prova sull'EFFETTO** in Chromium sulla rotta pubblica `/s/<slug>`
  con documento pubblicato ostile **e** asset caricato (`assertNoInjectionEffect`: contatore 0,
  nessun host esterno, nessuna navigazione, payload come TESTO) + **canary confinato** che rende
  ROSSO lo stesso oracolo — il verde vale solo perché il canary sa diventare rosso.
- **Altitudine (gate repo-wide)**: serving pubblico in `src/app`, logica pura in `src/domain`,
  accesso dati + `sharp` in `src/data`; nessun arco `forbidden` (§1bis).

## 4. Decision ledger

> Le decisioni si modificano SOLO con emendamento esplicito registrato qui.
> `P4-D1`…`P4-D9` vengono dal design approvato del 2026-08-06 (§3), in forma compatta:
> la motivazione integrale sta nella spec.

| ID | Decisione | Scelta | Stato |
|---|---|---|---|
| `P4-D1` | Dove servire i siti pubblicati in v1 | **Dall'app Next.js**, path-based `/s/<slug>`; Cloudflare R2/Worker + sottodomini wildcard + domini custom **rimandati** a un pass hosting dedicato | chiusa |
| `P4-D2` | Modello del "published" | **Snapshot separato dalle revisioni** in `site_publications` (per-sito): pubblicare congela il documento corrente (gate `parseDocument`) in un record dedicato → disaccoppia il live dall'editing e dalla **potatura FIFO** di P3 (T-303). Layer pubblicato sopra baseline→revisioni (estende P3-D9) | chiusa |
| `P4-D3` | Rotta pubblica | **Top-level `/s/<slug>`**, fuori dal routing localizzato; render **standalone** (nessuna chrome Belora) nella **locale del sito**; lettura **anon via RLS** (`is_published=true`, solo colonne pubbliche); gate `parseDocument` + escaping `SiteView`; slug ignoto/non pubblicato → `notFound()` | chiusa |
| `P4-D4` | Identità pubblica | **`public_slug` GLOBALE unico** (nuovo campo; `sites.slug` è unico solo per-account) — auto-generato dal nome attività al primo publish (dedup con suffisso), **lista di slug riservati** (`admin`,`api`,`s`,…), editabile con controllo unicità | chiusa |
| `P4-D5` | Confine free/paid in v1 | Publish/unpublish **GRATIS (0 crediti)**; **badge "Made with Belora"** su ogni sito pubblicato v1; rimozione badge e gating one-pager/multi-page = **P5** | chiusa |
| `P4-D6` | Media in v1 e storage | **Media dentro v1**; **bucket a lettura pubblica, oggetti per uuid** (URL stabili/cacheable, forward-compatible con R2); **scrittura tenant-scoped via RLS**. Trade-off dichiarato: foto caricata-ma-non-pubblicata raggiungibile per uuid (contenuto proprio destinato a diventare pubblico) | chiusa |
| `P4-D7` | Upload sicuro (niente AI) | Upload **attraverso il server**: sniff content-type per **magic-bytes** → **re-encode** (`sharp`) in raster (JPEG/PNG/WebP), **strip EXIF/metadata**, **rifiuto SVG**, resize a max sensati → byte puliti su Storage + riga `assets`. `ImageSlot source:'uploaded'` (T-202) reso da `SiteImage` con **src costruito da noi** (`asset_id → URL`, mai da testo libero: preserva P2-D12). Ritocco/sfondi AI = P5 | chiusa |
| `P4-D8` | SEO base | Metadata per pagina (`title`, description), **Open Graph** + Twitter card, **canonical** a `/s/<slug>`, `<html lang>`; **JSON-LD `LocalBusiness`** dai dati brief resi, serializzato con escaping di `< > &` + `U+2028/2029` (anti-breakout script); **sitemap.xml** per-sito + **robots.txt** (indicizza `/s/*`; editor/preview `noindex`). hreflang minimo (mono-locale) | chiusa |
| `P4-D9` | Postura di sicurezza/testing | Le 3 superfici nuove ognuna con oracolo: **RLS pubblica** provata a runtime; **upload** provato sull'effetto (payload ostili → raster pulito o rifiuto); **serving pubblico** e2e ostile su `/s/<slug>` (effetto nullo + canary rosso, incl. asset caricato); **JSON-LD** escaping provato; checkpoint 4/4 + e2e per confine di macrotask, batteria di mutazione per task | chiusa |

## 5. Fonti di verità

- **Piano**: questo blueprint (`00-INDEX` + moduli `01-publish-core` … `06-e2e-public`).
- **Design a monte**: `docs/superpowers/specs/2026-08-06-p4-publish-media-design.md`.
- **Stato vivo**: `SESSION-STATE.md` (fonte di verità del sotto-progetto P4 — distinta da quelle di
  P0/P1/P2/P3, di `architecture-hardening` e della skill trueline).
- **Contratto `architecture:`**: `docs/blueprint/P3-editor/00-INDEX.md` §1bis (fonte unica);
  enforcement `tests/architecture-contract.test.ts` (repo-wide).
- **Substrato**: `docs/blueprint/P2-generation/` e `P3-editor/` — in particolare
  `site_generations.document`, la persistenza a revisioni (`site_document_revisions`, T-301), il
  read-path "ultima revisione else baseline" (T-304), `src/ui/site/SiteView.tsx` + `SiteImage`,
  `src/domain/generation/document.ts` (`parseDocument`), `ImageSlot source:'uploaded'` (T-202),
  `saveRevision` (T-302).

## 6. Self-check del blueprint

- **Strutturale**: `node <trueline>/scripts/blueprint/validate_blueprint.mjs docs/blueprint/P4-publish`
  — atteso exit 0 (`11` §5.1): campi obbligatori, copertura AC→test, DAG aciclico, id univoci,
  ownership del macrotask, contratto `architecture:` ben formato (check `(6)`).
- **Semantico**: `self-check-checklist.md` punti 6–10 su ogni task (`11` §5.2); rilievi →
  human-in-the-loop.

## 7. Fuori scope di P4 v1 (rimandato)

- **Pass hosting dedicato**: Cloudflare R2/Worker (pre-render statico, egress $0) + **sottodomini
  wildcard** `nome.belora.app` + **domini custom** (Cloudflare for SaaS) → pass successivo (P4-D1).
- **Ritocco / rimozione sfondo AI** sulle foto → **P5** (ledger crediti) (P4-D7).
- **Gating a pagamento** (one-pager free / multi-page paid, rimozione badge) → **P5** (billing) (P4-D5).
- **Blocco galleria** (P2-D24) → più avanti.
- **hreflang con alternate**: i siti v1 sono **mono-locale** → non serve finché non esistono siti
  multi-locale (P4-D8).
