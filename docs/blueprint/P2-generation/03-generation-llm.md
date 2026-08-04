# 03-generation-llm — Macrotask `generation-llm` · Il confine col modello

> Modulo del blueprint P2 (Generazione dei mockup) di Belora. Un modulo = un macrotask:
> l'unita al cui confine gira il checkpoint e l'unita di commit atomico.
> Task atomici secondo lo schema trueline (id/AC/target_tests/security_notes).
>
> **Substrato P0+P1 (gia costruito, non nel DAG P2 — `P2-D18`):** confine LLM **unico**
> `src/data/anthropic.ts` server-only e mockabile (T-131, `P1-D7`) con la guardia ESLint
> deny-by-default; accessor di config `src/config/env.ts` (T-130); il pattern di
> `runOnboardingTurn` come forma di riferimento; il sottoinsieme JSON Schema ristretto
> dello strict tool use accertato da `P1-D20`; lo schema del Brief e `BRIEF_LIMITS` (T-121).
>
> **Vincolo che governa tutto il macrotask: non esiste una chiave API.** Ogni oracolo qui
> mocka il confine. Cio che non e provabile senza chiave e **dichiarato**, non stimato.

## Obiettivo del macrotask

Il **confine**: cosa del brief arriva al modello, in che forma, con quale contratto
d'uscita, e con quali guardie sul ritorno. E' il macrotask dove vive la difesa contro la
**prompt injection** — strutturale (allowlist in ingresso, nessuna leva in uscita), non
affidata a una frase nel prompt. E' anche dove vivono le **costanti di budget**, in un
solo posto, dichiarate provvisorie fino alla prima misura reale (`P2-D17`).

## Task atomici

