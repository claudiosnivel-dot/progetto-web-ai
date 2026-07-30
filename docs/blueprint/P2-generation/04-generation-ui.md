# 04-generation-ui — Macrotask `generation-ui` · Rotta, selettore, congelamento, fase 2, anteprima

> Modulo del blueprint P2 (Generazione dei mockup) di Belora. Un modulo = un macrotask:
> l'unita al cui confine gira il checkpoint e l'unita di commit atomico.
> Task atomici secondo lo schema trueline (id/AC/target_tests/security_notes).
>
> **Substrato P0+P1 (gia costruito, non nel DAG P2 — `P2-D18`):** `AppShell` e primitive
> del design system (P0), cataloghi i18n IT/ES, middleware con rotte protette, la catena di
> guardie estratta in `guard.ts` (de-duplicazione di P1), il pattern dello stream a due
> flush NDJSON di T-150 (`P1-D18`), la verifica di proprieta via `listSites()` con
> risposta identica per "non tuo" e "inesistente" (`P1-D21`), `getBrief` (T-123), il badge
> segnaposto "pronto per generare" della dashboard (T-153).
>
> **Questo e il macrotask piu esposto di P2:** e qui che il testo non fidato del brief
> viene reso in una pagina.

## Obiettivo del macrotask

Il percorso visibile: la rotta protetta che genera, i **componenti dei blocchi** che
rendono il sito sanificando il testo non fidato, il **selettore** dei cinque mockup reso
dallo *stesso* renderer dell'anteprima, il **congelamento** alla scelta, la **fase 2** che
costruisce le pagine interne a chunk, l'**anteprima navigabile**, e l'aggancio in
dashboard. E' la prima cosa del progetto che chiede di essere guardata.

I blocchi sono divisi in due task lungo la linea del **rischio**, non del conteggio:
**T-231** i blocchi *narrativi* (contenuto dal pool) piu le fondamenta condivise — chiavi
i18n di tutte le etichette, divieto di colore letterale, divieto di
`dangerouslySetInnerHTML`; **T-237** i blocchi di *dati* (offerte, orari, contatti,
recensioni), dove si concentra la superficie di testo non fidato e dove nascono
tutti i link costruiti da campi liberi del brief.

## Task atomici

