# P2 — Generazione dei mockup (brief confermato → 5 design fra cui scegliere) · Documento di Design

> **Progetto:** Belora · **Sotto-progetto:** P2 (3° dei 10) · **Data:** 2026-07-26 · **Stato:** design approvato in brainstorming; pronto per **trueline BOOTSTRAP**.
> **A monte:** `docs/superpowers/specs/2026-07-22-ai-website-builder-design.md` (visione) · `docs/blueprint/P1-onboarding/` (**P1 completo e verde su `main`**) · `docs/superpowers/research/2026-07-26-media-ingest-feasibility.md` (foto del cliente).
> **Deliverable di questa sessione:** SOLO questo documento (nessun codice). Il blueprint tecnico verrà generato via trueline in fase successiva.

---

## 1. Visione di P2 in una frase

**Trasformare un Business Brief confermato in cinque mockup fra cui l'utente sceglie, e la scelta in un sito completo — dove la bellezza è garantita dal codice, non dal modello.**

**Confini:**
- **P1 (fatto)** consegna: un brief `status='confirmed'`, forma di T-121, coi tetti di P1-D17 (fino a 200 offerte, riga fino a **~405 KB**).
- **P2 (questo)** consegna: 5 mockup della home fra cui scegliere, e — dalla scelta — un **documento di sito congelato**, **one-pager o multi-pagina** (5-10 pagine derivate dai dati), che è l'artefatto che P3 modifica e P4 pubblica.
- **P3/P4 (dopo)**: editor inline e pubblicazione. *P2 da solo non produce un sito pubblicato: produce il documento e la sua anteprima.*

**Il motore non è codegen libero**: è **libreria di blocchi premium × temi**. È così che "risultati brutti strutturalmente impossibili" diventa una proprietà del codice invece di una speranza affidata a un prompt — e l'unica forma per cui, senza chiave API, abbiamo oracoli veri.

---

## 2. Scope di P2 v1 — decisioni chiuse in brainstorming

| # | Decisione | Scelta | Motivazione |
|---|---|---|---|
| D1 | **Cosa varia fra i 5 mockup** | **Tema + struttura**, copy condiviso. Cinque **direzioni dichiarate a mano da noi**, non inventate dal modello. **Il confronto fra i 5 avviene sulla HOME** (vedi D13) | Le 5 opzioni diventano scelte di *comunicazione*, non solo di colore. La garanzia di bellezza deve stare nel codice che possiamo testare: un modello che sceglie liberamente i blocchi la riporta a essere una speranza. **5 direzioni universali** × blocco offerte che si specializza per verticale (5 ricette, non 25) |
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
| D13 | **Multi-pagina in v1** | **Sì: one-pager *e* multi-pagina semplice** (5-10 pagine). Il set di pagine è **derivato**, non configurato: `pagesFor(brief, { maxPages })`, funzione pura — **una pagina senza dati non esiste**. Generazione in **due fasi**: fase 1 = pool della **home**, su cui si confrontano i 5 mockup; fase 2 = pool delle **pagine interne**, **una volta sola, dopo la scelta**, in chunk da ~4 pagine | Se i 5 mockup variassero su tutte le pagine, l'utente confronterebbe 40 pagine: non è una scelta, è una paralisi. E il costo: le pagine interne si generano **sulla sola direzione scelta**, non cinque volte, quindi multi-pagina costa **~3,2-3,5× una one-pager, non 8×** (§9). Il set derivato è **D7 al livello di pagina**: è così che si ottengono 5-10 pagine senza far configurare una sitemap a un non tecnico — un ristorante con 40 voci di menu e nessuna recensione ottiene un set diverso da una palestra con corsi e testimonianze. `maxPages` è il **giunto verso P5** (free → 1 pagina), che P2 non conosce |

---

## 3. Non-goals di P2 v1 (rinviato — esplicito)

