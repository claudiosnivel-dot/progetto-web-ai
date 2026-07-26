# P2 — Generazione dei mockup (brief confermato → 5 design fra cui scegliere) · Documento di Design

> **Progetto:** Belora · **Sotto-progetto:** P2 (3° dei 10) · **Data:** 2026-07-26 · **Stato:** design approvato in brainstorming; pronto per **trueline BOOTSTRAP**.
> **A monte:** `docs/superpowers/specs/2026-07-22-ai-website-builder-design.md` (visione) · `docs/blueprint/P1-onboarding/` (**P1 completo e verde su `main`**) · `docs/superpowers/research/2026-07-26-media-ingest-feasibility.md` (foto del cliente).
> **Deliverable di questa sessione:** SOLO questo documento (nessun codice). Il blueprint tecnico verrà generato via trueline in fase successiva.

---

## 1. Visione di P2 in una frase

**Trasformare un Business Brief confermato in cinque mockup fra cui l'utente sceglie — dove la bellezza è garantita dal codice, non dal modello.**

**Confini:**
- **P1 (fatto)** consegna: un brief `status='confirmed'`, forma di T-121, coi tetti di P1-D17 (fino a 200 offerte, riga fino a **~405 KB**).
- **P2 (questo)** consegna: 5 mockup, la scelta dell'utente, e un **documento di sito congelato** — l'artefatto che P3 modifica e P4 pubblica.
- **P3/P4 (dopo)**: editor inline e pubblicazione. *P2 da solo non produce un sito pubblicato: produce il documento e la sua anteprima.*

**Il motore non è codegen libero**: è **libreria di blocchi premium × temi**. È così che "risultati brutti strutturalmente impossibili" diventa una proprietà del codice invece di una speranza affidata a un prompt — e l'unica forma per cui, senza chiave API, abbiamo oracoli veri.

---

## 2. Scope di P2 v1 — decisioni chiuse in brainstorming

