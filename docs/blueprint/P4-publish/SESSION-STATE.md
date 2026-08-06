# SESSION-STATE — Belora · P4 (Pubblicazione, serving pubblico & media)

> Fonte di verità sullo **stato vivo** del sotto-progetto P4, consumata da BUILD e
> aggiornata a ogni chiusura di sessione (`prompts/session-end.md`). Istanza distinta
> dalle SESSION-STATE di P0/P1/P2/P3, di `architecture-hardening` e da quella della skill
> trueline. Prosa in italiano, identificatori/nomi-file in inglese.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Ultimo aggiornamento** | 2026-08-06 (**BUILD M3 `seo-base` COMPLETO E MERGIATO su `main` `47d6885`**, checkpoint VERDE 4/4) |
| **Sessione corrente** | — (`seo-base` CHIUSO; **prossima sessione: BUILD di `media-storage`** via `prompts/session-start.md`) |

---

## 1. Stato dei macrotask

> Aggiornato a ogni `session-end`. Stati: `todo` | `in_progress` | `done`.

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| `publish-core` | **done** | **VERDE 4/4 (`6b87183`)** | 4 task (T-401…T-404): `site_publications` + RLS anon-published + UNIQUE public_slug, `public_slug` puro, `publishSite`/`unpublishSite`. RLS004 sulla policy anon = FP baselinato |
| `public-serving` | **done** | **VERDE 4/4 (`c624d0e`)** | 4 task (T-405…T-408): rotta `/s/<slug>` standalone (lettura anon RLS + gate + SiteView), middleware esclude `/s/*`, RLS pubblica a RUNTIME + canary, badge. `vitest fileParallelism:false`; hygiene 120→123 |
| `seo-base` | **done** | **VERDE 4/4 (`47d6885`)** | 3 task (T-409…T-411): `generateMetadata` (title/desc/OG/canonical/lang/og:image dallo snapshot), **JSON-LD `LocalBusiness` escaped** (< > & U+2028/9, anti-breakout), sitemap per-sito + robots + noindex editor/preview, migrazione `grant published_at` ad anon (provata a runtime). Nuovi helper condivisi: `getSiteBaseUrl`, `assetPublicUrl`+`SITE_ASSETS_BUCKET`, `extractBusinessInfo`, `buildLocalBusinessJsonLd`/`serializeJsonLdSafe` |
| `media-storage` | todo | — | 3 task (T-412…T-414): bucket+RLS+assets, `uploadAsset` re-encode, URL da asset_id |
| `media-editor-render` | todo | — | 2 task (T-415…T-416): `SiteImage` uploaded, affordance upload nell'editor |
| `e2e-public` | todo | — | 1 task (T-417): e2e ostile Chromium su `/s/<slug>` + canary rosso |

## 2. Macrotask corrente

- **Nessuno aperto**: `seo-base` (M3) è CHIUSO (checkpoint VERDE 4/4, mergiato ff su `main` `47d6885`).
- **Primo macrotask eseguibile ora: `media-storage`** (M4) — **nessuna dipendenza P4 aperta** (T-412 non ha
  `depends_on`). Ordine del piano: M1✔ → M2✔ → M3✔ → **`media-storage`** → `media-editor-render`;
  `e2e-public` alla fine (§2 di `00-INDEX`).
