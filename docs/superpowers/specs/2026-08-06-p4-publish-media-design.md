# P4 — Pubblicazione, serving pubblico & media (v1) — design

> Design del quarto sotto-progetto di **Belora** (AI website builder, Next.js 16 + Supabase).
> Poggia su P0 (fondamenta), P1 (onboarding), P2 (generazione) e P3 (editor), tutti completi
> e verdi su `main`. Scope e decisioni chiuse in brainstorming con l'utente il 2026-08-06.
> Prosa in italiano, identificatori/nomi-file in inglese. Questo è il **design**: il piano
> atomico (blueprint) lo genera il bootstrap trueline a valle.

## 1 · Cos'è P4

L'anello tra la **modifica** (P3) e il **mondo**: l'utente prende il proprio sito editato e lo
rende **live e condivisibile** a un URL pubblico, con SEO di base e **foto reali** al posto dei
placeholder del tema. È il primo momento in cui un artefatto di Belora esce dall'area
autenticata e diventa pubblico — quindi la superficie a più alto rischio finora.

**Ingresso:** il documento corrente di un sito (ultima revisione else baseline, P3-D9 / T-304),
reso dal renderer unico `SiteView`. **Uscita:** un sito pubblicato servito a `/s/<slug>`,
indicizzabile, con immagini caricate dall'utente.

## 2 · Scope

**In v1 (questo design):**
- **Publish flow + pointer "published"** (snapshot congelato, publish/unpublish, gratis).
- **Serving pubblico** dei siti pubblicati **dalla stessa app Next.js**, path-based `/s/<slug>`,
  col `SiteView` esistente.
- **SEO base**: metadata per pagina, Open Graph, canonical, JSON-LD `LocalBusiness`, sitemap, robots.
- **Pipeline media**: upload foto reali con **re-encode sicuro** (niente AI), rendering
  `ImageSlot source:'uploaded'`, affordance di upload nell'editor.

**Rimandato (pass successivi):**
- **Pass hosting dedicato**: Cloudflare R2/Worker (pre-render statico, egress $0) + **sottodomini
  wildcard** `nome.belora.app` + **domini custom** (Cloudflare for SaaS). Raggruppati lì perché
  toccano tutta la superficie di hosting pubblico e renderebbero throwaway un routing per-Host
  costruito ora nell'app.
- **Ritocco / rimozione sfondo AI** sulle foto → **P5** (crediti).
- **Gating a pagamento** (one-pager free / multi-page paid, rimozione badge) → **P5** (billing).
- **Blocco galleria** (P2-D24) → più avanti.
- **hreflang con alternate**: i siti v1 sono mono-locale → non serve finché non esistono siti
  multi-locale.

## 3 · Decision ledger (P4-D1…P4-D9)

