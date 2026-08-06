# SESSION-STATE — Belora · P4 (Pubblicazione, serving pubblico & media)

> Fonte di verità sullo **stato vivo** del sotto-progetto P4, consumata da BUILD e
> aggiornata a ogni chiusura di sessione (`prompts/session-end.md`). Istanza distinta
> dalle SESSION-STATE di P0/P1/P2/P3, di `architecture-hardening` e da quella della skill
> trueline. Prosa in italiano, identificatori/nomi-file in inglese.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Ultimo aggiornamento** | 2026-08-06 (**BUILD M1 `publish-core` COMPLETO E MERGIATO su `main` `6b87183`**, checkpoint VERDE 4/4; suite 1296) |
| **Sessione corrente** | — (`publish-core` CHIUSO; **prossima sessione: BUILD di `public-serving`** via `prompts/session-start.md`) |

---

## 1. Stato dei macrotask

> Aggiornato a ogni `session-end`. Stati: `todo` | `in_progress` | `done`.

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| `publish-core` | **done** | **VERDE 4/4 (`6b87183`)** | 4 task (T-401…T-404): `site_publications` + RLS anon-published + UNIQUE public_slug, `public_slug` dominio puro, `publishSite`/`unpublishSite`. Merge ff su main + push (autorizzato); RLS004 sulla policy anon = FP baselinato |
| `public-serving` | todo | — | 4 task (T-405…T-408): rotta `/s/<slug>` standalone, middleware, RLS runtime, badge |
| `seo-base` | todo | — | 3 task (T-409…T-411): `generateMetadata`, JSON-LD sicuro, sitemap/robots |
| `media-storage` | todo | — | 3 task (T-412…T-414): bucket+RLS+assets, `uploadAsset` re-encode, URL da asset_id |
| `media-editor-render` | todo | — | 2 task (T-415…T-416): `SiteImage` uploaded, affordance upload nell'editor |
| `e2e-public` | todo | — | 1 task (T-417): e2e ostile Chromium su `/s/<slug>` + canary rosso |

## 2. Macrotask corrente

- **Nessuno aperto**: `publish-core` (M1) è CHIUSO (checkpoint VERDE 4/4, mergiato su `main` `6b87183`).
- **Primo macrotask eseguibile ora: `public-serving`** (M2) — le sue dipendenze P4 (T-401, T-403) sono
  verdi. Ordine del piano: `publish-core`✔ → `public-serving` → `seo-base`; `media-storage` →
  `media-editor-render`; `e2e-public` alla fine (§2 di `00-INDEX`).
