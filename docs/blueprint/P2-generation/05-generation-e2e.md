# 05-generation-e2e — Macrotask `generation-e2e` · Il primo end-to-end vero del progetto

> Modulo del blueprint P2 (Generazione dei mockup) di Belora. Un modulo = un macrotask:
> l'unita al cui confine gira il checkpoint e l'unita di commit atomico.
> Task atomici secondo lo schema trueline (id/AC/target_tests/security_notes).
>
> **Il fatto che motiva questo macrotask:** in P0 e P1 **nulla e mai girato in un browser**
> (P1 §6-bis p.1). La UI e stata montata e testata in jsdom, che **non carica risorse**:
> la difesa del rendering e asserita come *"nessun elemento nasce dal testo del brief"* —
> una proprieta dell'**implementazione**, non dell'**effetto**. In P1 era un limite
> laterale, perche l'unica cosa resa era un pannello di form. In P2 il deliverable **e** una
> pagina piena di testo che arriva da siti terzi: il limite sta esattamente sopra il prodotto.
>
> **E non serve la chiave API**: l'artefatto sotto test e il **documento**, che in un
> end-to-end e una fixture. Cade la sola obiezione seria a un end-to-end in questo progetto.

## Obiettivo del macrotask

Provare **sull'effetto** cio che jsdom puo provare solo sulla forma: che il testo ostile
del brief non esegue nulla in un browser reale, che nessuna richiesta di rete parte verso
un host non previsto, che nessuna navigazione avviene — e, prima di tutto questo, che
**l'oracolo sa diventare rosso**. Piu la verifica che il deliverable sia davvero
raggiungibile percorrendo il flusso.

Due task, e il primo esiste per il secondo: senza il **canary**, *"zero errori di console"*
e indistinguibile da *"la pagina non si e caricata"*.

## Task atomici

