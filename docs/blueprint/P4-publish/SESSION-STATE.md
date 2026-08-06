# SESSION-STATE — Belora · P4 (Pubblicazione, serving pubblico & media)

> Fonte di verità sullo **stato vivo** del sotto-progetto P4, consumata da BUILD e
> aggiornata a ogni chiusura di sessione (`prompts/session-end.md`). Istanza distinta
> dalle SESSION-STATE di P0/P1/P2/P3, di `architecture-hardening` e da quella della skill
> trueline. Prosa in italiano, identificatori/nomi-file in inglese.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Ultimo aggiornamento** | 2026-08-06 (**BUILD M2 `public-serving` COMPLETO E MERGIATO su `main` `c624d0e`**, checkpoint VERDE 4/4) |
| **Sessione corrente** | — (`public-serving` CHIUSO; **prossima sessione: BUILD di `seo-base`** via `prompts/session-start.md`) |

---

## 1. Stato dei macrotask

> Aggiornato a ogni `session-end`. Stati: `todo` | `in_progress` | `done`.

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| `publish-core` | **done** | **VERDE 4/4 (`6b87183`)** | 4 task (T-401…T-404): `site_publications` + RLS anon-published + UNIQUE public_slug, `public_slug` dominio puro, `publishSite`/`unpublishSite`. RLS004 sulla policy anon = FP baselinato |
| `public-serving` | **done** | **VERDE 4/4 (`c624d0e`)** | 4 task (T-405…T-408): rotta `/s/<slug>` standalone (lettura anon RLS + gate `parseDocument` + `SiteView` reale nella locale della riga + `notFound` anti-enum), middleware esclude `/s/*` dal routing di locale, **RLS pubblica provata a RUNTIME** col client anon + canary `USING(true)`→ROSSO, badge "Made with Belora" dal serving. **`vitest fileParallelism:false`** per il canary globale; hygiene R-04 `120→123` |
| `seo-base` | todo | — | 3 task (T-409…T-411): `generateMetadata`, JSON-LD sicuro, sitemap/robots |
| `media-storage` | todo | — | 3 task (T-412…T-414): bucket+RLS+assets, `uploadAsset` re-encode, URL da asset_id |
| `media-editor-render` | todo | — | 2 task (T-415…T-416): `SiteImage` uploaded, affordance upload nell'editor |
| `e2e-public` | todo | — | 1 task (T-417): e2e ostile Chromium su `/s/<slug>` + canary rosso |

## 2. Macrotask corrente

- **Nessuno aperto**: `public-serving` (M2) è CHIUSO (checkpoint VERDE 4/4, mergiato ff su `main` `c624d0e`).
- **Primo macrotask eseguibile ora: `seo-base`** (M3) — la sua dipendenza P4 (T-405, la rotta pubblica) è
  verde. Ordine del piano: `publish-core`✔ → `public-serving`✔ → **`seo-base`**; `media-storage` →
  `media-editor-render`; `e2e-public` alla fine (§2 di `00-INDEX`). `media-storage` (M4) è indipendente da
  M1–M3 (nessun `depends_on` aperto) e potrebbe essere aperto in alternativa, ma l'ordine del piano è M3 prima.
- **Follow-up potenziali non bloccanti** (fuori dagli AC, per pass futuri, non da aprire ora):
  editing del `public_slug` con controllo unicità (`validatePublicSlug` esiste già in `public-slug.ts`, non
  ancora cablato a una server action); `og:image` dinamica (parte di T-409); hreflang multi-locale.

## 3. Stato git

