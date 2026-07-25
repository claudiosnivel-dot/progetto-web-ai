# SESSION-STATE — Belora · P1 (Onboarding)

> Fonte di verita sullo **stato vivo** del sotto-progetto P1. Letta da BUILD a ogni
> apertura e aggiornata a ogni chiusura (`prompts/session-end.md`). Distinta dalla
> SESSION-STATE della skill trueline e da quella di P0.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (JS/TS + Supabase) |
| **Ultimo aggiornamento** | 2026-07-25 (chiusura BUILD `onboarding-ui` + emendamento **P1-D24** — **P1 COMPLETO**) |
| **Sessione corrente** | **CHIUSA**. Ha chiuso l'ULTIMO macrotask di P1, `onboarding-ui` (T-150..T-153), piu' DUE emendamenti a task chiusi e verdi: **P1-D17** (tetto di lunghezza, T-121) e **P1-D24** (stato del brief al modello + `readyForReview` corroborato, T-132). Tre checkpoint eseguiti, tutti **VERDI al secondo giro** (i primi rossi su dead-code). Mergeato su `main` in fast-forward fino a `81ffd66`, pushato. **P1 e' completo: il prossimo sotto-progetto e' P2 (generazione dei mockup).** |

---

## 1. Stato dei macrotask

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| brief-model | **done** | **VERDE 4/4** | T-120..T-123 (`33fb898` + `5243260`) |
| ai-onboarding | **done** | **VERDE 4/4** | T-130..T-132 (`8ef4cf9`), build + 6 fix |
| url-import | **done** | **VERDE 4/4** | T-140..T-141 (`802ee69`), build + 10 fix |
| onboarding-ui | **done** | **VERDE 4/4** | T-150..T-153 (`4792553`, `4b93692`, `cf3217c`, `43ed032`) + emendamento T-121 (`9c4254e`) + de-duplicazione (`d38dcee`) |

**→ P1 e' COMPLETO. Non restano task.**

## 2. Cosa esiste adesso (il flusso, end-to-end nel codice)

Dashboard (`/{locale}/dashboard`) → CTA per riga sito → rotta protetta
`/{locale}/onboarding/{siteId}` con ChatPanel + BriefPanel live + UrlImportBar → link a
`/{locale}/onboarding/{siteId}/review` → conferma esplicita → `status='confirmed'` → ritorno
alla dashboard, che mostra il badge segnaposto "pronto per generare".

Il brief confermato e' l'artefatto che **P2** consumera'.

**Attenzione al senso di "end-to-end": e' end-to-end nel CODICE, non nell'esecuzione.**
Nessun flusso e' stato eseguito in un browser, e il confine LLM e' mockato in ogni test
(non esiste una chiave API). Vedi §6-bis.

