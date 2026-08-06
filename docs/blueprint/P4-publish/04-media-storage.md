# 04-media-storage — Macrotask `media-storage`

> Modulo del blueprint P4 (Pubblicazione, serving pubblico & media) di Belora. Un
> modulo = un macrotask (`L-COL-018`, `L-COL-024`). Task atomici secondo lo schema
> trueline (`L-COL-019`). Fonte dell'intento: `docs/superpowers/specs/2026-08-06-p4-publish-media-design.md`
> (decisioni `P4-D6`, `P4-D7`; §4 modello dati, §5 flussi, §7.2 upload, §7.6 altitudine).
> Identificatori in inglese, prosa in italiano. DAG interno a P4: questo macrotask è
> **indipendente** da `publish-core`/`public-serving`/`seo-base`; alimenta `media-editor-render` (M5).

## Obiettivo del macrotask

La **pipeline dei media** (P4-D6/P4-D7): dare a un sito **foto reali** al posto dei
placeholder del tema, senza mai fidarsi del byte caricato. Si costruisce il substrato di
storage — un **bucket a lettura pubblica** con oggetti indirizzati per uuid e **scrittura
vincolata per-tenant via RLS**, più la tabella `assets` (RLS riconquistata) — e la
**server action `uploadAsset`**, dove il **re-encode `sharp`** è la difesa provata
sull'effetto: magic-bytes → raster pulito (JPEG/PNG/WebP), **EXIF strippato**, **SVG
rifiutato**, ridimensionamento a limiti sensati, byte puliti su Storage + riga `assets`.
Infine, la regola non negoziabile che rende sicuro il consumo: l'**URL pubblico dell'asset
lo costruiamo noi da `asset_id`**, mai da testo libero (preserva `P2-D12`). Nessun render
qui: `SiteImage` e l'affordance editor sono M5.

## Task atomici