- **Editor inline** dei contenuti → **P3**. P2 si ferma all'anteprima in sola lettura.
- **Pubblicazione**, pre-render statico, R2/Worker, domini → **P4**.
- **Ingest di media** (upload, Google Photos Picker, WhatsApp, Web Share Target) → **P4**. Studio di fattibilità già fatto: `docs/superpowers/research/2026-07-26-media-ingest-feasibility.md`.
- **Crediti e addebito** → **P5**. P2 non conta né scala nulla; il bound di costo per build è però **calcolato e asserito** (§9).
- **Multi-pagina complesso**: e-commerce, blog, pagine programmatiche settore×città → **P4/P7**. In P2 il multi-pagina è **semplice e derivato** (D13): un set di pagine vetrina che nasce dai dati del brief, senza sitemap configurabile, senza pagine create a mano, senza gerarchie oltre un livello.
- **Sitemap XML, hreflang, canonical, robots** e la SEO *tecnica* → **P4**. In P2 nascono i **testi** di `title` e `meta description` per pagina, perché sono copy (D10).
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
                 ├─ writePool(scope='home', variant_index = null) + status='ready'
                 └─ FLUSH 2: il pool della home
                      └─ 5 card = render(resolve(pool, ricetta_i, tema_i, brief))   ← STESSO renderer
                           ├─ "rigenera il testo di questa" → pool con variant_index = i (1 chiamata)
                           └─ "scegli questa" → chosen_variant = i
                                ├─ document = { pages: [ home ] } CONGELATO · status='chosen'
                                ├─ /{locale}/preview/{siteId}  ← la home è già visibile QUI
                                └─ FASE 2: pagesFor(brief, {maxPages}) → chunk da ~4 pagine
                                     ├─ writePool(scope='inner', variant_index = i)
                                     ├─ document.pages += pagine interne
                                     └─ status='complete'