> Registrato a ogni `session-end`. Mai lavorare su `main`.

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/public-serving` (commit atomico `c624d0e`, cita T-405..T-408 + esito gate; pushato origin). `main` = P3 + `architecture-hardening` + **P4 M1+M2** mergiati |
| Ultimo commit | `c624d0e` build(public-serving): P4 M2 (su `main`, pushato origin) |
| Stato merge su `main` | **`public-serving` mergiato ff** (`65cc13e→c624d0e`) + push origin, su **autorizzazione esplicita** dell'utente (deploy-coupling coupled, human-gated anche sul verde) |
| Deploy-coupling | **`coupled` — RICONFERMATO**. Il merge di ogni macrotask resta **human-gated anche sul verde**; deploy non supervisionato BLOCCATO. Il merge M2 (che ATTIVA la rotta pubblica `/s/<slug>`) è avvenuto solo dopo il verde 4/4 E il via esplicito |

## 4. Baseline & budget

- **Baseline di sicurezza**: due file gitignored: `.trueline/baseline.json` (formato oggetto di `capture`) **e**
  `.trueline/checkpoint-baseline.json` (**formato ARRAY** — quello che `run_checkpoint --baseline` legge davvero:
  `loadBaseline` vuole un array top-level o `.findings` come array). Contiene 2 finding: `postcss@8.5.22` OSV
  **MEDIUM** (sotto soglia) + **RLS004 HIGH accepted-FP** sulla policy anon pubblica (`de0128…`). Invariata in M2.
- **Baseline d'igiene**: `.trueline/hygiene-baseline.json` (versionata) **ri-attribuita `120→123`** (R-04): 3 cloni
  LOW strutturali introdotti/ri-fingerprintati dall'aggiunta dei file M2 — `domain/sites/slug.ts:44`
  (idioma dedup-slug `generateUniqueSlug`, clone di `public-slug.ts`), `data/site-publications.ts:71` e `:97`
  (idioma query Supabase `.from().select().eq()…maybeSingle()` / acquisizione client, clone del nuovo
  `data/public-site.ts`). Delta verificato: **+3 esatti, 0 spostati/rimossi** (i 120 pre-esistenti tutti ancora
  combacianti). Gotcha: `baseline.mjs capture <dir> --hygiene --out <hygiene path>` — **senza `--out` scrive nel
  default `.trueline/baseline.json`** (sbaglierebbe file).
- **Budget consumato**: **2 macrotask** (`publish-core` M1, `public-serving` M2) su 6.

## 5. Esiti dell'ultima sessione (framing onesto)

> Solo fatti: "checkpoint VERDE 4/4 sui target_test", mai "P4 è pronto/sicuro" (`L-COL-006`).

- **BUILD M2 `public-serving`** (T-405…T-408) costruito con **1 dynamic workflow** (8 agenti: builder +
  verifier BLIND per task, sequenziali in ordine di DAG) → 1 fermata umana → checkpoint **VERDE 4/4** su
  stato pulito. Mergiato ff su `main` (`c624d0e`) + push, su via esplicito.
- **Nuovi artefatti**: `src/data/public-site.ts` (`readPublishedSite` — client anon SSR, match esatto `.eq`,
  sole colonne pubbliche `document/public_slug/locale`, `maybeSingle`, React `cache()`, fail-closed a `null`);
  `src/app/s/[slug]/page.tsx` (gate `parseDocument` in render → `SiteView` reale nella locale della RIGA,
  badge fuori dall'albero del documento); `src/app/s/[slug]/layout.tsx` (**2° root layout standalone**: non
  c'è `src/app/layout.tsx`, `[locale]/layout.tsx` è il root de-facto, quindi `/s/*` porta il proprio
  `<html lang={row.locale}>`); `src/app/s/[slug]/Badge.tsx` (href statico, testo per-locale della riga);
  `src/middleware.ts` esteso (`isPublicStandalonePath` early-return prima della guardia auth). 4 nuovi test.
- **Rilievo HIGH del verifier T-407 (orchestrazione, non codice):** il canary AC-407-6 fa un
  `ALTER POLICY … USING(true)` **globale di tabella** poi ripristina → in esecuzione parallela di vitest su un
  DB locale condiviso poteva andare in gara con le letture anon di T-401/T-404 (falso ROSSO non-deterministico).
  Fix scelto dall'utente: **`vitest fileParallelism:false`** (serializza i file; nessuna gara su stato globale
  del DB; deterministico anche per M3–M6). Costo: suite del checkpoint più lenta.
- **Percorso del gate (onesto):** checkpoint #1 ROSSO solo sul controllo 1 (igiene: 3 cloni LOW nuovi) → R-04
  re-attribution `120→123` (delta ispezionato, cloni strutturali non dannosi) → checkpoint #2 **VERDE 4/4**.
  L'oracolo è provato capace di diventare rosso (batteria di mutazione T-405: gate `parseDocument` sabotato →
  suite ROSSA 1/13 → ripristino **sha256-identico** → VERDE 13/13; 1 uccisa, 0 sopravvissute).
- Verifier BLIND: **0 rilievi ALTA/MEDIA di codice**; solo LOW (2 `className` speculativi nel Badge, rimossi;
  nit di tag-hygiene cosmetici lasciati). Nessun comportamento inventato oltre la spec, purezza `src/domain`
  intatta, renderer UNICO (nessuna copia di `SiteView`), altitudine rispettata (serving in `src/app`,
  lettura dati in `src/data`, logica pura in `src/domain`).

## 6. Copertura dichiarata (cosa è verificato, cosa NO)

- **Verificato ora** (oracolo checkpoint **VERDE 4/4** su M2, run monolitico su stato pulito): la **RLS pubblica
  anon-published a RUNTIME** sulla rotta (T-407: client anon reale legge SOLO il pubblicato, non il
  non-pubblicato né di altri tenant, colonne private negate `42501`, anti-placebo owner, **canary `USING(true)`
  → oracolo ROSSO** poi ripristinato); l'**assenza di distinzione osservabile** slug ignoto vs non pubblicato
  (`notFound` anti-enum, P1-D21, provata sul path reale della rotta col data-seam mockato che modella l'RLS);
  il **gate `parseDocument` in render** (AC-405-4); l'**escaping React** del testo ostile via il renderer unico
  `SiteView` (AC-405-5: payload come TESTO, nessun `src/href` da testo libero); l'**esclusione di `/s/*`** dal
  routing di locale senza regressione (T-406); il **badge non spoofabile** reso dal serving (T-408);
  `arch_check` repo-wide verde. RLS004 statico = FP baselinato.
- **NON ancora coperto** (attende i macrotask successivi): l'**e2e ostile Chromium sulla superficie pubblica
  `/s/<slug>`** con documento pubblicato ostile + asset caricato (T-417, **M6**) — il render della rotta è
  provato a unità col renderer reale + a runtime per la RLS, ma NON ancora end-to-end in un browser reale;
  l'**escaping del JSON-LD** e i metadata/OG (T-409/T-410, **M3**); l'**effetto del re-encode** upload + URL
  asset da `asset_id` (T-413/T-414, **M4**). Nessuno è un verde finché un oracolo non lo produce. Carry-over
  invariati: osv 2 MODERATE, CI mai girata da run reale, e2e solo Chromium.

## 7. Carry-over ereditati (da P0/P1/P2/P3, rilevanti per P4)

**Aperti:**
- `osv`: 2 advisory **MODERATE** (`next`, `postcss`) — carry-over separato, non introdotto da P4.
- **CI mai provata da una run reale** (`gh` non installato); `test:e2e` esiste ma non è cablato in `ci.yml`.
- e2e solo **Chromium**; non percorre login/onboarding (cookie iniettati, seed via `service_role` nei test).
- Assenza di **CSP** dichiarata: la difesa provata è la **sanificazione** (e per l'upload il **re-encode**),
  non una CSP. Rilevante per la rotta pubblica `/s/<slug>` (nessuna chrome autenticata) — la difesa è
  l'escaping del renderer unico + `parseDocument`, provata a unità/runtime; l'e2e pubblico arriva in M6.
- `sharp` è nell'albero via Next: **da promuovere a dipendenza diretta** se `uploadAsset` lo importa (P4-D7).

**Chiusi (da onorare, non riaprire):**
- Disciplina del **testo non fidato** provata sull'effetto in P2 (T-241), estesa all'editor in P3 (T-317):
  da **preservare ed estendere** alla **superficie pubblica** (T-417, M6). In M2 il testo ostile è provato
  come TESTO a unità (AC-405-5) col renderer reale.
- **Renderer UNICO** `SiteView` (P2-D8): la rotta pubblica passa da lì, mai una copia (confermato in M2).
- **`parseDocument` come gate** (P3): ogni snapshot pubblicato ri-valida in scrittura (T-403) **e in render**
  (T-405).
- **Nessun `src/href` da testo libero** (P2-D12): badge con href costante statico; URL asset da `asset_id` (M4).
- **Contratto `architecture:` repo-wide** (P3-D7 + AH-D6): rispettato in M2 (serving in `src/app`, lettura anon
  in `src/data`, slug puro in `src/domain`).
- **RLS riconquistata su tabella nuova**, provata A RUNTIME (M1 T-401 + M2 T-407): mai nell'SQL editor.
- **Anti-enumerazione** `notFound()` (P1-D21): slug ignoto/non pubblicato → 404 indistinguibili (M2 T-405).

## 8. Prossimi passi

1. **M2 `public-serving` CHIUSO**: checkpoint VERDE 4/4, mergiato su `main` (`c624d0e`) + push. Il blueprint
   resta la fonte di verità approvata: si costruisce secondo i task, non si ridiscute il design.
2. **Aprire BUILD sul macrotask `seo-base`** (T-409…T-411: `generateMetadata` title/description/OG/canonical/
   lang/og:image dallo snapshot, **JSON-LD `LocalBusiness` con serializzazione SICURA** — escaping `< > &` +
   `U+2028/2029`, anti-breakout script, A03:2025 — sitemap.xml per-sito + robots.txt che indicizza `/s/*` e
   tiene editor/preview `noindex`) — il PRIMO passo della prossima sessione: `prompts/session-start.md` →
   branch `trueline/build/seo-base`, **UN dynamic workflow per l'intero macrotask** (builder + verifier BLIND
   per task). Dipendenza P4 (T-405) verde. Il **JSON-LD è il punto di sicurezza** del macrotask (oracolo di
   escaping obbligatorio, come il canary di T-407).
3. **Deploy-coupling = `coupled` RICONFERMATO** (§3): il merge di ogni macrotask resta human-gated anche sul
   verde.
4. Disciplina invariata: **1 dynamic workflow per MACROTASK** (builder + verifier BLIND per task) → 1 fermata
   umana → fix; checkpoint `run_checkpoint.mjs --in-place --mode build --baseline <file ARRAY>` **SENZA
   `--blueprint`**, verdetto dal JSON `.green`. Checkpoint su **stato pulito** (`rm -rf .next` + `db:reset` che
   azzera il rate-limit auth; `.env.local` FUORI dal repo durante lo scan gitleaks, env esportate via shell —
   `setup.env.ts` riempie solo le var `undefined`, quindi lo shell-export vince). **`vitest fileParallelism:false`
   ora attivo** (DB locale condiviso serializzato). Batteria di mutazione (fatale + ripristino sha256);
   disciplina fixture (>1 elemento, valori discordanti, uno slug prefisso di un altro) + **namespace di slug
   proprio per ogni file DB-test** (`public_slug` UNIQUE GLOBALE, DB condiviso).