```yaml
- id: T-412
  title: "Bucket Storage a lettura pubblica + RLS scrittura per-tenant + tabella assets + RLS"
  macrotask: "media-storage"
  depends_on: []

  objective: >
    Creare il substrato di storage dei media: un bucket Supabase Storage a lettura
    pubblica con oggetti indirizzati per uuid (path <account_id>/<site_id>/<asset_id>.<ext>),
    una policy di scrittura su storage.objects vincolata al prefisso di path del proprio
    account, e la tabella assets con RLS owner-only riconquistata. Nessuna riga né oggetto
    di un tenant deve essere scrivibile/cancellabile/leggibile-in-tabella da un altro.

  definition_of_done:
    - "Migration che crea la tabella assets (id uuid, account_id, site_id, storage_path, mime, width, height, created_at) con RLS ON"
    - "Policy RLS su assets: i membri dell'account fanno INSERT/SELECT/DELETE SOLO sulle proprie righe (account_id = account della sessione); nessuna policy USING(true)"
    - "FK composita (site_id, account_id) verso sites come difesa in profondità (lezione P2-D19)"
    - "Bucket Storage creato a lettura pubblica; convenzione di path oggetti PIATTA <asset_id> (uuid v4 opaco, generato server-side, non enumerabile) — EMENDAMENTO P4-D6a (vedi 00-INDEX §4): la chiave e' l'asset_id, cosi' il renderer/SEO anon costruisce l'URL dal SOLO asset_id (schema documento P2-D12), coerente con assetPublicUrl gia' VERDE in M3; storage_path della riga assets = <asset_id>"
    - "Policy RLS di scrittura su storage.objects (INSERT/UPDATE/DELETE) a CONFINE-OWNER: owner = auth.uid() sul bucket site-assets — EMENDAMENTO P4-D6a: la chiave piatta non ha cartella di account su cui fare binding, quindi il confine e' l'OWNER dell'oggetto (Supabase valorizza objects.owner con l'uploader) + chiavi uuid generate da noi (A non puo' scegliere la chiave di B)"

  acceptance_criteria:
    - id: AC-412-1
      given: "un membro dell'account A"
      when: "inserisce una riga assets per un proprio sito"
      then: "la riga è scritta con account_id = A e storage_path = la chiave PIATTA <asset_id> (EMENDAMENTO P4-D6a: niente cartella <account_id>/<site_id>/; la chiave e' l'asset_id opaco)"
    - id: AC-412-2
      given: "due account distinti con asset ciascuno (fixture con più di un account, valori discordanti, un account_id che è prefisso di un altro) e un lettore anon"
      when: "un membro di A e l'anon tentano di SELECT sulle righe assets di B"
      then: "ricevono insieme vuoto (RLS blocca); account_id e storage_path non sono esposti"
    - id: AC-412-3
      given: "un oggetto nel bucket posseduto dall'account B, e un membro dell'account A (fixture con >1 account, owner discordanti) — EMENDAMENTO P4-D6a: confine-OWNER, non confine-cartella"
      when: "A tenta di UPDATE/DELETE l'oggetto di B, o di scrivere sulla chiave (asset_id) di B"
      then: "la scrittura e' rifiutata dalla policy storage (binding a objects.owner = auth.uid(), non prefisso di path); e la chiave e' un uuid generato server-side che A non puo' predire/scegliere"
    - id: AC-412-4
      given: "un oggetto esistente nel bucket e un client anon"
      when: "anon esegue GET sull'URL pubblico dell'oggetto"
      then: "riceve i byte (200) — trade-off dichiarato P4-D6: l'oggetto è pubblico per uuid, la riga assets resta privata"
    - id: AC-412-5
      given: "un membro dell'account A e una riga assets dell'account B (fixture con più di un account, id discordanti)"
      when: "A tenta DELETE della riga assets di B"
      then: "0 righe cancellate (RLS blocca la cancellazione cross-tenant)"

  target_tests:
    - file: "tests/assets-rls.test.ts"
      covers: [AC-412-1, AC-412-2, AC-412-5]
    - file: "tests/storage-rls.test.ts"
      covers: [AC-412-3, AC-412-4]

  security_notes:
    - "RLS per-tenant sulla tabella assets RICONQUISTATA (OWASP A01:2025, categoria killer Supabase): policy owner-only INSERT/SELECT/DELETE ancorate a account_id della sessione; nessuna policy USING(true)"
    - "RLS di scrittura su storage.objects a CONFINE-OWNER (owner = auth.uid()) — EMENDAMENTO P4-D6a: con chiave piatta <asset_id> non c'e' cartella di account su cui fare binding; la lezione-prefisso P1/P2 e' onorata DIVERSAMENTE (chiavi uuid v4 generate server-side, non predicibili → A non puo' scegliere la chiave di B) e la modifica e' owner-bound (A non modifica/cancella l'oggetto di B)"
    - "Bucket a lettura pubblica = trade-off dichiarato P4-D6: l'oggetto è raggiungibile per uuid (v4, non enumerabile), ma le colonne della riga assets (account_id, storage_path) restano private — anon SELECT su assets = vuoto (A01:2025)"
    - "FK composita (site_id, account_id) verso sites come difesa in profondità (P2-D19): un asset non può legarsi a un sito di un altro tenant"
    - "service_role mai nel browser: la migrazione e le policy vivono lato DB; l'accesso runtime è client di sessione (RLS attiva)"

  out_of_scope:
    - "uploadAsset e re-encode sharp (T-413)"
    - "Costruzione dell'URL pubblico da asset_id (T-414)"
    - "Hosting dedicato R2/Worker e domini custom (pass successivo, P4-D1)"

- id: T-413
  title: "uploadAsset(siteId, file): sniff magic-bytes + re-encode sharp (strip EXIF, rifiuto SVG, resize) -> Storage + riga assets"
  macrotask: "media-storage"
  depends_on: [T-412]

  objective: >
    Esporre una server action uploadAsset(siteId, file) che non si fida mai del byte
    caricato: determina il content-type per magic-bytes lato server, ricodifica i raster
    accettati con sharp (JPEG/PNG/WebP) strippando i metadata (EXIF) e ridimensionando a
    limiti sensati, rifiuta SVG/sniff-fallito/oversize, scrive i byte PULITI su Storage e
    inserisce la riga assets, ritornando asset_id. La difesa è provata sull'EFFETTO.

  definition_of_done:
    - "Server action uploadAsset(siteId, file) su client di sessione con RLS, mai service_role; ownership del sito verificata, sito altrui -> 404"
    - "Il content-type è deciso per magic-bytes lato server, mai dal mime/estensione dichiarati dal client"
    - "I raster accettati sono ricodificati con sharp in JPEG/PNG/WebP con metadata strippati (EXIF/GPS/commenti) e ridimensionati a un cap massimo di dimensione"
    - "SVG rifiutato; sniff fallito rifiutato; input oltre il cap di byte/pixel rifiutato — in nessun caso byte grezzi salvati"
    - "Su successo: byte puliti scritti su Storage al path dell'owner (T-412) + riga assets inserita; ritorna asset_id"

  acceptance_criteria:
    - id: AC-413-1
      given: "un JPEG valido con EXIF (GPS + orientamento + un commento con payload testuale)"
      when: "si chiama uploadAsset"
      then: "l'oggetto salvato decodifica come raster SENZA alcun metadato EXIF (strip provato sui byte di output) e la riga assets riporta mime/width/height coerenti"
    - id: AC-413-2
      given: "un file SVG (anche con contenuto ben formato che include <script>)"
      when: "si chiama uploadAsset"
      then: "è rifiutato: nessun oggetto scritto su Storage, nessuna riga assets"
    - id: AC-413-3
      given: "un file il cui mime/estensione dichiarati sono image/png ma i magic-bytes NON sono un'immagine (polyglot HTML/JS, magic-bytes falsi)"
      when: "si chiama uploadAsset"
      then: "lo sniff fallisce e l'upload è rifiutato (il content-type dichiarato dal client non è mai fidato)"
    - id: AC-413-4
      given: "un input oltre il cap (dimensioni in pixel o byte sopra la soglia, incl. una immagine altamente compressa che si espande)"
      when: "si chiama uploadAsset"
      then: "è rifiutato senza produrre un oggetto salvato (guardia anti decompression-bomb)"
    - id: AC-413-5
      given: "un polyglot con header immagine valido e payload/script appeso in coda (fixture con più payload ostili discordanti)"
      when: "si chiama uploadAsset"
      then: "il re-encode produce un raster i cui byte contengono solo dati immagine (il payload appeso sparisce); output != input byte-per-byte"
    - id: AC-413-6
      given: "un utente e un siteId di un sito NON posseduto"
      when: "si chiama uploadAsset"
      then: "riceve 404 e nulla è scritto (né oggetto né riga assets)"

  target_tests:
    - file: "tests/upload-asset.effect.test.ts"
      covers: [AC-413-1, AC-413-2, AC-413-3, AC-413-4, AC-413-5, AC-413-6]

  security_notes:
    - "Upload non fidato: content-type deciso per magic-bytes lato server, MAI dal mime/estensione del client (OWASP A05:2025 / unrestricted file upload)"
    - "Il re-encode sharp è la DIFESA provata sull'EFFETTO (invariante §10): ogni raster accettato è ricodificato con metadata strippati (EXIF/GPS/commenti), neutralizzando polyglot e byte appesi (OWASP A03:2025 injection)"
    - "SVG rifiutato categoricamente (XSS stored via <script>/<foreignObject> in SVG); sniff fallito rifiutato; nessun byte grezzo salvato"
    - "Cap di byte/pixel applicato prima/allo decode come guardia anti decompression-bomb (DoS)"
    - "uploadAsset su client di sessione con RLS, mai service_role; ownership del sito verificata; sito altrui -> 404 (anti-enumerazione P1-D21)"
    - "Altitudine (gate repo-wide T-AH6/T-312): sharp e accesso Storage (I/O) in src/data; le decisioni di forma pure (mime ammessi, cap) in src/domain — il dominio non raggiunge data"

  out_of_scope:
    - "Ritocco / rimozione sfondo AI sulle foto (P5, crediti)"
    - "Rendering di ImageSlot uploaded e affordance editor (T-415/T-416)"

- id: T-414
  title: "URL pubblico dell'asset costruito da asset_id (mai da testo libero, preserva P2-D12)"
  macrotask: "media-storage"
  depends_on: [T-412]

  objective: >
    Fornire la funzione pura di dominio che costruisce l'URL pubblico di un asset dai soli
    identificatori (account_id/site_id/asset_id/ext), mai da un campo di testo libero.
    È il punto che rende sicuro il consumo dei media a valle: conserva P2-D12 (nessun
    src/href da testo di terzi) e mantiene significativa l'asserzione end-to-end di T-241.

  definition_of_done:
    - "Funzione pura assetPublicUrl(assetId) in src/config/storage.ts (GIA' esistente da M3, VERDE) che deriva l'URL pubblico del bucket dal SOLO asset_id, senza I/O — EMENDAMENTO P4-D6a: resta in src/config (unica sede del nome bucket + template URL, gia' importata da page.tsx), NON si sposta in src/domain (eviterebbe churn cross-macrotask su M3); T-414 aggiunge i test falsificanti + eventuale guard uuid"
    - "L'URL è costruito SOLO dall'asset_id (uuid opaco); nessun campo di testo (filename originale, caption) partecipa — per FIRMA la funzione prende solo l'asset_id, quindi il testo libero e' strutturalmente escluso"
    - "Output ben formato verso il nostro bucket pubblico (SITE_ASSETS_BUCKET); nessun campo url/src/href letto dall'input"

  acceptance_criteria:
    - id: AC-414-1
      given: "un asset_id (uuid)"
      when: "si chiama assetPublicUrl(assetId)"
      then: "ritorna l'URL pubblico canonico ESATTO di quell'oggetto nel nostro bucket (<origin>/storage/v1/object/public/site-assets/<assetId>)"
    - id: AC-414-2
      given: "un contesto in cui esistono metadati di testo dell'asset (filename originale o caption) che contengono un URL assoluto, javascript: o ../ path traversal — EMENDAMENTO P4-D6a: la funzione prende SOLO l'asset_id"
      when: "si chiama assetPublicUrl(assetId)"
      then: "l'URL prodotto e' derivato solo dall'asset_id e non c'e' alcun parametro in cui quel testo possa entrare (prova P2-D12 per FIRMA: nessun src da testo libero)"
    - id: AC-414-3
      given: "una fixture con più di un asset (asset_id discordanti, un asset_id che è prefisso di un altro — near-collision, un prefisso proprio non passa z.string().uuid())"
      when: "si costruisce l'URL di ciascuno"
      then: "ogni asset mappa al proprio URL distinto (nessuna collisione da prefisso; identità esatta)"
    - id: AC-414-4
      given: "lo stesso asset"
      when: "si chiama assetPublicUrl due volte"
      then: "ritorna una stringa byte-identica (deterministico, nessuno stato nascosto né I/O)"

  target_tests:
    - file: "tests/asset-public-url.test.ts"
      covers: [AC-414-1, AC-414-2, AC-414-3, AC-414-4]

  security_notes:
    - "P2-D12 preservata: l'URL è costruito da noi dal SOLO asset_id (uuid), MAI da un campo di testo libero; per FIRMA nessun campo url/src/href/testo dell'input partecipa (EMENDAMENTO P4-D6a)"
    - "Irrappresentabilità per tipo: un testo di terzi (filename, caption) non può diventare un attributo di rete src — conserva VERA e SIGNIFICATIVA l'asserzione end-to-end T-241 (nessuna richiesta verso host fuori allowlist)"
    - "Path traversal impossibile: il singolo componente del path e' un uuid opaco (nessun / o .. iniettabile), nessun input libero entra nel path (OWASP A03:2025 injection)"
    - "Funzione PURA in src/domain, nessun I/O (gate di altitudine repo-wide T-AH6/T-312, OWASP A05:2025): il dominio non raggiunge data"

  out_of_scope:
    - "Rendering dell'URL in SiteImage per ImageSlot source:'uploaded' (T-415)"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir `docs/blueprint/P4-publish`
  — atteso exit 0 / tutti i controlli OK (copertura AC→test, DAG aciclico, id univoci, ownership).
- **Semantico** (checklist guidata): `self-check-checklist.md` punti 6–10 su ogni task; i
  rilievi vanno all'human-in-the-loop.
