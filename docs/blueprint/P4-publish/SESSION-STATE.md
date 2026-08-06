# SESSION-STATE — Belora · P4 (Pubblicazione, serving pubblico & media)

> Fonte di verità sullo **stato vivo** del sotto-progetto P4, consumata da BUILD e
> aggiornata a ogni chiusura di sessione (`prompts/session-end.md`). Istanza distinta
> dalle SESSION-STATE di P0/P1/P2/P3, di `architecture-hardening` e da quella della skill
> trueline. Prosa in italiano, identificatori/nomi-file in inglese.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Ultimo aggiornamento** | 2026-08-06 (BOOTSTRAP: blueprint P4 generato, **validato** (`validate_blueprint` exit 0, 17 task, 6/6) e committato `c7dd6e7`; **nessun macrotask costruito**) |
| **Sessione corrente** | — (blueprint pronto e validato; **prossima sessione: aprire BUILD di `publish-core`** via `prompts/session-start.md`) |

---

## 1. Stato dei macrotask

> Aggiornato a ogni `session-end`. Stati: `todo` | `in_progress` | `done`.

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| `publish-core` | todo | — | 4 task (T-401…T-404): tabella `site_publications` + RLS anon-published + UNIQUE public_slug, `public_slug` dominio puro, `publishSite`/`unpublishSite` |
| `public-serving` | todo | — | 4 task (T-405…T-408): rotta `/s/<slug>` standalone, middleware, RLS runtime, badge |
| `seo-base` | todo | — | 3 task (T-409…T-411): `generateMetadata`, JSON-LD sicuro, sitemap/robots |
| `media-storage` | todo | — | 3 task (T-412…T-414): bucket+RLS+assets, `uploadAsset` re-encode, URL da asset_id |
| `media-editor-render` | todo | — | 2 task (T-415…T-416): `SiteImage` uploaded, affordance upload nell'editor |
| `e2e-public` | todo | — | 1 task (T-417): e2e ostile Chromium su `/s/<slug>` + canary rosso |

## 2. Macrotask corrente

- **Nessuno aperto**: il blueprint P4 è appena stato generato (BOOTSTRAP). Nessun codice prodotto.
- **Primo macrotask eseguibile: `publish-core`** (nessuna dipendenza P4 aperta). Segue l'ordine dei
  macrotask del piano: `publish-core` → `public-serving` → `seo-base`; `media-storage` →
  `media-editor-render`; `e2e-public` alla fine (§2 di `00-INDEX`).