| ID | Decisione | Scelta | Stato |
|---|---|---|---|
| `P4-D1` | Dove servire i siti pubblicati in v1 | **Dall'app Next.js**, path-based; Cloudflare R2/Worker + sottodomini + domini custom **rimandati** a un pass hosting dedicato | chiusa |
| `P4-D2` | Modello del "published" | **Snapshot separato dalle revisioni** in `site_publications` (per-sito): pubblicare congela il documento corrente (gate `parseDocument`) in un record dedicato → disaccoppia il sito live dall'editing e dalla **potatura FIFO** di P3 (T-303), che altrimenti potrebbe cancellare la revisione pubblicata. Layer pubblicato sopra baseline→revisioni (estende P3-D9) | chiusa |
| `P4-D3` | Rotta pubblica | **Top-level `/s/<slug>`**, fuori dal routing localizzato; render **standalone** (nessuna chrome Belora) nella **locale del sito**; lettura **anon via RLS** (`is_published=true`, solo colonne pubbliche); gate `parseDocument` + escaping `SiteView`; slug ignoto/non pubblicato → `notFound()` | chiusa |
| `P4-D4` | Identità pubblica | **`public_slug` GLOBALE unico** (nuovo campo; `sites.slug` è unico solo per-account) — auto-generato dal nome attività al primo publish (dedup con suffisso), **lista di slug riservati** (`admin`,`api`,`s`,…), editabile con controllo unicità | chiusa |
| `P4-D5` | Confine free/paid in v1 | Publish/unpublish **GRATIS (0 crediti)**; **badge "Made with Belora"** su ogni sito pubblicato v1 (pre-billing tutti free-tier); rimozione badge e gating one-pager/multi-page = **P5** | chiusa |
| `P4-D6` | Media in v1 e storage | **Media dentro v1**; **bucket a lettura pubblica, oggetti per uuid** (URL stabili/cacheable, miglior SEO/GEO, forward-compatible con R2); **scrittura tenant-scoped via RLS**. Trade-off dichiarato: foto caricata-ma-non-pubblicata raggiungibile per uuid (contenuto proprio destinato comunque a diventare pubblico) | chiusa |
| `P4-D7` | Upload sicuro (niente AI) | Upload **attraverso il server**: sniff content-type per **magic-bytes** → **re-encode** con una libreria immagini (`sharp`, già nell'albero via Next — da promuovere a dipendenza diretta se serve) in raster (JPEG/PNG/WebP), **strip EXIF/metadata**, **rifiuto SVG**, ridimensiona a max sensati → scrive byte puliti su Storage + riga `assets`. `ImageSlot source:'uploaded'` (già tipizzato T-202) reso da `SiteImage` con **src costruito da noi** (`asset_id → URL`, mai da testo libero: preserva P2-D12). Ritocco/sfondi AI = P5 | chiusa |
| `P4-D8` | SEO base | Metadata per pagina (`title`, description), **Open Graph** + Twitter card, **canonical** a `/s/<slug>`, `<html lang>`; **JSON-LD `LocalBusiness`** dai dati brief resi, serializzato con escaping di `< > & U+2028/2029` (anti-breakout script); **sitemap.xml** per-sito + **robots.txt** (indicizza `/s/*`; editor/preview noindex). hreflang minimo (mono-locale) | chiusa |
| `P4-D9` | Postura di sicurezza/testing | Le 3 superfici nuove ognuna con oracolo: **RLS pubblica** provata a runtime (anon legge solo pubblicati, mai altrui/non pubblicati); **upload** provato sull'effetto (payload ostili → raster pulito o rifiuto); **serving pubblico** e2e ostile su `/s/<slug>` (effetto nullo + canary rosso, incl. asset caricato); **JSON-LD** escaping provato; checkpoint 4/4 + e2e per confine di macrotask, batteria di mutazione per task | chiusa |

## 4 · Modello dati

Due nuove entità (più il riuso di quelle di P0–P3). RLS per-tenant su scrittura; policy anon
mirata sulla lettura pubblicata.

- **`site_publications`** (per-sito, il layer pubblicato):
  - `id` (uuid), `account_id` (derivato, RLS), `site_id`, `source_generation_id` (da quale
    generazione viene lo snapshot), `document` (jsonb, **copia validata** da `parseDocument`),
    `public_slug` (**UNIQUE globale**), `locale`, `is_published` (bool), `published_at`, timestamps.
  - **RLS**: membri dell'account = CRUD sulle proprie righe; **`anon` = SELECT solo su
    `is_published = true`**, e la rotta seleziona solo `document, public_slug, locale`.
  - `public_slug` con `UNIQUE` + **lista riservati** applicata in scrittura.
- **`assets`** (media caricati):
  - `id` (uuid), `account_id`, `site_id`, `storage_path`, `mime`, `width`, `height`, `created_at`.
  - **RLS**: solo il proprietario inserisce/legge/cancella le proprie righe.
  - Storage: **bucket a lettura pubblica**, oggetti `<account_id>/<site_id>/<asset_id>.<ext>`;
    **RLS di scrittura** su `storage.objects` vincolata al path del proprio account.
    > **SUPERATO da `P4-D6a`** (2026-08-06, ledger in `docs/blueprint/P4-publish/00-INDEX.md` §4): in build si è
    > adottata la **chiave piatta `<asset_id>`** con **RLS a confine-OWNER** (`owner = auth.uid()`), perché lo schema
    > documento congelato (P2-D12) porta solo `asset_id` e il renderer/SEO anon costruisce l'URL da quello — coerente con
    > `assetPublicUrl` già VERDE in M3. Il folder-path qui descritto resta la motivazione storica, non il layout costruito.

## 5 · Flussi & azioni

- **`publishSite(siteId)`** (server action, gratis): apre la generazione corrente sotto RLS →
  legge il documento corrente (ultima revisione else baseline) → **gate `parseDocument`** →
  upsert `site_publications` con la **copia validata**, `is_published=true`, assegna/conferma
  `public_slug` (auto-generato + dedup + riservati) → ritorna slug/URL. Client di sessione, mai
  `service_role`; sito altrui → 404.
- **`unpublishSite(siteId)`**: `is_published=false` (lo snapshot resta per ri-pubblicare).
- **`uploadAsset(siteId, file)`** (server action): magic-bytes → `sharp` re-encode/strip/resize →
  Storage → riga `assets` → ritorna `asset_id`. Rifiuta SVG / sniff fallito / oversize.
- **Editor (superficie P3)**: affordance "carica foto" per slot immagine → sostituisce
  l'`ImageSlot` placeholder con `{ source:'uploaded', asset_id }` nel draft → salvato via
  `saveRevision` (lo schema T-202 lo accetta già).
- **Rotta pubblica `GET /s/<slug>`**: legge lo snapshot pubblicato (anon RLS) → `parseDocument` →
  `SiteView` standalone nella locale del sito → metadata/SEO (§6) → badge.

## 6 · SEO base (dettaglio)

- **`generateMetadata`** per la rotta pubblica: `title`, `description`, Open Graph
  (`og:title/description/type=website/url/locale`, **`og:image`** = URL Storage stabile della hero
  se caricata), Twitter card, **`<link rel="canonical">`** a `/s/<slug>`.
- **JSON-LD `LocalBusiness`**: costruito dai dati brief resi (nome, indirizzo, geo, telefono,
  orari, `image`) e iniettato come `<script type="application/ld+json">` con **serializzazione
  sicura** (JSON + escaping di `<`, `>`, `&`, `U+2028`, `U+2029`). È un punto di sicurezza, non
  decorativo: i campi sono non fidati.
- **`sitemap.xml`** per-sito (le pagine pubblicate) + **`robots.txt`** che consente `/s/*` e tiene
  `noindex` su editor/preview.

## 7 · Sicurezza — disciplina (P4-D9)

Estende P2/P3 alle superfici nuove. Ogni asserzione è provata da un oracolo, mai dall'LLM:

1. **RLS pubblica riconquistata (non ereditata)**, provata a **runtime**: anon legge un sito
   pubblicato ma **non** righe non pubblicate né di altri tenant; `account_id`/`source_generation_id`
   mai esposti.
2. **Upload non fidato → re-encode è la difesa**: payload ostili (polyglot, SVG con script,
   magic-bytes falsi, EXIF con payload, oversize) → oggetto salvato **pulito** o **rifiutato**.
3. **Serving pubblico**: gate `parseDocument` + escaping `SiteView`; **e2e ostile** su `/s/<slug>`
   (contatore 0, nessun host esterno, nessuna navigazione, payload come TESTO) + **canary ROSSO**;
   include un **asset caricato** nel documento ostile (prova che `asset_id → URL nostro` è sicuro).
4. **JSON-LD** escaping contro il breakout dal tag script — provato con brief ostile.
5. **Autorizzazione**: publish/unpublish/upload sotto RLS (client di sessione, mai `service_role`),
   ownership; sito altrui → 404 (anti-enumerazione P1-D21). `public_slug` unico + riservati.
6. **Altitudine (gate repo-wide T-312)**: serving pubblico in `src/app`; logica pura publish/media
   (slug, validazione forma) in `src/domain`; accesso dati + `sharp` (I/O) in `src/data`; nessun
   arco vietato.

## 8 · Testing & oracoli

- **Unit/dominio**: generazione+dedup+riservati di `public_slug`; forma dello snapshot; costruzione
  sicura del JSON-LD (escaping); costruzione dell'URL asset da `asset_id`.
- **RLS runtime**: anon SELECT su `site_publications` (pubblicato sì / non pubblicato/altrui no);
  scrittura `assets`/storage vincolata al proprio account.
- **Upload effect**: re-encode neutralizza/rifiuta i payload ostili (raster pulito, metadata
  strippati, SVG rifiutato).
- **e2e Chromium** sulla rotta pubblica `/s/<slug>`: documento pubblicato ostile (con asset caricato)
  → nessun effetto d'iniezione + payload come testo + **canary** che rende ROSSO lo stesso oracolo
  (estende T-241/T-317 alla superficie pubblica). È la prova di punta.
- **Checkpoint `run_checkpoint.mjs` 4/4** al confine di ogni macrotask (dead-code · security incl.
  nuova RLS · regressions · conformance), **batteria di mutazione** per task (fatale→rosso→ripristino
  per sha256). Nota operativa (da editor-blocks): il checkpoint monolitico va eseguito su stato
  pulito (`rm -rf .next` + `db:reset`) o gitleaks scansiona `.next` stantio / l'auth esaurita fa
  scadere la finestra.

## 9 · Fasatura di build — macrotask (input per il bootstrap trueline)

DAG interno a P4. P0–P3 sono substrato referenziato in prosa, non nel DAG.

- **M1 `publish-core`**: migrazione `site_publications` (+ RLS anon-published + UNIQUE public_slug),
  `publishSite`/`unpublishSite` (gate + snapshot + slug), generazione/dedup/riservati di `public_slug`.
- **M2 `public-serving`**: rotta `/s/<slug>` standalone (middleware esclude `/s/*` dal locale),
  lettura anon, `parseDocument` + `SiteView`, badge "Made with Belora", `notFound` anti-enumerazione.
- **M3 `seo-base`**: `generateMetadata` (OG/canonical), JSON-LD `LocalBusiness` (escaping sicuro),
  `sitemap.xml` + `robots.txt`.
- **M4 `media-storage`**: bucket + RLS storage, tabella `assets` + RLS, `uploadAsset` (magic-bytes +
  `sharp` re-encode/strip/reject-SVG/resize), URL pubblico da `asset_id`.
- **M5 `media-editor-render`**: `SiteImage` rende `source:'uploaded'`; affordance di upload nell'editor
  per slot; il draft porta l'`ImageSlot` uploaded; salvato via `saveRevision`.
- **M6 `e2e-public`**: e2e ostile Chromium su `/s/<slug>` (documento pubblicato ostile + asset caricato)
  con `assertNoInjectionEffect` + canary rosso; estende T-241/T-317 alla superficie pubblica.

**Ordine:** M1 → M2 → M3; M4 → M5 (indipendenti da M1–M3 salvo il render); M6 alla fine (richiede la
rotta pubblica e i media). Ogni macrotask si chiude col checkpoint; merge su `main` **human-gated**
(deploy-coupling **coupled**, confermato in P3).

## 10 · Invarianti non negoziabili

- **Renderer UNICO**: il sito pubblicato passa sempre dal `SiteView` reale; nessuna ri-implementazione.
- **Gate in scrittura e in render**: ogni documento pubblicato/reso ripassa `parseDocument`.
- **Snapshot pubblicato congelato**, disaccoppiato dalla potatura FIFO delle revisioni.
- **Testo non fidato solo come children React**; **nessun src/href da testo libero** (gli URL asset
  li costruiamo noi da uuid); **JSON-LD escaped**.
- **RLS riconquistata** sulle nuove tabelle e sul bucket; **anon legge solo il pubblicato**.
- **Upload sempre re-encodato** (raster pulito) o rifiutato; **mai** salvato grezzo.
- **Nessun falso "via libera"**; copertura sempre dichiarata; prima di credere a un verde, provare
  che lo strumento sa diventare rosso (canary sulla superficie pubblica).
