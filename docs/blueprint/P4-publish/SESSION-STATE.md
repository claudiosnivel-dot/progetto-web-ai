# SESSION-STATE — Belora · P4 (Pubblicazione, serving pubblico & media)

> Fonte di verità sullo **stato vivo** del sotto-progetto P4, consumata da BUILD e
> aggiornata a ogni chiusura di sessione (`prompts/session-end.md`). Istanza distinta
> dalle SESSION-STATE di P0/P1/P2/P3, di `architecture-hardening` e da quella della skill
> trueline. Prosa in italiano, identificatori/nomi-file in inglese.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Ultimo aggiornamento** | 2026-08-07 (**BUILD M5 `media-editor-render` COMPLETO E MERGIATO su `main` `9b30c6f`**, checkpoint VERDE 4/4 eseguito DECOMPOSTO) |
| **Sessione corrente** | — (`media-editor-render` CHIUSO; **prossima sessione: BUILD di `e2e-public`** via `prompts/session-start.md`) |

---

## 1. Stato dei macrotask

> Aggiornato a ogni `session-end`. Stati: `todo` | `in_progress` | `done`.

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| `publish-core` | **done** | **VERDE 4/4 (`6b87183`)** | 4 task (T-401…T-404): `site_publications` + RLS anon-published + UNIQUE public_slug, `public_slug` puro, `publishSite`/`unpublishSite`. RLS004 sulla policy anon = FP baselinato |
| `public-serving` | **done** | **VERDE 4/4 (`c624d0e`)** | 4 task (T-405…T-408): rotta `/s/<slug>` standalone (lettura anon RLS + gate + SiteView), middleware esclude `/s/*`, RLS pubblica a RUNTIME + canary, badge. `vitest fileParallelism:false`; hygiene 120→123 |
| `seo-base` | **done** | **VERDE 4/4 (`47d6885`)** | 3 task (T-409…T-411): `generateMetadata`, JSON-LD `LocalBusiness` escaped, sitemap + robots + noindex, grant `published_at` ad anon. Helper condivisi: `getSiteBaseUrl`, `assetPublicUrl`+`SITE_ASSETS_BUCKET`, `extractBusinessInfo`, `buildLocalBusinessJsonLd`/`serializeJsonLdSafe` |
| `media-storage` | **done** | **VERDE 4/4 (`2878a54`, decomposto)** | 3 task (T-412…T-414): tabella `assets` + RLS owner-only + FK composita + `unique(storage_path)`; bucket `site-assets` public + policy `storage.objects` **confine-OWNER**; `uploadAsset` (magic-bytes + re-encode `sharp`); `assetPublicUrl` invariata. **Emendamento `P4-D6a`: chiave Storage PIATTA `<asset_id>`** (00-INDEX §4). `sharp`→`dependencies` |
| `media-editor-render` | **done** | **VERDE 4/4 (`9b30c6f`, decomposto)** | 2 task (T-415…T-416): `SiteImage` rende `ImageSlot 'uploaded'` come `<img src={assetPublicUrl(asset_id)}>` (theme-placeholder invariato); pura `setUploadedImage` in `block-ops` (blockId esatto + indice canonico, re-gate parseDocument, ritorna candidate a structural-sharing per AC-416-2, no-op→null) + reducer action + `ImageUploadPanel` (upload via server action `uploadAsset` → dispatch, non-ok=no-op, persistenza SOLO via save-point). **R-04 hygiene ri-baselinata 123→125**; 1 dead-code (ImageSlotRef un-exported) fixato |
| `e2e-public` | todo | — | 1 task (T-417): e2e ostile Chromium su `/s/<slug>` + asset caricato + canary rosso |

## 2. Macrotask corrente