```

**Le due fasi sono due momenti UX diversi.** Fase 1 è "scegli il tuo design" e l'utente aspetta guardando. Fase 2 è "stiamo costruendo il tuo sito" **con la home già davanti agli occhi**: la latenza è coperta da qualcosa da guardare, non da uno spinner. È anche il punto dove il worker "tenuto in tasca" di D6 un giorno avrà senso.

**Riscelta**: libera e gratuita **finché il documento ha solo la home** (nessuno l'ha modificato). Dopo la fase 2, riscegliere significa rifare la fase 2 per la nuova direzione — **una chiamata**, quindi un costo reale: va confermato, non silenzioso. **Ha anche una scadenza**: quando P3 esiste, riscegliere **distrugge le modifiche** dell'utente — decisione di P3, registrata qui perché non ce ne accorgiamo dopo.

---

## 5. Architettura & moduli

Tre strati, nel rispetto della guardia di layering esistente (`src/app` → `src/domain` → `src/data`).

**`src/domain/generation/` — puro, nessun I/O.** È dove vive la garanzia, perché è l'unico posto con oracoli veri.

| Modulo | Responsabilità |
|---|---|
| `slots.ts` | Vocabolario degli slot di contenuto, ognuno con la **precondizione** sui campi del brief e il **ruolo di pagina** a cui appartiene |
| `pages.ts` | `pagesFor(brief, { maxPages }) → PageSpec[]` — set di pagine **derivato** dai dati (D13). Una pagina senza dati non esiste. Include la navigazione e i link interni, derivati dal set |
| `pool.ts` | `PoolSchema` (zod) + `POOL_LIMITS` in costanti nominate — valida l'uscita del modello, alla T-121. Un pool è **per ambito** (`home` \| `inner`) |
| `document.ts` | `SiteDocumentSchema` — contratto dell'artefatto congelato: `pages: [{ slug, role, blocks[] }]`. **Slot immagine tipato per sorgente** (D12) |
| `blocks.ts` | Libreria: ogni blocco dichiara gli slot che consuma, la precondizione, e i ruoli di pagina in cui può comparire. Blocco offerte con varianti per verticale |
| `recipes.ts` | Le 5 direzioni, con identificatori versionati. Ogni direzione definisce la home **e** le regole di composizione delle pagine interne |
| `themes.ts` | I 5 set di token **di P2** |
| `resolve.ts` | `resolve(pool, ricetta, tema, brief, pageSpecs) → SiteDocument` — pura, deterministica. Chiamabile su un sottoinsieme di pagine (fase 1 = solo home) |
| `generatable.ts` | Nozione di *generabile* propria di P2: blocchi superstiti, pagine superstiti, cosa manca, cosa sbloccherebbe |
| `projection.ts` | Allowlist in ingresso, con tetto in code unit. **Due profili**: `home` e `inner` (§8) |
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
| `status` | `generating` → `ready` → `chosen` → `complete`, più `failed`. La **fase 2** sta fra `chosen` e `complete` (D13) |
| `chosen_variant` | `smallint null CHECK (0..4)` — una **colonna con CHECK**, non un campo dentro un blob |
| `document` | `jsonb null` — `{ pages: [...] }`, popolata **dalla scelta** con la sola home, poi estesa dalla fase 2. Punto di consegna a P3 |
| `max_pages` | `smallint not null` — il tetto usato per questa generazione, **registrato** e non ricalcolato: se P5 cambia i piani, un sito già costruito non si riscrive da sé |
| `failure_reason` | codice, non prosa |

**`generation_pools`** — `generation_id`, `scope` (`home` \| `inner`), `variant_index smallint null` (NULL = condiviso, 0..4 = copy-on-write), `content jsonb`, **`UNIQUE(generation_id, scope, variant_index)`**: è D3 + D13 rese schema, e rende irrappresentabili due pool per lo stesso (ambito, variante). I pool sono **append-only**: la fase 2 aggiunge una riga, non aggiorna quella della home.

**Indice UNIQUE parziale** su `site_id WHERE status='generating'`: la doppia generazione in volo diventa irrappresentabile invece di gestita. Primo argine reale al problema di frequenza che P1 ha dichiarato e non risolto (§6-bis p.11). **La fase 2 non usa questo indice** (lo stato è `chosen`, non `generating`): il suo argine è `UNIQUE(generation_id, 'inner', variant_index)`, che rende irrappresentabile costruire due volte le pagine della stessa variante.

**RLS** clonata da `site_briefs` (policy ancorate a `is_account_member(account_id)`, `account_id` esplicito nel testo per l'auditabilità statica), GRANT espliciti, nessun accesso `anon`.

**Peso dichiarato.** Il documento incorpora le offerte — deve, altrimenti modificare il brief cambierebbe un sito già scelto — quindi al tetto pesa **~450 KB**. In P1 lo stesso numero è un limite *senza oracolo* (§6-bis p.10); qui **un test lo misura**.

**Sede definitiva del documento**: decisione di **P3**. Metterlo in `site_generations.document` lo rende esistente e leggibile e lo marca come punto di consegna; se P3 lo promuove a tabella con versioni è una migrazione di *forma*, su dati che allora sono **zero**.

---

## 7. Il motore

**Blocchi** (hero, offerte, chi-siamo, orari, contatti/mappa, recensioni, FAQ, CTA WhatsApp…). Ogni blocco dichiara: gli slot di contenuto che consuma, i campi del brief che rende direttamente, e la **precondizione** che ne determina l'esistenza.

**Ricette**: 5 direzioni universali, ognuna una sequenza ordinata di blocchi con un tema associato. Il **blocco offerte** si specializza per `vertical` (etichetta, layout, presenza del prezzo) — è il modo per avere 5 ricette invece di 25, coerente con P1-D3 (una sola lista `offerings` con un tag).

**Temi**: 5 set di token propri di P2 (colore, tipografia, spaziatura, raggi). `vertical = 'altro'` **non conta** come verticale scelto — `emptyBrief` lo porta comunque, stessa lettura di P1-D24.

**`brand_hints`** è l'unico campo di testo libero che vorrebbe influenzare l'estetica: in v1 è usato **solo come indicazione di tono per il copy**, mai per scegliere il tema. Lasciarglielo scegliere sarebbe un canale — piccolo, ma un canale.

**Il set di pagine è derivato** (D13). `pagesFor(brief, { maxPages })` è puro e ordinato per priorità: la **home** esiste sempre; le altre pagine hanno una precondizione sui dati esattamente come i blocchi, e quelle che non la soddisfano **non esistono** — non sono pagine vuote da riempire dopo. Esempi di precondizione: la pagina offerte richiede almeno *n* voci in `content.offerings`; la pagina contatti richiede almeno uno fra `address`, `phone`, `whatsapp`, `email`; la pagina orari richiede `hours` non vuoto; la pagina FAQ richiede abbastanza materia per generarne un numero minimo. Sotto il minimo di pagine, il sito **resta una one-pager**: le sezioni tornano nella home invece di diventare pagine sottili — che è il gate di qualità della visione §10.3-B applicato al nostro stesso prodotto.

**La navigazione e i link interni sono derivati dal set**, mai scritti dal modello: coerente con D4 (nessuna leva in uscita), e significa che una pagina che non esiste non può essere linkata da nessuna parte — un 404 interno è irrappresentabile, non sorvegliato.

**`maxPages` è il giunto verso P5.** P2 non conosce i piani: riceve un tetto, lo applica, e lo **registra sulla riga**. Il default dichiarato di P2 è il set derivato senza tetto artificiale; il piano free lo porterà a 1.

---

## 8. Il confine LLM

**Ingresso — allowlist nominata, in due profili.**

- **Profilo `home`** (fase 1): `business_name`, `vertical`, `description`, `primary_goal`, `locale`, `brand_hints`, `highlights`, più un **campione di soli nomi** di offerte con la loro sezione.
- **Profilo `inner`** (fase 2): lo stesso, ma il campione delle offerte è **per sezione** invece che piatto — al modello serve per scrivere l'intro di ciascuna sezione della pagina offerte. **Nessun campo nuovo entra nell'allowlist**: cambia la forma del campione, non la superficie.

**Niente**, in nessuno dei due profili: descrizioni delle offerte, prezzi, contatti, orari, indirizzo, social. Al **tetto**, il profilo `home` sta sotto **~8k token** e `inner` sotto **~10k**; un brief reale sta molto sotto (~3k). *Sono stime — vedi il punto sulla misura, sotto.*

**Uscita — nessuna leva.** Il contratto è **solo testo di contenuto in slot nominati**, ognuno con schema e tetto. Il modello **non** emette URL, `href`, `src`, HTML, nomi di blocco, nomi di tema, colori. Struttura e tema sono già nostri (D1); i link nascono dai campi strutturati del brief attraverso i loro validatori. **Un'iniezione riuscita ottiene un copy diverso da quello atteso — in un mockup che l'utente guarda prima di pubblicare — e nient'altro.**

**Schema strict.** Confermato sulla documentazione (non a memoria) che il sottoinsieme JSON Schema **esclude** `minLength`/`maxLength`, i vincoli numerici e gli schemi ricorsivi: i tetti degli slot vivono nella `description` del tool e nella validazione zod **dopo** il ritorno — pattern di **P1-D20**. Ogni oggetto annidato porta `additionalProperties:false` **e** `required`, il che **chiude per costruzione** il rischio aperto in P1 §6-bis p.2.

**Guardie sul ritorno**, tutte terminali e esplicite: `stop_reason` fuori norma → `failed`; **nessun blocco `tool_use`** → `failed` (è il modo di fallire silenzioso documentato); pool che non valida → `failed`.

**Prompt caching.** Il prefisso è `tools` → `system` → `messages`: schema del tool e system prompt sono **identici fra tutte le generazioni di tutti i clienti**, quindi vanno prima del breakpoint di cache; la proiezione del brief, che è volatile, va dopo. La fase 2 in due chunk paga l'ingresso **una volta** e lo rilegge al 10%. Soglia minima di prefisso cacheabile su Sonnet 5: **1024 token** — il nostro prefisso la supera, ma se non la superasse il caching **non avverrebbe in silenzio** (`cache_creation_input_tokens: 0`, nessun errore), quindi va verificato leggendo `usage`.

**Costanti dichiarate, e tutte in un solo posto** (`GENERATION_BUDGET`): `max_tokens` per fase, tetto di ogni profilo di proiezione, `effort`, timeout, `maxRetries`. Non i 30 minuti ereditati per default di P1 §7 p.9, e nessun retry silenzioso che sarebbe una seconda build mai chiesta. **Sono tarabili in un punto**, perché è il posto dove la misura reale (§9) andrà a incidere.

**Il budget si misura in code unit, non in token.** `count_tokens` è un endpoint API e senza chiave non è utilizzabile: l'oracolo resta il conteggio in code unit col rapporto **~4:1** già usato in P1 — **un proxy dichiarato, non la verità**.

**Due punti dove le stime sono probabilmente da alzare, dichiarati ora invece che scoperti dopo:**

1. **Il system prompt crescerà.** La stima di ~1,5k token è quella di un prompt minimo. Guida di copy che funzioni davvero — tono per verticale, il divieto di inventare, come cavarsela con un brief magro, registro per locale, cosa distingue una headline buona da una generica — sta plausibilmente sui **3-5k**. Non rompe il modello di costo perché vive nel **prefisso in cache**, ma **sposta il tetto di ingresso**: dimensionarlo con margine, o sarà il primo a essere sbattuto.
2. **La stima di uscita della fase 2 è la più fragile.** È costruita su ~300 parole per pagina. Pagine che non siano sottili ne vogliono 400-600 — e le pagine sottili sono un rischio SEO reale (visione §10.3-B) — quindi l'uscita può **raddoppiare** e `max_tokens` per chunk inizierebbe a stringere. Il pensiero adaptive è il termine meno prevedibile dei due.

Entrambi sono costanti che scegliamo noi, quindi il modo di chiuderli è **misurare**, non stimare meglio.

---

## 9. Testabilità sotto trueline (ORACLE-AS-JUDGE)

- **Funzioni pure** — fixture secondo la correzione di metodo n.1 di P1: **più di un elemento**, valori **discordanti**, e un id che è **prefisso** di un altro.
- **Anti-fuga** — nessun campo fuori allowlist raggiunge il confine, asserito sull'oggetto **realmente passato** a `runGenerationTurn` (non sul sorgente: lezione di P1-D20), sul prodotto `{it,es} × {import, ruoli invertiti}`, **case-insensitive** e con assenza anche del **prefisso** comune.
- **Conformità dello schema** — nessun keyword fuori sottoinsieme in nessun punto del tool; `additionalProperties:false` **e** `required` su ogni oggetto annidato.
- **Bound di costo calcolato, per fase e per sito** — un test deriva da `GENERATION_BUDGET`
  `costo_max_fase = (tetto_proiezione / 4) × prezzo_input + max_tokens × prezzo_output`
  e somma le due fasi (la fase 2 pesata sui suoi chunk, col secondo in cache read). Entrambi i lati sono limitati da costanti che scegliamo noi: **il costo peggiore per sito è un numero, non una speranza** — oggi ≈ **$0,43** (§13). Il test asserisce il tetto, così alzare una costante senza accorgersi del costo diventa **rosso**, non silenzioso.
- **`pagesFor` e il set di pagine** — che una pagina senza dati non esista; che sotto il minimo il sito resti una one-pager invece di produrre pagine sottili; che **nessun link interno punti a una pagina che non esiste** (il 404 interno, asserito e non supposto); che `maxPages` tagli in ordine di priorità e non a caso.
- **Peso del documento** — misurato su un brief con ogni campo al tetto **e col set di pagine massimo**: è il caso peggiore vero, non quello di una pagina sola.
- **DB-backed con `signInAs`** — RLS sulle due tabelle, negazione cross-tenant, `23503` sul site-squatting, e l'indice parziale che respinge la seconda generazione concorrente.
- **Ordine dei due flush** — le cornici escono **mentre la chiamata è in volo** (mock con gate controllato dal test): la forma d'oracolo di T-150, non "è uno stream".
- **End-to-end** (Chromium, al **checkpoint di macrotask**, non nel giro per-task): documento ostile con asserzioni sull'**effetto** (nessuno script ha girato, nessuna richiesta verso host fuori allowlist, nessuna navigazione) — **più un componente deliberatamente insicuro (canary)** che le stesse asserzioni devono prendere. *"Zero errori di console" è indistinguibile da "la pagina non si è caricata"*: è la correzione di metodo n.7 applicata **prima** di scrivere il verde.
- **Stile** — resta **non asserito** (P1 §6-bis p.8) e va dichiarato. Due controlli a costo quasi zero che non sono "bellezza": i 5 temi producono valori di token **diversi fra loro**, e nessun blocco contiene un **hex letterale**.

---

## 10. Definition of Done di P2

1. Da un brief `confirmed` si ottengono **5 mockup della home visibilmente diversi per struttura e tema**, con una sola chiamata al modello.
2. Rigenerare il testo di **una** variante non tocca le altre quattro.
3. La scelta **congela** un documento che l'anteprima rende a piena pagina, e che non cambia più se ritocchiamo una ricetta.
4. Dopo la scelta, la **fase 2** costruisce le pagine interne derivate dal brief: un sito **navigabile** in cui nessun link punta a una pagina inesistente, e in cui **nessuna pagina è sottile** — o, sotto il minimo, il sito resta correttamente una **one-pager**.
5. Un brief povero **non produce mockup sottili**: produce l'elenco di cosa manca e cosa sbloccherebbe.
6. Nessun valore del brief fuori allowlist raggiunge il confine LLM — asserito, su **entrambi** i profili di proiezione.
7. Il testo ostile del brief non esegue nulla nel browser — asserito **sull'effetto**, col canary che prova che l'oracolo sa diventare rosso.
8. Il **bound di costo per sito** è asserito da un test a partire da `GENERATION_BUDGET`.
9. Checkpoint trueline **4/4** (dead-code · sicurezza · regressioni · conformità-logica), baseline di sicurezza e d'igiene invariate o attribuite.

**Fuori dalla DoD, per impossibilità dichiarata**: la misura reale dei token e la taratura crediti/prezzi (`P2-D17`). Richiedono una chiave API, che non esiste. Non è un elemento rinviato per comodità: è un elemento **non eseguibile** con gli strumenti che abbiamo, e dichiararlo verde sarebbe il falso via-libera che questo progetto rifiuta.

---

## 11. Decisioni di ledger da portare al bootstrap

`P2-D1`…`P2-D13` = le tredici decisioni della tabella §2, riportate verbatim nel `00-INDEX` del blueprint. Più le derivate emerse in stesura:

- **`P2-D14`** — separazione del layer temi imposta da `no-restricted-imports`, non da convenzione.
- **`P2-D15`** — **riconciliazione dello stato**: una riga `generating` più vecchia del timeout dichiarato si legge come `failed`; idem una riga `chosen` rimasta senza pagine interne oltre il timeout della fase 2. L'indice UNIQUE parziale è la difesa contro la doppia generazione **ed è anche il modo di incastrarsi**: se il processo muore nessun `finally` gira, e senza riconciliazione il sito resterebbe non generabile per sempre. Servono **due** meccanismi, non uno.
- **`P2-D16`** — un guasto di lettura del brief **non si rende come "brief povero"**: è la lezione di T-152 spostata, dove un errore transitorio diventava un brief vuoto.
- **`P2-D17`** — **le costanti di budget sono provvisorie per dichiarazione.** I numeri di `GENERATION_BUDGET` (tetti dei profili di proiezione, `max_tokens` per fase, `effort`) sono **stime a tavolino**, non misure: `count_tokens` è un endpoint API e senza chiave non è utilizzabile, quindi il proxy in code unit al rapporto ~4:1 è tutto ciò che abbiamo. **La taratura crediti↔prezzi non si decide su queste stime**: attende la prima misura reale di `usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`) su un campione di brief veri, il primo giorno con una chiave. Fino a quel momento i numeri in §13 sono ordini di grandezza da non citare come autorevoli, e le due voci del §8 — crescita del system prompt, uscita della fase 2 — sono i candidati più probabili a essere riviste **in alto**. Sede della misura: un task dedicato del macrotask `generation-llm`, che gira **solo** in presenza di una chiave e altrimenti si dichiara non eseguito, mai verde.

---

## 12. DAG previsto dei task atomici

```
generation-model  (T-200..)   contratti: migrazioni + RLS (2 tabelle, scope, indice parziale),
        │                     slots, PoolSchema, SiteDocumentSchema multi-pagina, azioni dati
        │
        ├──> generation-engine (T-210..)  blocchi, ricette, temi, pagesFor + navigazione,
        │                                 resolve, generatable                         ┐ indipendenti
        └──> generation-llm    (T-220..)  projection (2 profili), normalizer,           │ fra loro
                                          tool strict, prompt, confine, guardie,       │
                                          GENERATION_BUDGET + task di misura (P2-D17)  ┘
                     │
                     └──> generation-ui  (T-230..)  rotta + 2 flush, selettore, rigenera,
                          (richiede engine E llm)   scegli & congela, FASE 2 a chunk,
                                 │                  anteprima navigabile, dashboard
                                 │
                                 └──> generation-e2e (T-240..)  harness Chromium + canary
                                                                + documento ostile
