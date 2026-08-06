# 05-media-editor-render — Macrotask `media-editor-render`

> Modulo del blueprint P4 (Pubblicazione, serving pubblico & media) di Belora. Un modulo
> = un macrotask (`L-COL-018`, `L-COL-024`). Task atomici secondo lo schema trueline
> (`L-COL-019`). Costruisce **sopra** `media-storage` (M4): consuma `uploadAsset` (T-413,
> re-encode server) e il costruttore di URL da `asset_id` (T-414), e **sopra** la superficie
> editor di P3 (`EditorClient`, il reducer del draft T-307, l'unica porta `saveRevision`
> T-302/T-309). DAG interno a P4: `media-storage` → `media-editor-render`.
> Fonte dell'intento: `docs/superpowers/specs/2026-08-06-p4-publish-media-design.md`
> (P4-D6/D7, §5, §9-M5, invarianti §10). Identificatori in inglese, prosa in italiano.

## Obiettivo del macrotask

Chiudere l'anello dei media dentro il render reale e dentro l'editing. Due mosse, entrambe
sotto le invarianti di P4 (§10):

1. **Rendering** (T-415): il renderer **UNICO** `SiteImage` impara a rendere la variante
   `source:'uploaded'` dello slot immagine (già tipizzata in T-202) come **immagine reale**,
   con il `src` **costruito da noi** dal solo `asset_id` via T-414 — **mai** da testo libero,
   preservando **P2-D12** (il tipo persistito resta senza alcun campo `url`/`src`/`href`) e
   l'**escaping** del renderer unico. Il ramo `theme-placeholder` resta invariato.
2. **Editing** (T-416): l'editor guadagna l'**affordance di upload** per gli slot immagine di
   un blocco. Il file passa **attraverso il server** da `uploadAsset` (T-413, dove vive la
   difesa provata: magic-bytes + re-encode `sharp`), l'`asset_id` restituito sostituisce lo
   slot placeholder con `{ source:'uploaded', asset_id }` **nel draft** dietro il gate
   `parseDocument`, e la modifica è persistita **solo** via `saveRevision` (T-302), attraverso
   i save-point di T-309. L'anteprima riflette l'immagine col renderer unico (T-415), senza
   alcuna copia client.

Nessun ritocco/sfondo AI (→ P5), nessun blocco galleria (→ più avanti), nessun upload diretto
dal browser allo Storage: sempre attraverso il server, sempre re-encodato o rifiutato.

## Task atomici

