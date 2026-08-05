# 01-editor-core — Macrotask `editor-core`

> Modulo del blueprint P3 (Editor inline) di Belora. Un modulo = un macrotask:
> l'unità al cui confine gira il checkpoint (`L-COL-018`) e l'unità di commit
> atomico su git (`L-COL-024`). Task atomici secondo lo schema trueline
> (`L-COL-019`): definition_of_done + acceptance_criteria + target_tests.
> Identificatori in inglese, prosa in italiano. Design a monte:
> `docs/superpowers/specs/2026-08-05-p3-editor-design.md`.

## Obiettivo del macrotask

Introdurre la **scrittura post-scelta** dei contenuti: la persistenza a revisioni
(`site_document_revisions`, RLS riconquistata), la server action che scrive dietro il
gate `parseDocument`, il read-path "ultima revisione else baseline", l'editing **inline**
dei testi con undo client, lo switch tema, i save-point (autosave + esplicito), la
**guardia riscelta soft** non distruttiva, il **ripristino da storia**, l'estensione della disciplina anti-XSS alla
superficie editor, e l'attivazione del contratto di altitudine `architecture:` (P3-D7).
`editor-blocks` (M2) userà questa persistenza e il renderer editabile qui costruiti.

## Task atomici

```yaml
- id: T-301
  title: "Tabella site_document_revisions con RLS per-tenant + FK composita"
  macrotask: "editor-core"
  depends_on: []

  objective: >
    Creare la tabella append-only delle revisioni del documento editato, con Row Level
    Security per-tenant e FK composita verso site_generations, così che l'editor possa
    persistere snapshot del SiteDocument isolati per account.

  definition_of_done:
    - "Migration che crea site_document_revisions (id, site_generation_id, account_id, document jsonb, source, seq, created_at)"
    - "ENABLE ROW LEVEL SECURITY applicato sulla tabella"
    - "Policy SELECT/INSERT che vincolano account_id all'appartenenza (is_account_member); nessuna USING (true)"
    - "FK COMPOSITA (site_generation_id, account_id) verso site_generations (id, account_id)"
    - "Vincolo su source in {generated, edited, rechosen} e UNIQUE (site_generation_id, seq)"
    - "REVOKE ALL sulla tabella FROM anon (le default privileges Supabase concedono REFERENCES/TRIGGER/TRUNCATE ad anon)"

  acceptance_criteria:
    - id: AC-301-1
      given: "la migration è applicata sul DB di test"
      when: "si interroga il catalogo pg per la tabella site_document_revisions"
      then: "row level security risulta abilitata (relrowsecurity = true)"
    - id: AC-301-2
      given: "due account distinti con revisioni ciascuno (fixture con più di un account, valori discordanti, un account_id che è prefisso di un altro)"
      when: "l'account A interroga site_document_revisions"
      then: "riceve solo le proprie righe, mai quelle dell'account B (RLS isola)"
    - id: AC-301-3
      given: "una revisione che riferisce (site_generation_id, account_id) di una generazione di un altro tenant"
      when: "si tenta l'insert"
      then: "la FK composita rifiuta la riga (nessuna scrittura cross-tenant)"
    - id: AC-301-4
      given: "un valore di source fuori dall'enum, oppure due revisioni con lo stesso (site_generation_id, seq)"
      when: "si tenta l'insert"
      then: "il vincolo (CHECK su source / UNIQUE su seq) rifiuta la riga"

  target_tests:
    - file: "tests/site-document-revisions.schema.test.ts"
      covers: [AC-301-1, AC-301-2, AC-301-3, AC-301-4]

  security_notes:
    - "RLS isolation per tenant (OWASP A01:2025) — categoria killer Supabase; nessuna policy USING (true)"
    - "FK composita (site_generation_id, account_id) come difesa in profondità oltre la RLS (anti cross-tenant, lezione T-120 / P2-D19)"
    - "REVOKE ALL FROM anon esplicito: astenersi non basta (default privileges, P2-D19)"

  out_of_scope:
    - "Pointer di pubblicazione esplicito (decisione di P4, P3-D8)"

- id: T-302
  title: "saveRevision: scrittura revisione dietro il gate parseDocument"
  macrotask: "editor-core"
  depends_on: [T-301]

  objective: >
    Esporre una server action che persiste una nuova revisione 'edited' del documento,
    validando il draft col gate parseDocument PRIMA della scrittura e mantenendo
    brief_fields_rendered sincronizzato con data, su client legato alla sessione
    (mai service_role).

  definition_of_done:
    - "Server action saveRevision(siteId, draft) su client di sessione con RLS, mai service_role"
    - "parseDocument(draft) chiamato PRIMA di ogni scrittura (strict, <=8 MiB, slug unici, una home)"
    - "Insert di una revisione source='edited' con seq = max(seq)+1 per la generazione"
    - "brief_fields_rendered di ogni blocco riallineato ai campi di data effettivamente presenti"
    - "Ritorna il documento corrente (la revisione appena scritta)"

  acceptance_criteria:
    - id: AC-302-1
      given: "un draft valido di un sito posseduto dall'utente"
      when: "si chiama saveRevision"
      then: "una revisione 'edited' è scritta con seq incrementato e document uguale al draft"
    - id: AC-302-2
      given: "un draft che rompe un invariante (due home, oltre 8 MiB, slug duplicato)"
      when: "si chiama saveRevision"
      then: "parseDocument rifiuta e NESSUNA riga è scritta"
    - id: AC-302-3
      given: "un utente non proprietario del sito"
      when: "si chiama saveRevision"
      then: "la scrittura è rifiutata (RLS/ownership) e nessuna riga è creata per quel tenant"
    - id: AC-302-4
      given: "un draft in cui un blocco ha data priva del campo X mentre brief_fields_rendered lo elencava"
      when: "si chiama saveRevision"
      then: "brief_fields_rendered della revisione scritta è riallineato ai campi realmente presenti"

  target_tests:
    - file: "tests/save-revision.test.ts"
      covers: [AC-302-1, AC-302-2, AC-302-3, AC-302-4]

  security_notes:
    - "parseDocument come gate in scrittura (OWASP A05:2025): nessun documento non validato persistito"
    - "Client di sessione con RLS, mai service_role; ownership del sito verificata"
    - "brief_fields_rendered è il contratto dei campi non fidati resi: va tenuto sincronizzato (carry-over T-241)"
    - "Slot immagine senza URL di terzi preservato (AC-204-11): il draft non introduce src/href da testo libero"

- id: T-303
  title: "Cap e potatura FIFO delle revisioni (max 20 per sito)"
  macrotask: "editor-core"
  depends_on: [T-302]

  objective: >
    Limitare la storia a 20 revisioni per generazione, potando in modo FIFO le più
    vecchie a ogni nuova scrittura, senza mai toccare la baseline site_generations.document.

  definition_of_done:
    - "Alla scrittura oltre 20 revisioni per (site_generation_id), le più vecchie (seq minore) sono eliminate fino a 20"
    - "La potatura avviene sotto RLS (solo revisioni del proprio tenant)"
    - "site_generations.document (baseline congelata) non è mai toccato dalla potatura"

  acceptance_criteria:
    - id: AC-303-1
      given: "una generazione con 20 revisioni"
      when: "si scrive la 21ª revisione"
      then: "resta esattamente 20 revisioni e la più vecchia (seq minimo) è stata eliminata"
    - id: AC-303-2
      given: "due generazioni distinte con revisioni (fixture con più di un sito, conteggi discordanti, un site_generation_id prefisso di un altro)"
      when: "una supera il cap e viene potata"
      then: "la potatura tocca SOLO quella generazione; l'altra resta intatta"
    - id: AC-303-3
      given: "una generazione al cap"
      when: "avviene la potatura"
      then: "site_generations.document (baseline) resta invariato ed è ancora leggibile come fallback"

  target_tests:
    - file: "tests/revision-pruning.test.ts"
      covers: [AC-303-1, AC-303-2, AC-303-3]

  security_notes:
    - "Potatura sotto RLS: nessuna riga di un altro tenant è mai eliminata"

- id: T-304
  title: "Read-path: ultima revisione else baseline"
  macrotask: "editor-core"
  depends_on: [T-302]

  objective: >
    Aggiornare readGenerationDocument perché ritorni la revisione con seq massimo se
    esiste, altrimenti la baseline congelata site_generations.document, così che anteprima
    ed editor leggano il contenuto editato senza rompere il percorso pre-editing.

  definition_of_done:
    - "readGenerationDocument ritorna la revisione con seq massimo del sito, se presente"
    - "Con zero revisioni ritorna site_generations.document (baseline): comportamento pre-editing invariato"
    - "La selezione del corrente usa seq (non created_at), deterministica a timestamp uguali"
    - "Lettura su client di sessione (RLS), mai service_role"

  acceptance_criteria:
    - id: AC-304-1
      given: "un sito senza alcuna revisione"
      when: "si legge il documento"
      then: "si ottiene la baseline site_generations.document"
    - id: AC-304-2
      given: "un sito con più revisioni (fixture con più di una revisione, document discordanti, seq crescenti)"
      when: "si legge il documento"
      then: "si ottiene la revisione con seq massimo"
    - id: AC-304-3
      given: "due revisioni con created_at identico e seq diverso"
      when: "si legge il documento"
      then: "vince la revisione con seq maggiore (ordinamento deterministico per seq)"
    - id: AC-304-4
      given: "un sito di un altro tenant"
      when: "si legge il documento con il client di sessione"
      then: "non si ottiene mai una sua revisione (RLS)"

  target_tests:
    - file: "tests/read-generation-document.test.ts"
      covers: [AC-304-1, AC-304-2, AC-304-3, AC-304-4]

  security_notes:
    - "Lettura sotto RLS con client di sessione, mai service_role (isolamento per tenant)"

- id: T-305
  title: "SiteView modalità editable + isola client EditableText"
  macrotask: "editor-core"
  depends_on: []

  objective: >
    Estendere il renderer unico SiteView con una modalità editable in cui gli slot di
    testo sono resi dentro un client component EditableText, mantenendo il testo come
    children React (escaping preservato) e senza mai duplicare il renderer né usare
    innerHTML.

  definition_of_done:
    - "SiteView accetta una prop editable; in modalità read-only il rendering è identico a P2 (parità)"
    - "In modalità editable ogni slot di testo è reso dentro un client component EditableText (block, slot)"
    - "Il testo non fidato resta children React; nessun dangerouslySetInnerHTML nella superficie editor"
    - "Ogni isola porta block id e slot id per il mapping isola verso campo del documento"

  acceptance_criteria:
    - id: AC-305-1
      given: "un documento con testo ostile (es. tag script, attributo onerror)"
      when: "SiteView rende in modalità editable"
      then: "il testo è reso come TESTO (escaping React), mai interpretato come markup"
    - id: AC-305-2
      given: "SiteView in modalità read-only e in modalità editable sullo stesso documento"
      when: "si confronta il contenuto testuale reso"
      then: "il contenuto coincide (l'editabilità non cambia cosa si vede)"
    - id: AC-305-3
      given: "un'isola EditableText di uno slot"
      when: "si ispeziona l'isola"
      then: "espone block id e slot id che identificano univocamente il campo del documento"

  target_tests:
    - file: "tests/siteview-editable.test.ts"
      covers: [AC-305-1, AC-305-2, AC-305-3]

  security_notes:
    - "Escaping React come unica strada; nessun dangerouslySetInnerHTML; nessun href/src da testo libero (disciplina T-241 preservata)"
    - "Renderer UNICO: nessuna ri-implementazione client del rendering dei blocchi (P2-D8)"

- id: T-306
  title: "Estendere lo scan statico anti-XSS alla superficie editor"
  macrotask: "editor-core"
  depends_on: [T-305]

  objective: >
    Portare il walk statico che vieta dangerouslySetInnerHTML e i colori letterali sulla
    nuova superficie src/ui/editor, con uno scanner falsificabile, così che un sink
    pericoloso introdotto nell'editor faccia fallire la CI invece di passare in silenzio.

  definition_of_done:
    - "Il walk statico copre src/ui/editor (estensione di site-blocks-style o test gemello con lo stesso scanner)"
    - "Fallisce se un file della superficie editor contiene dangerouslySetInnerHTML o un colore letterale (HEX/RGB/HSL)"
    - "Include un test di falsificabilità: gli scanner riconoscono le forme vietate e non scattano su var(--site-...)"

  acceptance_criteria:
    - id: AC-306-1
      given: "un dangerouslySetInnerHTML introdotto in un file di src/ui/editor"
      when: "gira lo scan statico"
      then: "il test FALLISCE"
    - id: AC-306-2
      given: "un colore letterale (es. un valore esadecimale) introdotto in src/ui/editor"
      when: "gira lo scan statico"
      then: "il test FALLISCE"
    - id: AC-306-3
      given: "codice che usa solo var(--site-...) e nessun sink pericoloso"
      when: "gira lo scan statico"
      then: "il test PASSA (nessun falso positivo)"
    - id: AC-306-4
      given: "lo scanner stesso"
      when: "si verifica la sua falsificabilità con le forme vietate assemblate a runtime"
      then: "le riconosce e non si auto-falsa"

  target_tests:
    - file: "tests/editor-style-scan.test.ts"
      covers: [AC-306-1, AC-306-2, AC-306-3, AC-306-4]

  security_notes:
    - "Chiude il rischio n.1 di P3: una superficie di render non sorvegliata fuori da src/ui/site"
    - "Scanner falsificabile: prima di credere al verde, prova che sa diventare rosso"

- id: T-307
  title: "Stato draft dell'editor + undo/redo client sui testi"
  macrotask: "editor-core"
  depends_on: [T-305]

  objective: >
    Tenere il SiteDocument di lavoro in stato client, applicare le modifiche inline degli
    slot di testo al draft, e offrire uno stack undo/redo in memoria, con le modifiche
    riflesse in anteprima tramite le isole.

  definition_of_done:
    - "L'editor mantiene un draft del SiteDocument in stato client"
    - "Modificare uno slot di testo aggiorna SOLO quel campo del draft"
    - "Stack undo/redo in memoria: undo ripristina lo stato precedente, redo lo riapplica"
    - "Le modifiche di testo si riflettono nell'anteprima (isole) senza round-trip server"

  acceptance_criteria:
    - id: AC-307-1
      given: "un draft con più blocchi e slot (fixture con più di un blocco, valori discordanti, uno slot id prefisso di un altro)"
      when: "si modifica il testo di uno slot"
      then: "nel draft cambia solo quel campo; gli altri restano invariati"
    - id: AC-307-2
      given: "una sequenza di modifiche"
      when: "si esegue undo"
      then: "il draft torna allo stato immediatamente precedente"
    - id: AC-307-3
      given: "un undo appena eseguito"
      when: "si esegue redo"
      then: "la modifica annullata è riapplicata"

  target_tests:
    - file: "tests/editor-draft-state.test.ts"
      covers: [AC-307-1, AC-307-2, AC-307-3]

  security_notes:
    - "Il draft resta struttura dati/testo, mai HTML serializzato (niente WYSIWYG che memorizzi markup)"

- id: T-308
  title: "Switch tema fra i 5 via CSS custom properties"
  macrotask: "editor-core"
  depends_on: [T-307]

  objective: >
    Permettere di scegliere fra i 5 temi versionati, aggiornando theme_id nel draft e i
    valori delle CSS custom property alla radice, senza toccare i blocchi (che usano solo
    var(--site-...)).

  definition_of_done:
    - "Il chrome editor offre la scelta fra i 5 temi del catalogo versionato"
    - "Scegliere un tema aggiorna theme_id nel draft e le CSS custom property (--site-*) alla radice"
    - "I blocchi non cambiano codice: leggono solo var(--site-...)"
    - "Un theme_id la cui versione non esiste è gestito con errore/fallback esplicito, mai var indefinite"

  acceptance_criteria:
    - id: AC-308-1
      given: "l'editor su un documento"
      when: "si sceglie un altro dei 5 temi"
      then: "theme_id nel draft è aggiornato e le custom property alla radice riflettono il tema scelto"
    - id: AC-308-2
      given: "il selettore di tema"
      when: "si elencano le scelte disponibili"
      then: "sono esattamente i 5 temi del catalogo (nessun valore libero)"
    - id: AC-308-3
      given: "un theme_id versionato non più esistente"
      when: "si risolve il tema per il render"
      then: "si ottiene un errore/fallback esplicito, non un collasso silenzioso delle var"

  target_tests:
    - file: "tests/editor-theme-switch.test.ts"
      covers: [AC-308-1, AC-308-2, AC-308-3]

  security_notes:
    - "Nessun input libero nei valori del tema: solo i 5 dal catalogo versionato (nessuna iniezione via stile)"

- id: T-309
  title: "Save-point: autosave con debounce + salvataggio esplicito"
  macrotask: "editor-core"
  depends_on: [T-302, T-307]

  objective: >
    Persistere una revisione ai save-point — autosave con debounce dopo l'inattività e
    pulsante Salva esplicito — passando sempre dal gate di saveRevision, con indicatore
    di stato salvato.

  definition_of_done:
    - "Autosave con debounce: una sola revisione persistita per burst di modifiche dopo l'inattività"
    - "Pulsante Salva esplicito che persiste immediatamente"
    - "Ogni save passa da saveRevision (gate parseDocument); un draft invalido non produce revisione e lo segnala"
    - "Indicatore di stato: salvato / in salvataggio / errore"

  acceptance_criteria:
    - id: AC-309-1
      given: "una raffica di modifiche seguita da un intervallo di inattività"
      when: "scatta l'autosave"
      then: "è persistita UNA sola revisione per quel burst (debounce)"
    - id: AC-309-2
      given: "modifiche non ancora salvate"
      when: "si preme Salva"
      then: "è persistita subito una revisione"
    - id: AC-309-3
      given: "un draft che non supera parseDocument"
      when: "scatta un save (autosave o esplicito)"
      then: "NESSUNA revisione è scritta e l'utente vede lo stato di errore"

  target_tests:
    - file: "tests/editor-autosave.test.ts"
      covers: [AC-309-1, AC-309-2, AC-309-3]

  security_notes:
    - "Ogni scrittura passa da saveRevision (RLS, parseDocument): nessun bypass del gate dall'autosave"

- id: T-310
  title: "Guardia riscelta soft: revisione rechosen non distruttiva"
  macrotask: "editor-core"
  depends_on: [T-302]

  objective: >
    Rendere la riscelta non distruttiva dopo l'editing — creare una revisione 'rechosen'
    dal design fresco lasciando le revisioni editate leggibili in storia — preservando la
    conferma-di-costo AC-233-4 per il caso da 'complete' e il CAS TOCTOU-safe.

  definition_of_done:
    - "selectVariant/applyRechoose estesi: dopo edit manuale la riscelta crea una revisione source='rechosen' dal documento fresco"
    - "Le revisioni 'edited' precedenti restano leggibili in storia (non distruttivo)"
    - "Conferma rassicurante in UI che nomina la conservazione delle modifiche in storia"
    - "Conferma-di-costo AC-233-4 preservata per la riscelta da 'complete'; CAS .eq(status, fromStatus) preservato"

  acceptance_criteria:
    - id: AC-310-1
      given: "un sito con revisioni 'edited'"
      when: "l'utente risceglie una variante"
      then: "è creata una revisione 'rechosen' e le revisioni 'edited' precedenti restano leggibili in storia"
    - id: AC-310-2
      given: "una riscelta dallo stato 'complete' senza confirm uguale a true"
      when: "si invoca l'azione"
      then: "non procede (reason conferma_richiesta) e nulla è scritto (AC-233-4 invariato)"
    - id: AC-310-3
      given: "lo stato letto come 'chosen' ma avanzato nel frattempo"
      when: "applyRechoose tenta il CAS con .eq(status, fromStatus)"
      then: "tocca 0 righe (nessun reset silenzioso di un sito completo)"

  target_tests:
    - file: "tests/rechoose-nondestructive.test.ts"
      covers: [AC-310-1, AC-310-2, AC-310-3]

  security_notes:
    - "RLS ownership; CAS TOCTOU-safe (.eq status fromStatus) preservato (P2-D23)"
    - "parseDocument sul documento 'rechosen'; invariante home-unica riverificata"

- id: T-311
  title: "Rotta /[locale]/editor/[siteId] con guardia ownership"
  macrotask: "editor-core"
  depends_on: [T-304, T-305]

  objective: >
    Esporre la rotta dell'editor protetta da enterSiteRoute, che rende SiteView in
    modalità editable dal documento corrente (ultima revisione else baseline), su client
    di sessione e mai service_role.

  definition_of_done:
    - "Rotta /[locale]/editor/[siteId] protetta da enterSiteRoute (locale allowlist, getUser, ownership via listSites sotto RLS, notFound anti-enumerazione)"
    - "Rende SiteView in modalità editable dal documento corrente (T-304)"
    - "Client di sessione, mai service_role"

  acceptance_criteria:
    - id: AC-311-1
      given: "l'utente proprietario del sito"
      when: "apre /[locale]/editor/[siteId]"
      then: "riceve 200 e l'editor è reso dal documento corrente"
    - id: AC-311-2
      given: "un siteId non posseduto o inesistente"
      when: "si apre la rotta"
      then: "risponde notFound (anti-enumerazione P1-D21), mai un errore distinguibile per esistenza"
    - id: AC-311-3
      given: "un utente non autenticato"
      when: "apre la rotta"
      then: "è rediretto a /login"
    - id: AC-311-4
      given: "un locale fuori dall'allowlist"
      when: "apre la rotta"
      then: "è gestito dalla guardia di locale (nessun render con locale arbitrario)"

  target_tests:
    - file: "tests/editor-route-guard.test.ts"
      covers: [AC-311-1, AC-311-2, AC-311-3, AC-311-4]

  security_notes:
    - "enterSiteRoute: ownership sotto RLS, notFound anti-enumerazione (P1-D21), getUser che rivalida il token"
    - "Client di sessione, mai service_role"

- id: T-312
  title: "Attivazione del contratto di altitudine architecture: (P1-D11 / P3-D7)"
  macrotask: "editor-core"
  depends_on: [T-305, T-311]

  objective: >
    Attivare il contratto di altitudine dichiarando il blocco architecture: in 00-INDEX
    (strati ui/domain/data/app e dipendenze vietate) e pinnando la purezza del domain con
    un test contro il grafo import reale, così che una violazione di layering diventi rossa.

  definition_of_done:
    - "Blocco architecture: dichiarato in 00-INDEX con layers (ui/domain/data/app) e forbidden (domain verso ui/data/app, data verso ui)"
    - "Un test asserisce che il grafo import reale non viola le regole forbidden"
    - "Il test è falsificabile: un import vietato deliberato lo fa fallire"

  acceptance_criteria:
    - id: AC-312-1
      given: "il grafo import reale del repo"
      when: "si verificano le regole forbidden del contratto"
      then: "non c'è alcuna violazione (verde)"
    - id: AC-312-2
      given: "un import vietato introdotto deliberatamente (es. un modulo di src/domain che importa da src/ui)"
      when: "gira il controllo di altitudine"
      then: "diventa ROSSO"
    - id: AC-312-3
      given: "ogni regola forbidden del contratto"
      when: "si mappano from e to sui moduli reali"
      then: "ciascuna regola mappa ad almeno un modulo reale (nessuna regola vacua)"

  target_tests:
    - file: "tests/architecture-contract.test.ts"
      covers: [AC-312-1, AC-312-2, AC-312-3]

- id: T-318
  title: "Ripristina una revisione dalla storia (non distruttivo)"
  macrotask: "editor-core"
  depends_on: [T-302, T-304]

  objective: >
    Esporre un'azione che ripristina una revisione passata creando una NUOVA revisione
    (seq massimo+1) copia del suo documento, così che la storia sia navigabile e
    ripristinabile cross-sessione senza mai distruggere le revisioni esistenti (append-only,
    "ultima vince").

  definition_of_done:
    - "Azione restoreRevision(siteId, revisionSeq) che legge la revisione target sotto RLS e scrive una NUOVA revisione copia del suo document con seq = massimo+1"
    - "Il ripristino passa da parseDocument (il documento ripristinato è ri-validato)"
    - "Nessuna revisione esistente è eliminata o mutata (append-only); la storia resta leggibile"
    - "L'editor può elencare le revisioni della generazione (seq, source, created_at) per la scelta"

  acceptance_criteria:
    - id: AC-318-1
      given: "una generazione con più revisioni (fixture con più di una revisione, document discordanti, seq distinti)"
      when: "si ripristina la revisione con seq K"
      then: "è scritta una NUOVA revisione con seq massimo+1 e document uguale a quello di K; il documento corrente diventa quello di K"
    - id: AC-318-2
      given: "un ripristino appena eseguito"
      when: "si ispezionano le revisioni della generazione"
      then: "nessuna revisione precedente è stata eliminata o modificata (append-only)"
    - id: AC-318-3
      given: "un revisionSeq di un'altra generazione o di un altro tenant"
      when: "si chiama restoreRevision"
      then: "è rifiutato (RLS/ownership) e nessuna revisione è scritta"
    - id: AC-318-4
      given: "un ripristino"
      when: "la nuova revisione è scritta"
      then: "passa parseDocument (documento valido: una home, entro 8 MiB, slug unici)"

  target_tests:
    - file: "tests/restore-revision.test.ts"
      covers: [AC-318-1, AC-318-2, AC-318-3, AC-318-4]

  security_notes:
    - "restoreRevision sotto RLS (client di sessione, mai service_role); ownership verificata"
    - "parseDocument sul documento ripristinato; append-only: nessuna mutazione/eliminazione di revisioni esistenti"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir `docs/blueprint/P3-editor`
  — atteso exit 0 / tutti i controlli OK (`11` §5.1).
- **Semantico** (checklist guidata): `self-check-checklist.md` punti 6–10 su ogni task; i
  rilievi vanno all'human-in-the-loop (`11` §5.2–§5.3).