| # | Decisione | Scelta | Motivazione |
|---|---|---|---|
| D1 | **Cosa varia fra i 5 mockup** | **Tema + struttura**, copy condiviso. Cinque **direzioni dichiarate a mano da noi**, non inventate dal modello | Le 5 opzioni diventano scelte di *comunicazione*, non solo di colore. La garanzia di bellezza deve stare nel codice che possiamo testare: un modello che sceglie liberamente i blocchi la riporta a essere una speranza. **5 direzioni universali** × blocco offerte che si specializza per verticale (5 ricette, non 25) |
| D2 | **Quante chiamate al modello** | **Una**: produce un **pool di contenuti** (superset normalizzato di slot). Le 5 varianti sono `render(resolve(pool, ricetta, tema))`, **funzioni pure** | Ricette diverse hanno slot diversi e devono pescare dallo stesso testo. Massimo prodotto in codice puro e testabile; una sola esposizione del testo non fidato per build; latenza minima |
| D3 | **Semantica del "rigenera"** | **Copy-on-write per variante**: le 5 nascono sullo stesso pool; rigenerarne una le dà un **pool proprio** (1 chiamata), le altre 4 non si muovono. Cambiare tema/ricetta è puro → **0 chiamate, 0 crediti** | La rigenerazione globale è la "rigenerazione alla cieca" che rimproveriamo ai competitor (visione §2 p.2). Deciso ORA perché è una **forma dello schema**: aggiungerlo dopo è una migrazione su dati di clienti |
| D4 | **Cosa del brief arriva al modello** | **Allowlist in ingresso** (proiezione nominata, con tetto in code unit) **+ nessuna leva in uscita** (solo testo in slot nominati). Busta con delimitatori presente ma **non contata come difesa** | Il brief intero pesa ~405 KB ≈ **~100k token**: la selezione è insieme il budget e la difesa. Le offerte **non passano dal modello** — sono già dati strutturati e vanno nel sito così come sono. Regola: *al modello vanno solo i campi da cui deve scrivere; i campi che il sito rende tali e quali non lo attraversano*. È P1-D24 con un gradino in più, non un'inversione |
| D5 | **Dove vive l'output** | **Due tabelle**; le 5 varianti sono **codice, non righe**; **congelamento alla scelta** in `site_generations.document` | Le varianti sono derivabili: salvarle è salvare un valore che diverge dal codice al primo ritocco di una ricetta. Ma il sito *scelto* deve essere dato, o cambia sotto i piedi del cliente. File in Storage scartati: media/hosting è **P4** (P1-D10) e la RLS su Storage è superficie nuova |
| D6 | **Come si aspetta la generazione** | **Sincrona con stream di trasporto** (pattern P1-D18), **durabilità dalla riga non dal trasporto** | Nessun worker da introdurre. La riga `status='generating'` si crea prima della chiamata: se il browser muore, la route continua e l'utente ricarica trovando il risultato. Struttura e tema sono nostri e deterministici → **le 5 cornici partono nel primo flush**, il pool nel secondo |
| D7 | **Brief confermato ma povero** | **Blocchi condizionati ai dati**: ogni blocco ha una precondizione; senza dati **non esiste** (né vuoto né lorem ipsum). La soglia **deriva** da quanti blocchi sopravvivono | La visione §5 vieta di inventare: un menu plausibile su un ristorante vero è un sito che **mente**. Con `slotsFor(brief)` il modello non ha nemmeno la *possibilità* di scrivere la sezione senza base. È il gate di qualità di §10.3-B spostato a monte, e trasforma la povertà da rifiuto in **percorso** |
| D8 | **Cosa accade dopo la scelta** | **Anteprima a piena pagina in sola lettura**. Rendering in **due funzioni pure in fila**: `resolve(pool,ricetta,tema) → documento` e `render(documento) → pagina` | Il "wow" è questo, e §6 dice che P1+P2 è il prototipo da validare per primo. È il solo posto in cui la sanificazione (carry-over P1 §7 p.5) ha un percorso da testare. **Un solo renderer** per card e anteprima → *ciò che scegli è ciò che ottieni* è irrappresentabile-altrimenti, non sorvegliato |
| D9 | **End-to-end vero** | **Sì, minimo e dichiarato**: Chromium, due scenari, **più un canary** | In P1 il limite di jsdom era laterale; qui il deliverable *è* una pagina piena di testo che arriva da siti terzi. E **non serve la chiave API**: l'artefatto sotto test è il **documento**, che in un E2E è una fixture — cade la sola obiezione seria |
| D10 | **Lingua del contenuto** | **Etichette dai cataloghi i18n** `it`/`es`; il modello scrive **solo la prosa** dell'attività | Le etichette non variano fra i siti: farle scrivere al modello è pagare token per testo fisso e renderlo non deterministico. E la CTA derivata da `primary_goal` fa rispettare **dal codice** la regola Meta del 15/01/2026 sugli agenti a scopo definito (visione §12) |
| D11 | **Modello e budget** | **Sonnet 5** (`claude-sonnet-5`), env `ANTHROPIC_MODEL_GENERATION` col pattern di P1-D4. Pensiero **adaptive acceso**, `effort` come leva | Il compito è copywriting da dati strutturati con schema d'uscita fisso, non ragionamento agentico: è la forma in cui il divario con Opus è più stretto. **~1,7× più economico** di Opus 5 a prezzo pieno ($3/$15 vs $5/$25), **~2,5×** col prezzo introduttivo $2/$10 in vigore **fino al 31-08-2026** — che non è una base per una decisione strutturale. E più veloce, che conta perché D6 è sincrona. **Mai `thinking: disabled`**, per due ragioni cumulative: su Sonnet 5 il pensiero disattivato **riduce la propensione a usare i tool** (e il nostro pool *è* una tool-call), e su Opus 5 — che l'env ci permette di attivare in un attimo — è documentato che la tool-call può arrivare come **testo visibile**: il turno riesce, nessun errore, e il pool non esiste |
| D12 | **Foto nei mockup di v1** | **Imagery del tema**, non le foto del brief. Ma il documento nasce con lo **slot immagine tipato per sorgente** (`theme-placeholder` \| `uploaded`) | `photo_ref` è un URL di terzi (P1-D10): metterlo in un `src` è hotlinking, espone l'IP di chi guarda e farebbe **cadere l'asserzione di P1** che `photo_ref` non finisce in un `src`. Lo slot tipato costa una proprietà oggi e risparmia a P4 una migrazione del contratto del documento. Vedi la ricerca del 2026-07-26 |

