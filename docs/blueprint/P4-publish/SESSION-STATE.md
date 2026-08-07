# SESSION-STATE — Belora · P4 (Pubblicazione, serving pubblico & media)

> Fonte di verità sullo **stato vivo** del sotto-progetto P4, consumata da BUILD e
> aggiornata a ogni chiusura di sessione (`prompts/session-end.md`). Istanza distinta
> dalle SESSION-STATE di P0/P1/P2/P3, di `architecture-hardening` e da quella della skill
> trueline. Prosa in italiano, identificatori/nomi-file in inglese.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Ultimo aggiornamento** | 2026-08-07 (**BUILD M6 `e2e-public` COMPLETO E MERGIATO su `main` `de1289b`**, checkpoint VERDE 4/4 decomposto + e2e Chromium 9/9. **P4 COMPLETO 6/6**) |
| **Sessione corrente** | — (**P4 CHIUSO**: `e2e-public` era l'ULTIMO macrotask; tutti e 6 verdi e mergiati su `main`. Nessun macrotask P4 residuo) |

---

## 1. Stato dei macrotask

> Aggiornato a ogni `session-end`. Stati: `todo` | `in_progress` | `done`.

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| `publish-core` | **done** | **VERDE 4/4 (`6b87183`)** | 4 task (T-401…T-404): `site_publications` + RLS anon-published + UNIQUE public_slug, `public_slug` puro, `publishSite`/`unpublishSite`. RLS004 sulla policy anon = FP baselinato |
| `public-serving` | **done** | **VERDE 4/4 (`c624d0e`)** | 4 task (T-405…T-408): rotta `/s/<slug>` standalone (lettura anon RLS + gate + SiteView), middleware esclude `/s/*`, RLS pubblica a RUNTIME + canary, badge. `vitest fileParallelism:false`; hygiene 120→123 |
| `seo-base` | **done** | **VERDE 4/4 (`47d6885`)** | 3 task (T-409…T-411): `generateMetadata`, JSON-LD `LocalBusiness` escaped, sitemap + robots + noindex, grant `published_at` ad anon. Helper condivisi: `getSiteBaseUrl`, `assetPublicUrl`+`SITE_ASSETS_BUCKET`, `extractBusinessInfo`, `buildLocalBusinessJsonLd`/`serializeJsonLdSafe` |
| `media-storage` | **done** | **VERDE 4/4 (`2878a54`, decomposto)** | 3 task (T-412…T-414): tabella `assets` + RLS owner-only + FK composita + `unique(storage_path)`; bucket `site-assets` public + policy `storage.objects` **confine-OWNER**; `uploadAsset` (magic-bytes + re-encode `sharp`); `assetPublicUrl` invariata. **Emendamento `P4-D6a`: chiave Storage PIATTA `<asset_id>`** (00-INDEX §4). `sharp`→`dependencies` |
| `media-editor-render` | **done** | **VERDE 4/4 (`9b30c6f`, decomposto)** | 2 task (T-415…T-416): `SiteImage` rende `ImageSlot 'uploaded'` come `<img src={assetPublicUrl(asset_id)}>`; pura `setUploadedImage` in `block-ops` + reducer action + `ImageUploadPanel` (upload via server action `uploadAsset`). R-04 hygiene 123→125 |
| `e2e-public` | **done** | **VERDE 4/4 (`de1289b`, decomposto) + e2e Chromium 9/9** | 1 task (T-417): e2e ostile Chromium **ANON** su `/s/<slug>` (documento pubblicato ostile + **asset uploaded** + **JSON-LD breakout**) → `assertNoInjectionEffect` effetto nullo + payload come TESTO + **CANARY ROSSO** (stessa allowlist). Estende T-241/T-317 alla superficie pubblica. Igiene INVARIATA 125 (jscpd esclude `e2e/`; R-04 NON scattato) |

## 2. Macrotask corrente

- **Nessuno**: **P4 è COMPLETO (6/6)**. `e2e-public` (M6) era l'ULTIMO nodo del DAG e chiude il sotto-progetto.
- Tutti e 6 i macrotask sono VERDI (checkpoint 4/4) e mergiati ff su `main`. La prova di punta (T-417,
  e2e ostile Chromium sulla rotta pubblica anon con asset caricato + JSON-LD, canary rosso) è passata.
- **Prossimo lavoro (fuori da questa SESSION-STATE):** il sotto-progetto successivo del progetto Belora
  (P5, secondo la mappa dei 10) avrà il proprio blueprint e la propria SESSION-STATE. P4 non ha residui.

## 3. Stato git

> Registrato a ogni `session-end`. Mai lavorare su `main`.

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/e2e-public` (commit atomico `de1289b`, cita T-417 + esito gate decomposto 4/4 + e2e 9/9 + batteria di mutazione; pushato origin). `main` = P3 + `architecture-hardening` + **P4 M1..M6** mergiati |
| Ultimo commit | `de1289b` build(e2e-public): P4 M6 (su `main`, pushato origin) |
| Stato merge su `main` | **`e2e-public` mergiato ff** (`b076494→de1289b`) + push origin, su **autorizzazione esplicita** dell'utente (deploy-coupling coupled, human-gated anche sul verde). Nessun deploy innescato dall'agente (solo merge; deploy non supervisionato BLOCCATO). **P4 completo su `main`** |
| Deploy-coupling | **`coupled` — RICONFERMATO** in questa sessione. Il merge di ogni macrotask resta **human-gated anche sul verde**; deploy non supervisionato BLOCCATO |

## 4. Baseline & budget

- **Baseline di sicurezza**: `.trueline/checkpoint-baseline.json` (**formato ARRAY**, gitignored) — **INVARIATA a 2 finding**:
  `postcss@8.5.22` OSV **MEDIUM** + **RLS004 HIGH accepted-FP** sulla policy anon. In M6 il control 2 ha dato
  `gitleaks:0 osv:1 semgrep:0 rls:1` → **0 finding NUOVI** (M6 non aggiunge migrazioni/RLS/segreti; solo file di
  test e2e + estensioni fixture/seed additive). La costante base64 `MINIMAL_PNG_BASE64` del seed **non** ha
  fatto scattare gitleaks (nome non-secret-shaped, entropia bassa).
- **Baseline d'igiene**: `.trueline/hygiene-baseline.json` (versionata) **INVARIATA a 125**: il control 1 ha dato
  `dead-code:0 dup:127 cycle:0 twin:0` con **0 blocker** e **nessun re-baseline**. **R-04 NON è scattato in M6**:
  i file aggiunti/estesi sono tutti sotto `e2e/` (`public-hostile.spec.ts`, `hostile-brief.ts`, `seed.ts`), che
  **jscpd esclude** dalla duplication — quindi nessun clone pre-esistente è stato ri-fingerprintato. (Diverso da
  M2/M5, dove i file nuovi erano in `src/` e imponevano l'attribuzione + ricattura.)
- **Budget consumato**: **6 macrotask su 6** (`publish-core` M1, `public-serving` M2, `seo-base` M3,
  `media-storage` M4, `media-editor-render` M5, `e2e-public` M6). **P4 esaurito.**

## 5. Esiti dell'ultima sessione (framing onesto)

> Solo fatti: "checkpoint VERDE 4/4 + e2e 9/9 sui target_test", mai "P4 è pronto/sicuro" (`L-COL-006`).

- **BUILD M6 `e2e-public`** (T-417) costruito con **1 dynamic workflow** (builder + verifier BLIND, verifier
  **senza schema** StructuredOutput). 2 agenti, **0 error** (`agents_error:0`, `agents_empty_result:0` — non un
  falso verde da workflow morto). Il verifier avversariale non ha emesso **alcun blocker né major**; 3 rilievi
  minor/contesto tutti **no-change** (la near-collision è meno load-bearing sul render che nel targeting editor
  di M5 ma l'AC regge; il canary copre la sola dimensione contatore/console come richiede AC-417-5; la dipendenza
  da `NEXT_PUBLIC_SUPABASE_URL` è fail-safe = rosso su assenza, mai falso verde). Review dell'orchestratore sul
  diff reale: additività confermata (T-241/T-317 intatti, `HOSTILE_PAYLOADS` = 6, `buildHostileDocument` identico).
- **Nuovi artefatti**: `e2e/public-hostile.spec.ts` (Chromium, `test.use` storageState vuoto = ANON; 2 test:
  pagina pubblica ostile AC-417-1..4 + canary AC-417-5; ogni AC taggato `// covers`); estensioni **additive** a
  `e2e/fixtures/hostile-brief.ts` (`JSONLD_BREAKOUT_PAYLOAD` separato dai 6; `hostileBrief(businessName=default)`;
  `buildPublishedHostileDocument` = resolve reale → inietta slot uploaded nell'hero → **RI-GATE `parseDocument`** →
  guardrail `heroAssetId===assetId` + 6 payload come testo; `nearCollisionUuids` via XOR-1 dell'ultimo hex) e a
  `e2e/support/seed.ts` (`seedAsset` = PNG 1x1 verificato alla chiave piatta `<asset_id>` + riga `assets`, P4-D6a;
  `seedPublication` `is_published=true`).
- **Percorso del gate (onesto):**
  1. **e2e Chromium 9/9 VERDE** (`npm run build` + `npm run test:e2e`, gira SEPARATO dal checkpoint): T-417 reale
     (pagina pubblica anon: 200, 6 payload come testo, contatore 0, allowlist [app host + host Storage DERIVATO
     da `assetPublicUrl`] esclude ATTACKER_HOST con raccolta non vacua, `<img>` src == `assetPublicUrl(asset_id)`
     ESATTO, `<script ld+json>` escaped a singolo oggetto) + **T-417 canary ROSSO** (`.rejects`, stessa allowlist) +
     **T-240/T-241/T-317 non regrediti**. **CANARY prima del verde.**
  2. **Checkpoint DECOMPOSTO** (monolite non-eseguibile qui — background `0xC0000142` / foreground cap 10 min <
     ~20 min; foreground spawn-subprocess OK, provato da build/e2e): driver `scratchpad/c1c2-driver.mjs` importa
     `control1Hygiene`/`control2Security` REALI e ricalca la wiring di `runCheckpoint` (baseline ARRAY + union
     `loadHygieneBaseline`, manifest `supabase-jsts` via `classify→loadManifest`, `mode:'build'`, `blueprintDir:null`).
     **C1 VERDE** (`dead-code:0 dup:127 cycle:0 twin:0`, 0 blocker, igiene invariata 125). **C2 VERDE**
     (`gitleaks:0 osv:1 semgrep:0 rls:1`, 0 nuovi). **C3+C4** suite reale **1396/1396** (shard `1/2`=778 + `2/2`=618,
     0 rate-limit) dopo `rm -rf .next` + `db:reset`.
- **Batteria di mutazione (ORCHESTRATORE, ripristino verificato con sha256, MAI `git checkout`):** DUE superfici
  nuove, entrambe UCCISE. (a) `SiteImage` `src={assetPublicUrl(...)}`→`src={image.asset_id}` (grezzo) → build +
  T-417 spec → **ROSSO** su AC-417-3 (host Storage non interrogato) → ripristino byte-identico. (b) `serializeJsonLdSafe`
  → replacement no-op (escaping disattivato) → build + T-417 spec → **ROSSO** su AC-417-1/4 (breakout: pageError da
  U+2028/9 iniettati) → ripristino byte-identico. Post-batteria: T-417 spec **2/2 verde**, `git status` = solo i 3
  file e2e, `SiteImage.tsx`/`jsonld.ts` sha256 == baseline. **0 mutazioni sopravvissute.**
- **Esito controlli (decomposto):** C1 hygiene VERDE · C2 security VERDE · C3+C4 full suite **1396/1396** · e2e
  Chromium **9/9** · batteria mutazione 2/2 uccise. **CHECKPOINT VERDE 4/4 + E2E VERDE. P4 COMPLETO.**

## 6. Copertura dichiarata (cosa è verificato, cosa NO)

- **Verificato ora** (e2e Chromium **9/9** + oracoli checkpoint **VERDE 4/4** decomposto, su M6): l'assenza di
  **EFFETTO d'iniezione** sulla **rotta pubblica e ANON** `/s/<slug>` con un documento **pubblicato ostile** che
  porta insieme (i) i sei payload di `HOSTILE_PAYLOADS` come TESTO byte-per-byte, (ii) un **asset caricato**
  (`ImageSlot 'uploaded'`) reso da `SiteImage` col `src` costruito da `assetPublicUrl(asset_id)` ESATTO (mai testo
  libero, mai ATTACKER_HOST; near-collision uuid non confusa), (iii) il **JSON-LD `LocalBusiness`** col breakout
  `</script>`+U+2028/9 **escaped** (`JSON.parse` a singolo oggetto, nessun secondo script eseguito). `assertNoInjectionEffect`
  (contatore 0, nessun host fuori allowlist DICHIARATA, nessuna navigazione, nessun errore iniettato) sulla pagina
  servita ad anon (200 solo perché `is_published=true`; colonne private non nel documento reso; client anon, mai
  service_role nel browser). **Falsificabilità provata due volte**: il **canary** rende ROSSO lo stesso oracolo
  con la stessa allowlist (AC-417-5), e la **batteria di mutazione** ha ucciso i difetti su entrambe le superfici
  nuove (asset src + JSON-LD escaping).
- **NON coperto** (carry-over invariati, dichiarati): l'e2e è solo **Chromium** (non tutti i browser) e non percorre
  login/onboarding (cookie/seed via `service_role` nei test); **assenza di CSP** — la difesa provata è la
  sanificazione/escaping (renderer unico + JSON-LD serializer + re-encode upload M4), non una CSP; **osv 2 MODERATE**
  (`next`, `postcss`) carry-over; **CI mai girata da una run reale** (`gh` non installato; `test:e2e` non cablato in
  `ci.yml`); il **serving è dall'app Next.js path-based** (R2/sottodomini/domini custom = pass hosting dedicato P4-D1);
  il badge "Made with Belora" è presente (rimozione = P5).

## 7. Carry-over ereditati (rilevanti oltre P4)

**Aperti:**
- **CHECKPOINT MONOLITICO NON-ESEGUIBILE in questo ambiente (M4→M6, RICONFERMATO):** background bash detached →
  `0xC0000142`; foreground → cap 10 min < ~20 min del monolite. **Rimedio in uso (stabile su M4/M5/M6)**: decomposizione
  — `control1Hygiene`/`control2Security` via `scratchpad/c1c2-driver.mjs` (wiring di `runCheckpoint`, manifest
  `supabase-jsts`, baseline ARRAY + union hygiene) + suite in **2 shard** (`vitest --shard`); l'e2e Playwright/Chromium
  gira separatamente (`npm run build` + `npm run test:e2e`). **Nota M6:** lo spawn di sottoprocessi in FOREGROUND
  funziona (build, e2e, vitest, driver) — il `0xC0000142` è **solo** il caso background-detached.
- **Ripristino mutazioni via backup+sha256, MAI `git checkout`** (M5→M6): il lavoro di macrotask è uncommitted finché
  non si committa; per le mutazioni su file COMMITTATI (M6: `SiteImage.tsx`, `jsonld.ts`) il backup+sha256 resta la
  regola uniforme e sicura.
- **Workflow (M4→M6):** i verifier con `schema` StructuredOutput rigido sfondano il retry cap → **verifier senza schema**
  (prosa). Controllare SEMPRE `agents_error`/`agents_empty_result` prima del valore di ritorno.
- **R-04 (M2/M5):** ricorre solo quando i file nuovi sono in dir SCANSIONATE da jscpd (`src/**`); in M6 i file nuovi
  erano sotto `e2e/` (esclusa) → **nessun re-baseline**. Regola invariata: attribuire PRIMA di ricatturare, con
  `baseline.mjs capture … --hygiene --out .trueline/hygiene-baseline.json`.
- `osv`: 2 advisory **MODERATE** (`next`, `postcss`) — carry-over separato.
- **CI mai provata da una run reale** (`gh` non installato); `test:e2e` esiste ma non è cablato in `ci.yml`.
- e2e solo **Chromium**; non percorre login/onboarding (cookie iniettati, seed via `service_role` nei test).
- Assenza di **CSP** dichiarata: la difesa provata è la **sanificazione**/escaping (renderer unico + JSON-LD serializer
  + re-encode upload M4 + escaping React del SiteView pubblico), non una CSP.
- **`sharp` in `dependencies`** (M4, P4-D7): `uploadAsset` lo importa a runtime.
- **auth rate_limit** locale (`config.toml`): `sign_in_sign_ups = 30 / 5 min per IP`. La suite serializzata in 2 shard
  ci sta (M6: **0 rate-limit** dopo `db reset`). `db reset` azzera il contatore.

**Chiusi (da onorare, non riaprire):**
- **e2e ostile sulla superficie PUBBLICA (M6/T-417):** l'`assertNoInjectionEffect` condiviso (T-240) è ora provato
  anche su `/s/<slug>` anon con documento pubblicato ostile + asset caricato + JSON-LD; il canary lo rende rosso
  sulla stessa superficie. Non riaprire con un secondo oracolo/renderer.
- **Renderer UNICO** `SiteView`/`SiteImage` (P2-D8): esteso in M5 al ramo `uploaded`; M6 lo esercita in Chromium sulla
  rotta pubblica. Un solo `<img>`, un solo URL builder `assetPublicUrl`, nessun renderer/URL parallelo.
- **`parseDocument` come gate** in scrittura E in render: M6 lo ri-attraversa anche nel fixture pubblicato
  (`buildPublishedHostileDocument` ri-gate dopo la mutazione dello slot).
- **Nessun `src`/`href`/URL da testo libero** (P2-D12): l'`<img>` uploaded costruisce il `src` dal SOLO `asset_id`;
  provato sull'EFFETTO in M6 (near-collision, host Storage nell'allowlist, mai ATTACKER_HOST).
- **JSON-LD escaped anti-breakout** (P4-D8, T-410): provato sull'EFFETTO in M6 (breakout `</script>`+U+2028/9 escaped,
  `JSON.parse` a singolo oggetto, nessun secondo script eseguito; mutazione dell'escaping → rosso).
- **RLS pubblica riconquistata** (T-401/T-407): l'anon legge SOLO il pubblicato; M6 serve la pagina anon solo perché
  `is_published=true`, colonne private non nel documento reso, service_role mai nel browser.
- **`P4-D6a`** (00-INDEX §4): chiave Storage PIATTA `<asset_id>` + `assetPublicUrl(asset_id)`; M6 semina l'oggetto
  reale alla chiave piatta e ne prova il render.
- **Contratto `architecture:` repo-wide** (P3-D7 + AH-D6): rispettato; M6 aggiunge solo file di test sotto `e2e/`
  (fuori dai layer di produzione), nessun arco `forbidden`.

## 8. Prossimi passi

1. **P4 (Pubblicazione, serving pubblico & media) COMPLETO**: 6/6 macrotask VERDI (checkpoint 4/4) e mergiati ff su
   `main` (`de1289b`) + push. L'ultimo (M6 `e2e-public`) chiude il DAG con la prova di punta (e2e ostile Chromium anon
   su `/s/<slug>` + asset caricato + JSON-LD, canary rosso). Il blueprint resta la fonte di verità approvata.
2. **Deploy-coupling = `coupled` RICONFERMATO** (§3): il merge è avvenuto su autorizzazione esplicita; nessun deploy
   innescato dall'agente. Un deploy dell'hosting pubblico resta un'azione umana supervisionata (P4-D1: pass hosting
   dedicato ancora rimandato).
3. **Nessun residuo P4.** Il lavoro successivo del progetto Belora (P5, secondo la mappa dei 10 sotto-progetti —
   billing/crediti, gating a pagamento, ritocco/sfondi AI delle foto, rimozione badge, P4-D5/P4-D7) partirà da un
   proprio blueprint (BOOTSTRAP) e una propria SESSION-STATE, non da questa.
4. Disciplina invariata per i sotto-progetti futuri: **1 dynamic workflow per MACROTASK** → 1 fermata umana → fix;
   **checkpoint DECOMPOSTO** dove il monolite non gira; verdetto dai JSON `.green`/dai conteggi shard; batteria di
   mutazione (fatale + ripristino **sha256**, mai `git checkout`); **CANARY prima del verde** sull'e2e; attribuzione
   **R-04** prima di ogni ricattura d'igiene (solo se i file nuovi sono in dir scansionate da jscpd); verifier senza
   schema; lintare i file nuovi (`eslint .`).
