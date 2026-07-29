# 02-generation-engine — Macrotask `generation-engine` · La trasformazione pura

> Modulo del blueprint P2 (Generazione dei mockup) di Belora. Un modulo = un macrotask:
> l'unita al cui confine gira il checkpoint e l'unita di commit atomico.
> Task atomici secondo lo schema trueline (id/AC/target_tests/security_notes).
>
> **Substrato P0+P1 (gia costruito, non nel DAG P2 — `P2-D18`):** schema di dominio del
> Brief `src/domain/onboarding/brief.ts` (T-121/T-122) con `BRIEF_LIMITS`, `emptyBrief`,
> `isBriefComplete`; design system dell'app (`src/ui/theme/tokens.ts`, primitive) — che
> questo macrotask deve tenere **separato** dai temi del sito generato; cataloghi i18n
> IT/ES di P0.

## Obiettivo del macrotask

Il **cuore di P2**, e il posto dove vive la garanzia: e tutto **codice puro e
deterministico**, quindi e l'unico strato con oracoli veri finche non esiste una chiave
API. La libreria di blocchi con le loro precondizioni sui dati, i cinque temi di P2 come
layer separato e **imposto**, le cinque ricette (che sono le cinque direzioni fra cui
l'utente scegle), la derivazione del set di pagine con la sua navigazione, la funzione
`resolve` che costruisce il documento, e la nozione di *generabile* propria di P2.

Qui non si chiama nessun modello e non si tocca nessun DB. E' per questo che la promessa
"risultati brutti strutturalmente impossibili" e verificabile.

## Task atomici

```yaml
- id: T-210
  title: "Libreria dei blocchi con precondizioni sui dati e ruoli di pagina"
  macrotask: "generation-engine"
  depends_on: [T-201]
  objective: >
    Definire in src/domain/generation/blocks.ts il catalogo dei blocchi del sito (hero,
    offerte, chi-siamo, orari, contatti/mappa, recensioni, FAQ, CTA WhatsApp) — gli otto
    della spec di design §7. La GALLERIA e FUORI dal catalogo v1 (P2-D24): in v1 le
    immagini sono imagery del tema (P2-D12), quindi un blocco galleria non avrebbe ne
    dati del brief ne prosa del modello, cioe sarebbe il blocco-segnaposto che P2-D7
    vieta. Rientra quando esistera l'upload (source 'uploaded', gia tipizzato in T-202).
    Ogni blocco dichiara: id stabile, i ruoli di pagina in cui puo comparire, gli slot di
    contenuto che consuma (dal catalogo di T-201), i campi del brief che rende
    DIRETTAMENTE (senza passare dal modello), e una PRECONDIZIONE sui dati del brief che
    determina se il blocco esiste. Esportare blocksFor(brief, pageRole) che ritorna i soli
    blocchi la cui precondizione e soddisfatta, e slotsForBlocks(blocks) che ritorna
    l'unione esatta dei loro slot. Il blocco offerte si specializza per `vertical`
    (etichetta, layout, presenza del prezzo). Funzioni pure.
  definition_of_done:
    - "Modulo src/domain/generation/blocks.ts con il catalogo BLOCKS esportato"
    - "Ogni voce del catalogo dichiara: id, page_roles (lista non vuota), slots (id dal catalogo di T-201), brief_fields_rendered (i campi resi direttamente), precondition(brief) -> boolean"
    - "blocksFor(brief, pageRole) esportata: ritorna solo i blocchi con precondizione soddisfatta per quel ruolo, in ordine dichiarato"
    - "slotsForBlocks(blocks) esportata: unione esatta degli slot dei blocchi passati, senza duplicati e senza slot estranei"
    - "Il blocco offerte espone varianti per vertical ('ristorazione' | 'fitness' | 'salone_studio' | 'negozio_artigiano' | 'altro') che differiscono per etichetta, layout e presenza del prezzo"
    - "Il record delle varianti per vertical e TOTALE sul tipo di BRIEF vertical: un vertical nuovo in T-121 rompe il typecheck e obbliga a decidere"
    - "Nessun blocco produce un segnaposto: un blocco senza precondizione soddisfatta non compare nel risultato"
  acceptance_criteria:
    - id: AC-210-1
      given: "un brief con hours vuoto e un brief identico con hours valorizzato"
      when: "chiamo blocksFor(brief, 'home') sui due"
      then: "il blocco orari e ASSENTE dal primo risultato (non presente-e-vuoto) e PRESENTE nel secondo"
    - id: AC-210-2
      given: "due brief identici tranne vertical='ristorazione' e vertical='salone_studio', entrambi con tre offerte"
      when: "risolvo la variante del blocco offerte per ciascuno"
      then: "le due varianti differiscono almeno per l'etichetta e per la presenza del prezzo, e nessuna delle due e la variante generica"
    - id: AC-210-3
      given: "un brief con vertical='altro' e tre offerte"
      when: "risolvo la variante del blocco offerte"
      then: "si ottiene la variante GENERICA, perche 'altro' e l'assenza di scelta e non un verticale (emptyBrief lo porta comunque)"
    - id: AC-210-4
      given: "una lista di tre blocchi che dichiarano complessivamente cinque slot distinti, di cui uno condiviso da due blocchi"
      when: "chiamo slotsForBlocks su quella lista"
      then: "il risultato contiene esattamente i cinque slot, senza duplicati e senza alcuno slot non dichiarato da quei blocchi"
    - id: AC-210-5
      given: "un brief con content.offerings vuoto e uno con cinque offerte discordanti (nomi diversi, una con prezzo e una senza, una con sezione)"
      when: "chiamo blocksFor su entrambi"
      then: "il blocco offerte e assente nel primo e presente nel secondo, e la sua risoluzione elenca tutte e cinque le offerte nell'ordine del brief"
    - id: AC-210-6
      given: "il catalogo BLOCKS"
      when: "itero su tutte le sue voci"
      then: "ogni voce ha page_roles non vuoto, slots che esistono tutti nel catalogo di T-201, e una precondition che e una funzione — nessuna voce e priva di uno dei tre"
  target_tests:
    - file: "tests/generation-blocks.test.ts"
      covers: [AC-210-1, AC-210-2, AC-210-3, AC-210-4, AC-210-5, AC-210-6]
  security_notes:
    - "OWASP A05:2025: brief_fields_rendered e la dichiarazione ESPLICITA di quali campi del brief ogni blocco rende direttamente, cioe di dove passa il testo NON FIDATO proveniente da fromUrl (T-141). E' il contratto che T-231 deve sanificare: senza questa dichiarazione la superficie di rendering sarebbe implicita."
    - "P2-D7 come proprieta del codice: un blocco senza base dati non esiste, quindi il modello non riceve nemmeno lo slot corrispondente (T-220) e non ha la possibilita di inventare la sezione. La visione §5 vieta di inventare; qui il divieto e strutturale, non una frase nel prompt."
    - "Trappola del test (correzione di metodo n.1 di P1): le fixture usano PIU DI UNA offerta con valori DISCORDANTI (AC-210-5) — una fixture con un solo elemento non prova nulla sull'identita di quell'elemento."
  out_of_scope:
    - "Componenti React dei blocchi e sanificazione in rendering (T-231)"
    - "Composizione in ricette (T-212)"
    - "Derivazione del set di pagine (T-213)"

- id: T-211
  title: "I 5 temi di P2 + separazione imposta dal design system dell'app"
  macrotask: "generation-engine"
  depends_on: []
  objective: >
    Definire in src/domain/generation/themes.ts cinque set di token completi e distinti
    (colori, tipografia, spaziature, raggi) che appartengono al SITO GENERATO e non al
    chrome del builder. La separazione dai token dell'app (src/ui/theme/tokens.ts) non e
    una convenzione ma un vincolo IMPOSTO: una regola ESLint no-restricted-imports vieta a
    src/ui/site/** di importare src/ui/theme/tokens, con lo stesso meccanismo che P1-D7 usa
    per il confine LLM. Senza questa regola, ritoccare il design system del builder
    cambierebbe i siti pubblicati dei clienti.
  definition_of_done:
    - "Modulo src/domain/generation/themes.ts con cinque temi esportati, ciascuno con id stabile e versionato"
    - "Ogni tema dichiara lo stesso insieme di chiavi di token (colori, famiglia tipografica, scala tipografica, spaziature, raggi); il tipo e totale, quindi un tema incompleto rompe il typecheck"
    - "I valori dei temi sono propri di P2: nessun valore e un riferimento ai token dell'app (nessun var(--color-*) del design system del builder)"
    - "Regola ESLint no-restricted-imports che vieta a src/ui/site/** di importare src/ui/theme/tokens (e i suoi path equivalenti)"
    - "La regola e verificata da un test che esegue ESLint su un modulo-fixture in violazione e ne asserisce il report"
  acceptance_criteria:
    - id: AC-211-1
      given: "il modulo dei temi"
      when: "itero sui cinque temi e ne confronto le chiavi di token"
      then: "sono esattamente cinque, e ciascuno espone lo stesso insieme di chiavi senza chiavi mancanti"
    - id: AC-211-2
      given: "i cinque temi"
      when: "confronto a coppie i loro token di colore"
      then: "nessuna coppia di temi ha la stessa palette: le dieci coppie differiscono tutte su almeno un token di colore"
    - id: AC-211-3
      given: "i cinque temi"
      when: "cerco nei loro valori un riferimento ai token del design system dell'app"
      then: "nessun valore contiene un riferimento alle custom property dell'app: i temi del sito generato sono indipendenti dal chrome del builder"
    - id: AC-211-4
      given: "un modulo-fixture collocato sotto src/ui/site/ che importa src/ui/theme/tokens"
      when: "eseguo ESLint su quel file con la configurazione del progetto"
      then: "ESLint riporta un errore di import vietato per quel file; e lo stesso import da un modulo NON sotto src/ui/site/ non produce errore (la regola e mirata, non globale)"
    - id: AC-211-5
      given: "un tema a cui manca una chiave di token"
      when: "eseguo il typecheck del progetto"
      then: "il typecheck falla su quel tema (il tipo dei temi e totale sulle chiavi)"
  target_tests:
    - file: "tests/generation-themes.test.ts"
      covers: [AC-211-1, AC-211-2, AC-211-3, AC-211-5]
    - file: "tests/generation-theme-isolation.test.ts"
      covers: [AC-211-4]
  security_notes:
    - "Integrita dell'artefatto del cliente (P2-D14): senza la regola ESLint, un'evoluzione del design system del builder si propagherebbe ai siti gia scelti e pubblicati dei clienti. La separazione e imposta dal meccanismo, non sorvegliata dalla disciplina — lo stesso pattern di P1-D7 per il confine LLM."
    - "Nota di framing (L-COL-006): questi controlli NON asseriscono che i temi siano belli. Asseriscono che il layer dei temi e davvero cablato e distinto. Lo stile resta non oracolabile (P1 §6-bis p.8) e va dichiarato tale."
  out_of_scope:
    - "Applicazione dei temi nel rendering (T-231)"
    - "Accoppiamento tema-ricetta (T-212)"
    - "brand_hints come selettore di tema: escluso in v1 per non aprire un canale dal testo non fidato"

- id: T-212
  title: "Le 5 ricette: direzioni della home + composizione delle pagine interne"
  macrotask: "generation-engine"
  depends_on: [T-210, T-211]
  objective: >
    Definire in src/domain/generation/recipes.ts le cinque DIREZIONI fra cui l'utente
    scegle. Ogni ricetta ha un id stabile e versionato, una sequenza ordinata di blocchi
    per la home, un tema associato (T-211), e le regole di composizione delle pagine
    interne (quali blocchi vanno in quale ruolo di pagina). Le ricette sono dichiarate a
    mano da noi e non inventate dal modello (P2-D1): e qui che la garanzia di bellezza
    diventa codice. Cinque direzioni UNIVERSALI, non cinque per verticale: la
    specializzazione vive nel blocco offerte (T-210). Funzioni pure.
  definition_of_done:
    - "Modulo src/domain/generation/recipes.ts con cinque ricette esportate, ciascuna con id stabile e VERSIONATO"
    - "Ogni ricetta dichiara: home_blocks (sequenza ordinata di id del catalogo T-210), theme_id (uno dei cinque di T-211), inner_page_rules (per ruolo di pagina, quali blocchi comporre e in quale ordine)"
    - "Ogni ricetta e accoppiata a un tema DISTINTO: le cinque ricette usano cinque temi diversi"
    - "recipeFor(recipeId) e applyRecipe(recipe, brief, pageRole) esportate: applyRecipe scarta i blocchi la cui precondizione non e soddisfatta PRESERVANDO l'ordine dichiarato"
    - "Ogni id di blocco e ogni ruolo di pagina citati dalle ricette esistono nei rispettivi cataloghi"
  acceptance_criteria:
    - id: AC-212-1
      given: "il modulo delle ricette"
      when: "elenco le ricette e i loro id"
      then: "sono esattamente cinque, con id distinti e versionati, e ciascuna cita un theme_id distinto dalle altre quattro"
    - id: AC-212-2
      given: "un brief ricco per cui tutti i blocchi della home soddisfano la precondizione"
      when: "applico le cinque ricette allo stesso brief per il ruolo home"
      then: "le cinque sequenze di blocchi risultanti sono a due a due DIVERSE (non solo per tema): esiste almeno una coppia di blocchi il cui ordine relativo o la cui presenza cambia fra due ricette qualsiasi"
    - id: AC-212-3
      given: "le cinque ricette"
      when: "verifico ogni id di blocco e ogni ruolo di pagina citati"
      then: "tutti esistono nel catalogo BLOCKS (T-210) e nell'insieme dei ruoli di pagina; nessun riferimento pende"
    - id: AC-212-4
      given: "una ricetta la cui home dichiara i blocchi [A, B, C] e un brief in cui la precondizione di B non e soddisfatta"
      when: "chiamo applyRecipe"
      then: "il risultato e [A, C] nell'ordine dichiarato: B e scartato, non sostituito da un segnaposto, e A e C non si riordinano"
    - id: AC-212-5
      given: "la stessa ricetta e lo stesso brief"
      when: "chiamo applyRecipe due volte"
      then: "i due risultati sono identici (la composizione e deterministica)"
  target_tests:
    - file: "tests/generation-recipes.test.ts"
      covers: [AC-212-1, AC-212-2, AC-212-3, AC-212-4, AC-212-5]
  security_notes:
    - "P2-D1 come proprieta del codice: la struttura del sito e dichiarata da noi e non scelta dal modello, quindi un'iniezione riuscita nel testo del brief NON puo alterare la struttura del sito generato. E' la prima delle leve che il modello non ha (l'altra e il tema)."
    - "Gli id delle ricette sono VERSIONATI perche il documento congelato (T-202) li registra: e cosi che un ritocco futuro a una ricetta non riscrive un sito gia scelto."
  out_of_scope:
    - "Derivazione di QUALI pagine esistono (T-213)"
    - "Costruzione del documento (T-214)"
    - "Rendering (T-231)"

- id: T-213
  title: "pagesFor: set di pagine derivato dai dati + navigazione e link interni"
  macrotask: "generation-engine"
  depends_on: [T-210]
  objective: >
    Definire in src/domain/generation/pages.ts la funzione pura pagesFor(brief,
    { maxPages }) che DERIVA il set di pagine dai dati del brief (P2-D13): la home esiste
    sempre; ogni altra pagina ha una precondizione sui dati come i blocchi, e se non e
    soddisfatta la pagina NON ESISTE. Le pagine sono ordinate per priorita dichiarata, e
    maxPages taglia in quell'ordine. Sotto il minimo di pagine il sito resta una ONE-PAGER:
    le sezioni tornano nella home invece di diventare pagine sottili. La navigazione e i
    link interni sono DERIVATI dal set, mai scritti dal modello: una pagina che non esiste
    non puo essere linkata da nessuna parte.
  definition_of_done:
    - "Modulo src/domain/generation/pages.ts con pagesFor(brief, { maxPages }) -> PageSpec[] e navigationFor(pageSpecs) esportate"
    - "PAGE_CATALOG dichiarato: per ogni ruolo di pagina, slug, priorita, precondizione sui dati del brief, e i blocchi che la compongono"
    - "PAGES_MIN in costante nominata: sotto questa soglia di pagine superstiti il risultato e la sola home in forma one-pager (le sezioni rientrano nella home)"
    - "La home e sempre presente nel risultato, per qualunque brief confermato"
    - "maxPages taglia le pagine in ordine di priorita decrescente, in modo deterministico"
    - "navigationFor produce una voce per ciascuna pagina del set e per nessun'altra; ogni destinazione di link interno e uno slug presente nel set"
  acceptance_criteria:
    - id: AC-213-1
      given: "il brief piu povero che possa essere 'confirmed' (solo business_name, primary_goal, locale, vertical al default)"
      when: "chiamo pagesFor(brief, { maxPages: 10 })"
      then: "il risultato contiene esattamente una pagina, di ruolo home, in forma one-pager"
    - id: AC-213-2
      given: "un brief con hours vuoto, nessuna recensione, e sei offerte in due sezioni"
      when: "chiamo pagesFor(brief, { maxPages: 10 })"
      then: "la pagina orari e la pagina recensioni sono ASSENTI dal set, la pagina offerte e PRESENTE, e nessuna pagina assente compare come voce vuota"
    - id: AC-213-3
      given: "un brief la cui ricchezza produce un numero di pagine superstiti inferiore a PAGES_MIN"
      when: "chiamo pagesFor"
      then: "il risultato e la sola home in forma one-pager, e i blocchi che sarebbero stati pagine compaiono come sezioni della home (nessuna pagina sottile viene prodotta)"
    - id: AC-213-4
      given: "un brief ricco che produrrebbe otto pagine"
      when: "chiamo pagesFor(brief, { maxPages: 1 })"
      then: "il risultato e la sola home, indipendentemente dalla ricchezza dei dati (maxPages e il giunto verso P5)"
    - id: AC-213-5
      given: "lo stesso brief ricco"
      when: "chiamo pagesFor(brief, { maxPages: 3 }) due volte"
      then: "entrambe le chiamate ritornano le stesse tre pagine, che sono le tre di priorita piu alta fra le superstiti (taglio deterministico e in ordine, non arbitrario)"
    - id: AC-213-6
      given: "un set di pagine ottenuto da un brief con maxPages=3, di cui una pagina potenziale e stata scartata"
      when: "chiamo navigationFor su quel set e raccolgo tutte le destinazioni dei link interni"
      then: "ogni destinazione e lo slug di una pagina presente nel set, e non esiste alcuna voce o link verso lo slug della pagina scartata (nessun 404 interno)"
  target_tests:
    - file: "tests/generation-pages.test.ts"
      covers: [AC-213-1, AC-213-2, AC-213-3, AC-213-4, AC-213-5, AC-213-6]
  security_notes:
    - "Integrita del deliverable: AC-213-6 rende un 404 interno IRRAPPRESENTABILE invece che sorvegliato — la navigazione e derivata dallo stesso set che genera le pagine, quindi non puo divergere."
    - "P2-D13 e il gate di qualita della visione §10.3-B applicato al nostro stesso prodotto: pubblicare pagine sottili e il comportamento che il Google June 2026 Spam Update punisce, e qui e strutturalmente impossibile (AC-213-3), non scoraggiato da una linea guida."
    - "Il modello non emette URL ne nomi di pagina (coerente con P2-D4, nessuna leva in uscita): la struttura del sito non e influenzabile dal testo non fidato del brief."
  out_of_scope:
    - "Generazione del contenuto delle pagine (T-234 per la fase 2)"
    - "Definizione di maxPages dai piani: P5"
    - "Rendering della navigazione (T-231/T-235)"

- id: T-214
  title: "resolve: da pool + ricetta + tema al SiteDocument (puro, deterministico)"
  macrotask: "generation-engine"
  depends_on: [T-202, T-212, T-213]
  objective: >
    Definire in src/domain/generation/resolve.ts la funzione pura
    resolve(pool, recipe, theme, brief, pageSpecs) che costruisce il SiteDocument (T-202):
    per ciascuna pagina del set applica la ricetta, riempie gli slot dei blocchi col
    contenuto del pool, e incorpora i campi del brief che i blocchi rendono direttamente
    (le offerte NON provengono dal modello: vengono dal brief). E' deterministica: gli
    stessi input producono lo stesso documento. E' chiamabile su un SOTTOINSIEME di pagine
    — la fase 1 la chiama sulla sola home. Riporta esplicitamente i blocchi scartati per
    slot mancante nel pool, invece di renderli vuoti in silenzio.
  definition_of_done:
    - "Modulo src/domain/generation/resolve.ts con resolve(pool, recipe, theme, brief, pageSpecs) -> { document, dropped } esportata"
    - "Il documento prodotto valida contro SiteDocumentSchema (T-202) senza eccezioni"
    - "Il documento registra l'id VERSIONATO della ricetta e del tema usati"
    - "Le offerte, gli orari, i contatti e l'indirizzo nel documento provengono dal BRIEF e non dal pool"
    - "Un blocco superstite il cui slot manca dal pool e SCARTATO e riportato in `dropped`, mai reso vuoto"
    - "Chiamata con pageSpecs contenente la sola home, produce un documento con una sola pagina"
  acceptance_criteria:
    - id: AC-214-1
      given: "gli stessi pool, ricetta, tema, brief e pageSpecs"
      when: "chiamo resolve due volte e serializzo i due documenti"
      then: "le due serializzazioni JSON sono identiche byte per byte (determinismo)"
    - id: AC-214-2
      given: "un pool valido, una ricetta, un tema e un brief ricco con set di pagine multiplo"
      when: "chiamo resolve e valido il risultato con parseDocument (T-202)"
      then: "la validazione ha successo, e il documento registra l'id versionato della ricetta e del tema usati"
    - id: AC-214-3
      given: "un pageSpecs contenente la sola pagina home"
      when: "chiamo resolve"
      then: "il documento ha esattamente una pagina di ruolo home (e la forma usata dalla fase 1)"
    - id: AC-214-4
      given: "un pool a cui manca lo slot richiesto da un blocco la cui precondizione E soddisfatta"
      when: "chiamo resolve"
      then: "quel blocco non compare nel documento e compare in `dropped` con il proprio id e lo slot mancante; nessun blocco vuoto o con testo segnaposto e presente nel documento"
    - id: AC-214-5
      given: "un brief con cinque offerte i cui nomi NON compaiono in nessuno slot del pool"
      when: "chiamo resolve su una ricetta che include il blocco offerte"
      then: "tutte e cinque le offerte compaiono nel documento con i nomi del brief, dimostrando che provengono dal brief e non dal modello"
    - id: AC-214-6
      given: "un brief le cui offerte hanno un photo_ref valorizzato con un URL di terzi"
      when: "chiamo resolve e cerco quell'URL in tutto il documento serializzato"
      then: "l'URL non compare in nessun punto del documento, e gli slot immagine presenti hanno source='theme-placeholder'"
  target_tests:
    - file: "tests/generation-resolve.test.ts"
      covers: [AC-214-1, AC-214-2, AC-214-3, AC-214-4, AC-214-5, AC-214-6]
  security_notes:
    - "P2-D12 verificata sul risultato (AC-214-6): il photo_ref di terzi non entra nel documento, quindi non puo diventare una richiesta di rete nel sito generato. E' cio che mantiene VERA e SIGNIFICATIVA l'asserzione end-to-end di T-241 sull'assenza di richieste verso host fuori allowlist."
    - "OWASP A05:2025: il documento incorpora testo non fidato del brief; il contratto di sanificazione e dichiarato dai blocchi (T-210) e imposto nel rendering (T-231). resolve NON sanifica: trasporta, e lo dichiara — sanificare qui darebbe l'illusione che il rendering sia sicuro per costruzione."
    - "Onestà del fallimento (AC-214-4): un blocco senza contenuto e scartato e RIPORTATO. Un blocco reso vuoto sarebbe una pagina sottile prodotta in silenzio, cioe esattamente cio che P2-D7 e P2-D13 escludono."
    - "PRECONDIZIONI EREDITATE DA T-202 (misurate durante il BUILD di generation-model, 2026-07-28 — non riscoprirle). (1) LA PARTIZIONE E PORTANTE: SiteDocumentSchema accetta fino a DOCUMENT_LIMITS.max_bytes (8 MiB). Se resolve rende lo STESSO campo del brief in piu blocchi della stessa pagina, il caso peggiore in italiano/spagnolo accentato misura 11.813.858 byte e il documento e RIFIUTATO pur essendo legittimo. Il caso peggiore PARTIZIONATO (ogni campo reso da un blocco solo per pagina) misura 6.397.198 byte e passa con il 31% di margine. Quindi resolve partiziona per contratto, oppure max_bytes va rivisto. (2) recipe_id e theme_id sono RICHIESTI dallo schema e la versione e dentro la forma (`nome-kebab@N`, max 64 code unit): un id senza `@N` fa cadere l'INTERO documento, quindi i cataloghi di T-211 e T-212 devono nascere con id gia versionati. (3) La chiave della mappa degli orari e vincolata PER FORMA dentro il documento (alfanumerico Unicode ai due bordi, separatori singoli interni) mentre brief.ts non impone nulla: un brief valido con una chiave non conforme fa RIFIUTARE il documento, e resolve deve decidere se scartare la voce o normalizzare la chiave, senza presumere che ogni brief valido produca un documento valido."
  out_of_scope:
    - "Persistenza del documento (T-203)"
    - "Rendering React (T-231)"
    - "Chiamata al modello per ottenere il pool (T-224)"

- id: T-215
  title: "generatable: soglia derivata, cosa manca e cosa sbloccherebbe"
  macrotask: "generation-engine"
  depends_on: [T-213]
  objective: >
    Definire in src/domain/generation/generatable.ts la funzione pura
    generatable(brief, { maxPages }) che risponde alla domanda propria di P2: questo brief
    vale una chiamata a un modello a pagamento? Ritorna se e generabile, quanti blocchi e
    quante pagine sopravvivono alle precondizioni, e — per ogni campo mancante — QUALE
    blocco o pagina sbloccherebbe. P2 NON riusa isBriefComplete (T-122): quella funzione e
    progettata per un altro scopo, vincola davvero solo due campi ed e dichiarata aggirabile
    (P1 §7 p.1). 'altro' non conta come vertical scelto.
  definition_of_done:
    - "Modulo src/domain/generation/generatable.ts con generatable(brief, { maxPages }) -> { ok, surviving_blocks, pages, missing } esportata"
    - "GENERATABLE_MIN_BLOCKS in costante nominata: la soglia DERIVA dal numero di blocchi superstiti, non da un conteggio di campi"
    - "Per ogni voce di `missing`: il nome del campo del brief e l'id del blocco o della pagina che sbloccherebbe; l'id citato esiste nei cataloghi di T-210/T-213"
    - "vertical='altro' e riportato come NON scelto (stessa lettura di P1-D24)"
    - "Il modulo non importa isBriefComplete"
  acceptance_criteria:
    - id: AC-215-1
      given: "un brief con solo business_name, primary_goal e locale valorizzati (i campi che isBriefComplete vincola davvero) e vertical al default 'altro'"
      when: "chiamo generatable"
      then: "ok e false, surviving_blocks e inferiore a GENERATABLE_MIN_BLOCKS, e `missing` elenca almeno description e offerings"
    - id: AC-215-2
      given: "lo stesso brief povero"
      when: "esamino ogni voce di `missing`"
      then: "ciascuna nomina un campo del brief e l'id di un blocco o di una pagina che esiste nei cataloghi di T-210/T-213 — nessun id pendente, nessuna voce generica"
    - id: AC-215-3
      given: "un brief ricco (description, sei offerte in due sezioni, hours, indirizzo, tre highlights)"
      when: "chiamo generatable(brief, { maxPages: 10 })"
      then: "ok e true, surviving_blocks e maggiore o uguale a GENERATABLE_MIN_BLOCKS, e pages riporta il numero di pagine del set derivato"
    - id: AC-215-4
      given: "un brief costruito perche isBriefComplete(brief) ritorni true ma con description, offerings, hours, indirizzo e highlights tutti vuoti"
      when: "chiamo isBriefComplete e generatable sullo stesso brief"
      then: "isBriefComplete ritorna true e generatable.ok ritorna false: le due nozioni sono distinte, e P2 non poggia sulla soglia di P1"
    - id: AC-215-5
      given: "un brief identico in due varianti, con vertical='altro' e con vertical='ristorazione'"
      when: "chiamo generatable su entrambi"
      then: "nel primo `missing` include vertical (non scelto), nel secondo no"
    - id: AC-215-6
      given: "un brief ricco e maxPages=1"
      when: "chiamo generatable"
      then: "ok e true e pages e 1: il tetto dei piani riduce le pagine ma non rende il sito non generabile"
  target_tests:
    - file: "tests/generation-generatable.test.ts"
      covers: [AC-215-1, AC-215-2, AC-215-3, AC-215-4, AC-215-5, AC-215-6]
  security_notes:
    - "P1 §7 p.1: isBriefComplete verifica la PRESENZA e non la PROVENIENZA, ed e aggirabile in un solo turno da un modello sotto injection (vincola davvero solo due campi). AC-215-4 asserisce che P2 non ci poggia: il gate che decide se spendere una chiamata a pagamento non deve dipendere da una funzione dichiarata aggirabile."
    - "Contenimento del costo: generatable e il gate che impedisce di spendere una chiamata a un modello per un brief che non puo produrre un sito presentabile. Non e sicurezza in senso stretto, ma e la difesa contro lo spreco che P5 dovra contabilizzare."
  out_of_scope:
    - "Messaggi utente e i18n dell'elenco `missing` (T-230)"
    - "Blocco effettivo della generazione a livello di rotta (T-230)"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir del blueprint P2 — atteso exit 0.
- **Semantico** (checklist guidata): punti 6–10 su ogni task; i rilievi vanno all'human-in-the-loop.