```yaml
- id: T-220
  title: "projection: allowlist nominata del brief, in due profili, con tetto misurato"
  macrotask: "generation-llm"
  depends_on: []
  objective: >
    Definire in src/domain/generation/projection.ts la funzione pura briefProjection(brief,
    profile) che produce la sola porzione del brief che raggiunge il modello, secondo una
    ALLOWLIST NOMINATA (P2-D4). Profilo 'home': business_name, vertical, description,
    primary_goal, locale, brand_hints, highlights, piu un campione di soli NOMI di offerte
    con la loro sezione. Profilo 'inner': lo stesso, ma il campione delle offerte e per
    sezione invece che piatto — nessun campo nuovo entra nell'allowlist, cambia solo la
    forma del campione. In nessun profilo passano: descrizioni delle offerte, prezzi,
    photo_ref, contatti (phone/whatsapp/email), orari, indirizzo, geo, social_links.
    PROJECTION_LIMITS in costanti nominate, con il tetto in code unit per profilo.
  definition_of_done:
    - "Modulo src/domain/generation/projection.ts con briefProjection(brief, profile) esportata e PROJECTION_LIMITS in costanti nominate"
    - "L'allowlist e dichiarata come una struttura esplicita ed enumerata, non come una serie di accessi sparsi ai campi"
    - "Il campione delle offerte e limitato in numero da PROJECTION_LIMITS.offering_sample e riporta solo name e section"
    - "briefProjection e pura: non muta il brief in ingresso"
    - "Un test misura la proiezione di un brief con ogni campo al tetto di P1-D17 e asserisce che resta sotto PROJECTION_LIMITS del profilo, riportando il valore misurato"
  acceptance_criteria:
    - id: AC-220-1
      given: "un brief con TUTTI i campi valorizzati, compresi phone, whatsapp, email, address, geo, hours, social_links e offerte con description, price e photo_ref"
      when: "serializzo briefProjection(brief, 'home') e cerco i valori dei campi fuori allowlist"
      then: "nessuno di quei valori compare nella proiezione serializzata, e i soli campi presenti sono quelli dell'allowlist dichiarata"
    - id: AC-220-2
      given: "il prodotto cartesiano {locale it, locale es} x {brief da import, brief con i ruoli dei campi invertiti}, con i marcatori ESTRATTI dal brief reale e non riscritti a mano"
      when: "per ciascuna delle quattro combinazioni serializzo la proiezione e cerco ogni marcatore"
      then: "nessun marcatore dei campi fuori allowlist compare, il confronto e case-insensitive, ed e assente anche il PREFISSO comune di ciascun marcatore (cattura le fughe troncate)"
    - id: AC-220-3
      given: "un brief con 200 offerte, ciascuna con name, description, price e photo_ref"
      when: "produco briefProjection(brief, 'home')"
      then: "la proiezione contiene al massimo PROJECTION_LIMITS.offering_sample nomi, nessuna description, nessun price e nessun photo_ref"
    - id: AC-220-4
      given: "un brief con ogni campo e ogni collezione al tetto di P1-D17"
      when: "misuro in code unit la serializzazione di briefProjection per i due profili"
      then: "il profilo 'home' resta sotto PROJECTION_LIMITS.home e 'inner' sotto PROJECTION_LIMITS.inner, e il test riporta i due valori misurati"
    - id: AC-220-5
      given: "un brief con sei offerte distribuite in tre sezioni"
      when: "confronto briefProjection(brief, 'home') e briefProjection(brief, 'inner')"
      then: "il campione di 'inner' e raggruppato per sezione e quello di 'home' e piatto, e l'insieme dei NOMI DI CAMPO presenti e IDENTICO nei due profili (nessun campo nuovo entra nell'allowlist per la fase 2)"
    - id: AC-220-6
      given: "un brief e la sua proiezione"
      when: "confronto il brief prima e dopo la chiamata"
      then: "il brief in ingresso e invariato (funzione pura, nessuna mutazione)"
  target_tests:
    - file: "tests/generation-projection.test.ts"
      covers: [AC-220-1, AC-220-2, AC-220-3, AC-220-4, AC-220-5, AC-220-6]
  security_notes:
    - "OWASP A05:2025 / prompt injection: description, highlights, i nomi delle offerte e business_name provengono da siti terzi via fromUrl (T-141). P1-D24 aveva AZZERATO la superficie mandando al modello i soli nomi di campo; P2 non puo (deve scrivere il copy), quindi la contiene con un'allowlist nominata: e lo stesso principio con un gradino in piu, non un'inversione."
    - "La proiezione e insieme il BUDGET e la DIFESA: il brief intero pesa ~405 KB (~100k token) e le offerte, che sono il 95% del peso, non servono al modello perche il sito le rende direttamente (T-214). Ridurre il payload e ridurre la superficie sono la stessa azione."
    - "LIMITE DICHIARATO (eredita P1 §6-bis p.6-bis): l'asserzione anti-fuga e un match per sottostringa su JSON.stringify. Prova che QUESTA implementazione non perde, NON che nessuna implementazione possa perdere: una fuga TRASFORMATA (base64, percent-encoding, collasso degli spazi) le sfuggirebbe. E non esiste barriera di tipo fra il Brief e la proiezione: briefProjection riceve il Brief INTERO. La proprieta e tenuta da un oracolo, non dal design."
  out_of_scope:
    - "Normalizzazione del testo (T-221)"
    - "Assemblaggio del prompt (T-223)"
    - "Chiamata al confine (T-224)"

- id: T-221
  title: "normalize: normalizzatore conservativo del testo che va al modello"
  macrotask: "generation-llm"
  depends_on: []
  objective: >
    Definire in src/domain/generation/normalize.ts la funzione pura normalizeForPrompt(text)
    che ripulisce il testo della PROIEZIONE prima che entri nel prompt: via i tag HTML, via
    gli URL e gli schemi tipo javascript: e data:, spazi collassati. Si applica SOLO alla
    copia destinata al modello, mai a cio che e salvato. Deve essere CONSERVATIVO: un
    testo legittimo non va rovinato — un'attivita che si chiama "C&C", una description con
    "<3", un nome con apostrofi, accenti o emoji devono sopravvivere intatti. Non e una
    sanificazione per il rendering (quella e T-231) e non va contata come tale.
  definition_of_done:
    - "Modulo src/domain/generation/normalize.ts con normalizeForPrompt(text) esportata, pura"
    - "Rimuove i tag HTML, gli schemi di URL pericolosi (javascript:, data:, vbscript:) e gli URL http/https, e collassa gli spazi multipli"
    - "Non modifica: & non seguito da un'entita, < seguito da un carattere non alfabetico (es. '<3'), apostrofi, lettere accentate, emoji"
    - "Idempotente: normalizeForPrompt(normalizeForPrompt(x)) === normalizeForPrompt(x)"
    - "Non allunga mai il testo: la lunghezza dell'output e minore o uguale a quella dell'input"
  acceptance_criteria:
    - id: AC-221-1
      given: "un testo con tag HTML annidati e un attributo di evento, es. '<div onclick=\"x()\">Bar <b>Sole</b></div>'"
      when: "chiamo normalizeForPrompt"
      then: "il risultato non contiene alcun tag ne alcun attributo, e conserva il testo 'Bar Sole'"
    - id: AC-221-2
      given: "un testo che contiene 'javascript:alert(1)', 'data:text/html;base64,AAA' e 'https://evil.example/x'"
      when: "chiamo normalizeForPrompt"
      then: "nessuno dei tre compare nel risultato"
    - id: AC-221-3
      given: "i testi legittimi 'C&C Ristorazione', 'Ti amo <3', \"L'Osteria dell'Oca\", 'Caffè & Cornetti 🥐'"
      when: "chiamo normalizeForPrompt su ciascuno"
      then: "ciascun testo e restituito con tutti i suoi caratteri significativi intatti: la & resta, il '<3' resta, gli apostrofi, gli accenti e l'emoji restano"
    - id: AC-221-4
      given: "un testo qualsiasi fra quelli dei casi precedenti"
      when: "applico normalizeForPrompt due volte di seguito"
      then: "il secondo risultato e identico al primo (idempotenza)"
    - id: AC-221-5
      given: "una proiezione e il brief da cui deriva"
      when: "applico la normalizzazione alla proiezione"
      then: "il brief in ingresso e la proiezione originale sono invariati: la normalizzazione produce una copia e non muta nulla"
    - id: AC-221-6
      given: "un insieme di venti testi eterogenei, compresi quelli ostili e quelli legittimi"
      when: "misuro la lunghezza di input e output per ciascuno"
      then: "per tutti l'output non e piu lungo dell'input"
  target_tests:
    - file: "tests/generation-normalize.test.ts"
      covers: [AC-221-1, AC-221-2, AC-221-3, AC-221-4, AC-221-5, AC-221-6]
  security_notes:
    - "Riduzione della superficie, NON una difesa dichiarata: normalizeForPrompt toglie le forme in cui un'istruzione si nasconde meglio, ma la difesa contro la prompt injection resta l'allowlist in ingresso (T-220) e l'assenza di leve in uscita (T-222). Contarla come difesa sarebbe un falso via libera (L-COL-006)."
    - "NON e la sanificazione del rendering: quella e T-231 e opera su un percorso diverso (il documento, non il prompt). Le offerte non passano da qui, perche non passano dal modello."
    - "Conservativa per scelta (AC-221-3): una normalizzazione aggressiva rovinerebbe testi legittimi di attivita reali, e il danno sarebbe silenzioso e permanente nel copy generato."
  out_of_scope:
    - "Sanificazione del rendering nel sito generato (T-231)"
    - "Rilevamento di istruzioni iniettate: non tentato, perche non oracolabile"

- id: T-222
  title: "Tool strict del pool + guardia di conformita al sottoinsieme JSON Schema"
  macrotask: "generation-llm"
  depends_on: [T-201]
  objective: >
    Definire in src/domain/generation/tool.ts l'oggetto Anthropic.Tool del pool, scritto a
    mano, con strict: true. Lo schema enumera gli slot richiesti per le pagine in oggetto e
    porta additionalProperties:false E required su OGNI oggetto annidato. I tetti degli slot
    NON compaiono nello schema — lo strict tool use esclude maxLength/maxItems e i vincoli
    numerici (P1-D20) — ma sono dichiarati al modello nella `description`, DERIVATA da
    POOL_LIMITS. Aggiungere una guardia di regressione eseguibile che ispeziona l'oggetto
    REALMENTE passato al confine e non il sorgente.
  definition_of_done:
    - "Modulo src/domain/generation/tool.ts con buildPoolTool(slotIds, pageSlugs) esportata, che ritorna un oggetto tool con strict: true"
    - "Ogni oggetto annidato dello schema porta additionalProperties:false E un array required che COINCIDE, come insieme, con le chiavi di properties (P2-D28)"
    - "La `description` del tool dichiara i tetti degli slot, e i numeri sono derivati da POOL_LIMITS (nessun letterale duplicato)"
    - "Lo schema enumera esattamente gli slot passati, e non altri"
    - "Guardia eseguibile: una funzione/test che cammina RICORSIVAMENTE l'oggetto tool e verifica l'assenza di keyword fuori dal sottoinsieme dello strict tool use"
  acceptance_criteria:
    - id: AC-222-1
      given: "l'oggetto tool prodotto da buildPoolTool per un set di slot che include uno slot 'qa' (quindi con oggetti annidati a due livelli)"
      when: "cammino ricorsivamente ogni nodo di tipo object dello schema"
      then: "OGNI nodo object ha additionalProperties === false E un array required che coincide, come INSIEME, con le chiavi di properties di quel nodo — non soltanto non vuoto (emendamento P2-D28). Lo strict tool use pretende le due cose insieme: una property fuori da required, o un nome in required che non e una property, e un 400 alla prima chiamata reale, invisibile a ogni oracolo senza chiave (chiude il rischio aperto in P1 §6-bis p.2, di cui la sola additionalProperties copriva meta)"
    - id: AC-222-2
      given: "lo stesso oggetto tool"
      when: "cerco ricorsivamente le keyword maxLength, minLength, maxItems, minItems, maximum, minimum, multipleOf, exclusiveMaximum, exclusiveMinimum, uniqueItems e i riferimenti ricorsivi"
      then: "nessuna di queste keyword compare in alcun punto dello schema (conformita al sottoinsieme accertato da P1-D20; la loro presenza sarebbe un 400 alla prima chiamata reale, invisibile a ogni oracolo senza chiave)"
    - id: AC-222-3
      given: "il valore di POOL_LIMITS.text modificato in un doppio del modulo"
      when: "rigenero il tool e leggo la sua `description`"
      then: "il numero riportato nella description cambia di conseguenza: la description DERIVA da POOL_LIMITS e non duplica un letterale"
    - id: AC-222-4
      given: "buildPoolTool chiamata con tre id di slot"
      when: "elenco le property dello schema del pool"
      then: "sono esattamente quelle dei tre slot richiesti, e non compare alcuno slot ulteriore del catalogo"
    - id: AC-222-5
      given: "l'oggetto tool"
      when: "leggo il campo strict"
      then: "strict === true"
  target_tests:
    - file: "tests/generation-tool-schema.test.ts"
      covers: [AC-222-1, AC-222-2, AC-222-3, AC-222-4, AC-222-5]
  security_notes:
    - "P1-D20 come guardia eseguibile: i tool sono oggetti scritti a mano passati a messages.create, quindi nessun SDK rimuove le keyword fuori sottoinsieme. In P1 questo errore fu un errore di DECISIONE dell'orchestratore, trovato dalla verifica avversariale e non da un oracolo: qui l'oracolo esiste (AC-222-2)."
    - "Chiude per costruzione P1 §6-bis p.2: il nested additionalProperties:false SENZA required era il rischio dichiarato e non verificato di P1. AC-222-1 lo verifica ricorsivamente su ogni nodo."
    - "L'ispezione e sull'oggetto REALMENTE prodotto e non sul sorgente: con valori derivati il sorgente non dice nulla (stessa lezione di P1-D20)."
    - "OWASP A05:2025: lo schema strict e il contratto che limita cio che il modello puo emettere. Nessuna property del pool ammette URL, href, src, HTML, nomi di blocco, nomi di tema o colori: e cosi che un'iniezione riuscita resta senza leve (P2-D4)."
  out_of_scope:
    - "Validazione del ritorno (T-201 fornisce PoolSchema; T-224 la applica)"
    - "Prova contro l'API reale: impossibile senza chiave, resta un rischio dichiarato"

- id: T-223
  title: "System prompt per-locale + GENERATION_BUDGET in un solo posto"
  macrotask: "generation-llm"
  depends_on: [T-220]
  objective: >
    Definire in src/domain/generation/prompt.ts i system prompt per-locale (it/es) e
    l'assemblaggio del payload, e in un unico modulo GENERATION_BUDGET tutte le costanti di
    budget: tetti dei profili di proiezione, max_tokens per fase, effort, timeout,
    maxRetries, e i prezzi unitari usati per il bound. L'ordine di assemblaggio e
    cache-friendly: la parte STABILE (tool + system prompt, identica fra tutte le
    generazioni di tutti i clienti) precede la parte VOLATILE (la proiezione del brief).
    Un test deriva dalle costanti il costo massimo per fase e per sito e lo asserisce sotto
    il tetto dichiarato.
  definition_of_done:
    - "Modulo src/domain/generation/prompt.ts con SYSTEM_PROMPTS per locale ('it','es') e buildGenerationPayload(projection, tool, profile) esportate"
    - "buildGenerationPayload applica normalizeForPrompt (T-221) a OGNI stringa della proiezione prima di serializzarla (P2-D26): e questo il punto in cui la proiezione diventa testo del prompt, e senza di esso il normalizzatore non ha alcun consumatore di produzione"
    - "Modulo con GENERATION_BUDGET: tetti dei due profili di proiezione, max_tokens per fase 1 e per chunk di fase 2, effort, timeout, maxRetries, prezzi unitari input/output"
    - "Il payload assemblato ha la parte stabile (tool + system) PRIMA della parte volatile (proiezione), cosi che il prefisso sia cacheabile"
    - "Il system prompt dichiara al modello che i valori dei campi non mostrati non gli sono disponibili e che non deve inventare contenuti"
    - "Test che calcola costo_max per fase e per sito dalle costanti di GENERATION_BUDGET e lo asserisce sotto GENERATION_BUDGET.max_cost_per_site_usd"
  acceptance_criteria:
    - id: AC-223-1
      given: "l'enum dei locale dichiarato in T-121"
      when: "per OGNI locale dell'enum leggo SYSTEM_PROMPTS[locale]"
      then: "esiste per ogni locale dell'enum — il record e TOTALE sul tipo, quindi un locale aggiunto a T-121 rompe il typecheck e obbliga a decidere —, ciascuno e non vuoto, i due sono diversi fra loro, e ciascuno nomina esplicitamente la propria lingua di destinazione"
    - id: AC-223-2
      given: "due brief DIVERSI dello stesso locale"
      when: "assemblo il payload per entrambi e confronto il prefisso che precede la parte volatile"
      then: "il prefisso (tool + system) e IDENTICO byte per byte fra i due payload: e la condizione perche il prompt caching possa colpire"
    - id: AC-223-3
      given: "un brief con tutti i campi valorizzati, compresi quelli fuori allowlist"
      when: "assemblo il payload completo e cerco i valori dei campi fuori allowlist"
      then: "nessuno compare nel payload assemblato: l'assemblaggio non reintroduce cio che la proiezione ha escluso"
    - id: AC-223-4
      given: "le costanti di GENERATION_BUDGET"
      when: "calcolo (tetto_proiezione / 4) x prezzo_input + max_tokens x prezzo_output per la fase 1 e per i chunk della fase 2, e ne sommo il totale per sito"
      then: "il totale calcolato e inferiore a GENERATION_BUDGET.max_cost_per_site_usd, e il test riporta il valore calcolato — alzare una costante senza accorgersi del costo rende questo test ROSSO"
    - id: AC-223-5
      given: "il profilo 'home' e il profilo 'inner'"
      when: "assemblo il payload per ciascuno sullo stesso brief"
      then: "i due payload differiscono nella parte volatile e nella lista di slot richiesti, e condividono lo stesso system prompt per quel locale"
    - id: AC-223-6
      given: "i valori ESATTI di GENERATION_BUDGET (max_tokens per fase, timeout, maxRetries, tetti dei due profili di proiezione) e i soli file sotto src/domain/generation/**, src/data/generations.ts e src/data/anthropic.ts, escluso il modulo che li dichiara"
      when: "cerco in quei file l'occorrenza letterale di ciascuno di quei valori"
      then: "nessuna occorrenza letterale e trovata: ogni uso passa da GENERATION_BUDGET. La ricerca e deliberatamente limitata a quei percorsi e ai valori esatti, per non produrre falsi positivi su numeri usati per altro. src/data/anthropic.ts e nel perimetro per emendamento P2-D30: e il file che CONSUMA timeout, maxRetries ed effort, e lasciarlo fuori rendeva la provenienza asserita sul solo valore"
    - id: AC-223-7
      given: "una proiezione i cui campi di testo portano tag HTML, uno schema javascript:, un data URI, un URL http e la stringa di chiusura della busta, accanto a testi legittimi con una & non seguita da un'entita, un '<3', apostrofi, accenti ed emoji"
      when: "assemblo il payload e leggo la parte volatile"
      then: "nessuna di quelle forme ostili compare, e i testi legittimi sono INTATTI: la normalizzazione di T-221 e in vigore sul percorso reale (P2-D26). Cade con essa anche il falso delimitatore, che chiuderebbe la busta in anticipo perche JSON.stringify non scherma ne '<' ne '/' — la busta non e contata come difesa (P2-D4), ma il compito che il modulo LE ATTRIBUISCE non deve venire meno in silenzio"
  target_tests:
    - file: "tests/generation-prompt.test.ts"
      covers: [AC-223-1, AC-223-2, AC-223-3, AC-223-5, AC-223-7]
    - file: "tests/generation-budget.test.ts"
      covers: [AC-223-4, AC-223-6]
  security_notes:
    - "OWASP A05:2025: AC-223-3 e la seconda rete anti-fuga, dopo quella sulla proiezione (T-220). Un assemblaggio che rileggesse il brief invece della proiezione riaprirebbe la superficie che T-220 chiude, e senza questo controllo la regressione sarebbe silenziosa."
    - "Il system prompt dice al modello che i valori non mostrati non gli sono disponibili: senza questa dichiarazione il modello li INVENTEREBBE, come registrato in P1-D24. E' l'unico punto in cui una frase nel prompt fa un lavoro reale, e non e contata come difesa di sicurezza."
    - "P2-D17: i numeri di GENERATION_BUDGET sono STIME dichiarate provvisorie, non misure. AC-223-4 asserisce la coerenza interna del bound, NON la correttezza delle stime — quella richiede la misura di T-225."
    - "LIMITE DICHIARATO (eredita P1 §6-bis p.7): AC-223-1 asserisce che i prompt per-locale esistono per ogni locale, sono non vuoti e sono diversi fra loro. Una traduzione SBAGLIATA ma diversa passerebbe: la qualita linguistica del prompt non e oracolabile, e senza chiave API non e oracolabile nemmeno il suo effetto. La totalita sul tipo (un locale nuovo rompe il typecheck) e cio che il controllo garantisce davvero."
  out_of_scope:
    - "Chiamata effettiva e guardie sul ritorno (T-224)"
    - "Misura reale dei token (T-225)"
    - "Qualita del copy: non oracolabile senza chiave"

- id: T-224
  title: "runGenerationTurn nel confine unico + guardie terminali sul ritorno"
  macrotask: "generation-llm"
  depends_on: [T-220, T-221, T-222, T-223]
  objective: >
    Aggiungere runGenerationTurn DENTRO src/data/anthropic.ts — non in un file nuovo:
    P1-D7 impone un unico punto di chiamata, e la guardia ESLint deny-by-default vale su
    QUEL file. Stessa forma di runOnboardingTurn: client iniettabile per i test, parametri
    da GENERATION_BUDGET, modello da ANTHROPIC_MODEL_GENERATION con default dichiarato,
    thinking adaptive (mai disabled). Piu le guardie sul ritorno, tutte TERMINALI ed
    esplicite: stop_reason fuori norma, assenza di un blocco tool_use, pool che non valida
    contro PoolSchema. Ciascuna produce un errore con un codice di motivo, non un pool
    parziale.
  definition_of_done:
    - "runGenerationTurn esportata da src/data/anthropic.ts (nessun modulo di confine nuovo), con 'server-only' in testa al file come gia e"
    - "Il client SDK e un parametro iniettabile con default lazy, come runOnboardingTurn"
    - "model da getAnthropicGenerationModel() (accessor in src/config/env.ts) con default 'claude-sonnet-5'"
    - "max_tokens, timeout, maxRetries ed effort provengono da GENERATION_BUDGET; thinking e adaptive"
    - "Guardie sul ritorno: stop_reason diverso da tool_use -> errore con codice; nessun blocco tool_use nella risposta -> errore con codice; input della tool-call che non valida con parsePool -> errore con codice"
    - "Nessuna guardia ritorna un pool parziale o vuoto: il fallimento e terminale e nominato"
    - "La parte STABILE del payload porta il breakpoint cache_control (P2-D29): senza di esso i due campi di cache di usage che T-225 deve misurare sono costantemente nulli, e il prefisso identico byte per byte imposto da AC-223-2 non produce alcun colpo di cache"
  acceptance_criteria:
    - id: AC-224-1
      given: "un doppio del client che ritorna una risposta con stop_reason='max_tokens'"
      when: "chiamo runGenerationTurn"
      then: "l'esito e un errore con codice riconoscibile di troncamento, e nessun pool viene restituito"
    - id: AC-224-2
      given: "un doppio del client che ritorna una risposta con solo blocchi di testo e nessun blocco tool_use, e stop_reason='end_turn'"
      when: "chiamo runGenerationTurn"
      then: "l'esito e un errore con codice riconoscibile di tool-call assente — il modo di fallire in cui il turno riesce e il pool non esiste NON produce un successo"
    - id: AC-224-3
      given: "un doppio del client che ritorna un blocco tool_use il cui input ha uno slot oltre il tetto di POOL_LIMITS"
      when: "chiamo runGenerationTurn"
      then: "l'esito e un errore di validazione con il nome dello slot fuori scala, e nessun contenuto parziale viene restituito"
    - id: AC-224-4
      given: "un doppio del client che registra i parametri ricevuti"
      when: "chiamo runGenerationTurn per la fase 1"
      then: "i parametri REALMENTE passati hanno max_tokens, timeout e maxRetries uguali ai valori di GENERATION_BUDGET, thinking di tipo adaptive, e in nessun caso thinking disabilitato"
    - id: AC-224-5
      given: "un brief con tutti i campi valorizzati e un doppio del client che cattura il payload"
      when: "chiamo runGenerationTurn e cerco nel payload catturato i marcatori dei campi fuori allowlist, in modo case-insensitive e cercando anche il prefisso comune"
      then: "nessun marcatore compare nel payload realmente passato al confine, per il prodotto {it,es} x {import, ruoli invertiti}"
    - id: AC-224-6
      given: "ANTHROPIC_MODEL_GENERATION non impostata, e poi impostata a un valore diverso"
      when: "chiamo runGenerationTurn nei due casi e leggo il model nei parametri catturati"
      then: "nel primo caso e il default dichiarato 'claude-sonnet-5', nel secondo e il valore della variabile d'ambiente"
    - id: AC-224-7
      given: "un modulo-fixture sotto src/ui/ che importa src/data/anthropic"
      when: "eseguo ESLint su quel file con la configurazione del progetto"
      then: "ESLint riporta l'errore di import vietato (la guardia deny-by-default di T-131 copre anche runGenerationTurn, perche vive nello stesso file)"
    - id: AC-224-8
      given: "un doppio del client che cattura i parametri realmente passati"
      when: "chiamo runGenerationTurn e cerco il breakpoint di cache nel payload catturato"
      then: "cache_control e presente sulla coda della parte STABILE (tool + system) e su nessun blocco della parte volatile: e li che il prefisso identico byte per byte di AC-223-2 diventa un colpo di cache invece di una proprieta senza effetto (P2-D29)"
  target_tests:
    - file: "tests/generation-turn.test.ts"
      covers: [AC-224-1, AC-224-2, AC-224-3, AC-224-4, AC-224-6, AC-224-8]
    - file: "tests/generation-boundary-leak.test.ts"
      covers: [AC-224-5]
    - file: "tests/generation-boundary-import-guard.test.ts"
      covers: [AC-224-7]
  security_notes:
    - "P1-D7: un secondo modulo di confine sarebbe un secondo posto da sorvegliare. runGenerationTurn vive nello STESSO file di runOnboardingTurn, quindi eredita 'server-only' e la guardia ESLint senza doverle replicare (AC-224-7)."
    - "OWASP A07/A02:2025 (segreti): ANTHROPIC_API_KEY resta server-only, letta dall'accessor di config (T-130), mai NEXT_PUBLIC, mai nel sorgente; baseline gitleaks 0."
    - "AC-224-5 e l'asserzione anti-fuga DEFINITIVA, perche e fatta sull'oggetto realmente passato al confine e non su un intermedio. Eredita il limite dichiarato di T-220: e un match per sottostringa, quindi una fuga trasformata le sfuggirebbe."
    - "P2-D11: thinking mai disabled (AC-224-4). Su Sonnet 5 il pensiero disattivato riduce la propensione a usare i tool, e il nostro pool E una tool-call; su Opus 5 — attivabile con una env — e documentato che la tool-call puo arrivare come testo visibile, con il turno che riesce e il pool che non esiste. AC-224-2 e la rete che prende quel caso comunque."
    - "Disponibilita e costo: maxRetries dichiarato impedisce il retry silenzioso, che sarebbe una seconda generazione mai chiesta e — quando esistera P5 — un secondo addebito."
    - "NON COPERTO, dichiarato: gli schemi strict non sono provati contro l'API reale (P1 §6-bis p.2). Ogni oracolo qui mocka il confine perche non esiste una chiave."
  out_of_scope:
    - "Rotta HTTP e stream (T-230)"
    - "Misura reale dei token (T-225)"
    - "Qualita e lingua del copy: non oracolabili senza chiave"

- id: T-225
  title: "Harness di misura reale dei token (P2-D17), non eseguibile senza chiave"
  macrotask: "generation-llm"
  depends_on: [T-224]
  objective: >
    Fornire uno script eseguibile che, IN PRESENZA di una chiave API, misura l'uso reale di
    token su un campione di brief veri e confronta la misura con GENERATION_BUDGET,
    segnalando ogni costante che la realta supera. In ASSENZA di chiave si dichiara NON
    ESEGUITO e non produce alcun verde. E' la sede della taratura rinviata da P2-D17: le
    costanti di budget sono stime a tavolino, e count_tokens e un endpoint API. Lo script
    NON fa parte della suite raccolta dal checkpoint: non puo rendere il checkpoint verde
    ne rosso da solo.
  definition_of_done:
    - "Script eseguibile (es. scripts/measure-generation-usage.mjs o equivalente nel progetto) che accetta un campione di brief di test"
    - "Senza chiave API configurata: esce dichiarando 'non eseguito' con un codice di uscita distinto dal successo, e NON scrive alcun report di misura"
    - "Con chiave: per ciascun brief e per ciascuna fase registra input_tokens, output_tokens, cache_creation_input_tokens e cache_read_input_tokens da usage"
    - "Il report confronta i valori misurati con le costanti di GENERATION_BUDGET e segnala esplicitamente ogni costante superata dalla misura"
    - "Lo script non e raccolto dalla suite di test del progetto (non compare nel pattern di include della configurazione di test)"
    - "Il campione contiene almeno un brief ai tetti di P1-D17 (P2-D31): la misura d'INGRESSO deve essere il caso peggiore come gia lo e quella d'uscita (che usa tutti gli slot del catalogo). Un campione al 2-4% del tetto di proiezione taccerebbe proprio sulla costante che T-225 esiste per tarare"
    - "La directory che ospita lo script rientra nel perimetro dei confini di lint e dell'oracolo dead-code (P2-D27): lo script costruisce un client con la chiave grezza, e un perimetro non sorvegliato sarebbe un secondo confine nato per omissione"
  acceptance_criteria:
    - id: AC-225-1
      given: "nessuna chiave API configurata nell'ambiente"
      when: "eseguo lo script"
      then: "l'output dichiara esplicitamente 'non eseguito' per assenza di chiave, il codice di uscita e distinto da quello di successo, e nessun file di report viene scritto"
    - id: AC-225-2
      given: "una chiave finta e un doppio del confine che ritorna una risposta con un blocco usage popolato"
      when: "eseguo lo script su un campione di due brief"
      then: "il report prodotto contiene, per ciascun brief e ciascuna fase, i quattro campi di usage, e riporta il totale"
    - id: AC-225-3
      given: "un doppio del confine che ritorna input_tokens superiore al tetto di proiezione dichiarato in GENERATION_BUDGET"
      when: "eseguo lo script"
      then: "il report segnala esplicitamente quella costante come superata dalla misura, nominandola"
    - id: AC-225-4
      given: "la configurazione di test del progetto"
      when: "elenco i file raccolti dalla suite"
      then: "lo script di misura non e fra quelli raccolti: non partecipa al verdetto del checkpoint"
    - id: AC-225-5
      given: "un modulo-fixture nella directory che ospita lo script, che importa @/data/anthropic e @/data/supabase-admin in forma statica E dinamica"
      when: "eseguo ESLint su quel percorso con la configurazione del progetto"
      then: "ESLint riporta gli errori di import vietato, come li riporta sugli stessi import da src/ui/**: la directory degli script non e un'eccezione nata per omissione. Lo script di misura resta l'UNICA eccezione, dichiarata esplicitamente nella configurazione e non ottenuta col silenzio (P2-D27)"
  target_tests:
    - file: "tests/generation-usage-harness.test.ts"
      covers: [AC-225-1, AC-225-2, AC-225-3, AC-225-4, AC-225-5]
  security_notes:
    - "L-COL-006 reso eseguibile: AC-225-1 asserisce che l'assenza di chiave produce un 'non eseguito' e non un verde. E' la forma piu diretta del divieto di falso via libera — un harness che in assenza di chiave uscisse con successo dichiarerebbe misurato cio che non e stato misurato."
    - "Il campione di brief usato per la misura non deve contenere dati reali di clienti; usa i brief di test del progetto."
    - "La chiave, quando esistera, resta server-only e letta dall'accessor di config: lo script non la stampa ne la scrive nel report."
  out_of_scope:
    - "La misura stessa e la ri-taratura delle costanti: richiedono una chiave e sono fuori dalla DoD di P2 (P2-D17)"
    - "Decisione su crediti e prezzi: P5"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir del blueprint P2 — atteso exit 0.
- **Semantico** (checklist guidata): punti 6–10 su ogni task; i rilievi vanno all'human-in-the-loop.