```

`generation-model` = **contratti**, `generation-engine` = **trasformazione pura**, `generation-llm` = **il confine**. `generation-e2e` resta separato: è una superficie d'oracolo nuova con la sua infrastruttura, e fonderla in `generation-ui` renderebbe quel checkpoint meno leggibile.

Il multi-pagina (D13) **non aggiunge un macrotask**: aggiunge `pagesFor` + navigazione a `generation-engine`, il secondo profilo di proiezione a `generation-llm`, e la fase 2 a `generation-ui`. È il segno che la decisione si è innestata sull'architettura invece di piegarla. Ordine e granularità definitivi li fissa il bootstrap.

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
- **Latenza della fase 2** — ~5k token di uscita sono una generazione lunga (60-120 s stimati, non misurati). È coperta dal fatto che arriva **dopo** la scelta, con la home già visibile, ma resta il punto dove il **tetto di durata delle funzioni** della piattaforma di hosting può morderci. Va verificato, non supposto; i chunk da ~4 pagine servono anche a questo.
- **Tetto di durata delle funzioni** e budget di latenza della fase 1 (obiettivo secondo flush < 60 s): **non misurati**.

### Costo: i numeri, e perché non sono ancora una base per i prezzi

Sonnet 5 a prezzo pieno ($3 / $15 per 1M), a cambio €1 ≈ $1,08 (assunzione dichiarata). **Il tetto è calcolato; la stima è stimata** — e vale `P2-D17`: nessuna decisione di prezzo si prende su questi numeri.

| | Tetto **garantito** (asserito da test) | Stima realistica |
|---|---|---|
| Fase 1 — 5 mockup della home | $0,144 | ≈ $0,060 |
| Fase 2 — pagine interne (2 chunk) | $0,281 | ≈ $0,18–0,21 |
| **Sito multi-pagina (8 pagine)** | **≈ $0,43** | **≈ $0,24–0,27** |
| One-pager (tutto in fase 1) | ≈ $0,17 | ≈ $0,077 |

**Multi-pagina ≈ 3,2–3,5× una one-pager, non 8×** — perché l'ingresso non cresce col numero di pagine, il prefisso si rilegge in cache, e le pagine interne si generano **sulla sola direzione scelta**. Su Opus 5 tutto ×~1,7.

**Dove la contabilità attuale della visione si rompe.** Con `build = 5 crediti` (§7.3) e i crediti esauriti:

| Piano | Crediti | Siti multi-pagina | Inferenza | Quota del ricavo |
|---|---|---|---|---|
| Starter €9 | 30 | 6 | $1,56 | **16%** |
| Pro €19 | 120 | 24 | $6,24 | **30%** |
| Studio €39 | 400 (pool) | 80 | $20,80 | **≈ 49%** ⚠️ |

Su Opus 5, Studio a pieno consumo arriva a **~80%**: in perdita dopo hosting e commissioni. Nessuno esaurisce il pool, quindi il numero realistico è più basso — ma **il tetto è la passività**, e §7.4 vieta già di scendere sotto il costo marginale. **Il rimedio esiste già nella visione e non è stato usato**: §7.3 elenca *«re-layout di una nuova pagina aggiunta = 1 credito»* — applicandolo alla build, un sito di 8 pagine costa **5 + 7 = 12 crediti**, Studio passa da 80 a 33 siti e la quota scende a **~20%**. Coerente, e **decisione di P5**: qui è registrata come input, non presa.

---

## 14. Prossimo passo

**trueline BOOTSTRAP** su questo documento → `docs/blueprint/P2-generation/` con `00-INDEX` (mappa, piano di build, DAG, decision ledger `P2-D1..P2-D17`, aggancio alla sicurezza), i moduli-macrotask coi task atomici (`definition_of_done` + `acceptance_criteria` + `target_tests` + `security_notes`), `SESSION-STATE.md` e `prompts/`.
Self-check: `validate_blueprint.mjs docs/blueprint/P2-generation` → atteso **exit 0**.