- **Follow-up potenziali non bloccanti** (fuori dagli AC, per pass futuri, non da aprire ora):
  editing del `public_slug` con controllo unicità (P4-D4, oltre l'auto-generazione di T-402);
  `og:image` dinamica generata; hreflang quando esisteranno siti multi-locale.

## 3. Stato git

> Registrato a ogni `session-end`. Mai lavorare su `main`.

| Campo | Valore |
|---|---|
| Branch di lavoro | (da creare a inizio BUILD, es. `trueline/build/publish-core`). `main` = P3 + `architecture-hardening` mergiati |
| Ultimo commit | `c7dd6e7` docs(P4): bootstrap blueprint (su `main`, pushato). Nessun commit di BUILD P4 ancora |
| Stato merge su `main` | **NESSUNO** (nessun macrotask P4 costruito) |
| Deploy-coupling | **`coupled` — CONFERMATO in P3, ancora valido in P4**. P4 aggiunge una **rotta pubblica** `/s/<slug>`, tabelle nuove e un bucket Storage: il merge di ogni macrotask resta **human-gated anche sul verde** (mergiare può innescare il deploy dell'hosting pubblico). Deploy non supervisionato BLOCCATO |

## 4. Baseline & budget

- **Baseline di sicurezza**: **da ricatturare a inizio BUILD** (nessuna baseline P4 ancora). P4
  introduce **due tabelle nuove** (`site_publications`, `assets`) + un **bucket Storage** → `rls`
  **da riconquistare** e provare A RUNTIME (anon legge solo il pubblicato); una **rotta pubblica
  anon** e una **pipeline di upload** → scan/effetto da provare. Registrare `.trueline/baseline.json`
  (gitignored) all'apertura.
- **Baseline d'igiene**: `.trueline/hygiene-baseline.json` (versionata) da **ri-attribuire** prima di
  ricatturare (impronte sensibili alla POSIZIONE — R-04): le nuove dir (`src/app/s`, `src/data` media,
  `e2e`) ri-fingerprintano impronte pre-esistenti. Gotcha noto: `baseline.mjs capture <dir> --hygiene`
  scrive nel default `baseline.json` → serve `--out <hygiene path>`.
- **Budget consumato**: 0 macrotask (blueprint appena generato).

## 5. Esiti dell'ultima sessione (framing onesto)

> Solo fatti: "generato e validato il blueprint", mai "P4 è pronto/sicuro" (`L-COL-006`).

- Blueprint P4 **generato** (BOOTSTRAP): `00-INDEX`, `VISION-AND-CONSTRAINTS`, questa `SESSION-STATE`,
  i 3 prompt di lifecycle, e i moduli `01-publish-core` … `06-e2e-public` (17 task, T-401…T-417).
- **Oracolo strutturale** `validate_blueprint.mjs` su `docs/blueprint/P4-publish`: **eseguito, exit 0**
  — 17 task, 6/6 controlli (campi obbligatori, copertura AC→test, DAG aciclico, id univoci, ownership
  del macrotask, contratto `architecture:` ben formato). Nessun codice prodotto.
- **Self-check semantico** (punti 6–10): **svolto** sui moduli a più alto rischio (00-INDEX,
  public-serving, media-storage, e2e-public) — misurabilità/atomicità/copertura/baseline-per-nome OK,
  **nessun rilievo bloccante** (il blueprint aggiunge difesa-in-profondità: GRANT column-level ad anon,
  confine-cartella su storage.objects, guardia decompression-bomb, canary sulla RLS pubblica).

## 6. Copertura dichiarata (cosa è verificato, cosa NO)

> In BOOTSTRAP l'unico oracolo è `validate_blueprint` (strutturale). Il resto è **piano**,
> non ancora provato: si chiude solo in BUILD con gli oracoli del checkpoint.

- **Verificato ora** (`validate_blueprint` **exit 0**): la forma strutturale del blueprint — campi
  obbligatori, copertura AC→test, DAG aciclico, id univoci, ownership del macrotask, contratto
  `architecture:` ben formato. Più il self-check semantico (nessun rilievo bloccante).
- **NON ancora coperto** (attende BUILD): la **RLS pubblica** a runtime (anon legge il pubblicato,
  non il non-pubblicato né di altri tenant; colonne private non esposte); il **gate `parseDocument`**
  sul percorso reale di publish e di render; l'**escaping del JSON-LD** contro il breakout dal tag
  script; l'**effetto del re-encode** dell'upload (payload ostili → raster pulito o rifiuto); la
  costruzione dell'**URL asset da `asset_id`** (mai da testo libero); l'**assenza di effetto**
  dell'iniezione sulla rotta pubblica `/s/<slug>` (Chromium + canary); `arch_check` contro il grafo
  import reale. Nessuno di questi è un verde finché un oracolo non lo produce.

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

1. **`validate_blueprint` eseguito (exit 0) + self-check semantico svolto** (nessun rilievo bloccante):
   il blueprint è la fonte di verità approvata. Si costruisce secondo i task, non si ridiscute il design.
2. **Aprire BUILD sul macrotask `publish-core`** (T-401…T-404) — il PRIMO passo della prossima sessione:
   `prompts/session-start.md` → creare il branch `trueline/build/publish-core`, ricatturare la baseline
   di sicurezza (`rls` da riconquistare), poi **UN dynamic workflow per l'intero macrotask** (builder +
   verifier BLIND per task).
3. **Deploy-coupling = `coupled` CONFERMATO** (§3): il merge di ogni macrotask resta human-gated
   anche sul verde (P4 apre l'hosting pubblico).
4. Disciplina invariata: **1 dynamic workflow di build PER MACROTASK** (builder + verifier BLIND per
   task) → 1 fermata umana → 1 workflow fixer; checkpoint `run_checkpoint.mjs --in-place --mode build
   --baseline <sicurezza>` **SENZA `--blueprint`**, verdetto dal JSON `.green`; batteria di mutazione
   con sanità fatale + ripristino per sha256; checkpoint su **stato pulito** (`rm -rf .next` +
   `db:reset`, che azzera anche il rate-limit auth); disciplina fixture (>1 elemento, valori
   discordanti, un id prefisso di un altro).