- **Follow-up potenziali non bloccanti** (fuori dagli AC, per pass futuri, non da aprire ora):
  editing del `public_slug` con controllo unicità (P4-D4, oltre l'auto-generazione di T-402);
  `og:image` dinamica generata; hreflang quando esisteranno siti multi-locale.

## 3. Stato git

> Registrato a ogni `session-end`. Mai lavorare su `main`.

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/publish-core` (commit atomico `6b87183`, cita T-401..T-404 + esito gate). `main` = P3 + `architecture-hardening` + **P4 M1** mergiati |
| Ultimo commit | `6b87183` build(publish-core): P4 M1 (su `main`, pushato origin). Segue: `docs(P4): session-end` |
| Stato merge su `main` | **`publish-core` mergiato ff** (`de9b1a7→6b87183`) + push origin, su **autorizzazione esplicita** dell'utente (deploy-coupling coupled, human-gated anche sul verde) |
| Deploy-coupling | **`coupled` — RICONFERMATO in questa sessione**. Il merge di ogni macrotask resta **human-gated anche sul verde**; deploy non supervisionato BLOCCATO. Il merge M1 è avvenuto solo dopo il verde 4/4 E il via esplicito |

## 4. Baseline & budget

- **Baseline di sicurezza**: catturata su stato pre-P4. Due file (entrambi gitignored): `.trueline/baseline.json`
  (formato oggetto di `baseline.mjs capture`) **e** `.trueline/checkpoint-baseline.json` (**formato ARRAY** —
  quello che `run_checkpoint --baseline` legge davvero: `loadBaseline` vuole un array top-level o `.findings`
  come array, NON l'oggetto). Contengono 2 finding: `postcss@8.5.22` OSV **MEDIUM** (sotto soglia) + **RLS004
  HIGH accepted-FP** sulla policy anon pubblica (`de0128…`; FP superato dalla prova runtime AC-401-3/4).
- **Baseline d'igiene**: `.trueline/hygiene-baseline.json` (versionata) **ri-attribuita 107→120** (R-04):
  16 cloni-prosa dei doc P4 (dal bootstrap) + 1 self-clone del preambolo `getAuthedClient`. I fingerprint
  sono ancorati al CONTENUTO → i 6 fix di codice non li hanno spostati (ri-cattura post-fix identica).
  Gotcha: `baseline.mjs capture <dir> --hygiene --out <hygiene path>` (senza `--out` scrive nel default).
- **Budget consumato**: **1 macrotask** (`publish-core`, M1) su 6.

## 5. Esiti dell'ultima sessione (framing onesto)

> Solo fatti: "generato e validato il blueprint", mai "P4 è pronto/sicuro" (`L-COL-006`).

- **BUILD M1 `publish-core`** (T-401…T-404) costruito con **1 dynamic workflow** (8 agenti: builder +
  verifier BLIND per task) → 1 fermata umana → 6 fix diretti (root-cause) + FP RLS004 baselinato →
  checkpoint **VERDE 4/4** su stato pulito. Mergiato ff su `main` (`6b87183`) + push, su via esplicito.
- **Percorso del gate (onesto):** checkpoint #1 ROSSO (RLS004 + 3 test) → #2 (control 1/3/4 verdi, 2
  rosso per bug di FORMATO baseline: `run_checkpoint --baseline` vuole un ARRAY, `capture` scrive un
  oggetto → letta vuota) → fix formato (`.trueline/checkpoint-baseline.json`) → **#3 VERDE 4/4**.
  L'oracolo è provato capace di diventare rosso (redde su difetti reali; batteria di mutazione T-402:
  1 uccisa, ripristino sha256).
- Nessun comportamento inventato oltre la spec, nessun orfano, purezza `src/domain` intatta (verifier
  BLIND: 0 rilievi alta/media; solo minor — i tidy sono stati inclusi nei fix).

## 6. Copertura dichiarata (cosa è verificato, cosa NO)

> In BOOTSTRAP l'unico oracolo è `validate_blueprint` (strutturale). Il resto è **piano**,
> non ancora provato: si chiude solo in BUILD con gli oracoli del checkpoint.

- **Verificato ora** (oracolo checkpoint **VERDE 4/4** su M1): la **RLS pubblica anon-published a RUNTIME**
  su `site_publications` — client anon reale legge SOLO `is_published=true` (**AC-401-3**), colonne private
  (`account_id`, `source_generation_id`) negate `42501` (**AC-401-4**), isolamento membro A↔B (AC-401-2),
  UNIQUE (23505) e FK composite (23503) provati in isolamento; il **gate `parseDocument` sul percorso reale
  di publish** (documento invalido → nessuna scrittura, AC-403-2); lo **snapshot congelato disaccoppiato
  dalla FIFO** (AC-403-6); `public_slug` server-side deduplicato ancorato dal UNIQUE (AC-403-3); `arch_check`
  repo-wide verde (`src/domain` puro). **RLS004 statico sulla policy anon = FALSO POSITIVO dichiarato/
  baselinato** — superato dalla prova comportamentale (AC-401-3/4); `rls_check` stesso rimanda la verifica
  per-tenant al DB-test.
- **NON ancora coperto** (attende i macrotask successivi): l'**assenza di effetto dell'iniezione sulla ROTTA
  pubblica `/s/<slug>`** end-to-end + `notFound` anti-enum (T-405/T-407, **M2**); l'**escaping del JSON-LD**
  (T-410, **M3**); l'**effetto del re-encode** upload + URL asset da `asset_id` (T-413/T-414, **M4**); l'**e2e
  ostile Chromium** su `/s/<slug>` + asset + canary (T-417, **M6**). Nessuno è un verde finché un oracolo non
  lo produce. Carry-over invariati: osv 2 MODERATE, CI mai girata da run reale, e2e solo Chromium.

## 7. Carry-over ereditati (da P0/P1/P2/P3, rilevanti per P4)

**Aperti:**
- `osv`: 2 advisory **MODERATE** (`next`, `postcss`) — carry-over separato, non introdotto da P4.
- **CI mai provata da una run reale** (`gh` non installato); `test:e2e` esiste ma non è cablato in
  `ci.yml`.
- e2e solo **Chromium** (non Firefox/WebKit); non percorre login/onboarding (cookie iniettati, seed
  via `service_role` nei test).
- Assenza di **CSP** dichiarata: la difesa provata è la **sanificazione** (e per l'upload il
  **re-encode**), non una CSP. Rilevante per P4: la rotta pubblica non ha la chrome autenticata.
- `sharp` è nell'albero via Next: **da promuovere a dipendenza diretta** se `uploadAsset` lo importa
  esplicitamente (P4-D7).

**Chiusi (da onorare, non riaprire):**
- Disciplina del **testo non fidato** provata sull'effetto in P2 (T-241) ed estesa all'editor in P3
  (T-317): da **preservare ed estendere** alla **superficie pubblica** (T-417).
- **Renderer UNICO** `SiteView` (P2-D8): il sito pubblicato passa da lì, mai una copia.
- **`parseDocument` come gate in scrittura** (P3): ogni snapshot pubblicato e ogni draft con
  `ImageSlot 'uploaded'` ri-validano.
- **Nessun `src/href` da testo libero** (P2-D12): gli URL asset si costruiscono da `asset_id`.
- **Contratto `architecture:` repo-wide** (P3-D7 + AH-D6): `data→ui` e `domain→{ui,data,app}` vietati;
  gate `tests/architecture-contract.test.ts`.
- **RLS riconquistata su tabella nuova**, provata A RUNTIME (lezione P3-T-301/T-407): mai nell'SQL
  editor.
- **Anti-enumerazione** `notFound()` (P1-D21): slug ignoto/non pubblicato e sito altrui → 404.

## 8. Prossimi passi

1. **M1 `publish-core` CHIUSO**: checkpoint VERDE 4/4, mergiato su `main` (`6b87183`) + push. Il blueprint
   resta la fonte di verità approvata: si costruisce secondo i task, non si ridiscute il design.
2. **Aprire BUILD sul macrotask `public-serving`** (T-405…T-408: rotta `/s/<slug>` standalone, middleware
   che esclude `/s/*` dal routing di locale, **RLS pubblica provata a RUNTIME col client anon** T-407,
   badge "Made with Belora", `notFound` anti-enum) — il PRIMO passo della prossima sessione:
   `prompts/session-start.md` → branch `trueline/build/public-serving`, **UN dynamic workflow per l'intero
   macrotask** (builder + verifier BLIND per task). Dipendenze P4 (T-401, T-403) verdi.
3. **Deploy-coupling = `coupled` RICONFERMATO** (§3): il merge di ogni macrotask resta human-gated anche
   sul verde (la rotta pubblica `/s/<slug>` di M2 è servita dall'app).
4. Disciplina invariata: **1 dynamic workflow per MACROTASK** (builder + verifier BLIND per task) → 1
   fermata umana → fix; checkpoint `run_checkpoint.mjs --in-place --mode build --baseline <file ARRAY>`
   **SENZA `--blueprint`**, verdetto dal JSON `.green`. **Per gli accettati/FP la baseline va in formato
   ARRAY** (`.trueline/checkpoint-baseline.json`, che `run_checkpoint` legge davvero — l'oggetto di
   `capture` è letto vuoto). Batteria di mutazione (fatale + ripristino sha256); checkpoint su **stato
   pulito** (`rm -rf .next` + `db:reset`, che azzera il rate-limit auth); disciplina fixture (>1 elemento,
   valori discordanti, un id/slug prefisso di un altro) + **namespace di slug proprio per ogni file DB-test**
   (`public_slug` è UNIQUE GLOBALE e il DB è condiviso fra i file in parallelo).
