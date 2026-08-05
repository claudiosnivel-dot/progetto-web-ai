# 02-editor-blocks — Macrotask `editor-blocks`

> Modulo del blueprint P3 (Editor inline) di Belora. Un modulo = un macrotask
> (`L-COL-018`, `L-COL-024`). Task atomici secondo lo schema trueline
> (`L-COL-019`). Costruisce **sopra** `editor-core` (M1): usa la persistenza a
> revisioni, il renderer editabile e la rotta editor. DAG: `editor-core` → `editor-blocks`.
> Identificatori in inglese, prosa in italiano.

## Obiettivo del macrotask

Le **operazioni sui blocchi** (T2 del design): aggiungi / riordina / sostituisci blocchi
dalla libreria **entro i guardrail** (modello a slot/lista, **niente drag pixel-libero**),
con l'anteprima strutturale ri-renderizzata dal `SiteView` reale lato server, il rispetto
delle **precondition dati** dei blocchi, la manutenzione di `brief_fields_rendered`, e
l'estensione della **prova sull'effetto** (e2e ostile) alla superficie editor.

## Task atomici

```yaml
- id: T-313
  title: "renderDraftPage: anteprima strutturale server sul draft"
  macrotask: "editor-blocks"
  depends_on: [T-305, T-311]

  objective: >
    Esporre una server action che valida un draft (parseDocument) e rende una pagina col
    SiteView reale, per aggiornare l'anteprima quando cambia la struttura dei blocchi,
    mantenendo il renderer unico.

  definition_of_done:
    - "Server action renderDraftPage(siteId, draft, pageSlug) che valida il draft con parseDocument prima di rendere"
    - "Rende la pagina col SiteView reale (renderer unico), mai una ri-implementazione client"
    - "Ownership del sito verificata (RLS), client di sessione"

  acceptance_criteria:
    - id: AC-313-1
      given: "un draft valido di un sito posseduto e uno slug di pagina"
      when: "si chiama renderDraftPage"
      then: "ritorna la pagina resa dal SiteView reale"
    - id: AC-313-2
      given: "un draft che non supera parseDocument"
      when: "si chiama renderDraftPage"
      then: "è rifiutato e nulla è reso"
    - id: AC-313-3
      given: "un draft che contiene testo ostile"
      when: "renderDraftPage rende la pagina"
      then: "il testo è reso come TESTO (nessun effetto di iniezione)"
    - id: AC-313-4
      given: "un sito non posseduto dall'utente"
      when: "si chiama renderDraftPage"
      then: "è rifiutato (RLS/ownership)"

  target_tests:
    - file: "tests/render-draft-page.test.ts"
      covers: [AC-313-1, AC-313-2, AC-313-3, AC-313-4]

  security_notes:
    - "parseDocument come gate prima del render; RLS ownership; escaping preservato (renderer unico)"

- id: T-314
  title: "Aggiungi blocco dalla libreria (precondition dati + label i18n)"
  macrotask: "editor-blocks"
  depends_on: [T-307, T-313]

  objective: >
    Permettere di aggiungere un blocco dalla libreria a una pagina rispettando la
    precondition dati del blocco e la sua label i18n, aggiornando brief_fields_rendered e
    mantenendo il documento valido, con modello a slot/lista (mai canvas libero).

  definition_of_done:
    - "Il pannello blocchi permette di aggiungere un blocco dalla libreria a una pagina (modello a lista, no drag pixel-libero)"
    - "Solo i blocchi la cui precondition dati è soddisfatta sono aggiungibili; brief_fields_rendered aggiornato"
    - "Il blocco aggiunto ha la sua voce label i18n (it/es); il documento risultante passa parseDocument (home-unica, limiti di blocchi per pagina)"

  acceptance_criteria:
    - id: AC-314-1
      given: "una pagina e un blocco della libreria con dati disponibili"
      when: "si aggiunge il blocco"
      then: "è reso nella pagina e brief_fields_rendered riflette i campi resi"
    - id: AC-314-2
      given: "un blocco la cui precondition dati è falsa (es. recensioni con precondition sempre falsa)"
      when: "si apre la libreria dei blocchi"
      then: "quel blocco NON è offerto né aggiungibile"
    - id: AC-314-3
      given: "un'aggiunta che porterebbe la pagina oltre i limiti o romperebbe l'invariante home-unica"
      when: "si tenta l'aggiunta"
      then: "il documento risultante è rifiutato da parseDocument e l'aggiunta non è persistita"
    - id: AC-314-4
      given: "un blocco appena aggiunto"
      when: "si rende la pagina"
      then: "usa la sua label i18n dal catalogo (mai prosa non tradotta né id grezzo)"

  target_tests:
    - file: "tests/editor-add-block.test.ts"
      covers: [AC-314-1, AC-314-2, AC-314-3, AC-314-4]

  security_notes:
    - "parseDocument sul documento risultante; brief_fields_rendered sincronizzato; label da catalogo i18n; nessun href/src da testo libero"

- id: T-315
  title: "Riordina i blocchi in una pagina (lista ordinabile)"
  macrotask: "editor-blocks"
  depends_on: [T-314]

  objective: >
    Permettere di riordinare i blocchi entro una pagina con un modello a lista ordinabile
    (mai drag pixel-libero), riflettendo l'ordine nel draft e nell'anteprima e mantenendo
    il documento valido.

  definition_of_done:
    - "Riordino dei blocchi entro una pagina via lista (sposta su/giù o handle), senza drag pixel-libero"
    - "L'ordine si riflette nel draft e nell'anteprima (renderDraftPage)"
    - "Il documento riordinato passa parseDocument (home-unica e limiti preservati)"

  acceptance_criteria:
    - id: AC-315-1
      given: "una pagina con più blocchi (fixture con più di un blocco, contenuti discordanti, un block id prefisso di un altro)"
      when: "si sposta un blocco nell'ordine"
      then: "cambia SOLO l'ordine; nessun contenuto di blocco è alterato"
    - id: AC-315-2
      given: "un riordino appena eseguito"
      when: "si rende l'anteprima"
      then: "i blocchi appaiono nel nuovo ordine"
    - id: AC-315-3
      given: "un documento riordinato"
      when: "si valida il documento"
      then: "passa parseDocument (una home, limiti rispettati)"

  target_tests:
    - file: "tests/editor-reorder-blocks.test.ts"
      covers: [AC-315-1, AC-315-2, AC-315-3]

  security_notes:
    - "parseDocument sul documento riordinato; il riordino non modifica dati o contenuti dei blocchi"

- id: T-316
  title: "Sostituisci un blocco con un altro dalla libreria"
  macrotask: "editor-blocks"
  depends_on: [T-314]

  objective: >
    Permettere di sostituire un blocco con un altro compatibile dalla libreria,
    riconciliando dati e brief_fields_rendered e mantenendo il documento valido.

  definition_of_done:
    - "Sostituzione di un blocco esistente con un altro dalla libreria la cui precondition dati è soddisfatta"
    - "brief_fields_rendered riconciliato dopo la sostituzione; label i18n del nuovo blocco presente"
    - "Il documento risultante passa parseDocument"

  acceptance_criteria:
    - id: AC-316-1
      given: "un blocco in pagina e un blocco sostitutivo con dati disponibili"
      when: "si sostituisce il blocco"
      then: "il nuovo blocco è reso al posto del vecchio e brief_fields_rendered è coerente"
    - id: AC-316-2
      given: "un candidato la cui precondition dati è falsa"
      when: "si apre la sostituzione"
      then: "quel candidato NON è offerto"
    - id: AC-316-3
      given: "una sostituzione appena eseguita"
      when: "si valida il documento"
      then: "passa parseDocument"

  target_tests:
    - file: "tests/editor-replace-block.test.ts"
      covers: [AC-316-1, AC-316-2, AC-316-3]

  security_notes:
    - "parseDocument sul documento risultante; brief_fields_rendered sincronizzato; label da catalogo i18n"

- id: T-317
  title: "Estendere i payload e2e ostili alla superficie editor (prova sull'effetto)"
  macrotask: "editor-blocks"
  depends_on: [T-311, T-313, T-314]

  objective: >
    Esercitare i payload ostili sulla rotta editor in edit-mode e provare sull'EFFETTO
    (Chromium) che il testo non fidato non produce iniezione, col canary che dimostra che
    lo stesso oracolo sa diventare rosso.

  definition_of_done:
    - "I payload ostili (hostile-brief più eventuali nuovi campi editabili) sono esercitati sulla ROTTA EDITOR in edit-mode"
    - "assertNoInjectionEffect gira sull'editor (contatore, console, richieste off-host, navigazione)"
    - "Canary confinato: marker mai in src/ né nel bundle .next, Chromium-only, suite vitest/e2e disgiunte"

  acceptance_criteria:
    - id: AC-317-1
      given: "l'editor caricato con un documento ostile"
      when: "si asserisce l'effetto sulla pagina editor"
      then: "contatore uguale a 0, nessuna richiesta off-host, nessuna navigazione, nessun errore iniettato"
    - id: AC-317-2
      given: "i payload ostili nell'editor"
      when: "si ispeziona il DOM dell'editor"
      then: "compaiono come TESTO (anti-placebo), a prova che l'oracolo non è vacuo"
    - id: AC-317-3
      given: "il canary insicuro"
      when: "gira lo stesso assertNoInjectionEffect"
      then: "diventa ROSSO (falsificabilità dell'oracolo)"

  target_tests:
    - file: "e2e/editor-hostile.spec.ts"
      covers: [AC-317-1, AC-317-2, AC-317-3]

  security_notes:
    - "Prova sull'EFFETTO in Chromium; estende T-241 alla superficie editor; canary confinato (marker mai in src/ né nel bundle)"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir `docs/blueprint/P3-editor`
  — atteso exit 0 / tutti i controlli OK (`11` §5.1).
- **Semantico** (checklist guidata): `self-check-checklist.md` punti 6–10 su ogni task; i
  rilievi vanno all'human-in-the-loop (`11` §5.2–§5.3).