```yaml
- id: T-415
  title: "SiteImage rende ImageSlot source:'uploaded' (src dal nostro URL, escaping preservato)"
  macrotask: "media-editor-render"
  depends_on: [T-414]

  objective: >
    Rendere lo slot immagine `source:'uploaded'` come immagine reale il cui `src` è costruito dal
    costruttore di URL di T-414 a partire dal solo `asset_id` (un uuid validato da ImageSlotSchema/
    T-202), mai da testo libero, preservando P2-D12 (il tipo persistito resta senza alcun campo
    url/src/href) e l'escaping del renderer unico; il ramo `theme-placeholder` resta invariato.

  definition_of_done:
    - "SiteImage, per un ImageSlot { source:'uploaded', asset_id }, rende un elemento <img> il cui src è ottenuto dal costruttore di URL di T-414 (asset_id -> URL pubblico del nostro Storage), mai da un campo di testo del documento"
    - "Il tipo ImageSlot persistito resta privo di qualunque campo url/src/href (P2-D12): l'URL è costruito a RENDER, non memorizzato nel documento né nello snapshot pubblicato"
    - "Il ramo source:'theme-placeholder' resta reso come prima (riquadro decorativo con data-image-token, nessun <img>): nessuna regressione dell'altra variante dell'unione discriminata"
    - "Nessun HTML grezzo: l'<img> nasce come elemento React (escaping preservato), nessun dangerouslySetInnerHTML in SiteImage; lo scan statico anti-XSS su src/ui/site copre il file"
    - "Un solo costruttore di URL (quello di T-414 in src/data): SiteImage NON reimplementa la costruzione dell'URL; l'import ui->data è consentito dal contratto di altitudine (vietati solo domain->* e data->ui)"

  acceptance_criteria:
    - id: AC-415-1
      given: "un ImageSlot { source:'uploaded', asset_id } con un asset_id uuid valido"
      when: "SiteImage lo rende"
      then: "l'output contiene un <img> il cui attributo src è ESATTAMENTE l'URL che il costruttore di T-414 produce da quell'asset_id (stessa origine del nostro Storage, path derivato dall'uuid)"
    - id: AC-415-2
      given: "una fixture con DUE slot uploaded con asset_id DISCORDANTI che condividono un lungo prefisso comune (differiscono solo negli ultimi caratteri: un match per prefisso li confonderebbe)"
      when: "entrambi gli slot sono resi"
      then: "ogni <img> ha il src costruito dal PROPRIO asset_id per uguaglianza esatta (nessuno scambio, nessun match per prefisso)"
    - id: AC-415-3
      given: "un ImageSlot { source:'theme-placeholder', token }"
      when: "SiteImage lo rende"
      then: "l'output NON contiene alcun <img> e resta il riquadro decorativo con data-image-token (l'altra variante è invariata)"
    - id: AC-415-4
      given: "uno slot uploaded il cui unico dato è l'asset_id uuid (il tipo non ammette per costruzione url/src/href, P2-D12)"
      when: "si costruisce il src e si rende l'<img>"
      then: "il src è uguale all'URL derivato dall'asset_id e a null'altro: nessuna stringa del documento diversa dall'uuid raggiunge l'attributo (nessun 'javascript:'/'data:'/URL di terzi possibile), e l'attributo è emesso da React (escaping preservato)"

  target_tests:
    - file: "tests/site-image-uploaded.test.tsx"
      covers: [AC-415-1, AC-415-2, AC-415-3, AC-415-4]

  security_notes:
    - "P2-D12 preservato: lo slot 'uploaded' resta irrappresentabile-per-tipo senza url/src/href; il src è COSTRUITO da noi dal solo asset_id (uuid validato da ImageSlotSchema/T-202), mai da testo libero — chiude il vettore OWASP A03:2025 (injection via src 'javascript:'/'data:'/URL di terzi)"
    - "Escaping del renderer UNICO preservato (P2-D8): <img> come elemento React, nessun dangerouslySetInnerHTML in SiteImage; scan statico anti-XSS su src/ui/site (eredità/estensione T-241)"
    - "Altitudine (T-AH6/T-312): un solo costruttore di URL (T-414 in src/data), nessuna duplicazione nella UI; import ui->data consentito dal contratto (vietati solo domain->*, data->ui), nessun arco vietato"

  out_of_scope:
    - "Costruzione dell'URL pubblico da asset_id (T-414) e resolver che non esponga colonne private ad anon (T-407/T-412)"
    - "Upload, sniff magic-bytes e re-encode sharp (T-413); affordance di upload nell'editor (T-416)"
    - "Ritocco / rimozione sfondo AI sulle foto (P5); blocco galleria (più avanti)"

- id: T-416
  title: "Editor: affordance di upload per slot immagine -> ImageSlot 'uploaded' nel draft -> salvato via saveRevision"
  macrotask: "media-editor-render"
  depends_on: [T-413, T-415]

  objective: >
    Dare all'editor l'affordance di caricare una foto reale per uno slot immagine di un blocco:
    l'upload passa SEMPRE attraverso il server via uploadAsset (T-413, re-encode), l'asset_id
    restituito sostituisce lo slot placeholder con { source:'uploaded', asset_id } NEL DRAFT dietro
    il gate parseDocument (azione del reducer T-307), e la modifica è persistita SOLO via
    saveRevision (T-302) attraverso i save-point di T-309; l'anteprima riflette l'immagine caricata
    resa dal renderer unico (SiteImage, T-415).

  definition_of_done:
    - "Ogni slot immagine di un blocco nell'editor espone un'affordance 'carica foto' che invia il file a uploadAsset(siteId, file) (T-413) attraverso il server; mai un upload diretto dal browser al bucket Storage"
    - "Al successo, l'asset_id restituito produce nel draft uno slot { source:'uploaded', asset_id } al posto dello slot placeholder indirizzato (coordinata blockId + indice immagine), via una nuova azione del reducer del draft (T-307), immutabile e per uguaglianza esatta del blockId"
    - "Il documento risultante passa parseDocument (lo schema T-202 ammette già la variante 'uploaded'); una modifica che romperebbe un invariante è un no-op (stesso stato, nessuna voce di storia spuria), come le altre azioni del draft"
    - "La modifica è persistita SOLO via saveRevision (T-302), attraverso i save-point di T-309 (autosave con debounce / Salva esplicito): nessun secondo canale di scrittura"
    - "L'anteprima mostra l'immagine caricata resa da SiteImage source:'uploaded' (T-415), col renderer UNICO; nessuna copia client dei blocchi"
    - "Un esito non-ok di uploadAsset (sniff fallito, SVG, oversize) NON muta il draft e NON produce alcuno slot 'uploaded'"

  acceptance_criteria:
    - id: AC-416-1
      given: "l'editor con un blocco che ha uno slot immagine placeholder e un file immagine valido"
      when: "l'utente carica il file via l'affordance dello slot"
      then: "uploadAsset(siteId, file) è invocato attraverso il server e, al successo, il draft contiene { source:'uploaded', asset_id } per quello slot al posto del placeholder"
    - id: AC-416-2
      given: "un draft con più blocchi/slot immagine (fixture con >1 slot, asset_id e indici DISCORDANTI, e un blockId PREFISSO di un altro blocco presente, es. 'orari' e 'orari-estivi')"
      when: "si imposta lo slot uploaded a un indice canonico di un blocco specifico"
      then: "cambia SOLO quello slot (blockId per uguaglianza esatta, indice canonico in range); gli altri slot, blocchi e contenuti restano la stessa reference"
    - id: AC-416-3
      given: "uno slot appena reso 'uploaded' nel draft"
      when: "scatta il save-point (autosave con debounce o Salva esplicito)"
      then: "la persistenza passa da saveRevision (unica porta) e il documento inviato supera il gate parseDocument (la variante 'uploaded' è ammessa)"
    - id: AC-416-4
      given: "un upload che uploadAsset RIFIUTA (sniff fallito / SVG / oversize -> esito non-ok)"
      when: "l'affordance riceve l'esito"
      then: "il draft NON è mutato (nessuno slot 'uploaded', nessuna voce di storia) e nulla è passato a saveRevision"
    - id: AC-416-5
      given: "uno slot reso 'uploaded' con un asset_id nel draft"
      when: "l'anteprima si aggiorna"
      then: "l'immagine è resa da SiteImage col src costruito dall'asset_id (T-415), mai da testo libero, dal renderer unico (nessuna copia client)"

  target_tests:
    - file: "tests/editor-upload-image.test.tsx"
      covers: [AC-416-1, AC-416-2, AC-416-3, AC-416-4, AC-416-5]

  security_notes:
    - "Upload SEMPRE attraverso il server (uploadAsset/T-413): sniff magic-bytes + re-encode sharp (strip EXIF, rifiuto SVG, resize) è la difesa PROVATA sull'effetto (T-413), mai byte grezzi, mai upload diretto dal browser al bucket; RLS Storage per-tenant (T-412, OWASP A01:2025)"
    - "Nessun src/href da testo libero: il draft porta solo l'asset_id (uuid) restituito da uploadAsset; l'URL lo costruisce SiteImage via T-414 (P2-D12) — OWASP A03:2025"
    - "Gate parseDocument (OWASP A05:2025) sul documento risultante e UNICA porta di scrittura saveRevision (client di SESSIONE sotto RLS, mai service_role, T-302/T-309): nessun canale che aggiri il gate; siteId non è un confine di sicurezza — uploadAsset/saveRevision riverificano ownership sotto RLS (anti-enumerazione P1-D21)"
    - "Un esito non-ok di uploadAsset non muta il draft: nessuno slot 'uploaded' fabbricato, nessuna revisione persistita (disciplina no-op del reducer T-307); scan statico anti-XSS su src/ui/editor (eredità T-306) copre l'affordance"

  out_of_scope:
    - "uploadAsset: magic-bytes, re-encode sharp, tabella/RLS assets e Storage (T-412/T-413)"
    - "Rendering dell'immagine caricata e costruzione del src (T-415/T-414)"
    - "e2e ostile Chromium sulla superficie pubblica /s/<slug> con asset caricato (T-417)"
    - "Ritocco / sfondi AI e blocco galleria (P5 / più avanti)"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir `docs/blueprint/P4-publish`
  — atteso exit 0 / tutti i controlli OK (`11` §5.1). I `depends_on` di T-415 (T-414) e T-416
  (T-413, T-415) puntano a id del **modulo M4** (`04-media-storage.md`), risolti perché
  `validate_blueprint` gira sull'**intera** dir del blueprint P4.
- **Semantico** (checklist guidata): `self-check-checklist.md` punti 6–10 su ogni task; i rilievi
  vanno all'human-in-the-loop (`11` §5.2–§5.3).
- **Nota sui `covers:` nei file di test.** In BUILD col controllo 4 attivo (`--blueprint`), ogni
  blocco di test che esercita un AC porta `// covers: AC-xxx-n`: un AC non tracciato rende il
  controllo 4 rosso prima di eseguire. Convenzione del file di test, non campo del blueprint.