## 3. Stato git

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/onboarding-ui` (pushato; mergeato su main; non cancellato) |
| Ultimo commit | `d38dcee` su `main` (HEAD) — working tree pulito, `origin/main` allineato |
| Stato merge su `main` | **MERGED**: ff `6874065..d38dcee`, gated dal checkpoint verde 4/4 |
| Deploy-coupling | **`main_deploy_coupled: false`** — override riconfermato a inizio BUILD P1. Nessun deploy-on-push |

Commit del macrotask, in ordine:
`958f9da` ledger · `9c4254e` emendamento T-121 · `4792553` T-150 · `4b93692` T-151 ·
`cf3217c` T-152 · `43ed032` T-153 · `d38dcee` de-duplicazione + baseline d'igiene.

## 4. Baseline & budget

- **Baseline di sicurezza**: `gitleaks:0 · osv:0 · semgrep:0 · rls:0`. Invariata: il
  macrotask **non ha introdotto superficie DB** (nessuna migrazione, tabella o policy).
- **Baseline d'igiene**: **NUOVA**, `.trueline/hygiene-baseline.json` (39 impronte,
  oracoli `jscpd`/`cycle`/`twin`), **tracciata in git**. Prima non esisteva, ed e' la
  ragione del primo checkpoint rosso. `.gitignore` usa `/.trueline/*` + negazione:
  escludendo la *directory*, git non consulterebbe piu' nulla al suo interno e la
  negazione non avrebbe effetto.
- **Igiene**: `dead-code:0 · dup:40 · cycle:0 · twin:0`. Le 40 duplicazioni sono
  **preesistenti dichiarate** (vedi §5).
- **Suite**: **210 test** nei 12 file rilevanti, 0 skippati. Nuovi in questo macrotask:
  `onboarding-route` (23), `onboarding-ui` (36+), `onboarding-review` (30+),
  `dashboard-onboarding-cta` (12), `brief-length-caps` (69). typecheck, lint, knip puliti.
- **Budget**: 7 workflow lanciati. Uno **FALLITO** (5 agenti, tutti morti per limite di
  sessione, 0 completati); i sei riusciti hanno completato 2-3 agenti ciascuno. Totale
  agenti utili ~14. Vedi §6 per la correzione di metodo.
- **Oracoli dell'orchestratore** (indipendenti da quelli degli agenti): **49 mutazioni,
  49 uccise, 0 sopravvissute, 0 ripristini falliti** — 11 sull'emendamento, 16 su T-150,
  10 su T-151, 10 su T-152, 3 su T-153, 9 dopo la de-duplicazione. Piu' 4 riproduttori
  eseguiti sull'emendamento e 2 sonde sperimentali prima dei builder.

## 5. Esiti dell'ultima sessione (framing onesto)

### Emendamento P1-D17 a T-121 (tetto di lunghezza sui campi del brief)
Chiude il carry-over §7 p.6 della sessione precedente. Tre difetti trovati dalla verifica
avversariale, tutti con **riproduttore eseguito dall'orchestratore**:
1. **[HIGH sicurezza]** il merge delle `offerings` non era limitato: il tetto valeva
   sull'array della PATCH, non sul risultato. Misurato: 3 patch conformi una per una →
   600 offerte, riga da **1,04 MB**, `rejected: []` a ogni giro, e un Brief che **non
   validava contro il proprio `BriefSchema`**.
2. **[MEDIUM contratto]** `applyBriefUpdate` **LANCIAVA** `TypeError` su una chiave che
   risolve sul prototype (`constructor`, `toString`, `valueOf`, `__proto__`,
   `hasOwnProperty`), violando il proprio contratto non-lanciante (AC-122-3).
   **Preesistente** all'emendamento.
3. **[HIGH conformita']** `maxLength`/`maxItems` nel tool strict erano un **errore di
   decisione dell'orchestratore** (clausola 4 di P1-D17), non del builder: sono **fuori
   dal sottoinsieme JSON Schema dello strict tool use**, e i tool sono oggetti scritti a
   mano, quindi nessun SDK li rimuove. Sarebbe stato un **400 alla prima chiamata reale**,
   invisibile a ogni oracolo senza chiave API. Annullata da **P1-D20**; il limite passa
   nella `description` del tool, e una guardia di regressione ispeziona l'oggetto
   **realmente passato al confine** (non il sorgente, che con valori derivati non dice nulla).

### T-150 — rotta protetta + turno di chat
Stream di **trasporto a due flush** NDJSON (P1-D18): il confine T-131 resta non-streaming e
intoccato. L'oracolo prova che il chunk `text` esce **mentre la scrittura sul DB e' in
volo** (mock con gate controllato dal test, confronto su confine di macrotask), non che
"la risposta e' uno stream" — una risposta completa in un colpo solo fallisce.
History rigiocata **solo testo** (P1-D19): un blocco `tool_use` fabbricato dal client e'
**irrappresentabile**, quindi il 400 da `tool_result` mancante non puo' accadere.
Guardie aggiunte: `Sec-Fetch-Site` **preteso** (era fail-open se assente) prima del
confronto su `Origin`; tetto sui byte del body con **413 prima di `request.json()`**
(misurato: un body da 64,66 MB veniva letto integralmente e poi rifiutato); history
obbligata a iniziare con `user`, che l'API pretende.

### T-151 / T-152 / T-153 — la UI
- `hours` **editabile** (P1-D13): senza questo editor gli orari non entrerebbero MAI nel
  Brief da nessun percorso.
- `UrlImportBar` passa da una **Server Action** (`src/data/import.ts`) che **pretende una
  sessione**: senza, il server sarebbe un proxy di sonde SSRF per chiunque. Eredita il
  controllo d'origine di Next — la difesa CSRF che T-150 ha dovuto costruire a mano.
- Conferma **esplicita** col pattern di `SiteRow` (T-105); la meta' **negativa** di
  AC-152-2 e' provata a cinque stadi.
- Primitiva **`Textarea`** aggiunta: sede dichiarata da P1-D17. Pinnata da un test col
  valore **esattamente al tetto**, reso per intero e senza `maxlength` (la UI non e' il
  gate nemmeno sulla lunghezza).

### Difetti che valeva la pena trovare
- **[HIGH perdita di dati, T-151]** `fromUrl` costruisce la proposta su `emptyBrief()`,
  dove `vertical` ha `default('altro')`: **ogni** import portava `vertical:'altro'` anche
  per una pagina che del tipo di attivita' non dice nulla, e la conferma successiva lo
  scriveva nel DB **cancellando la scelta dell'utente**. Causa radice: la proposta non
  distingueva "campo assente" da "campo col valore di default".
- **[T-151]** il `locale` era escluso dalla proposta **solo per convenzione**: una pagina
  esterna poteva cambiare la lingua del sito. Ora e' irrappresentabile **per tipo**.
- **[T-151]** il deliverable **non era raggiungibile dall'applicazione**: misurato, non
  supposto — `npm run build` passava ma i componenti erano **assenti da `.next/static`**,
  e `knip` li elencava come file inutilizzati appena si rinominava il file di test.
- **[T-152]** un **guasto di lettura** del brief era reso come brief **vuoto**: con un
  errore transitorio l'utente poteva **confermare un brief mai visto**.
- **[T-152]** una **stringa i18n diceva il falso**: affermava che il server scarta i
  singoli campi fuori limite, mentre `upsertBrief` valida la patch **intera** e risponde
  400 senza scrivere nulla. Su una schermata di conferma e' il posto peggiore per sbagliare.
- **[T-152]** la schermata era **irraggiungibile** (nessun `href` la nominava). Ora il
  workspace la collega, e il link **non** e' dietro `readyForReview`: quel flag e' deciso
  dal modello ed e' prompt-injectable (§7 p.10), quindi un'iniezione chiuderebbe l'ultimo
  passo dell'onboarding.
- **[T-153]** difetto **preesistente** (T-102): la dashboard interpolava il locale
  **grezzo** dell'URL nelle destinazioni senza allowlist.
- **[T-153]** `listSites` che falliva rendeva `dashboard.emptyState`, cioe' **"non hai
  ancora creato nessun sito"**: un utente con siti reali, davanti a un 500, poteva
  ricrearne uno che esisteva. Corretto dall'orchestratore.

### Il checkpoint: un giro ROSSO prima del verde
Primo run **NON-VERDE 3/4**: controllo 1 rosso per **baseline d'igiene mancante**
(`dup:46`). Sicurezza, regressioni e conformita' verdi.
**Non e' stato aggirato catturando la baseline.** Prima l'attribuzione: delle 46,
**10 erano di questa sessione** e 36 preesistenti. Catturare subito avrebbe funzionato — il
controllo e' rosso perche' la baseline *manca*, quindi lo sarebbe stato anche con zero
duplicazioni nuove — ma avrebbe **benedetto anche le mie**. Decisione dell'utente
(human-in-the-loop, come per ogni cosa che sposta il riferimento di un oracolo): prima
ridurre le mie, poi catturare. **Da 46 a 40, le mie da 10 a 4.**

La piu' grave era una **catena di guardie di sicurezza scritta due volte identica**, ed era
colpa di un'istruzione dell'orchestratore al builder di T-152 ("segui la stessa catena, non
una variante"). Estratta in `guard.ts`. La **lettura del brief** e' rimasta in ciascuna
pagina perche' le due la trattano in modo **deliberatamente diverso**: la rotta tollera
`ok:false`, la review LANCIA. Estratto l'identico, non l'apparentemente simile.

**Le 4 duplicazioni residue, dichiarate**: l'involucro `AppShell`+`h1` fra le due rotte
(Next ha `layout.tsx`, se mai servisse); le due liste di campi in `brief.ts`, che **devono**
esistere entrambe (optionality e default diversi) e che l'emendamento P1-D17 ha reso piu'
simili nel testo proprio de-duplicando i numeri; il blocco di import fra due componenti
client; le righe orario JSX. In ognuna la correzione sarebbe peggiore del difetto.

### fix_state
Tutte **verified**: riverificate con lo STESSO oracolo e con la batteria di mutazione
(49/49 uccise). Nessuna rimozione di dead-code.

## 6. Note operative (checkpoint, test, metodo)

- **Checkpoint**: `db reset` (azzera anche il contatore di rate limit auth), `set -a; . .env.local; set +a`,
  `.env.local` **fuori dal repo** + `rm -rf .next`, `run_checkpoint.mjs "<repo>" --in-place --mode build`
  (SENZA `--blueprint`), ripristino via `trap EXIT`. Script in
  `C:/Users/claud/.claude/plugins/cache/trueline-local/trueline/0.1.0/skills/trueline/scripts/`.
- **BASELINE D'IGIENE — nuovo e necessario.** Il controllo 1 e' rosso se manca, **anche con
  zero duplicazioni nuove**. Cattura:
  `node <scripts>/findings/baseline.mjs capture <repo> --hygiene --out <repo>/.trueline/hygiene-baseline.json`.
  Il flag `--hygiene` seleziona gli oracoli (`jscpd`/`cycle`/`twin`) ma **non** cambia il
  percorso di output: senza `--out` scrive `baseline.json`, che e' un altro file.
- **NON dedurre il verdetto dall'exit code.** Il checkpoint e' stato lanciato con
  `| tail`, quindi l'exit code osservato era quello di `tail`: exit 0 con checkpoint
  **NON-VERDE**. Il verdetto si legge nel JSON (`green`, `summary`, `controls[]`).
- **`gitleaks` e i nomi di variabile**: una costante di test chiamata `SECRET`/`TOKEN`/`KEY`
  con un literal assegnato fa scattare un falso positivo. Nominarla diversamente **prima**.
- **Rate limit auth**: suite/checkpoint una volta per finestra; `db reset` azzera il contatore.
  Durante il BUILD si eseguono solo i file di test rilevanti, mai `npm test`.
- **CRLF**: i file su disco sono CRLF. Una batteria di mutazione con pattern multi-riga
  scritti con `\n` **non combacia**: rilevare l'EOL e normalizzare. E' costato due giri.
- **Le impronte d'igiene sono SENSIBILI ALLA POSIZIONE.** Editare un file vicino a un blocco
  gia' duplicato — o editare il **partner** di una coppia — produce un finding "nuovo"
  **spurio**, anche quando la duplicazione e' identica a prima. Successo con
  `02-ai-onboarding.md` (AC emendati) che ha fatto risultare "nuovo" il boilerplate
  `## Self-check` di `04-onboarding-ui.md`. Attribuire **sempre** prima di ricatturare:
  distinguere il churn di posizione dalla duplicazione vera.
- **Non lanciare il checkpoint attraverso `| tail`.** Il primo giro di P1-D24 e' stato letto
  con `tail -55`, che ha tagliato la **testa** del JSON — cioe' `green`, `summary` e lo stato
  del controllo 1 — dando l'illusione di avere il verdetto. Scrivere l'output **intero** su
  file e leggerlo da li'. E' la stessa lezione dell'exit code, applicata al pezzo sbagliato.

### Correzioni al metodo, imparate sul campo
1. **UNA FIXTURE CON UN SOLO ELEMENTO NON PROVA NULLA SULL'IDENTITA' DI QUELL'ELEMENTO.**
   E' il difetto che si e' ripetuto **tre volte** in questa sessione, sempre con la suite
   verde: un solo sito su T-150 (`sites[0].id === SITE_A` vero per costruzione → in
   produzione il turno del sito B avrebbe scritto sul brief di A), una sola coppia di orari
   e `geo`/`hours` non valorizzati su T-151 (tre mutazioni di rendering ostile
   sopravvivevano perche' i rami non venivano mai resi), id disgiunti su T-152
   (`===` → `startsWith` sopravviveva). **Nessuna review di codice trova questa classe:
   solo mutare l'implementazione e guardare se qualcosa muore.** Nel prompt di ogni builder
   va richiesto esplicitamente: piu' di un elemento, valori **discordanti**, e un id che sia
   **prefisso** di un altro.
2. **Un workflow da 5 agenti muore per limite di sessione.** E' successo: `agents_done: 0`,
   `agents_error: 5`, e il risultato conteneva array vuoti che **sembravano un verde** —
   esattamente la trappola registrata dalla sessione precedente. Controllare **sempre**
   `agents_error` prima del valore di ritorno. La forma che tiene e' **2 agenti per
   workflow** (builder + verifier a lente combinata), un task per volta, con la batteria di
   mutazione dell'orchestratore fra un task e l'altro.
3. **La lente combinata non equivale a due lenti indipendenti.** Su T-150 due verifier
   separati hanno trovato cose diverse (21 rilievi); su T-151/152/153, a lente singola, la
   copertura e' diversa — non peggiore in assoluto, ma **non equivalente**. Va dichiarato.
4. **La batteria di mutazione dell'orchestratore e' lo strumento che trova.** 49 mutazioni
   in questa sessione; quelle che contavano non erano bug di produzione ma **buchi
   d'oracolo**: proprieta' vere per costruzione della fixture. Includere sempre un
   controllo di sanita' palesemente fatale (uno ha ucciso 53 test), e verificare il
   ripristino **con l'hash**.
5. **Il verifier ha ragione anche quando corregge l'orchestratore.** Due decisioni mie sono
   state demolite con riproduttori: `maxLength` nel tool strict (P1-D20) e la motivazione di
   P1-D19 (P1-D23). E una mia istruzione ha *creato* la duplicazione della catena di
   guardie. Il ledger registra l'errore invece di cancellarlo: la traccia vale piu' della
   sua rimozione.
6. **Non peggiorare il prodotto per compiacere un oracolo.** Un fixer ha scartato
   l'alternativa di sostituire un `<a>` con un `Button`+`router.push` per non rompere
   un'asserzione "zero anchor", e ha corretto l'oracolo enumerando l'href atteso. E' la
   direzione giusta. Stessa regola applicata alle 3 duplicazioni di P1-D24: **non** sono
   state ridotte, perche' l'unica sostanziale unirebbe il vocabolario del PROMPT con le
   etichette della UI — due concerni separati che per caso enumerano lo stesso schema.
7. **CONTROLLARE LO STRUMENTO DI MISURA, non solo il codice.** Tutto cio' che questa sessione
   ha trovato appartiene a una famiglia sola: **il misuratore che sembra funzionare e non
   misura**. Fixture con un solo elemento; asserzioni su un solo ramo (`it` e non `es`);
   campi la cui fuga non e' osservabile perche' la fixture li lascia vuoti; e due errori
   dell'orchestratore nello stesso giro — una batteria di mutazione le cui "fughe"
   assegnavano a una variabile mai usata (quindi non erano fughe), e un verdetto letto
   attraverso `| tail` che ne aveva tagliato la testa. **Prima di credere a un verde, provare
   che lo strumento sa diventare rosso.**

## 6-bis. Copertura dichiarata (cosa e' verificato e cosa NO)

> Il "fatto" si dichiara per fatti. Un checkpoint verde dice cosa e' stato **controllato**,
> non cosa e' stato **coperto**.

**Verificato da oracoli.** 210 test nei 12 file rilevanti, 0 skippati. Segreto Anthropic
confinato (nominato in UN file, assente dai moduli `'use client'`). SSRF: schema, confini
delle range IPv4, IPv6 riservati + NAT64 + 6to4, rivalidazione per-hop sui redirect, limiti
tempo/redirect/byte, 18 input ostili da 1 MB sotto 2 s. Tetti di P1-D17 su ogni campo, con
scarto per campo e **niente troncamento**. Stream a due flush provato **sull'ordine**.
History solo-testo: `tool_use` dal client **irrappresentabile**. Same-origin fail-closed,
tetto sui byte del body, primo messaggio `user` imposto. Proprieta' del sito per
**uguaglianza esatta** (fixture con id in relazione di prefisso). Anti-enumerazione: "non
tuo" e "inesistente" danno la stessa risposta, asserita su un valore atteso esplicito.
Rendering: nessun elemento nasce dal testo ostile del brief, `photo_ref` non finisce in un
`src`. 49 mutazioni dell'orchestratore, 49 uccise.

**`rls:0` significa "niente di nuovo".** `onboarding-ui` non ha introdotto superficie DB.
La RLS di `site_briefs` resta provata a runtime da `brief-model`: 35 test DB-backed
eseguiti, 0 skippati, `signInAs` con auth reale, denial cross-tenant asserito, FK composita
che risponde `23503` sul site-squatting.

**NON coperto — da non confondere con un verde:**
1. **Nulla e' stato eseguito in un browser.** Il flusso esiste nel codice ed e' montato, ma
   nessun utente (ne' un test E2E) l'ha percorso. jsdom non carica risorse: la sicurezza
   del rendering e' asserita come "nessun elemento nasce dal testo del brief", **non** come
   "nessuno script ha girato".
2. **Il confine LLM e' mockato in ogni test, per costruzione.** Non esiste una chiave API:
   la qualita' dell'intervista non e' oracolata, e **gli schemi strict non sono mai stati
   provati contro l'API reale**. Il vincolo del primo messaggio `user` e' ora imposto
   server-side, ma il nested `updates` con `additionalProperties:false` **senza `required`**
   resta non verificato: se l'API applicasse il vincolo ricorsivamente, la prima chiamata
   vera tornerebbe 400.
3. **La RLS non e' esercitata dai test della UI**: `listSites`/`getBrief`/`upsertBrief`/
   `confirmBrief` sono doppi. L'isolamento cross-tenant vero e' provato altrove (T-100/T-120).
4. **"Una Server Action eredita il controllo d'origine di Next" e' un'INFERENZA** dalla
   documentazione: i test la invocano come funzione. Nessun oracolo prova che una POST
   cross-site verso l'azione sia rifiutata — a differenza dei due gate di T-150, che sono asseriti.
5. **La guardia SSRF non ha mai girato contro un server remoto ostile** ne' dietro un
   gateway NAT64. Le porte **non sono filtrate** su IP pubblici (`:22`, `:6379` permessi).
6. **L'estrazione e' provata su HTML sintetico**, mai su siti reali.
7. **Lo spagnolo e' verificato solo come "diverso dall'italiano e presente in entrambi i
   cataloghi"**: una traduzione sbagliata ma diversa passerebbe.
8. **Lo STILE non e' asserito**: rimuovere le classi token da un componente (o metterci un
   hex) non fa cadere nessun test. Vale per tutte le primitive, `Textarea` compresa.
9. **Verifica avversariale a LENTE COMBINATA** su T-151/T-152/T-153 (un agente, due lenti),
   non a due lenti indipendenti come su T-150.
10. **Il peso massimo di una riga ENTRO i tetti e' ~405 KB** (misurato), dominato dalle 200
    offerte al tetto. Il tetto impedisce il singolo campo da centinaia di migliaia di
    caratteri, **non** rende la riga piccola. Non ha oracolo.
11. **Nulla limita la FREQUENZA delle richieste.** Una singola POST di turno puo' portare al
    modello ~164.000 code unit (~41k token) e il client SDK ha `maxRetries` 2, quindi fino a
    **3 chiamate upstream per POST**. `importBriefFromUrl` non ha ne' limite di frequenza ne'
    di costo. Il tetto sui byte non copre un client che omette `Content-Length` (chunked).

## 7. Carry-over: rilievi NON corretti (nessuno e' un via libera)

> Consapevolmente non risolti, perche' fuori dagli acceptance_criteria del macrotask che li
> ha fatti emergere. **Non trattarli come chiusi.**

**CHIUSI da questa sessione** (erano §7 p.1, p.2, p.3, p.5, p.6 della sessione precedente):
il ciclo `tool_result` (P1-D19, il 400 e' irrappresentabile), `assistantText` vuota (il
ChatPanel rende un segnaposto invece di una bolla vuota), `hours` editabile (P1-D13), il
messaggio d'errore unico dell'import (P1-D16), il tetto di lunghezza (P1-D17).

**CHIUSO da `P1-D24`** (era il p.1, il piu' importante): il modello **vede** ora lo stato del
brief — i **nomi** dei campi compilati e mancanti piu' i **valori dei due enum chiusi** — e
continua a **non vedere nessun valore di testo libero**, che e' cio' che azzera la superficie
di prompt injection dal testo importato. Non ri-chiede piu' cio' che `fromUrl` ha raccolto e
sa cosa manca. Effetto di rimbalzo: **il brief e' ora la memoria durevole** anche al reload.

**APERTI:**
1. **La corroborazione di `readyForReview` verifica la PRESENZA, non la PROVENIENZA.**
   `markedReady && isBriefComplete(brief)` e' **aggirabile in UN SOLO turno** — misurato:
   `isBriefComplete` chiede `business_name && vertical && primary_goal && locale`, ma
   `vertical` ha `default('altro')` e `locale` e' sempre valorizzato, quindi i campi che
   davvero vincola sono **due**. Un modello sotto injection che fabbrica quei due e segnala
   nello stesso turno passa. Alza la barriera da "qualunque segnale apre la conferma" a
   "un'iniezione deve anche fabbricare i campi essenziali, che l'utente vede nel pannello e
   conferma esplicitamente" (T-152), **ma non la chiude**. Chiuderla richiede tracciare la
   provenienza dei valori: e' un'altra decisione. Il comportamento e' **pinnato da un test**.
2. **La history della chat non e' persistita**: al reload chi torna riparte da zero. Mitigato
   ma non risolto da P1-D24 (il brief e' memoria, la conversazione no).
3. **`upsertBrief` non riporta quali campi ha scartato** (ritorna solo `{ok, complete}`):
   `onSaved(patch)` segna come persistita TUTTA la patch, quindi un campo rifiutato
   risulterebbe salvato e i diff successivi lo salterebbero. Sede: **T-123**.
4. **T-122 fonde le offerte PER NOME**, quindi **rinominare una voce non rinomina: AGGIUNGE**.
   Pinnato da un test (asserisce TRE voci) e **detto all'utente** nella schermata. Sede: T-122.
5. **Testo estratto = input non fidato in RENDERING** anche per **P2**: il sito generato
   consumera' `description`/`highlights`/offerte. La superficie del modello e' chiusa e il
   rendering di P1 e' sicuro, ma la sanitizzazione nel sito generato spetta a P2.
6. **`stop_reason` mai ispezionato** e `max_tokens` 2048 in `runOnboardingTurn`: un turno
   troncato produce un `tool_use.input` parziale, la validazione lo scarta e l'aggiornamento
   **si perde in silenzio**.
7. **Un solo campo invalido scarta l'INTERA tool-call** in `interview.ts` (fail-closed),
   mentre `fromUrl` scarta per-campo: i due percorsi **si comportano diversamente**.
   Con i tetti di P1-D17 il caso e' piu' raggiungibile.
8. **`readyForReview` e' pilotato interamente dal modello** (prompt-injectable):
   corroborazione deterministica disponibile e non usata (`isBriefComplete`, T-122). Per
   questo il link alla review **non** e' dietro quel flag.
9. **Timeout SDK Anthropic di default** (10 min x 2 retry ≈ 30 min) in una route Next.
10. **`openingHoursSpecification`** (forma a oggetti) non letta da `fromUrl`; **porte non
    filtrate** su IP pubblici; `withoutRegions` inserisce uno spazio in piu' a ogni regione.
11. **Un valore GIA' salvato oltre il tetto** viene scartato in **lettura** e, al primo
    salvataggio, **riscritto come assente** (la riga viene toccata: `briefToRow` riscrive
    ogni colonna). Rischio **latente**: nessun writer applicativo scrive oltre il tetto,
    quindi la riga fuori scala oggi non esiste.
12. **`zod` entra nel bundle del browser**: `OnboardingWorkspace` e' il primo modulo
    `'use client'` che importa **valori** da `@/domain/onboarding/brief`. Nessun segreto
    (`brief.ts` importa solo zod), ma e' peso.
13. **Il test che lega gli enum del pannello a `BriefUpdateSchema` cattura rinomine e
    rimozioni, NON le aggiunte**: un `vertical` nuovo in T-121 mancherebbe dalle select
    senza che nulla diventi rosso.
14. **`P1-D11` (contratto di altitudine, `architecture:`) ancora rinviato.** La guardia
    ESLint deny-by-default di T-131 e' ormai un vincolo di layering reale
    (`src/app` → `src/domain` → `src/data`) e `cycle:0` e' misurato: l'audit del grafo
    import e' piu' semplice di prima.
15. **N+1 sulla dashboard**: `getBrief` per sito (concorrenti, quindi ~1 round-trip di
    latenza ma N di carico), e `getBrief` fa `select('*')` + zod per leggere UN campo
    `status`. Proposta **riportata e non applicata**: `listBriefStatuses()` in una sola
    query. Sede: **T-123**, da aprire come emendamento.
16. **La protezione del middleware su `/review`** si appoggia all'oracolo di T-150 sul regex
    `(?:/.*)?`, non e' riasserita nel file di T-152. E il matcher del middleware **esclude i
    pathname che contengono un punto**: per un `siteId` del genere l'unica guardia e' il
    `getUser()` della pagina (pinnato da un test).

## 8. Prossimi passi & decisioni

1. **P1 e' completo.** Il prossimo sotto-progetto e' **P2 (generazione dei 5 mockup)**, che
   consuma il brief `status='confirmed'`. Da bootstrappare con un blueprint proprio.
2. **Decisione CHIUSA — `P1-D24`**: lo stato del brief arriva al modello come soli nomi di
   campo. Resta aperto il limite della corroborazione di `readyForReview` (§7 p.1), che
   verifica la presenza e non la provenienza: chiuderlo e' una decisione a se'.
3. **Emendamenti da proporre**, entrambi su T-123: riportare `rejected[]` in
   `UpsertBriefResult` (§7 p.3) e `listBriefStatuses()` per l'N+1 (§7 p.15).
4. **Prima chiamata reale all'API**, quando ci sara' una chiave: verificare gli schemi
   strict (§6-bis p.2). E' l'unico modo di chiudere quel rischio.
5. **Decision ledger**: aggiunte in questa sessione `P1-D17` (tetto di lunghezza), `P1-D18`
   (stream a due flush), `P1-D19` (history solo testo), `P1-D20` (annulla la clausola 4 di
   P1-D17), `P1-D21` (proprieta' via `listSites`, anti-enumerazione), `P1-D22` (cap della
   history), `P1-D23` (corregge la motivazione di P1-D19). Vedi `00-INDEX.md` §4.