---

## 3. Non-goals di P2 v1 (rinviato — esplicito)

- **Editor inline** dei contenuti → **P3**. P2 si ferma all'anteprima in sola lettura.
- **Pubblicazione**, pre-render statico, R2/Worker, domini → **P4**.
- **Ingest di media** (upload, Google Photos Picker, WhatsApp, Web Share Target) → **P4**. Studio di fattibilità già fatto: `docs/superpowers/research/2026-07-26-media-ingest-feasibility.md`.
- **Crediti e addebito** → **P5**. P2 non conta né scala nulla; il bound di costo per build è però **calcolato e asserito** (§9).
- **Multi-pagina**: v1 genera **una pagina** (one-pager). Le pagine aggiuntive del piano a pagamento → dopo P4. ⚠️ **Assunzione di scope introdotta in stesura, da confermare**: non è uscita da una domanda di brainstorming. Segue dal funnel della visione (§7.5: free = one-pager) e dal modello a crediti (§7.3: *«1 credito = 1 variante di design di **pagina**»*), ed è quel che serve al prototipo da validare per primo (§6). Ma il multi-pagina cambierebbe il motore — sitemap, navigazione, ricette a livello di pagina — quindi va deciso, non ereditato.
- **SEO premium**, schema.org avanzato, pagine programmatiche → **P4/P7**.
- **Teaser pubblico anonimo** con modello economico → **P6**.

---

## 4. Flusso utente

```
dashboard (badge "pronto per generare" di T-153 → CTA)
  └─ /{locale}/generate/{siteId}     auth + proprietà via listSites() (P1-D21)
       ├─ getBrief → generatable(brief)?
       │    └─ NO → "ti manca X — aggiungilo e sblocchi il blocco Y" → torna all'onboarding
       └─ SÌ → "Genera 5 design"
            └─ POST /api/generate    catena di guardie (guard.ts) · tetto byte · Sec-Fetch-Site + Origin
                 ├─ createGeneration → status='generating'
                 ├─ FLUSH 1: le 5 cornici (ricetta + tema)        ← puro, zero rete
                 ├─ projection → normalize → prompt + tool → runGenerationTurn
                 ├─ stop_reason ok? blocco tool_use presente? PoolSchema valida?  → no ⇒ 'failed'
                 ├─ writePool(variant_index = null) + status='ready'
                 └─ FLUSH 2: il pool
                      └─ 5 card = render(resolve(pool, ricetta_i, tema_i, brief))   ← STESSO renderer
                           ├─ "rigenera il testo di questa" → pool con variant_index = i (1 chiamata)
                           └─ "scegli questa" → chosen_variant = i, document = resolve(...) CONGELATO
                                └─ /{locale}/preview/{siteId}   legge il DOCUMENT, mai il pool
```

**Riscelta**: libera e gratuita in P2 (nessuno ha ancora modificato il documento). **Ha una scadenza**: quando P3 esiste, riscegliere **distrugge le modifiche** e vorrà una conferma esplicita — decisione di P3, registrata qui perché non ce ne accorgiamo dopo.

---

## 5. Architettura & moduli

Tre strati, nel rispetto della guardia di layering esistente (`src/app` → `src/domain` → `src/data`).

**`src/domain/generation/` — puro, nessun I/O.** È dove vive la garanzia, perché è l'unico posto con oracoli veri.

