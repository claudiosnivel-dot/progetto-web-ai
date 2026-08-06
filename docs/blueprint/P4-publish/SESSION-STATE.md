# SESSION-STATE — Belora · P4 (Pubblicazione, serving pubblico & media)

> Fonte di verità sullo **stato vivo** del sotto-progetto P4, consumata da BUILD e
> aggiornata a ogni chiusura di sessione (`prompts/session-end.md`). Istanza distinta
> dalle SESSION-STATE di P0/P1/P2/P3, di `architecture-hardening` e da quella della skill
> trueline. Prosa in italiano, identificatori/nomi-file in inglese.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Ultimo aggiornamento** | 2026-08-07 (**BUILD M4 `media-storage` COMPLETO E MERGIATO su `main` `2878a54`**, checkpoint VERDE 4/4 eseguito DECOMPOSTO) |
| **Sessione corrente** | — (`media-storage` CHIUSO; **prossima sessione: BUILD di `media-editor-render`** via `prompts/session-start.md`) |

---

## 1. Stato dei macrotask

> Aggiornato a ogni `session-end`. Stati: `todo` | `in_progress` | `done`.

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| `publish-core` | **done** | **VERDE 4/4 (`6b87183`)** | 4 task (T-401…T-404): `site_publications` + RLS anon-published + UNIQUE public_slug, `public_slug` puro, `publishSite`/`unpublishSite`. RLS004 sulla policy anon = FP baselinato |
| `public-serving` | **done** | **VERDE 4/4 (`c624d0e`)** | 4 task (T-405…T-408): rotta `/s/<slug>` standalone (lettura anon RLS + gate + SiteView), middleware esclude `/s/*`, RLS pubblica a RUNTIME + canary, badge. `vitest fileParallelism:false`; hygiene 120→123 |
| `seo-base` | **done** | **VERDE 4/4 (`47d6885`)** | 3 task (T-409…T-411): `generateMetadata`, JSON-LD `LocalBusiness` escaped, sitemap + robots + noindex, grant `published_at` ad anon. Helper condivisi: `getSiteBaseUrl`, `assetPublicUrl`+`SITE_ASSETS_BUCKET`, `extractBusinessInfo`, `buildLocalBusinessJsonLd`/`serializeJsonLdSafe` |
| `media-storage` | **done** | **VERDE 4/4 (`2878a54`, decomposto)** | 3 task (T-412…T-414): tabella `assets` + RLS owner-only + FK composita + `unique(storage_path)`; bucket `site-assets` public + policy `storage.objects` **confine-OWNER**; `uploadAsset` (magic-bytes + re-encode `sharp`); `assetPublicUrl` invariata. **Emendamento `P4-D6a`: chiave Storage PIATTA `<asset_id>`** (00-INDEX §4). `sharp`→`dependencies` |
| `media-editor-render` | todo | — | 2 task (T-415…T-416): `SiteImage` uploaded, affordance upload nell'editor |
| `e2e-public` | todo | — | 1 task (T-417): e2e ostile Chromium su `/s/<slug>` + canary rosso |

## 2. Macrotask corrente

- **Nessuno aperto**: `media-storage` (M4) è CHIUSO (checkpoint VERDE 4/4, mergiato ff su `main` `2878a54`).
- **Primo macrotask eseguibile ora: `media-editor-render`** (M5) — le dipendenze P4 sono verdi: T-415 `depends_on: [T-414]`✔;
  T-416 `depends_on: [T-413, T-415]` (T-413✔, T-415 nello stesso macrotask). Ordine del piano: M4✔ → **`media-editor-render`**;
  `e2e-public` (M6) alla fine (richiede rotta pubblica + SEO + media, §2 di `00-INDEX`).
- **AGGANCIO M4→M5 (riuso, evita duplicazione):** M5/T-415 rende `ImageSlot source:'uploaded'` in `SiteImage`
  costruendo il `src` da **`assetPublicUrl(image.asset_id)`** (`src/config/storage.ts`, invariata) — **mai da testo libero**
  (P2-D12); l'`asset_id` viene dal documento (unico handle, schema T-202). M5/T-416 (affordance editor) chiama la server
  action **`uploadAsset(siteId, file)`** (`src/data/media/uploadAsset.ts`, M4/T-413) → ritorna `asset_id` → sostituisce lo
  slot placeholder con `{ source:'uploaded', asset_id }` nel draft → `saveRevision` (ripassa `parseDocument`).

## 3. Stato git