```yaml
- id: T-230
  title: "Rotta protetta /generate + POST /api/generate con catena di guardie e stream a due flush"
  macrotask: "generation-ui"
  depends_on: [T-203, T-204, T-212, T-224]
  objective: >
    Implementare la rotta protetta /{locale}/generate/{siteId} — che verifica auth e
    proprieta via listSites() (P1-D21), legge il brief con getBrief, valuta
    generatable(brief) e, se non generabile, mostra cosa manca e cosa sbloccherebbe invece
    di offrire la generazione — e l'endpoint POST /api/generate che riusa la catena di
    guardie di guard.ts (Sec-Fetch-Site preteso, confronto su Origin, tetto sui byte del
    body con 413 PRIMA di leggere il corpo), crea la riga con status='generating' PRIMA
    della chiamata, e apre uno stream NDJSON a due flush: (1) le cinque cornici
    ricetta+tema, che sono pure e non costano rete; (2) il pool, al ritorno del modello.
    Un guasto di lettura del brief NON si rende come brief povero (P2-D16).
  definition_of_done:
    - "Rotta /{locale}/generate/{siteId} protetta server-side; proprieta del sito verificata con listSites()"
    - "Se generatable(brief).ok e false: la pagina elenca cosa manca e quale blocco/pagina sbloccherebbe, con un link all'onboarding, e NON offre la generazione"
    - "Se la lettura del brief fallisce: stato d'errore esplicito, distinto dal caso 'brief povero'"
    - "POST /api/generate applica la catena di guardie di guard.ts e risponde 413 sul tetto di byte PRIMA di leggere il corpo"
    - "La riga site_generations con status='generating' e creata prima della chiamata al modello (durabilita dalla riga, non dal trasporto)"
    - "Stream NDJSON: primo chunk con le cinque cornici (recipe_id + theme_id, nessun contenuto testuale), secondo chunk col pool"
    - "Ogni esito di fallimento del confine (T-224) porta la riga a status='failed' con failure_reason"
  acceptance_criteria:
    - id: AC-230-1
      given: "nessuna sessione autenticata"
      when: "richiedo la rotta /{locale}/generate/{siteId} e poi POST /api/generate"
      then: "entrambe sono respinte, nessuna riga site_generations viene creata e nessuna chiamata al confine viene effettuata"
    - id: AC-230-2
      given: "l'utente A autenticato, un siteId appartenente a un altro tenant e un siteId inesistente"
      when: "richiede la rotta con ciascuno dei due"
      then: "la risposta e IDENTICA nei due casi (stessa forma e stesso contenuto): la rotta non e un oracolo di enumerazione dei site_id altrui"
    - id: AC-230-3
      given: "un brief confermato ma povero, per cui generatable(brief).ok e false"
      when: "richiedo la rotta e poi tento POST /api/generate"
      then: "la pagina elenca i campi mancanti con il blocco che sbloccherebbero, e la POST e respinta senza effettuare alcuna chiamata al confine"
    - id: AC-230-4
      given: "getBrief che fallisce con un errore di lettura (non un brief assente)"
      when: "richiedo la rotta"
      then: "la pagina mostra uno stato d'errore esplicito e NON il messaggio di brief incompleto: un guasto transitorio non deve dire a un utente che il suo brief e povero"
    - id: AC-230-5
      given: "un doppio del confine LLM con un gate controllato dal test, che non risolve finche il test non lo sblocca"
      when: "eseguo POST /api/generate e leggo lo stream"
      then: "il primo chunk con le cinque cornici e ricevuto MENTRE la chiamata al confine e ancora in volo (prima di sbloccare il gate), e il secondo chunk arriva solo dopo; una risposta consegnata in un solo chunk fa fallire il test"
    - id: AC-230-6
      given: "richieste POST prive dell'header Sec-Fetch-Site, con Origin di un altro sito, e con un body oltre il tetto di byte"
      when: "invio le tre richieste"
      then: "la prima e respinta (fail-closed sull'header assente, non fail-open), la seconda e respinta per origine, la terza risponde 413 e il corpo non viene letto integralmente"
    - id: AC-230-7
      given: "un doppio del confine che lancia un errore dopo che la riga e stata creata"
      when: "eseguo POST /api/generate"
      then: "la riga esiste con status='failed' e un failure_reason nominato; nessuna riga resta in 'generating'"
    - id: AC-230-8
      given: "il primo chunk dello stream"
      when: "ne ispeziono il contenuto"
      then: "contiene i cinque recipe_id e theme_id e nessun testo generato: le cornici sono pure e non attendono il modello"
  target_tests:
    - file: "tests/generate-route.test.ts"
      covers: [AC-230-1, AC-230-2, AC-230-3, AC-230-4, AC-230-7]
    - file: "tests/generate-api-guards.test.ts"
      covers: [AC-230-6]
    - file: "tests/generate-two-flush.test.ts"
      covers: [AC-230-5, AC-230-8]
  security_notes:
    - "OWASP A01:2025: rotta protetta server-side e proprieta verificata con listSites() (RLS-backed). AC-230-2 conserva l'anti-enumerazione di P1-D21: 'non tuo' e 'inesistente' danno la stessa risposta, altrimenti la rotta diventa un oracolo dei site_id altrui."
    - "CSRF / same-origin: Sec-Fetch-Site e PRETESO e non fail-open sull'assenza, come corretto in T-150; il confronto su Origin segue. Il tetto sui byte risponde 413 PRIMA di leggere il corpo (in P1 un body da 64 MB veniva letto integralmente e poi rifiutato)."
    - "Contenimento del costo: AC-230-3 impedisce di spendere una chiamata a un modello a pagamento su un brief che non puo produrre un sito presentabile."
    - "Disponibilita (P2-D15): AC-230-7 e la meta 'route' del doppio meccanismo. L'altra meta e la riconciliazione in lettura di T-203, che copre il caso in cui il processo muore e nessun finally gira."
    - "P2-D16 come asserzione (AC-230-4): e la lezione di T-152 spostata, dove un guasto di lettura veniva reso come brief vuoto e l'utente poteva confermare un brief mai visto."
    - "LIMITE DICHIARATO: nulla limita ancora la FREQUENZA delle generazioni per account. L'indice UNIQUE parziale impedisce la concorrenza sul singolo sito, non la raffica su siti diversi. Tetto complessivo: P5."
  out_of_scope:
    - "Rendering dei blocchi (T-231)"
    - "Selettore e rigenerazione (T-232)"
    - "Fase 2 (T-234)"

- id: T-231
  title: "Blocchi narrativi del sito + chiavi i18n di tutte le etichette + divieto di colore letterale"
  macrotask: "generation-ui"
  depends_on: [T-210, T-211]
  objective: >
    Implementare in src/ui/site/blocks/ i componenti React dei blocchi NARRATIVI — quelli il
    cui contenuto viene dal pool: hero, chi-siamo, CTA e FAQ — applicando i token del tema.
    Insieme, stabilire le fondamenta condivise da tutti i blocchi: (a) le CHIAVI i18n delle
    etichette di TUTTI i blocchi (compresi quelli di dati di T-237) nei cataloghi it/es, dato
    che per P2-D10 le etichette sono nostre e il modello scrive solo la prosa; (b) il divieto
    di colore letterale, verificato su tutta la directory; (c) il divieto di
    dangerouslySetInnerHTML. E' il primo punto in cui il testo NON FIDATO del brief
    (description, highlights — provenienti da siti terzi via fromUrl, T-141) diventa una
    pagina: la sanificazione spetta a P2 ed e qui.
  definition_of_done:
    - "Componenti in src/ui/site/blocks/ per i blocchi narrativi del catalogo T-210 (hero, chi-siamo, CTA, FAQ), che ricevono il documento risolto e i token del tema"
    - "Le chiavi i18n delle etichette di TUTTI i blocchi del catalogo T-210 — narrativi e di dati — sono aggiunte ai cataloghi it ed es di P0"
    - "Le etichette rese provengono dal catalogo del locale del sito, non da stringhe inline e non dal modello"
    - "Nessun uso di dangerouslySetInnerHTML in alcun file sotto src/ui/site/**"
    - "Nessun valore di colore letterale in alcun file sotto src/ui/site/**: i colori provengono dai token del tema"
    - "I componenti non importano src/ui/theme/tokens (regola ESLint di T-211)"
  acceptance_criteria:
    - id: AC-231-1
      given: "un documento in cui description e un highlight contengono ciascuno un payload ostile diverso (un tag script e un tag img con attributo di evento)"
      when: "monto i blocchi narrativi e ispeziono l'albero reso"
      then: "i due payload compaiono come TESTO, e nessun elemento script o img nasce da quel testo: il numero di elementi di quei tipi nell'albero e quello atteso dal componente e non aumenta per effetto del payload"
    - id: AC-231-2
      given: "il catalogo dei blocchi di T-210 e i cataloghi i18n it ed es"
      when: "per ogni blocco del catalogo cerco la chiave della sua etichetta nei due cataloghi"
      then: "ogni chiave esiste in ENTRAMBI i cataloghi (nessun blocco senza etichetta, in nessuna delle due lingue); un blocco aggiunto a T-210 senza la sua chiave fa fallire questo controllo"
    - id: AC-231-3
      given: "lo stesso documento montato con locale 'it' e con locale 'es'"
      when: "leggo le etichette rese dai blocchi narrativi"
      then: "le etichette provengono dal catalogo del locale attivo e differiscono fra le due lingue; nessuna etichetta e una stringa inline nel componente"
    - id: AC-231-4
      given: "tutti i file sotto src/ui/site/**"
      when: "cerco valori di colore letterali (notazione esadecimale, rgb(), hsl()) e occorrenze di dangerouslySetInnerHTML"
      then: "nessun file ne contiene: i colori arrivano dai token del tema e il testo non fidato attraversa solo il percorso di escape di React"
    - id: AC-231-5
      given: "un brief in cui OGNI campo NON dichiarato in brief_fields_rendered per un dato blocco narrativo porta un marcatore unico e riconoscibile"
      when: "monto quel blocco e cerco i marcatori nell'albero reso"
      then: "nessun marcatore dei campi non dichiarati compare: il blocco rende solo cio che ha dichiarato di rendere (T-210)"
  target_tests:
    - file: "tests/site-blocks-narrative.test.ts"
      covers: [AC-231-1, AC-231-5]
    - file: "tests/site-blocks-i18n-labels.test.ts"
      covers: [AC-231-2, AC-231-3]
    - file: "tests/site-blocks-style.test.ts"
      covers: [AC-231-4]
  security_notes:
    - "OWASP A03:2025 (XSS / injection in output): nessun dangerouslySetInnerHTML sotto src/ui/site/**, verificato su tutta la directory e non per componente (AC-231-4), cosi che un blocco aggiunto dopo non sfugga al controllo. Il testo non fidato attraversa solo il percorso di escape di React."
    - "Inizia a chiudere il carry-over P1 §7 p.5 ('testo estratto = input non fidato in RENDERING anche per P2') per la parte narrativa; la parte dei dati e in T-237 e la prova sull'EFFETTO in T-241."
    - "P2-D10 come proprieta verificabile (AC-231-2, AC-231-3): le etichette vengono dai cataloghi e non dal modello, quindi la CTA derivata da primary_goal fa rispettare DAL CODICE la regola Meta del 15/01/2026 sugli agenti a scopo definito. Se le etichette le scrivesse il modello, quel vincolo dipenderebbe da una frase in un prompt."
    - "AC-231-2 e totale sul catalogo: e la stessa forma di P1-D24 (un campo aggiunto a T-121 rompe il controllo e obbliga a decidere). Chiude il gap per cui P1 §6-bis p.13 osservava che i test catturano rinomine e rimozioni ma NON le aggiunte."
    - "LIMITE DICHIARATO: queste asserzioni girano in jsdom, che NON carica risorse. Provano 'nessun elemento nasce dal testo del brief', non 'nessuno script ha girato'. La prova sull'EFFETTO e in T-241, e per questo l'end-to-end esiste."
    - "LIMITE DICHIARATO (eredita P1 §6-bis p.7): AC-231-3 asserisce che le etichette es sono presenti e diverse dalle it. Una traduzione SBAGLIATA ma diversa passerebbe."
  out_of_scope:
    - "Blocchi di dati: offerte, orari, contatti, recensioni (T-237)"
    - "Anteprima a piena pagina (T-235)"
    - "Sanificazione lato pubblicazione: P4"

- id: T-237
  title: "Blocchi di dati del sito + link costruiti da campi strutturati validati"
  macrotask: "generation-ui"
  depends_on: [T-210, T-211, T-231]
  objective: >
    Implementare i componenti dei blocchi che rendono i DATI del brief direttamente, senza
    passare dal modello: offerte (con le varianti per verticale di T-210), orari, contatti e
    mappa, recensioni. La galleria NON esiste nel catalogo v1 (P2-D24), quindi non ha
    componente. E' dove si concentra la superficie di rischio di P2: i nomi
    e le descrizioni delle offerte sono testo non fidato, e whatsapp/phone/email sono campi
    di TESTO LIBERO nel brief (T-121) da cui questi blocchi costruiscono i LINK. Nessun href
    o src nasce dal testo libero: i link si costruiscono dai campi strutturati passati
    attraverso un validatore di schema, e un valore non valido non produce un link.
  definition_of_done:
    - "Componenti in src/ui/site/blocks/ per i blocchi di dati del catalogo T-210 (offerte con varianti per verticale, orari, contatti/mappa, recensioni)"
    - "I link (whatsapp, telefono, email, social) sono costruiti dai campi strutturati e validati sullo SCHEMA prima dell'uso; un valore non valido non produce alcun link"
    - "Nessun href/src e costruito dal testo libero del brief; lo slot immagine e reso secondo la sua sorgente tipizzata (T-202)"
    - "Le etichette provengono dalle chiavi i18n aggiunte da T-231, per il locale del sito"
    - "La variante del blocco offerte segue il vertical del brief (T-210)"
  acceptance_criteria:
    - id: AC-237-1
      given: "un documento il cui campo whatsapp contiene 'javascript:alert(1)', il cui phone contiene una stringa con caratteri non ammessi e il cui email contiene uno schema non ammesso"
      when: "monto il blocco contatti e ispeziono gli attributi href prodotti"
      then: "nessun href ha uno schema diverso da quelli ammessi (https, tel, mailto), nessun href contiene 'javascript:', e per i valori non validi non viene reso alcun link"
    - id: AC-237-2
      given: "un documento derivato da un brief le cui offerte hanno photo_ref valorizzato con un URL di terzi"
      when: "monto i blocchi di dati e raccolgo tutti gli attributi src e href dell'albero"
      then: "quell'URL non compare in nessun attributo: lo slot immagine e theme-placeholder e non porta URL (T-202)"
    - id: AC-237-3
      given: "un documento con cinque offerte discordanti (nomi diversi, una senza prezzo, una con sezione, due nella stessa sezione) e orari con piu di una chiave"
      when: "monto i blocchi offerte e orari"
      then: "tutte e cinque le offerte e tutte le chiavi orario sono rese, ciascuna con i propri valori, e nessuna voce risulta duplicata o omessa"
    - id: AC-237-4
      given: "un documento in cui il NOME di un'offerta contiene un tag script e la DESCRIZIONE di un'altra contiene un iframe con srcdoc"
      when: "monto il blocco offerte e ispeziono l'albero reso"
      then: "i due payload compaiono come TESTO e nessun elemento script o iframe nasce da quel testo"
    - id: AC-237-5
      given: "due documenti identici tranne il vertical del brief ('ristorazione' e 'salone_studio'), montati nello stesso locale"
      when: "leggo l'etichetta e il layout del blocco offerte nei due casi"
      then: "l'etichetta differisce e proviene dal catalogo i18n (non da una stringa inline), e il layout segue la variante dichiarata in T-210"
  target_tests:
    - file: "tests/site-blocks-data.test.ts"
      covers: [AC-237-3, AC-237-5]
    - file: "tests/site-blocks-untrusted.test.ts"
      covers: [AC-237-1, AC-237-2, AC-237-4]
  security_notes:
    - "CHIUDE la parte piu esposta del carry-over P1 §7 p.5: le offerte e i contatti sono i campi che il sito generato rende direttamente dal brief, quindi senza passare dal filtro dell'allowlist del confine LLM. Sono la superficie di rendering piu larga di tutto P2."
    - "AC-237-1 chiude una superficie specifica e facile da mancare: whatsapp/phone/email sono campi di TESTO LIBERO (max 40-320 caratteri, T-121) e possono venire da un sito terzo via fromUrl. Costruire wa.me/<valore> o href={valore} senza validare lo SCHEMA sarebbe un javascript: URL nel sito pubblico di un cliente pagante."
    - "AC-237-2: nessuna richiesta di rete verso un host di terzi puo nascere da un photo_ref, perche il tipo dello slot immagine non ha un campo URL (T-202). E' cio che rende significativa l'asserzione end-to-end di T-241."
    - "Trappola del test (correzione di metodo n.1 di P1): AC-237-3 usa CINQUE offerte con valori DISCORDANTI e orari con PIU DI UNA chiave — una fixture con un solo elemento non prova nulla sull'identita di quell'elemento, ed e il difetto che in P1 si e ripetuto tre volte con la suite verde."
    - "LIMITE DICHIARATO: jsdom non carica risorse. La prova sull'EFFETTO e in T-241."
  out_of_scope:
    - "Blocchi narrativi e chiavi i18n (T-231)"
    - "Anteprima a piena pagina (T-235)"
    - "Ingest e ri-hosting delle foto reali: P4"

- id: T-232
  title: "Selettore dei 5 mockup con lo stesso renderer + rigenera una variante"
  macrotask: "generation-ui"
  depends_on: [T-230, T-231, T-237, T-214]
  objective: >
    Implementare il selettore in src/ui/generation/: cinque card, ciascuna resa dallo
    STESSO renderer dell'anteprima (T-235) applicato a resolve(pool, ricetta_i, tema_i) —
    cosi che cio che l'utente scegle sia cio che ottiene, per costruzione e non per
    sorveglianza. Piu l'azione "rigenera il testo di questa variante", che secondo P2-D3
    crea un pool con variant_index = i (una chiamata) e lascia intatte le altre quattro.
    Cambiare tema o ricetta su un pool esistente e puro: zero chiamate.
  definition_of_done:
    - "Componente selettore in src/ui/generation/ che rende cinque card"
    - "Le card usano lo stesso modulo di rendering dei blocchi dell'anteprima (nessun renderer parallelo per le card)"
    - "Azione 'rigenera questa variante': una sola chiamata al confine, scrive un pool con scope='home' e variant_index = i"
    - "Le altre quattro varianti restano invariate dopo una rigenerazione"
    - "Cambio di tema/ricetta su un pool esistente: nessuna chiamata al confine"
  acceptance_criteria:
    - id: AC-232-1
      given: "un pool e un documento risolti dalla stessa variante"
      when: "rendo la card della variante e l'anteprima dello stesso documento, e confronto la sequenza di id di blocco prodotta nei due alberi"
      then: "le due sequenze sono identiche: card e anteprima passano dallo stesso renderer"
    - id: AC-232-2
      given: "un pool e un brief ricco"
      when: "rendo le cinque card e confronto le sequenze di id di blocco"
      then: "le cinque sequenze non sono tutte uguali: almeno per una coppia cambia la presenza o l'ordine di un blocco, non solo il tema"
    - id: AC-232-3
      given: "una generazione in stato 'ready' con un pool condiviso e un doppio del confine che conta le chiamate"
      when: "eseguo 'rigenera' sulla variante 2"
      then: "il confine e chiamato una volta sola, esiste un pool con scope='home' e variant_index=2, e le varianti 0,1,3,4 rendono esattamente lo stesso albero di prima"
    - id: AC-232-4
      given: "una generazione con un pool condiviso e un doppio del confine che conta le chiamate"
      when: "cambio il tema o la ricetta mostrata per una variante"
      then: "il numero di chiamate al confine e zero e la card si aggiorna"
    - id: AC-232-5
      given: "una rigenerazione della variante 2 gia in volo"
      when: "richiedo una seconda rigenerazione della variante 2"
      then: "la seconda e respinta con un errore riconoscibile e non produce un secondo pool per la stessa variante (UNIQUE su generation_id+scope+variant_index)"
  target_tests:
    - file: "tests/generation-chooser.test.ts"
      covers: [AC-232-1, AC-232-2, AC-232-4]
    - file: "tests/generation-regenerate.test.ts"
      covers: [AC-232-3, AC-232-5]
  security_notes:
    - "Integrita della scelta (AC-232-1): un renderer separato per le card renderebbe possibile che l'anteprima non somigli alla card scelta. Con un solo renderer quella classe di difetto e irrappresentabile, non sorvegliata."
    - "Contenimento del costo: AC-232-3 e AC-232-4 asseriscono il numero di chiamate al modello, non l'effetto visivo. E' l'unica forma in cui il costo di P2-D3 e verificabile senza chiave."
    - "P2-D3 come schema (AC-232-5): il vincolo UNIQUE e cio che rende irrappresentabile una doppia rigenerazione della stessa variante; la UI non deve sorvegliarlo."
  out_of_scope:
    - "Congelamento (T-233)"
    - "Fase 2 (T-234)"

- id: T-233
  title: "Scegli & congela: chosen_variant e documento della home"
  macrotask: "generation-ui"
  depends_on: [T-232]
  objective: >
    Implementare l'azione di scelta: registra chosen_variant, congela il documento con la
    SOLA pagina home (resolve su pageSpecs=[home]), porta status a 'chosen' e reindirizza
    all'anteprima, dove la home e subito visibile. Il documento registra gli id VERSIONATI
    di ricetta e tema, cosi che un ritocco futuro a una ricetta non riscriva un sito gia
    scelto. La riscelta e libera e gratuita finche il documento ha solo la home; dopo la
    fase 2 comporta rifare la fase 2, cioe un costo, e va confermata esplicitamente.
  definition_of_done:
    - "Azione di scelta che scrive chosen_variant e document (una sola pagina, role home) e porta status a 'chosen'"
    - "Il documento registra recipe_id e theme_id versionati"
    - "Riscelta prima della fase 2: sostituisce il documento, nessuna chiamata al confine"
    - "Riscelta dopo la fase 2: richiede una conferma esplicita, perche rifara la fase 2"
    - "Un indice di variante fuori 0..4 e respinto"
  acceptance_criteria:
    - id: AC-233-1
      given: "una generazione 'ready' con un pool condiviso"
      when: "l'utente scegle la variante 3"
      then: "la generazione ha chosen_variant=3, status='chosen' e document con esattamente una pagina di role 'home'; l'utente e portato all'anteprima"
    - id: AC-233-2
      given: "il documento congelato"
      when: "ne leggo i metadati"
      then: "contiene il recipe_id e il theme_id versionati della variante scelta"
    - id: AC-233-3
      given: "una generazione in stato 'chosen' con la sola home e un doppio del confine che conta le chiamate"
      when: "l'utente scegle una variante diversa"
      then: "il numero di chiamate al confine e zero, chosen_variant e aggiornato e il documento e ricostruito dalla nuova variante"
    - id: AC-233-4
      given: "una generazione in stato 'complete' (fase 2 conclusa)"
      when: "l'utente tenta di scegliere una variante diversa senza confermare"
      then: "l'azione non procede e viene richiesta una conferma esplicita; solo dopo la conferma la fase 2 viene rifatta per la nuova variante"
    - id: AC-233-5
      given: "una generazione 'ready'"
      when: "invoco l'azione di scelta con indice 5 e con indice -1"
      then: "entrambe sono respinte e chosen_variant resta invariato"
    - id: AC-233-6
      given: "un documento congelato e una modifica successiva alla definizione della ricetta usata"
      when: "rileggo il documento e lo rendo"
      then: "l'albero reso e identico a prima della modifica: il documento e dato e non si ricalcola dalla ricetta"
  target_tests:
    - file: "tests/generation-choose.test.ts"
      covers: [AC-233-1, AC-233-2, AC-233-3, AC-233-5, AC-233-6]
    - file: "tests/generation-rechoose.test.ts"
      covers: [AC-233-4]
  security_notes:
    - "Integrita dell'artefatto del cliente (AC-233-6): e la ragione per cui si congela. Se il documento restasse derivato, migliorare una ricetta cambierebbe il sito di un cliente senza che nessuno lo abbia chiesto."
    - "AC-233-4 evita un addebito non consapevole: dopo la fase 2 la riscelta ha un costo reale in chiamate al modello, quindi non puo essere un gesto silenzioso."
    - "SCADENZA DICHIARATA: quando P3 esistera, riscegliere DISTRUGGERA le modifiche dell'utente. E' una decisione di P3, registrata qui perche non ce ne accorgiamo dopo."
  out_of_scope:
    - "Fase 2 (T-234)"
    - "Guardia sulla perdita delle modifiche dell'editor: P3"

- id: T-234
  title: "Fase 2: pagine interne generate una volta, a chunk, sulla variante scelta"
  macrotask: "generation-ui"
  depends_on: [T-233, T-213, T-224]
  objective: >
    Implementare la fase 2 (P2-D13): dopo la scelta, derivare il set di pagine con
    pagesFor(brief, { maxPages }) — usando il max_pages registrato sulla riga, non
    ricalcolato — e generare il pool delle pagine interne in CHUNK di
    GENERATION_BUDGET.pages_per_chunk pagine, con profilo di proiezione 'inner'. Ogni chunk
    scritto estende document.pages; al termine status passa a 'complete'. Il chunking non e
    un dettaglio: un troncamento perde un chunk e non tutto il sito, e ogni chiamata resta
    sotto la soglia oltre la quale servirebbe lo streaming. Il prefisso stabile del payload
    e identico fra i chunk, perche sia cacheabile.
  definition_of_done:
    - "Azione di fase 2 che gira solo su status='chosen' e solo per la variante scelta (scope='inner', variant_index = chosen_variant)"
    - "Il set di pagine e derivato con il max_pages REGISTRATO sulla riga della generazione"
    - "Le chiamate sono suddivise in chunk di GENERATION_BUDGET.pages_per_chunk pagine"
    - "Ogni chunk completato estende document.pages; al termine di tutti i chunk status='complete'"
    - "Il fallimento di un chunk lascia il documento con le pagine gia prodotte e porta status a 'failed' con failure_reason; non dichiara 'complete'"
    - "Il prefisso stabile (tool + system prompt) e identico fra i chunk della stessa fase 2"
  acceptance_criteria:
    - id: AC-234-1
      given: "una generazione 'chosen' con chosen_variant=1 e un set derivato di sette pagine interne, con pages_per_chunk=4"
      when: "eseguo la fase 2 con un doppio del confine che conta le chiamate"
      then: "il confine e chiamato esattamente due volte, e i pool scritti hanno scope='inner' e variant_index=1"
    - id: AC-234-2
      given: "la stessa fase 2 in due chunk"
      when: "confronto i payload dei due chunk"
      then: "la parte stabile (tool + system prompt) e identica byte per byte fra i due, e differisce solo la parte volatile con le pagine del chunk"
    - id: AC-234-3
      given: "una fase 2 in cui il secondo chunk fallisce (stop_reason di troncamento)"
      when: "leggo la generazione al termine"
      then: "status e 'failed' con un failure_reason nominato, document.pages contiene la home piu le pagine del primo chunk, e lo stato NON e 'complete'"
    - id: AC-234-4
      given: "una fase 2 conclusa con successo"
      when: "leggo la generazione e confronto document.pages col set derivato da pagesFor"
      then: "status e 'complete' e gli slug di document.pages coincidono esattamente con quelli del set derivato, nello stesso ordine"
    - id: AC-234-5
      given: "una fase 2 gia conclusa per la variante 1"
      when: "tento di eseguirla di nuovo per la stessa variante"
      then: "l'operazione e respinta e non viene scritto un secondo pool 'inner' per la variante 1"
    - id: AC-234-6
      given: "una generazione la cui riga registra max_pages=3, e un brief che produrrebbe otto pagine"
      when: "eseguo la fase 2"
      then: "il documento finale ha tre pagine, coerenti col max_pages REGISTRATO e non con un ricalcolo dai piani correnti"
    - id: AC-234-7
      given: "una riga in stato 'chosen' il cui aggiornamento e piu vecchio di GENERATION_TIMEOUTS.phase2 e senza pagine interne"
      when: "l'utente rilegge la generazione"
      then: "lo stato riportato e 'failed' e la fase 2 puo essere ritentata (riconciliazione di P2-D15 estesa alla fase 2)"
  target_tests:
    - file: "tests/generation-phase2.test.ts"
      covers: [AC-234-1, AC-234-3, AC-234-4, AC-234-5, AC-234-6, AC-234-7]
    - file: "tests/generation-phase2-cache-prefix.test.ts"
      covers: [AC-234-2]
  security_notes:
    - "Contenimento del costo (AC-234-1, AC-234-5): la fase 2 gira UNA VOLTA e sulla SOLA direzione scelta. E' cio che rende il multi-pagina ~3x una one-pager invece di ~8x, e il numero di chiamate e asserito, non sperato."
    - "Onestà dello stato (AC-234-3): un fallimento parziale non deve dichiarare 'complete'. Un sito a meta dichiarato completo e la forma peggiore di falso verde per l'utente finale."
    - "max_pages REGISTRATO e non ricalcolato (AC-234-6): quando P5 cambiera i piani, un sito gia costruito non deve riscriversi da se."
    - "Il profilo di proiezione 'inner' non aggiunge campi all'allowlist (T-220, AC-220-5): la fase 2 non riapre la superficie che la fase 1 chiude."
    - "LIMITE DICHIARATO: la latenza della fase 2 (piu chunk, uscita piu grande) non e misurata, e il tetto di durata delle funzioni della piattaforma di hosting va verificato contro di essa."
  out_of_scope:
    - "Worker o coda asincrona: rinviata (P2-D6 la tiene in tasca)"
    - "Anteprima (T-235)"

- id: T-235
  title: "Anteprima navigabile /preview che legge il documento congelato"
  macrotask: "generation-ui"
  depends_on: [T-233, T-231, T-237]
  objective: >
    Implementare la rotta protetta /{locale}/preview/{siteId} che rende a piena pagina il
    documento CONGELATO, mai il pool: se rendesse dal pool, il sito tornerebbe a essere
    derivato e ricambierebbe al primo ritocco di una ricetta. La navigazione e resa dal set
    di pagine del documento; un documento one-pager non mostra navigazione. La rotta e
    protetta come /generate e conserva l'anti-enumerazione. Il deliverable deve essere
    RAGGIUNGIBILE dall'applicazione, non solo esistere nel sorgente.
  definition_of_done:
    - "Rotta /{locale}/preview/{siteId} protetta server-side, proprieta verificata con listSites()"
    - "L'anteprima legge document da site_generations; non legge generation_pools"
    - "La navigazione e derivata dalle pagine del documento; ogni destinazione e uno slug presente"
    - "Un documento con una sola pagina non rende alcuna navigazione"
    - "La rotta e collegata dall'applicazione (dalla scelta e dalla dashboard) e i suoi componenti compaiono nell'output di build"
  acceptance_criteria:
    - id: AC-235-1
      given: "una generazione 'complete' il cui documento e presente, e le righe generation_pools rimosse"
      when: "richiedo l'anteprima"
      then: "la pagina rende il sito completo: l'anteprima non dipende dal pool"
    - id: AC-235-2
      given: "un documento con cinque pagine"
      when: "monto l'anteprima e raccolgo le destinazioni della navigazione"
      then: "esiste una voce per ciascuna delle cinque pagine e per nessun'altra, e ogni destinazione corrisponde a uno slug presente nel documento"
    - id: AC-235-3
      given: "nessuna sessione, poi una sessione di un altro tenant, poi un siteId inesistente"
      when: "richiedo l'anteprima nei tre casi"
      then: "nessun documento e restituito, e la risposta per 'altro tenant' e per 'inesistente' e identica"
    - id: AC-235-4
      given: "un documento con la sola pagina home (one-pager)"
      when: "monto l'anteprima"
      then: "nessun elemento di navigazione fra pagine e reso, e la home e resa per intero"
    - id: AC-235-5
      given: "il progetto costruito con la build di produzione"
      when: "verifico che la rotta sia raggiungibile da un link dell'applicazione e che i componenti dell'anteprima compaiano fra gli asset prodotti"
      then: "esiste almeno un href dell'applicazione che nomina la rotta, e i componenti non risultano file inutilizzati per l'analisi statica del progetto"
  target_tests:
    - file: "tests/generation-preview.test.ts"
      covers: [AC-235-1, AC-235-2, AC-235-3, AC-235-4]
    - file: "tests/generation-preview-reachable.test.ts"
      covers: [AC-235-5]
  security_notes:
    - "OWASP A01:2025: la rotta e protetta e conserva l'anti-enumerazione di P1-D21. La protezione del middleware su /preview e RIASSERITA qui e non ereditata dall'oracolo di T-150 (chiude P1 §7 p.16); si ricordi anche che il matcher del middleware esclude i pathname che contengono un punto, quindi la guardia della pagina e necessaria."
    - "AC-235-1 e la forma verificabile di P2-D5: l'anteprima legge il DATO. Se leggesse il pool, il sito del cliente cambierebbe sotto i suoi piedi al primo ritocco di una ricetta."
    - "AC-235-5 e la lezione di T-151: 'npm run build' passava mentre i componenti erano ASSENTI dagli asset e l'analisi statica li elencava come inutilizzati. Un deliverable che esiste nel sorgente e non nell'applicazione non e un deliverable."
  out_of_scope:
    - "Modifica dei contenuti: P3"
    - "Pubblicazione e URL pubblici: P4"
    - "Prova sull'EFFETTO in un browser reale (T-241)"

- id: T-236
  title: "Aggancio dashboard: stato della generazione per sito, in una query"
  macrotask: "generation-ui"
  depends_on: [T-203, T-230]
  objective: >
    Sostituire il badge segnaposto 'pronto per generare' di T-153 con lo stato reale della
    generazione per ciascun sito, letto con listGenerationStatuses() in UNA query — senza
    ripetere l'N+1 che P1 ha dichiarato e non risolto (§7 p.15). La CTA per riga cambia con
    lo stato: genera / riprendi / vedi l'anteprima. Un guasto di listSites non deve rendere
    lo stato vuoto della dashboard, e le destinazioni non interpolano il locale grezzo
    dell'URL.
  definition_of_done:
    - "La dashboard legge lo stato di generazione di tutti i siti con listGenerationStatuses() (una query)"
    - "La CTA per riga dipende dallo stato: nessuna generazione -> genera; ready/chosen -> riprendi; complete -> vedi l'anteprima; failed -> riprova"
    - "Un guasto di lettura non rende lo stato vuoto 'non hai ancora creato nessun sito'"
    - "Le destinazioni dei link usano un locale da allowlist, non il valore grezzo del path"
  acceptance_criteria:
    - id: AC-236-1
      given: "un account con tre siti in stati di generazione diversi (nessuna, ready, complete) e un doppio del client che conta le chiamate"
      when: "rendo la dashboard"
      then: "il numero di chiamate al DB per lo stato di generazione e 1, e ciascuna delle tre righe mostra lo stato corretto"
    - id: AC-236-2
      given: "una lettura dei siti che falla con un errore"
      when: "rendo la dashboard"
      then: "viene mostrato uno stato d'errore esplicito e NON il messaggio di elenco vuoto: un utente con siti reali non deve credere di non averne"
    - id: AC-236-3
      given: "un locale non ammesso nel path della richiesta"
      when: "rendo la dashboard e ispeziono gli href generati"
      then: "gli href usano un locale dell'allowlist e non il valore grezzo del path"
    - id: AC-236-4
      given: "quattro siti negli stati nessuna/ready/complete/failed"
      when: "ispeziono la CTA di ciascuna riga"
      then: "le quattro CTA puntano rispettivamente a generare, riprendere, vedere l'anteprima e riprovare, ciascuna con la propria destinazione"
  target_tests:
    - file: "tests/dashboard-generation-state.test.ts"
      covers: [AC-236-1, AC-236-2, AC-236-3, AC-236-4]
  security_notes:
    - "OWASP A01:2025: le destinazioni non interpolano il locale grezzo dell'URL (AC-236-3) — e il difetto preesistente di T-102 trovato in T-153 e da non reintrodurre."
    - "AC-236-2 e la lezione di T-153: listSites che fallisce rendeva 'non hai ancora creato nessun sito', e un utente con siti reali davanti a un 500 poteva ricrearne uno che esisteva."
    - "Efficienza (AC-236-1): chiude il carry-over P1 §7 p.15 per la parte di P2, invece di ripeterne la forma."
  out_of_scope:
    - "Emendamento di getBrief per l'N+1 del brief: resta un carry-over di P1 su T-123"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir del blueprint P2 — atteso exit 0.
- **Semantico** (checklist guidata): punti 6–10 su ogni task; i rilievi vanno all'human-in-the-loop.