| Modulo | Responsabilità |
|---|---|
| `slots.ts` | Vocabolario degli slot di contenuto, ognuno con la **precondizione** sui campi del brief |
| `pool.ts` | `PoolSchema` (zod) + `POOL_LIMITS` in costanti nominate — valida l'uscita del modello, alla T-121 |
| `document.ts` | `SiteDocumentSchema` — contratto dell'artefatto congelato. **Slot immagine tipato per sorgente** (D12) |
| `blocks.ts` | Libreria: ogni blocco dichiara gli slot che consuma e la precondizione. Blocco offerte con varianti per verticale |
| `recipes.ts` | Le 5 direzioni, con identificatori versionati |
| `themes.ts` | I 5 set di token **di P2** |
| `resolve.ts` | `resolve(pool, ricetta, tema, brief) → SiteDocument` — pura, deterministica |
| `generatable.ts` | Nozione di *generabile* propria di P2: blocchi superstiti, cosa manca, cosa sbloccherebbe |
| `projection.ts` | Allowlist in ingresso, con tetto in code unit |
| `normalize.ts` | Normalizzatore conservativo (via HTML, URL, schemi `javascript:`) — **solo sulla copia che va al modello** |
| `tool.ts` | Tool strict del pool: `additionalProperties:false` **+** `required` su ogni oggetto annidato; tetti nella `description` |
| `prompt.ts` | System prompt per-locale, costruito dalla proiezione |