```yaml
- id: T-240
  title: "Harness Chromium + canary che prova che l'oracolo sa diventare rosso"
  macrotask: "generation-e2e"
  depends_on: [T-235]
  objective: >
    Introdurre l'infrastruttura end-to-end: un runner su Chromium che avvia
    l'applicazione, si autentica, carica una pagina di anteprima da un documento-fixture, e
    raccoglie le OSSERVABILI dell'effetto — errori di console, richieste di rete con il loro
    host, navigazioni, e un contatore globale che un'iniezione riuscita dovrebbe
    incrementare. E, PRIMA di scrivere qualunque verde, un COMPONENTE DELIBERATAMENTE
    INSICURO (canary) confinato al codice di test, che inietta per davvero: le stesse
    asserzioni del task successivo devono prenderlo. E' la correzione di metodo n.7 di P1
    applicata prima e non dopo aver perso due giri.
  definition_of_done:
    - "Runner end-to-end configurato per il solo Chromium, con avvio dell'applicazione e autenticazione dell'utente di test"
    - "Raccolta delle osservabili: messaggi ed errori di console, richieste di rete con host, navigazioni, e un contatore globale su window che parte da zero"
    - "Un componente-canary deliberatamente insicuro, confinato a un percorso di solo test, che inietta ed esegue codice incrementando il contatore globale"
    - "Le asserzioni sull'effetto sono estratte in un helper condiviso, usato sia dal canary sia dallo scenario reale (T-241)"
    - "Il canary NON e raggiungibile dall'applicazione e non compare nel bundle di produzione"
    - "L'end-to-end gira al CHECKPOINT di macrotask e non nel giro per-task"
  acceptance_criteria:
    - id: AC-240-1
      given: "l'harness avviato su Chromium e una pagina di anteprima da un documento-fixture innocuo che contiene un nome di attivita noto"
      when: "carico la pagina e leggo le osservabili raccolte"
      then: "il nome dell'attivita del fixture e presente nel DOM, il contatore globale e zero, e fra le richieste raccolte compare il documento HTML della rotta di anteprima con esito 200 — cosi che 'nessuna richiesta verso host esterni' non possa risultare vera solo perche la raccolta e vuota"
    - id: AC-240-2
      given: "la pagina che monta il componente-canary deliberatamente insicuro"
      when: "applico a quella pagina lo STESSO helper di asserzioni usato dallo scenario reale"
      then: "le asserzioni FALLISCONO: il contatore globale risulta incrementato e/o e registrato un errore di console da codice iniettato — l'oracolo sa diventare rosso"
    - id: AC-240-3
      given: "il bundle di produzione dell'applicazione e le rotte raggiungibili"
      when: "cerco il componente-canary fra gli asset prodotti e fra le destinazioni raggiungibili dall'applicazione"
      then: "il canary non compare nel bundle di produzione e nessuna rotta dell'applicazione lo raggiunge"
    - id: AC-240-4
      given: "la configurazione dei test del progetto"
      when: "elenco i file raccolti dalla suite unitaria e quelli eseguiti dall'end-to-end"
      then: "i due insiemi sono disgiunti: l'end-to-end non e raccolto dalla suite unitaria che gira nel giro per-task"
    - id: AC-240-5
      given: "la configurazione del runner"
      when: "leggo i browser previsti"
      then: "e previsto il solo Chromium"
  target_tests:
    - file: "e2e/harness.spec.ts"
      covers: [AC-240-1, AC-240-2]
    - file: "tests/e2e-canary-confinement.test.ts"
      covers: [AC-240-3, AC-240-4, AC-240-5]
  security_notes:
    - "L-COL-006 reso eseguibile: AC-240-2 e il controllo di sanita palesemente fatale. Senza di esso, 'zero errori di console' e indistinguibile da 'la pagina non si e caricata', e il verde di T-241 non significherebbe nulla. E' la correzione di metodo n.7 di P1 (controllare lo STRUMENTO DI MISURA, non solo il codice) applicata a monte."
    - "Il canary e codice deliberatamente vulnerabile: AC-240-3 asserisce che e confinato al test e non raggiungibile ne incluso nel bundle di produzione. Un canary che finisse in produzione sarebbe una vulnerabilita introdotta per provarne l'assenza."
    - "Costo dichiarato: l'end-to-end introduce una dipendenza di sviluppo, un binario di browser e un tipo di flakiness che il progetto non ha ancora mai avuto. Gira al checkpoint, non a ogni task."
  out_of_scope:
    - "Scenario ostile e raggiungibilita del deliverable (T-241)"
    - "End-to-end del flusso di P1 (login, onboarding, conferma): fuori da P2, per il rate limit auth"

- id: T-241
  title: "Documento ostile asserito sull'effetto + raggiungibilita del deliverable"
  macrotask: "generation-e2e"
  depends_on: [T-240]
  objective: >
    Usare l'harness per i due scenari che giustificano l'esistenza dell'end-to-end.
    Primo: l'anteprima di un documento costruito da un brief OSTILE, con payload che in
    jsdom sono inerti per costruzione (tag script, tag con attributo di evento, href con
    schema javascript:, iframe con srcdoc, url() in CSS, e un photo_ref che punta a un host
    attaccante), asserendo l'EFFETTO — nessuno script ha girato, nessuna richiesta verso
    host fuori allowlist, nessuna navigazione, nessun errore di console da codice iniettato.
    Secondo: percorrere una volta genera -> scegli -> anteprima in un browser reale, per
    dimostrare che il deliverable e raggiungibile e non solo presente nel sorgente.
  definition_of_done:
    - "Scenario ostile: un brief-fixture i cui campi di testo portano i sei payload elencati nell'objective, portato a documento attraverso il percorso reale (resolve) e reso dall'anteprima"
    - "Le asserzioni usano l'helper condiviso di T-240 (le stesse che il canary fa fallire)"
    - "Scenario di raggiungibilita: percorso genera -> scegli -> anteprima eseguito una volta in Chromium, col confine LLM sostituito da un doppio deterministico"
    - "L'elenco degli host ammessi per le richieste di rete e dichiarato nel test, non implicito"
  acceptance_criteria:
    - id: AC-241-1
      given: "l'anteprima di un documento derivato dal brief ostile, caricata in Chromium"
      when: "leggo il contatore globale che un'iniezione riuscita incrementerebbe"
      then: "il contatore e zero: nessuno script proveniente dal testo del brief e stato eseguito"
    - id: AC-241-2
      given: "la stessa pagina e l'elenco dichiarato degli host ammessi"
      when: "raccolgo tutte le richieste di rete effettuate dalla pagina"
      then: "nessuna richiesta e diretta a un host fuori dall'elenco dichiarato; in particolare nessuna richiesta raggiunge l'host dell'attaccante presente nel photo_ref del brief"
    - id: AC-241-3
      given: "la stessa pagina"
      when: "confronto l'URL corrente prima e dopo il caricamento e leggo le navigazioni registrate"
      then: "nessuna navigazione e avvenuta: l'href con schema javascript: e l'iframe non hanno spostato il documento"
    - id: AC-241-4
      given: "la stessa pagina"
      when: "leggo gli errori di console raccolti"
      then: "non esiste alcun errore attribuibile a codice iniettato dal testo del brief"
    - id: AC-241-5
      given: "un utente di test autenticato con un brief confermato e il confine LLM sostituito da un doppio deterministico"
      when: "in Chromium percorro genera -> scelgo una variante -> apro l'anteprima"
      then: "la pagina finale contiene il contenuto del documento scelto (almeno il nome dell'attivita e una voce di offerta), dimostrando che il percorso e raggiungibile dall'applicazione e non solo presente nel sorgente"
    - id: AC-241-6
      given: "i payload dello scenario ostile"
      when: "verifico che ciascuno dei sei sia effettivamente presente nel documento reso (come testo)"
      then: "tutti e sei sono presenti nel DOM come contenuto testuale: lo scenario esercita davvero i payload e non passa perche il testo ostile e stato scartato prima di arrivare alla pagina"
  target_tests:
    - file: "e2e/hostile-document.spec.ts"
      covers: [AC-241-1, AC-241-2, AC-241-3, AC-241-4, AC-241-6]
    - file: "e2e/reachability.spec.ts"
      covers: [AC-241-5]
  security_notes:
    - "OWASP A03:2025 (XSS) provato sull'EFFETTO e non sulla forma: e la differenza fra 'nessun elemento nasce dal testo del brief' (jsdom, P1) e 'nessuno script ha girato' (browser reale). Chiude la parte oracolabile del carry-over P1 §7 p.5 e supera il limite dichiarato in P1 §6-bis p.1."
    - "AC-241-2 e significativa PERCHE T-202 e T-214 hanno reso il photo_ref irrappresentabile nel documento: lo scenario prova che l'intera catena tiene, dal brief alla pagina, non solo un anello."
    - "AC-241-6 e la rete contro il test placebo: se il testo ostile fosse scartato a monte, tutte le altre asserzioni passerebbero senza aver provato nulla. Asserire la PRESENZA dei payload nel DOM e cio che rende non vacue le asserzioni sull'assenza di effetto — stessa famiglia di difetto delle fixture a un solo elemento (correzione di metodo n.1 di P1)."
    - "AC-241-5 e la lezione di T-151 portata in un browser reale: 'npm run build' passava mentre i componenti erano assenti dagli asset."
    - "NON COPERTO, dichiarato: l'end-to-end non percorre login e onboarding (rate limit auth, P1 §6). Non prova la qualita del copy ne la lingua. Non sostituisce una revisione di sicurezza del sito pubblicato, che e superficie di P4."
  out_of_scope:
    - "End-to-end del flusso di P1"
    - "Test su browser diversi da Chromium"
    - "Prova contro l'API Anthropic reale: impossibile senza chiave"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir del blueprint P2 — atteso exit 0.
- **Semantico** (checklist guidata): punti 6–10 su ogni task; i rilievi vanno all'human-in-the-loop.