- **AGGANCIO M3→M4 (obbligatorio, evita duplicazione):** M3 ha già creato `src/config/storage.ts` con
  `SITE_ASSETS_BUCKET = 'site-assets'` e `assetPublicUrl(assetId)` (URL `<SUPABASE_URL>/storage/v1/object/
  public/site-assets/<id>`). **M4/T-412 DEVE creare il bucket Storage col nome ESATTO `site-assets`**;
  **M4/T-414 DEVE riusare `assetPublicUrl`** (mai duplicare il template dell'URL). L'og:image/JSON-LD image di
  M3 è già cablato su questo helper: in M3 esercitato solo da fixture (nessun asset reale finché M4 non esiste).

## 3. Stato git

> Registrato a ogni `session-end`. Mai lavorare su `main`.

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/seo-base` (commit atomico `47d6885`, cita T-409..T-411 + esito gate + 2 fix cross-macrotask; pushato origin). `main` = P3 + `architecture-hardening` + **P4 M1+M2+M3** mergiati |
| Ultimo commit | `47d6885` build(seo-base): P4 M3 (su `main`, pushato origin) |
| Stato merge su `main` | **`seo-base` mergiato ff** (`736a3ad→47d6885`) + push origin, su **autorizzazione esplicita** dell'utente (deploy-coupling coupled, human-gated anche sul verde) |
| Deploy-coupling | **`coupled` — RICONFERMATO**. Il merge di ogni macrotask resta **human-gated anche sul verde**; deploy non supervisionato BLOCCATO |

## 4. Baseline & budget

- **Baseline di sicurezza**: `.trueline/checkpoint-baseline.json` (**formato ARRAY**, gitignored) — 2 finding:
  `postcss@8.5.22` OSV **MEDIUM** + **RLS004 HIGH accepted-FP** sulla policy anon. Invariata in M3 (la nuova
  migrazione `grant published_at` NON ha aggiunto finding di sicurezza: `gitleaks:0 osv:1 semgrep:0 rls:1`).
- **Baseline d'igiene**: `.trueline/hygiene-baseline.json` (versionata) **INVARIATA a 123**: in M3 il controllo 1
  è **verde senza re-attribuzione** (`dup:124` ma 0 NUOVI — i file M3 non hanno introdotto cloni-fingerprint
  fuori baseline; nessun R-04 questa volta).
- **Budget consumato**: **3 macrotask** (`publish-core` M1, `public-serving` M2, `seo-base` M3) su 6.

## 5. Esiti dell'ultima sessione (framing onesto)

> Solo fatti: "checkpoint VERDE 4/4 sui target_test", mai "P4 è pronto/sicuro" (`L-COL-006`).

- **BUILD M3 `seo-base`** (T-409…T-411) costruito con **1 dynamic workflow** (6 agenti: builder + verifier
  BLIND per task, sequenziali, con **ownership esplicita dei moduli condivisi** — T-409 crea i config/domain
  helper, T-410/T-411 li riusano). Mergiato ff su `main` (`47d6885`) + push, su via esplicito.
- **Nuovi artefatti**: `src/config/env.ts +getSiteBaseUrl`; `src/config/storage.ts` (`SITE_ASSETS_BUCKET` +
  `assetPublicUrl`); `src/domain/generation/site-seo.ts` (`extractBusinessInfo` puro — nome/tagline/hero dai
  blocchi `data`, hero = primo ImageSlot `uploaded`); `src/domain/generation/jsonld.ts`
  (`buildLocalBusinessJsonLd` + `serializeJsonLdSafe` — escape `< > & U+2028/9 -> \uXXXX`, round-trip);
  `src/data/public-sitemap.ts` (`readPublishedSiteForSitemap` anon + `published_at`);
  `src/domain/generation/sitemap.ts` (`buildSitemapXml` puro, XML-escape); rotta `src/app/s/[slug]/sitemap.xml/
  route.ts`; `src/app/robots.ts`; `page.tsx +generateMetadata +<script ld+json>`; editor/preview `+noindex`;
  migrazione `20260806000200` (`grant select (published_at)` ad anon).
- **Percorso del gate (onesto, imperfetto):** il checkpoint è stato **interrotto (killed) 2 volte** prima di
  completare (una all'avvio, una durante `db:reset` — riavvio Docker; env `.env.local` ripristinato a mano,
  il `trap EXIT` non scatta su kill forzato). Al 3° tentativo è girato (~20 min: suite serializzata ~5.5 min +
  gitleaks/osv ~9 min + conformance ~5.5 min). Checkpoint #1 ROSSO su regressions/conformance = **2 regressioni
  di test CROSS-MACROTASK** (non rate-limit — 0 errori auth; non igiene/sicurezza): (1) `site-publications.
  schema.test.ts` (M1/T-401) fissava il GRANT column-level anon a **esattamente** `{document,locale,public_slug}`
  → la migrazione T-411 ha aggiunto `published_at` → asserzione aggiornata a 4 colonne (private ancora negate);
  (2) `public-site-route.test.ts` **AC-405-5** (M2/T-405) asseriva **zero `<script>`** → T-410 ha aggiunto il
  `<script type=application/ld+json>` → asserzione ora ammette il SOLO ld+json (non eseguibile) e prova che il
  tag non è richiudibile (contenuto escaped). **Diagnosi senza sprecare la finestra auth**: 45 test mock-based
  verdi → non regressione di codice; poi full-suite diagnostic (1361 test, isolò le 2 failing). Entrambi i fix
  verificati in isolamento → checkpoint #3 **VERDE 4/4**. Batteria di mutazione: escaper JSON-LD neutralizzato →
  `jsonld` ROSSA 4/10 → ripristino **sha256** → VERDE 10/10.
- **LEZIONE (per M4–M6):** quando un builder tocca un **file condiviso** (`page.tsx`) o l'**anon grant**, i test
  dei macrotask PRECEDENTI possono rompersi anche se il codice è corretto — i builder per-task girano solo i
  propri file, quindi il **checkpoint** è il primo posto dove emergono. Nei prompt dei builder di M4 elencare i
  test prior-macrotask potenzialmente toccati (es. chi modifica `page.tsx` ri-controlli `public-site-route` e
  `public-badge`).

## 6. Copertura dichiarata (cosa è verificato, cosa NO)

- **Verificato ora** (oracolo checkpoint **VERDE 4/4** su M3): i **metadata** derivati SOLO dallo snapshot
  pubblicato (anon, `cache()`), `canonical`/`og:url` assoluti byte-uguali, `og:locale`/`lang` dalla RIGA,
  `og:image` da `asset_id` solo per hero uploaded / assente per placeholder; l'**escaping del JSON-LD**
  (`< > & U+2028/9`, round-trip, anti-breakout `</script>`, **falsificabile** — mutazione provata); la **sitemap**
  anon+match-esatto+`notFound`+gate+XML-escape (una `<loc>` per sito); `robots` Allow `/s/` / Disallow+noindex
  editor/preview; il **grant `published_at` ad anon provato a RUNTIME** (anon legge `published_at` del pubblicato,
  colonne private ancora `42501`). Suite intera verde (1361 test).
- **NON ancora coperto** (attende i macrotask successivi): l'**e2e ostile Chromium** su `/s/<slug>` incl. il
  JSON-LD (T-417, **M6**); l'**effetto del re-encode** upload + il **bucket Storage reale** + URL asset da
  `asset_id` con asset veri (T-412/T-413/T-414, **M4** — in M3 l'og:image/image è cablato ma esercitato solo da
  fixture); il render di `ImageSlot 'uploaded'` (T-415, **M5**). Note minori dichiarate: il `Sitemap:` di
  `robots.txt` punta a `<base>/sitemap.xml` **placeholder** (indice globale fuori scope); `openingHours` del
  JSON-LD = stringhe etichetta localizzate (non day-code schema.org). Carry-over invariati: osv 2 MODERATE, CI
  mai girata da run reale, e2e solo Chromium.

## 7. Carry-over ereditati (rilevanti per P4)

**Aperti:**
- `osv`: 2 advisory **MODERATE** (`next`, `postcss`) — carry-over separato.
- **CI mai provata da una run reale** (`gh` non installato); `test:e2e` esiste ma non è cablato in `ci.yml`.
- e2e solo **Chromium**; non percorre login/onboarding (cookie iniettati, seed via `service_role` nei test).
- Assenza di **CSP** dichiarata: la difesa provata è la **sanificazione**/escaping (renderer unico + JSON-LD
  serializer + re-encode upload in M4), non una CSP. Rilevante per la rotta pubblica `/s/<slug>`.
- `sharp` da promuovere a dipendenza diretta se `uploadAsset` (M4/T-413) lo importa (P4-D7).
- **auth rate_limit** locale (`config.toml`): `sign_in_sign_ups = 30 / 5 min per IP`. La suite serializzata
  (`fileParallelism:false`) ci sta (NON è stata la causa del rosso M3), ma M4–M6 aggiungono test DB-runtime:
  se un giorno la suite supera 30 sign-in in una finestra da 5 min, alzare il limite in `config.toml` (config
  locale, non di produzione) è la fix legittima.
- **Checkpoint lungo (~20 min) e a volte interrotto**: girarlo in background e ritentare; ripristinare
  `.env.local` a mano se il processo è killato (il `trap EXIT` non scatta su kill forzato).

**Chiusi (da onorare, non riaprire):**
- **Renderer UNICO** `SiteView` (P2-D8); **`parseDocument` come gate** in scrittura E in render (T-403/T-405);
  **JSON-LD serializer** come gate d'escaping in output (T-410).
- **Nessun `src`/`href`/URL da testo libero** (P2-D12): og:image/JSON-LD image/sitemap `<loc>` costruiti da
  `asset_id`/`public_slug`/base config, mai da testo del brief.
- **Anti-enumerazione** `notFound()` (P1-D21): esteso a metadata (T-409) e sitemap (T-411).
- **Contratto `architecture:` repo-wide**: rispettato in M3 (serving/route/sitemap/robots in `src/app`, lettura
  anon in `src/data`, logica pura in `src/domain`, accessor env in `src/config`).
- **RLS su tabella nuova provata A RUNTIME**: esteso al grant `published_at` (T-411).

## 8. Prossimi passi

1. **M3 `seo-base` CHIUSO**: checkpoint VERDE 4/4, mergiato su `main` (`47d6885`) + push. Il blueprint resta la
   fonte di verità approvata: si costruisce secondo i task, non si ridiscute il design.
2. **Aprire BUILD sul macrotask `media-storage`** (T-412…T-414: **bucket Storage a lettura pubblica** + RLS
   scrittura per-tenant + tabella `assets` + RLS; `uploadAsset` = sniff magic-bytes + **re-encode `sharp`**
   (strip EXIF, rifiuto SVG, resize, anti decompression-bomb) → byte puliti su Storage + riga `assets`; **URL
   pubblico da `asset_id`**) — via `prompts/session-start.md` → branch `trueline/build/media-storage`, **UN
   dynamic workflow per l'intero macrotask** (builder + verifier BLIND per task). **Riusa** `SITE_ASSETS_BUCKET`
   + `assetPublicUrl` di M3 (§2): il bucket va creato con quel nome, l'URL builder non va duplicato. **L'upload
   è provato sull'EFFETTO** (payload ostili → raster pulito o rifiuto), è la 2ª superficie di byte non fidati.
3. **Deploy-coupling = `coupled` RICONFERMATO** (§3): merge di ogni macrotask human-gated anche sul verde.
4. Disciplina invariata: **1 dynamic workflow per MACROTASK** → 1 fermata umana → fix; checkpoint
   `run_checkpoint.mjs --in-place --mode build --baseline <file ARRAY>` **SENZA `--blueprint`**, verdetto dal
   JSON `.green`, su **stato pulito** (`rm -rf .next` + `db:reset`; env via shell, `.env.local` FUORI dal repo —
   `setup.env.ts` riempie solo le var `undefined`). `vitest fileParallelism:false` attivo. Batteria di mutazione
   (fatale + ripristino sha256). Disciplina fixture (>1 elemento, valori discordanti, un id/slug prefisso di un
   altro — per gli uuid `asset_id` la trappola-prefisso è una near-collision, un prefisso proprio non passa
   `z.string().uuid()`). **Nei prompt dei builder elencare i test prior-macrotask potenzialmente toccati** (§5).