**`src/data/`.** `runGenerationTurn` si aggiunge **dentro `src/data/anthropic.ts`**, non in un file nuovo: P1-D7 dice "unico punto di chiamata", e la guardia ESLint deny-by-default vale su *quel* file. Più `src/data/generations.ts`, con `listGenerationStatuses()` in **una query** (evita di ripetere l'N+1 di P1 §7 p.15).

**Rotte** (un segmento per fase, come P1): `/{locale}/generate/{siteId}`, `/{locale}/preview/{siteId}`, `POST /api/generate`. Middleware esteso, e la protezione di `/preview` **riasserita nei test di P2** invece di appoggiarsi all'oracolo di T-150 (chiude P1 §7 p.16).

**UI.** `src/ui/generation/` (selettore, anteprima) e `src/ui/site/blocks/` (blocchi del sito generato). **La separazione dei temi è imposta, non convenuta**: una regola `no-restricted-imports` vieta a `src/ui/site/**` di importare `src/ui/theme/tokens` — lo stesso meccanismo di P1-D7. Senza, ritoccare il chrome del builder cambierebbe i siti dei clienti.

---

## 6. Modello dati

**`site_generations`** — **1:N** con `sites` (1:1 renderebbe impossibile rigenerare un set intero più tardi).

| Colonna | Note |
|---|---|
| `account_id`, `site_id` | **FK composita** `(account_id, site_id) → sites(account_id, id)`, come `site_briefs`/T-120 |
| `status` | `generating` \| `ready` \| `failed` \| `chosen` |
| `chosen_variant` | `smallint null CHECK (0..4)` — una **colonna con CHECK**, non un campo dentro un blob |
| `document` | `jsonb null` — popolata **dalla scelta**. Punto di consegna a P3 |
| `failure_reason` | codice, non prosa |

**`generation_pools`** — `generation_id`, `variant_index smallint null` (NULL = condiviso, 0..4 = copy-on-write), `content jsonb`, **`UNIQUE(generation_id, variant_index)`**: è D3 resa schema, e rende irrappresentabili due pool per la stessa variante.

**Indice UNIQUE parziale** su `site_id WHERE status='generating'`: la doppia generazione in volo diventa irrappresentabile invece di gestita. Primo argine reale al problema di frequenza che P1 ha dichiarato e non risolto (§6-bis p.11).

**RLS** clonata da `site_briefs` (policy ancorate a `is_account_member(account_id)`, `account_id` esplicito nel testo per l'auditabilità statica), GRANT espliciti, nessun accesso `anon`.

**Peso dichiarato.** Il documento incorpora le offerte — deve, altrimenti modificare il brief cambierebbe un sito già scelto — quindi al tetto pesa **~450 KB**. In P1 lo stesso numero è un limite *senza oracolo* (§6-bis p.10); qui **un test lo misura**.

**Sede definitiva del documento**: decisione di **P3**. Metterlo in `site_generations.document` lo rende esistente e leggibile e lo marca come punto di consegna; se P3 lo promuove a tabella con versioni è una migrazione di *forma*, su dati che allora sono **zero**.

---

## 7. Il motore

**Blocchi** (hero, offerte, chi-siamo, orari, contatti/mappa, recensioni, FAQ, CTA WhatsApp…). Ogni blocco dichiara: gli slot di contenuto che consuma, i campi del brief che rende direttamente, e la **precondizione** che ne determina l'esistenza.

**Ricette**: 5 direzioni universali, ognuna una sequenza ordinata di blocchi con un tema associato. Il **blocco offerte** si specializza per `vertical` (etichetta, layout, presenza del prezzo) — è il modo per avere 5 ricette invece di 25, coerente con P1-D3 (una sola lista `offerings` con un tag).

**Temi**: 5 set di token propri di P2 (colore, tipografia, spaziatura, raggi). `vertical = 'altro'` **non conta** come verticale scelto — `emptyBrief` lo porta comunque, stessa lettura di P1-D24.

**`brand_hints`** è l'unico campo di testo libero che vorrebbe influenzare l'estetica: in v1 è usato **solo come indicazione di tono per il copy**, mai per scegliere il tema. Lasciarglielo scegliere sarebbe un canale — piccolo, ma un canale.

---

## 8. Il confine LLM

**Ingresso — allowlist nominata.** Al confine arriva una proiezione dichiarata: `business_name`, `vertical`, `description`, `primary_goal`, `locale`, `brand_hints`, `highlights`, più un **campione di soli nomi** di offerte con la loro sezione. **Niente** descrizioni delle offerte, prezzi, contatti, orari, indirizzo, social. Stima: **~8k token invece di ~100k**.

**Uscita — nessuna leva.** Il contratto è **solo testo di contenuto in slot nominati**, ognuno con schema e tetto. Il modello **non** emette URL, `href`, `src`, HTML, nomi di blocco, nomi di tema, colori. Struttura e tema sono già nostri (D1); i link nascono dai campi strutturati del brief attraverso i loro validatori. **Un'iniezione riuscita ottiene un copy diverso da quello atteso — in un mockup che l'utente guarda prima di pubblicare — e nient'altro.**

**Schema strict.** Confermato sulla documentazione (non a memoria) che il sottoinsieme JSON Schema **esclude** `minLength`/`maxLength`, i vincoli numerici e gli schemi ricorsivi: i tetti degli slot vivono nella `description` del tool e nella validazione zod **dopo** il ritorno — pattern di **P1-D20**. Ogni oggetto annidato porta `additionalProperties:false` **e** `required`, il che **chiude per costruzione** il rischio aperto in P1 §6-bis p.2.

**Guardie sul ritorno**, tutte terminali e esplicite: `stop_reason` fuori norma → `failed`; **nessun blocco `tool_use`** → `failed` (è il modo di fallire silenzioso documentato); pool che non valida → `failed`.

**Costanti dichiarate**: `max_tokens`, timeout e `maxRetries` in costanti nominate — non i 30 minuti ereditati per default di P1 §7 p.9, e nessun retry silenzioso che sarebbe una seconda build mai chiesta.

**Il budget si misura in code unit, non in token**: `count_tokens` è un endpoint API e senza chiave non è utilizzabile. L'oracolo resta il conteggio in code unit col rapporto ~4:1 già usato in P1 — **un proxy dichiarato, non la verità**, da ri-baselinare il primo giorno con una chiave.

---

## 9. Testabilità sotto trueline (ORACLE-AS-JUDGE)

- **Funzioni pure** — fixture secondo la correzione di metodo n.1 di P1: **più di un elemento**, valori **discordanti**, e un id che è **prefisso** di un altro.
- **Anti-fuga** — nessun campo fuori allowlist raggiunge il confine, asserito sull'oggetto **realmente passato** a `runGenerationTurn` (non sul sorgente: lezione di P1-D20), sul prodotto `{it,es} × {import, ruoli invertiti}`, **case-insensitive** e con assenza anche del **prefisso** comune.
- **Conformità dello schema** — nessun keyword fuori sottoinsieme in nessun punto del tool; `additionalProperties:false` **e** `required` su ogni oggetto annidato.
- **Bound di costo calcolato** — un test deriva dalle costanti dichiarate
  `costo_max_build = (tetto_proiezione / 4) × prezzo_input + max_tokens × prezzo_output`
  e lo asserisce sotto il tetto. Entrambi i lati sono limitati da costanti che scegliamo noi: **il costo peggiore è un numero, non una speranza**.
- **Peso del documento** — misurato su un brief con ogni campo al tetto.
- **DB-backed con `signInAs`** — RLS sulle due tabelle, negazione cross-tenant, `23503` sul site-squatting, e l'indice parziale che respinge la seconda generazione concorrente.
- **Ordine dei due flush** — le cornici escono **mentre la chiamata è in volo** (mock con gate controllato dal test): la forma d'oracolo di T-150, non "è uno stream".
- **End-to-end** (Chromium, al **checkpoint di macrotask**, non nel giro per-task): documento ostile con asserzioni sull'**effetto** (nessuno script ha girato, nessuna richiesta verso host fuori allowlist, nessuna navigazione) — **più un componente deliberatamente insicuro (canary)** che le stesse asserzioni devono prendere. *"Zero errori di console" è indistinguibile da "la pagina non si è caricata"*: è la correzione di metodo n.7 applicata **prima** di scrivere il verde.
- **Stile** — resta **non asserito** (P1 §6-bis p.8) e va dichiarato. Due controlli a costo quasi zero che non sono "bellezza": i 5 temi producono valori di token **diversi fra loro**, e nessun blocco contiene un **hex letterale**.

---

## 10. Definition of Done di P2

1. Da un brief `confirmed` si ottengono **5 mockup visibilmente diversi per struttura e tema**, con una sola chiamata al modello.
2. Rigenerare il testo di **una** variante non tocca le altre quattro.
3. La scelta **congela** un documento che l'anteprima rende a piena pagina, e che non cambia più se ritocchiamo una ricetta.
4. Un brief povero **non produce mockup sottili**: produce l'elenco di cosa manca e cosa sbloccherebbe.
5. Nessun valore del brief fuori allowlist raggiunge il confine LLM — asserito.
6. Il testo ostile del brief non esegue nulla nel browser — asserito **sull'effetto**, col canary che prova che l'oracolo sa diventare rosso.
7. Checkpoint trueline **4/4** (dead-code · sicurezza · regressioni · conformità-logica), baseline di sicurezza e d'igiene invariate o attribuite.

---

## 11. Decisioni di ledger da portare al bootstrap

`P2-D1`…`P2-D12` = le dodici decisioni della tabella §2, riportate verbatim nel `00-INDEX` del blueprint. Più le derivate emerse dal design:

- **`P2-D13`** — separazione del layer temi imposta da `no-restricted-imports`, non da convenzione.
- **`P2-D14`** — **riconciliazione dello stato**: una riga `generating` più vecchia del timeout dichiarato si legge come `failed`. L'indice UNIQUE parziale è la difesa contro la doppia generazione **ed è anche il modo di incastrarsi**: se il processo muore nessun `finally` gira, e senza riconciliazione il sito resterebbe non generabile per sempre. Servono **due** meccanismi, non uno.
- **`P2-D15`** — un guasto di lettura del brief **non si rende come "brief povero"**: è la lezione di T-152 spostata, dove un errore transitorio diventava un brief vuoto.

---

## 12. DAG previsto dei task atomici

```
generation-model  (T-200..)   contratti: migrazioni + RLS, slots, PoolSchema, SiteDocumentSchema, azioni dati
        │
        ├──> generation-engine (T-210..)  blocchi, ricette, temi, resolve, generatable
        │                                                                              ┐ indipendenti
        └──> generation-llm    (T-220..)  projection, normalizer, tool strict,          │ fra loro
                                          prompt, confine, guardie sul ritorno         ┘
                     │
                     └──> generation-ui  (T-230..)  rotta + 2 flush, selettore, rigenera,
                          (richiede engine E llm)   scegli & congela, anteprima, dashboard
                                 │
                                 └──> generation-e2e (T-240..)  harness Chromium + canary
                                                                + documento ostile
```

`generation-model` = **contratti**, `generation-engine` = **trasformazione pura**, `generation-llm` = **il confine**. `generation-e2e` resta separato: è una superficie d'oracolo nuova con la sua infrastruttura, e fonderla in `generation-ui` renderebbe quel checkpoint meno leggibile. Ordine e granularità definitivi li fissa il bootstrap.

---

## 13. Rischi & punti aperti

**Ereditati da P1, che P2 tocca:**
- **Sanificazione del testo importato nel sito generato** (P1 §7 p.5) — è di P2, ed è il *motivo* per cui esiste l'anteprima: senza un percorso di rendering, quella difesa non ha dove essere provata.
- **Gli schemi strict non sono mai stati provati contro l'API reale** (P1 §6-bis p.2) — resta aperto, ma il nested `updates` senza `required` è chiuso per costruzione qui (§8).
- **Nulla limita la frequenza delle richieste** (P1 §6-bis p.11) — l'indice parziale è il primo argine, non la soluzione: manca un tetto sul **numero totale** di generazioni per sito, che è di **P5** (crediti).

**Nuovi:**
- **Ambiguità nei termini di terzi** — vedi la ricerca del 2026-07-26 §4: non tocca P2, ma tocca P4.
- **Il modello può rispondere nella lingua sbagliata** — difetto di *qualità*, non di sicurezza; non oracolabile senza chiave; visibile nell'anteprima prima che esista una pubblicazione. Nessun rilevatore di lingua: dipendenza nuova con falsi positivi su nomi propri.
- **`es` è una lingua sola** (T-121) — l'ingresso in LATAM (visione §14) porta *ustedes*/*vosotros*, voseo e lessico diverso: la prosa `es` che generiamo è di fatto iberica. Non risolvibile in P2, ma da sapere prima che ci siano contenuti da migrare.
- **La debolezza dei cataloghi si eredita** (P1 §6-bis p.7): una traduzione **sbagliata ma diversa** passa l'oracolo. Vale anche per le etichette dei blocchi.
- **Taratura crediti↔costo** — con Sonnet 5 una build costa **~$0,06 (prezzo introduttivo) – ~$0,08 (prezzo pieno)**, e fino a ~$0,13 se la proiezione o l'uscita crescono verso i tetti. Il piano **Studio** (400 crediti = 80 build, se esaurite) porta la sola inferenza a **~11–17% del ricavo** di €39, prima di hosting e commissioni; ai prezzi PPP la quota sale (Starter Colombia ≈ €3,40 → ~9% con Sonnet, ~24% con Opus 5). Su Opus 5 gli stessi conti raddoppiano circa. Decisione di **P5**, che la visione §7.3 dichiara già pendente; la visione §7.4 vieta già di far scendere il promo sotto il costo marginale.
- **Tetto di durata delle funzioni** sulla piattaforma di hosting: va verificato contro il budget di latenza (obiettivo secondo flush < 60 s). Non misurato.

---

## 14. Prossimo passo

**trueline BOOTSTRAP** su questo documento → `docs/blueprint/P2-generation/` con `00-INDEX` (mappa, piano di build, DAG, decision ledger `P2-D1..P2-D15`, aggancio alla sicurezza), i moduli-macrotask coi task atomici (`definition_of_done` + `acceptance_criteria` + `target_tests` + `security_notes`), `SESSION-STATE.md` e `prompts/`.
Self-check: `validate_blueprint.mjs docs/blueprint/P2-generation` → atteso **exit 0**.