> Registrato a ogni `session-end`. Mai lavorare su `main`.

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/media-storage` (commit atomico `2878a54`, cita T-412..T-414 + P4-D6a + esito gate decomposto + fix lint + batteria di mutazione; pushato origin). `main` = P3 + `architecture-hardening` + **P4 M1+M2+M3+M4** mergiati |
| Ultimo commit | `2878a54` build(media-storage): P4 M4 (su `main`, pushato origin) |
| Stato merge su `main` | **`media-storage` mergiato ff** (`11eabf6→2878a54`) + push origin, su **autorizzazione esplicita** dell'utente (deploy-coupling coupled, human-gated anche sul verde) |
| Deploy-coupling | **`coupled` — RICONFERMATO**. Il merge di ogni macrotask resta **human-gated anche sul verde**; deploy non supervisionato BLOCCATO |

## 4. Baseline & budget

- **Baseline di sicurezza**: `.trueline/checkpoint-baseline.json` (**formato ARRAY**, gitignored) — **INVARIATA a 2 finding**:
  `postcss@8.5.22` OSV **MEDIUM** + **RLS004 HIGH accepted-FP** sulla policy anon. In M4 il control 2 ha dato
  `gitleaks:0 osv:1 semgrep:0 rls:1` → **0 finding NUOVI** (le nuove RLS `assets`/storage a confine-owner referenziano
  `account_id`/`owner`+`auth.uid()`: nessun RLS004/RLS005; **nessuna nuova voce di baseline richiesta**).
- **Baseline d'igiene**: `.trueline/hygiene-baseline.json` (versionata) **INVARIATA a 123**: in M4 il controllo 1 è
  **verde senza re-attribuzione** (`dead-code:0 dup:124 cycle:0 twin:0`, 0 NUOVI — i file M4, incluse le fixture di test
  che riusano il pattern near-collision, non hanno introdotto cloni-fingerprint fuori baseline; nessun R-04).
- **Budget consumato**: **4 macrotask** (`publish-core` M1, `public-serving` M2, `seo-base` M3, `media-storage` M4) su 6.

## 5. Esiti dell'ultima sessione (framing onesto)

> Solo fatti: "checkpoint VERDE 4/4 sui target_test", mai "P4 è pronto/sicuro" (`L-COL-006`).

- **BUILD M4 `media-storage`** (T-412…T-414) costruito con **1 dynamic workflow** (builder + verifier BLIND per task,
  sequenziale). **Emendamento `P4-D6a`** (assenso esplicito dell'utente, registrato in `00-INDEX` §4): chiave Storage
  **PIATTA `<asset_id>`** + RLS scrittura a **confine-OWNER** (non a confine-cartella) + `assetPublicUrl` **invariata**
  in `src/config` — risolve il conflitto fra il design §4 (path cartella) e la realtà già shippata da M3 (schema documento
  P2-D12 asset-id-only + renderer/SEO anon che costruiscono l'URL dal solo `asset_id`; la tabella `assets` è owner-only,
  anon non risolve account/site/ext). Blast-radius **zero** su M1/M3 (nessuna riapertura). Mergiato ff su `main`
  (`2878a54`) + push, su via esplicito.
- **Nuovi artefatti**: migrazione `20260806000300_assets_and_storage.sql` (tabella `assets` RLS owner-only con
  `account_id` esplicito + FK composita `(account_id,site_id)→sites` + `unique(storage_path)`; bucket `site-assets`
  `public=true` con `file_size_limit`/`allowed_mime_types`; policy `storage.objects` owner-boundary); `src/domain/media/`
  (`limits.ts` cap byte/pixel puri; `sniff.ts` magic-bytes puro, SVG→null a monte di sharp); `src/data/media/uploadAsset.ts`
  (server action, client di sessione, ownership-first 404, re-encode `sharp` strip-EXIF/resize/anti-bomb → chiave piatta
  + riga `assets`); test `assets-rls`/`storage-rls`/`upload-asset.effect`/`asset-public-url`; `sharp`→`dependencies`.
- **Percorso del gate (onesto, imperfetto — 2 attriti d'ambiente, NON di codice):**
  1. **Il workflow di build è morto una volta** su `StructuredOutput retry cap (5)` del verifier T-412 (schema troppo
     rigido per l'output ricco del verifier). Fix: **rimosso lo `schema` dai verifier** (ritorno prosa) mantenendo il
     builder T-412 identico (cache) → **resume** (`resumeFromRunId`): b412 da cache, tutto il resto live. Completato 6/6,
     0 blocker/major dai verifier BLIND.
  2. **Il checkpoint MONOLITICO non gira in questo ambiente**: in **background** gli oracoli non spawnano i sottoprocessi
     (`exit 0xC0000142` STATUS_DLL_INIT_FAILED — window-station/desktop-heap del processo detached); in **foreground**
     supera il cap di 10 min (2× suite ~11 min + security ~8 min). **Eseguito DECOMPOSTO con gli oracoli REALI**:
     `control1Hygiene`/`control2Security` invocati via un driver (`scratchpad/c1c2-driver.mjs`) che ricalca **byte-per-byte**
     la wiring di `runCheckpoint` (baseline ARRAY + `loadHygieneBaseline` + `resolveManifest`=`classify`→`loadManifest`,
     manifest `supabase-jsts`); controlli 3+4 = **suite reale** (`npm test`) in **2 shard** (`--shard=1/2` + `2/2`) per
     stare sotto il cap. Fedele a ciò che il monolite calcolerebbe, ma **non** una singola invocazione di `run_checkpoint.mjs`.
  3. **Fix di gate colto dall'oracolo**: `createClient` importato ma inutilizzato in `storage-rls.test.ts` → `eslint .`
     rosso → scaffold meta-test `npm run lint` rosso (control 3/4). Rimosso l'import → verde.
- **Batteria di mutazione (le due difese sanno diventare rosse):** (a) upload — `new Uint8Array(clean)`→`input` (byte
  grezzi) → `upload-asset.effect` ROSSO (EXIF+payload sopravvivono) → ripristino **sha256** byte-identico → VERDE 6/6;
  (b) RLS — `alter policy assets_select_member ... using(true)` sul DB live → `assets-rls` ROSSO (A vede le 2 righe di B)
  → ripristino qual `is_account_member(account_id)` (verificato) → VERDE 3/3.
- **Esito controlli (decomposto):** C1 dead-code/hygiene VERDE · C2 security VERDE · C3+C4 full suite **1381/1381**
  (shard 774+607, 0 rate-limit). CHECKPOINT VERDE 4/4.
- **LEZIONE (per M5–M6):** in questo ambiente il **checkpoint monolitico è non-eseguibile** — girarlo **decomposto**
  (driver c1/c2 con gli oracoli reali + suite in 2 shard). I workflow (agenti gestiti) spawnano bene e girano lunghi;
  il **background bash detached NO** (`0xC0000142`). Nei prompt dei verifier **niente schema rigido** (o cap StructuredOutput).

## 6. Copertura dichiarata (cosa è verificato, cosa NO)

- **Verificato ora** (oracoli checkpoint **VERDE 4/4**, decomposto, su M4): la **RLS `assets` owner-only** a RUNTIME
  (membro scrive il proprio, cross-tenant SELECT/DELETE = ∅ con oracolo indipendente anti-placebo, anon = 42501); la
  **RLS `storage.objects` a confine-OWNER** a RUNTIME (A non modifica/cancella l'oggetto di B, provata sull'EFFETTO dei
  byte; anon GET URL pubblico = 200; near-collision); l'**upload provato sull'EFFETTO** (EXIF strippato sui byte di
  OUTPUT, SVG/sniff-fallito/oversize/bomba rifiutati, payload appeso sparito, sito altrui→404 nulla scritto); l'**URL da
  `asset_id`** (P2-D12 per firma, near-collision, deterministico). Suite intera verde (**1381/1381**). **Falsificabilità
  provata** su entrambe le difese (batteria di mutazione, §5).
- **NON ancora coperto** (attende i macrotask successivi): il **render** di `ImageSlot 'uploaded'` in `SiteImage`
  (`src` da `assetPublicUrl(asset_id)`) e l'**affordance upload nell'editor** (T-415/T-416, **M5**); l'**e2e ostile
  Chromium** su `/s/<slug>` incl. asset caricato + JSON-LD (T-417, **M6**). Note minori dichiarate: `uploadAsset` è un
  export senza chiamante finché M5 non lo cabla (knip non lo flagga come morto — dead-code:0); il gate del cap-pixel usa
  i metadati header + `limitInputPixels` (non un decode completo preventivo). Carry-over invariati: osv 2 MODERATE, CI
  mai girata da run reale, e2e solo Chromium, assenza CSP (difesa = sanificazione/escaping/re-encode).

## 7. Carry-over ereditati (rilevanti per P4)

**Aperti:**
- **CHECKPOINT MONOLITICO NON-ESEGUIBILE in questo ambiente (NUOVO, M4):** background bash detached → `0xC0000142`
  (gli oracoli non spawnano i sottoprocessi); foreground → cap 10 min < ~20 min del monolite. **Rimedio provato:
  decomposizione** — `control1Hygiene`/`control2Security` via `scratchpad/c1c2-driver.mjs` (wiring di `runCheckpoint`,
  manifest `supabase-jsts`, baseline ARRAY + hygiene) + suite in **2 shard** (`vitest --shard=1/2`,`2/2`). Riusare in M5/M6.
- **Workflow (NUOVO, M4):** i verifier con `schema` StructuredOutput rigido possono sfondare il retry cap (5) su output
  ricco → **verifier senza schema** (prosa). Il resume (`resumeFromRunId`) ricicla i builder invariati da cache.
- `osv`: 2 advisory **MODERATE** (`next`, `postcss`) — carry-over separato.
- **CI mai provata da una run reale** (`gh` non installato); `test:e2e` esiste ma non è cablato in `ci.yml`.
- e2e solo **Chromium**; non percorre login/onboarding (cookie iniettati, seed via `service_role` nei test).
- Assenza di **CSP** dichiarata: la difesa provata è la **sanificazione**/escaping (renderer unico + JSON-LD serializer +
  **re-encode upload M4**), non una CSP. Rilevante per la rotta pubblica `/s/<slug>`.
- **`sharp` promosso a `dependencies`** in M4 (P4-D7): `uploadAsset` lo importa a runtime.
- **auth rate_limit** locale (`config.toml`): `sign_in_sign_ups = 30 / 5 min per IP`. La suite serializzata ci sta (M4:
  full suite + 2 shard, **0 rate-limit**). `db reset` azzera il contatore. Se un giorno la suite supera 30 in 5 min,
  alzare il limite in `config.toml` (config locale) è la fix legittima.

**Chiusi (da onorare, non riaprire):**
- **Renderer UNICO** `SiteView` (P2-D8); **`parseDocument` come gate** in scrittura E in render; **JSON-LD serializer**
  come gate d'escaping in output.
- **Nessun `src`/`href`/URL da testo libero** (P2-D12): og:image/JSON-LD image/sitemap `<loc>` e **URL asset**
  (`assetPublicUrl`, M4) costruiti da `asset_id`/`public_slug`/base config, mai da testo del brief.
- **Anti-enumerazione** `notFound()`/404 (P1-D21): esteso a metadata, sitemap, e **`uploadAsset` ownership-first** (M4).
- **Contratto `architecture:` repo-wide**: rispettato in M4 (serving/route in `src/app`, logica pura media in
  `src/domain/media`, accesso dati + `sharp` + Storage in `src/data/media`, accessor bucket in `src/config`).
- **RLS su tabella/bucket nuovi provata A RUNTIME**: esteso ad `assets` (owner-only) e `storage.objects` (confine-owner) in M4.
- **`P4-D6a`** (00-INDEX §4): chiave Storage PIATTA `<asset_id>` + RLS scrittura confine-OWNER; `assetPublicUrl(asset_id)`
  invariata in `src/config`. **Non riaprire** (supera spec §4 e la formulazione originale di T-412/T-414).

## 8. Prossimi passi

1. **M4 `media-storage` CHIUSO**: checkpoint VERDE 4/4 (decomposto), mergiato su `main` (`2878a54`) + push. Il blueprint
   resta la fonte di verità approvata: si costruisce secondo i task (con l'emendamento P4-D6a registrato), non si ridiscute.
2. **Aprire BUILD sul macrotask `media-editor-render`** (T-415…T-416: `SiteImage` rende `ImageSlot source:'uploaded'`
   col `src` da **`assetPublicUrl(asset_id)`** — escaping preservato, nessun `src` da testo libero; affordance di upload
   nell'editor per slot immagine → chiama **`uploadAsset`** (M4) → `{ source:'uploaded', asset_id }` nel draft → salvato
   via `saveRevision` (ripassa `parseDocument`)) — via `prompts/session-start.md` → branch `trueline/build/media-editor-render`,
   **UN dynamic workflow per l'intero macrotask** (builder + verifier BLIND per task, verifier **senza schema**).
3. **Deploy-coupling = `coupled` RICONFERMATO** (§3): merge di ogni macrotask human-gated anche sul verde.
4. Disciplina invariata: **1 dynamic workflow per MACROTASK** → 1 fermata umana → fix; **checkpoint DECOMPOSTO**
   (driver c1/c2 con oracoli reali + suite in 2 shard; §5/§7) — il monolite non gira qui. Verdetto dal JSON `.green` dei
   controlli / dai conteggi delle shard. Batteria di mutazione (fatale + ripristino sha256/qual). Disciplina fixture
   (>1 elemento, valori discordanti, un id/slug prefisso — per gli uuid la trappola è una **near-collision**). **Nei prompt
   dei builder elencare i test prior-macrotask potenzialmente toccati** (§5) e **lintare i file nuovi** (`eslint .`, non solo `tsc`).