- **Nessuno aperto**: `media-editor-render` (M5) è CHIUSO (checkpoint VERDE 4/4 decomposto, mergiato ff su `main` `9b30c6f`).
- **Primo (e unico) macrotask eseguibile ora: `e2e-public`** (M6) — le dipendenze P4 sono verdi:
  T-417 `depends_on: [T-405✔, T-409✔, T-410✔, T-416✔]`. È l'ultimo del piano (§2 di `00-INDEX`): richiede rotta pubblica + SEO + media.
- **AGGANCIO M5→M6:** T-417 estende `assertNoInjectionEffect` (T-241/T-317) alla superficie pubblica `/s/<slug>` con un documento pubblicato **ostile** E un **asset caricato** (il render `SiteImage 'uploaded'` di T-415 in produzione). Il **CANARY** viene prima del verde: un componente deliberatamente insicuro deve rendere ROSSO lo stesso oracolo, o l'e2e non prova nulla. Chromium-only (carry-over §7).

## 3. Stato git

> Registrato a ogni `session-end`. Mai lavorare su `main`.

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/media-editor-render` (commit atomico `9b30c6f`, cita T-415..T-416 + esito gate decomposto 4/4 + R-04 hygiene 123→125 + fix dead-code + batteria di mutazione; pushato origin). `main` = P3 + `architecture-hardening` + **P4 M1+M2+M3+M4+M5** mergiati |
| Ultimo commit | `9b30c6f` build(media-editor-render): P4 M5 (su `main`, pushato origin) |
| Stato merge su `main` | **`media-editor-render` mergiato ff** (`e148a33→9b30c6f`) + push origin, su **autorizzazione esplicita** dell'utente (deploy-coupling coupled, human-gated anche sul verde). Nessun deploy innescato dall'agente (solo merge; deploy non supervisionato BLOCCATO) |
| Deploy-coupling | **`coupled` — RICONFERMATO** in questa sessione. Il merge di ogni macrotask resta **human-gated anche sul verde**; deploy non supervisionato BLOCCATO |

## 4. Baseline & budget

- **Baseline di sicurezza**: `.trueline/checkpoint-baseline.json` (**formato ARRAY**, gitignored) — **INVARIATA a 2 finding**:
  `postcss@8.5.22` OSV **MEDIUM** + **RLS004 HIGH accepted-FP** sulla policy anon. In M5 il control 2 ha dato
  `gitleaks:0 osv:1 semgrep:0 rls:1` → **0 finding NUOVI** (M5 non aggiunge migrazioni/RLS/segreti; solo render UI +
  reducer puro + affordance client che chiama `uploadAsset`/`saveRevision` esistenti).
- **Baseline d'igiene**: `.trueline/hygiene-baseline.json` (versionata) **RI-BASELINATA 123→125 (R-04)**: l'aggiunta di
  `ImageUploadPanel.tsx` (e i 2 file di test, ignorati da jscpd) ha **ri-fingerprintato** cloni PRE-ESISTENTI su file
  **NON toccati da M5** (`uploadAsset.ts`↔`site-publications.ts`/`site-document-revisions.ts` = boilerplate `getAuthedClient`;
  `P4-publish/VISION-AND-CONSTRAINTS.md` = header-table dei blueprint) + il pattern **idiomatico** di `setUploadedImage`
  (stesso page-walk immutabile di `applySlotEdit`/`addBlock`, già baselinati). **Attribuzione fatta PRIMA della ricattura**
  (nessun clone genuinamente nuovo mascherato). Ricattura: `baseline.mjs capture … --hygiene --out .trueline/hygiene-baseline.json`.
  Il **dead-code** genuino (`ImageSlotRef` export orfano in `ImageUploadPanel`) è stato **fixato** (un-exported), non baselinato
  (knip non è coperto dalla baseline d'igiene).
- **Budget consumato**: **5 macrotask** (`publish-core` M1, `public-serving` M2, `seo-base` M3, `media-storage` M4,
  `media-editor-render` M5) su 6.

## 5. Esiti dell'ultima sessione (framing onesto)

> Solo fatti: "checkpoint VERDE 4/4 sui target_test", mai "P4 è pronto/sicuro" (`L-COL-006`).

- **BUILD M5 `media-editor-render`** (T-415…T-416) costruito con **1 dynamic workflow** (builder + verifier BLIND per task,
  sequenziale, verifier **senza schema** StructuredOutput). 4 agenti, 0 error, 0 blocker/major dai verifier; falsificabilità
  provata dai verifier (3 mutazioni T-415, 4 mutazioni T-416 → tutte rosse).
- **Nuovi artefatti**: `src/ui/site/SiteImage.tsx` (ramo `uploaded` → `<img src={assetPublicUrl(image.asset_id)}>` da
  `@/config/storage`, `ui→config` arch-legale; theme-placeholder invariato; escaping React); `src/domain/editor/block-ops.ts`
  (`setUploadedImage` puro: blockId ESATTO + imageIndex canonico, re-gate `parseDocument`, **ritorna il candidate a
  structural-sharing** — non `parsed.document` — per preservare `Object.is` degli slot non toccati, AC-416-2; no-op→null);
  `src/ui/editor/draft-state.ts` + `useEditorDraft.ts` (nuova azione `setUploadedImage`, disciplina no-op di addBlock);
  `src/ui/editor/ImageUploadPanel.tsx` (affordance 'carica foto' → `uploadAsset(siteId,file)` server action → dispatch on-ok,
  non-ok=no-op, **nessun 2° canale di scrittura**); wiring `EditorClient.tsx` + `page.tsx` + i18n `it/es`; test
  `site-image-uploaded.test.tsx` (4) + `editor-upload-image.test.tsx` (11).
- **Percorso del gate (onesto):**
  1. **Checkpoint DECOMPOSTO** (monolite non-eseguibile qui, carry-over M4 riconfermato): driver `scratchpad/c1c2-driver.mjs`
     importa `control1Hygiene`/`control2Security` REALI e ricalca la wiring di `runCheckpoint` (baseline ARRAY + union
     `loadHygieneBaseline`, manifest `supabase-jsts` via `classify→loadManifest`, `mode:'build'`, `blueprintDir:null`);
     controlli 3+4 = suite reale in **2 shard** (`vitest --shard=1/2`,`2/2`) dopo `rm -rf .next` + `db:reset`.
  2. **C1 hygiene**: prima RED (7 blocker: 1 dead-code `ImageSlotRef` + 6 duplication). Fix dead-code (un-export) +
     **attribuzione R-04** delle 6 duplication (tutte legittime: file non toccati + pattern idiomatico) → ricattura hygiene
     123→125 → **C1 VERDE** (`dead-code:0 dup:127 cycle:0 twin:0`, 0 blocker).
  3. **C2 security VERDE** (`gitleaks:0 osv:1 semgrep:0 rls:1`, 0 nuovi). **C3+C4** suite reale **1396/1396** (shard 778+618,
     0 rate-limit).
- **Batteria di mutazione (ORCHESTRATORE, ripristino verificato con sha256):** (a) `SiteImage` `src`→costante → 
  `site-image-uploaded` ROSSO (3 fail, theme-placeholder resta verde) → ripristino byte-identico; (b) `setUploadedImage`
  blockId ESATTO→prefisso → `editor-upload-image` ROSSO (caso `'orar'→null`) → ripristino byte-identico. Post-batteria 15/15
  verde, tree pristine. **0 mutazioni sopravvissute.**
- **Esito controlli (decomposto):** C1 hygiene VERDE · C2 security VERDE · C3+C4 full suite **1396/1396**. **CHECKPOINT VERDE 4/4.**
- **LEZIONE (per M6):** riusare la decomposizione (driver c1/c2 + suite 2 shard); verifier senza schema; **R-04 ricorrente**
  (ogni macrotask che aggiunge file ri-fingerprinta cloni pre-esistenti → attribuisci PRIMA di ricatturare); ripristino
  mutazioni SEMPRE via backup+sha256, **mai `git checkout`** (il change M5 era uncommitted → un `git checkout --` lo
  cancellerebbe, come il process-incident del verifier T-415, poi ricostruito fedelmente).

## 6. Copertura dichiarata (cosa è verificato, cosa NO)

- **Verificato ora** (oracoli checkpoint **VERDE 4/4**, decomposto, su M5): il **render** di `ImageSlot 'uploaded'` in
  `SiteImage` come `<img>` col `src` costruito da `assetPublicUrl(asset_id)` (mai da testo libero, P2-D12; near-collision
  uuid; theme-placeholder invariato; escaping React, no `dangerouslySetInnerHTML`); l'**affordance upload nell'editor**
  (upload SOLO via server action `uploadAsset`; su ok → `{source:'uploaded',asset_id}` nel draft via reducer puro dietro gate
  `parseDocument`; **esito non-ok = no-op** provato; persistenza SOLO via save-point esistente/`saveRevision`, nessun 2°
  canale; targeting per blockId ESATTO con fixture prefisso `orari`/`orari-estivi`; anteprima dal renderer UNICO). Suite
  intera verde (**1396/1396**). **Falsificabilità provata** su entrambe le difese (batteria di mutazione, §5).
- **NON ancora coperto** (attende M6): l'**e2e ostile Chromium** su `/s/<slug>` con documento pubblicato ostile **e asset
  caricato** + `assertNoInjectionEffect` + **canary ROSSO** (T-417). Note minori dichiarate: il render dell'`<img>` uploaded
  non è ancora esercitato E2E in un browser reale sulla rotta pubblica (solo unit jsdom finché M6 non lo caba); la
  riflessione dell'anteprima dei cambi strutturali nell'editor segue il modello P3 esistente (server-rendered `children`),
  non live-DOM per lo slot uploaded (asserito via `renderDraftPage`/renderer unico, non via mutazione DOM client). Carry-over
  invariati: osv 2 MODERATE, CI mai girata da run reale, e2e solo Chromium, assenza CSP (difesa = sanificazione/escaping/re-encode).

## 7. Carry-over ereditati (rilevanti per P4)

**Aperti:**
- **CHECKPOINT MONOLITICO NON-ESEGUIBILE in questo ambiente (M4, RICONFERMATO M5):** background bash detached → `0xC0000142`;
  foreground → cap 10 min < ~20 min del monolite. **Rimedio in uso**: decomposizione — `control1Hygiene`/`control2Security`
  via `scratchpad/c1c2-driver.mjs` (wiring di `runCheckpoint`, manifest `supabase-jsts`, baseline ARRAY + union hygiene) +
  suite in **2 shard** (`vitest --shard`). Riusare in M6 (ma T-417 aggiunge un e2e Playwright/Chromium: girarlo separatamente).
- **R-04 ricorrente (M5):** ogni macrotask che aggiunge file ri-fingerprinta cloni pre-esistenti (jscpd position-sensitive) →
  il control 1 li segna NUOVI. **Attribuire PRIMA di ricatturare**; ricattura con `baseline.mjs capture … --hygiene --out
  .trueline/hygiene-baseline.json` (il default scrive nel path SECURITY: usare `--out`). hygiene ora **125**.
- **Ripristino mutazioni via backup+sha256, MAI `git checkout`** (M5): il lavoro di macrotask è uncommitted finché non si
  committa → `git checkout -- <file>` lo riporta a `main`, cancellandolo (process-incident verifier T-415, poi ricostruito).
- **Workflow (M4):** i verifier con `schema` StructuredOutput rigido sfondano il retry cap → **verifier senza schema** (prosa).
- `osv`: 2 advisory **MODERATE** (`next`, `postcss`) — carry-over separato.
- **CI mai provata da una run reale** (`gh` non installato); `test:e2e` esiste ma non è cablato in `ci.yml`.
- e2e solo **Chromium**; non percorre login/onboarding (cookie iniettati, seed via `service_role` nei test).
- Assenza di **CSP** dichiarata: la difesa provata è la **sanificazione**/escaping (renderer unico + JSON-LD serializer +
  re-encode upload M4), non una CSP. Rilevante per la rotta pubblica `/s/<slug>` (T-417).
- **`sharp` in `dependencies`** (M4, P4-D7): `uploadAsset` lo importa a runtime.
- **auth rate_limit** locale (`config.toml`): `sign_in_sign_ups = 30 / 5 min per IP`. La suite serializzata
  (`fileParallelism:false`) in 2 shard ci sta (M5: **0 rate-limit** dopo `db reset`). `db reset` azzera il contatore.

**Chiusi (da onorare, non riaprire):**
- **Renderer UNICO** `SiteView`/`SiteImage` (P2-D8): esteso in M5 al ramo `uploaded` (un solo `<img>`, un solo URL builder
  `assetPublicUrl`, nessun renderer/URL parallelo, nessuna copia client dei blocchi).
- **`parseDocument` come gate** in scrittura E in render; il reducer editor lo ri-attraversa anche per lo slot uploaded
  (`setUploadedImage` re-gate; no-op→null; nessun 2° canale oltre `saveRevision`).
- **Nessun `src`/`href`/URL da testo libero** (P2-D12): l'`<img>` uploaded costruisce il `src` dal SOLO `asset_id`
  (`assetPublicUrl`), mai da testo del documento; il draft porta solo l'`asset_id` (uuid) restituito da `uploadAsset`.
- **Upload SEMPRE attraverso il server** (M4/T-413): l'affordance editor (M5/T-416) manda il file solo a `uploadAsset`
  (server action, re-encode/RLS), mai un upload diretto browser→bucket.
- **Anti-enumerazione** `notFound()`/404 e ownership sotto RLS (P1-D21): `uploadAsset`/`saveRevision` riverificano ownership;
  `siteId` non è un confine di sicurezza.
- **Contratto `architecture:` repo-wide**: rispettato in M5 (render/affordance in `src/ui`, reducer/op pure in
  `src/domain/editor`+`src/ui/editor` cablaggio, `uploadAsset` in `src/data`, `assetPublicUrl` in `src/config` layer-neutro).
- **`P4-D6a`** (00-INDEX §4): chiave Storage PIATTA `<asset_id>` + `assetPublicUrl(asset_id)` invariata; M5 la riusa in render.

## 8. Prossimi passi

1. **M5 `media-editor-render` CHIUSO**: checkpoint VERDE 4/4 (decomposto), mergiato ff su `main` (`9b30c6f`) + push. Il
   blueprint resta la fonte di verità approvata: si costruisce secondo i task, non si ridiscute.
2. **Aprire BUILD sul macrotask `e2e-public`** (T-417: e2e ostile Chromium su `/s/<slug>` con documento pubblicato **ostile**
   + **asset caricato** → `assertNoInjectionEffect` effetto nullo + payload come TESTO + **canary ROSSO** confinato; estende
   T-241/T-317 alla superficie pubblica) — via `prompts/session-start.md` → branch `trueline/build/e2e-public`, **UN dynamic
   workflow** (builder + verifier BLIND, verifier senza schema). È l'ULTIMO macrotask di P4.
3. **Deploy-coupling = `coupled` RICONFERMATO** (§3): merge human-gated anche sul verde.
4. Disciplina invariata: **1 dynamic workflow per MACROTASK** → 1 fermata umana → fix; **checkpoint DECOMPOSTO** (driver c1/c2
   + suite in 2 shard; l'e2e Playwright/Chromium di T-417 gira separatamente); verdetto dai JSON `.green`/dai conteggi shard;
   batteria di mutazione (fatale + ripristino **sha256**, mai `git checkout`); **CANARY prima del verde** sull'e2e; attribuzione
   **R-04** prima di ogni ricattura d'igiene; verifier senza schema; lintare i file nuovi (`eslint .`, non solo `tsc`).
