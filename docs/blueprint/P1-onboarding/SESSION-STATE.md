# SESSION-STATE — Belora · P1 (Onboarding)

> Fonte di verita sullo **stato vivo** del sotto-progetto P1. Letta da BUILD a ogni
> apertura e aggiornata a ogni chiusura (`prompts/session-end.md`). Distinta dalla
> SESSION-STATE della skill trueline e da quella di P0.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (JS/TS + Supabase) |
| **Ultimo aggiornamento** | 2026-07-25 (chiusura BUILD macrotask `url-import`) |
| **Sessione corrente** | build-P1-url-import — **CHIUSA**. Checkpoint VERDE 4/4 al secondo giro (il primo ROSSO su sicurezza), mergeato su `main` (`802ee69`). **Prossimo macrotask DESIGNATO: `onboarding-ui`** (T-150..T-153), l'ULTIMO di P1. Riprendere con `prompts/session-start.md`. |

---

## 1. Stato dei macrotask

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| brief-model | **done** | **VERDE 4/4** | T-120..T-123 (`33fb898` + `5243260`); mergeato su `main` |
| ai-onboarding | **done** | **VERDE 4/4** | T-130..T-132 (`8ef4cf9`), build + 6 fix; mergeato su `main` |
| url-import | **done** | **VERDE 4/4** | T-140..T-141 (`802ee69`), build + 10 fix; mergeato su `main` |
| onboarding-ui | **todo** | — | T-150..T-153 — **tutte le dipendenze sono verdi: e' sbloccato** |

**→ Restano solo `onboarding-ui` (T-150..T-153) e la chiusura di P1.**

## 2. Macrotask corrente

- **Ultimo chiuso**: `url-import` (T-140..T-141, checkpoint verde 4/4, `802ee69`).
- **PROSSIMO DESIGNATO**: **`onboarding-ui`** (T-150 rotta + chat streaming, T-151
  ChatPanel/BriefPanel/UrlImportBar, T-152 Rivedi&conferma, T-153 dashboard).
- **ATTENZIONE — `onboarding-ui` eredita 6 vincoli espliciti** dai macrotask precedenti.
  Sono in §7 e **vanno letti prima di iniziare**: il piu' pesante e' che senza un ciclo
  `tool_result` la route di T-150 prende un **400 dall'API** al secondo turno.

## 3. Stato git

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/url-import` (pushato; mergeato su main; non cancellato) |
| Ultimo commit | `802ee69` su `main` (HEAD) — working tree pulito, `origin/main` allineato |
| Stato merge su `main` | **MERGED**: url-import ff `b16ac2c..802ee69`, gated dal checkpoint verde 4/4 |
| Deploy-coupling | **`main_deploy_coupled: false`** — override riconfermato dall'utente a inizio BUILD P1. Nessun deploy-on-push |

## 4. Baseline & budget

- **Baseline di sicurezza**: `gitleaks:0 · osv:0 · semgrep:0 · rls:0`; dead-code:0, twin:0;
  `degraded: []`. **`npm audit`: 0 vulnerabilita TOTALI** (non solo escludendo dev).
- **Dipendenze**: aggiunta `undici@^7.28.0` a `dependencies` (era phantom, decisione
  `P1-D14`). `npm audit fix` ha chiuso `brace-expansion` (advisory dev-only **preesistente
  in `main`**, emerso perche' pubblicato di recente — non introdotto da questo macrotask).
- **Suite**: **62 test url-import** (fetch-safe 28, import-fromurl 34) — nessuno tocca il DB
  ne' la rete: resolver, trasporto e confine LLM sono iniettati o mockati. Full suite verde
  nel checkpoint. typecheck/lint/knip/prettier puliti.
- **Budget**: BUILD 2 builder sequenziali (~351k token). VERIFY: **16 agenti lanciati, 3
  completati — il workflow e' FALLITO per limite di sessione** (~589k token spesi). La
  refutazione non e' mai girata e la lente `oracles` non e' partita.
- **Oracoli deterministici dell'orchestratore** (sono questi che hanno tenuto): 4 sonde
  sperimentali sul percorso reale, 15 mutazioni di sicurezza sul build (14 uccise, 1 non
  applicabile), 9 riproduttori sui rilievi, 15 mutazioni sulle fix (**15 uccise**), 18 casi
  di ReDoS su HTML ostile da 1 MB (tutti < 2 s).

## 5. Esiti dell'ultima sessione (framing onesto)

### url-import (T-140..T-141)
- **T-140** `fetchSafe`: schema → DNS → giudizio su TUTTI gli indirizzi → connessione
  **pinnata** agli indirizzi appena validati (hook `connect.lookup` di undici), redirect a
  mano con rivalidazione per-hop, limiti su tempo/byte/redirect, allowlist `text/html`,
  risultato tipizzato che non fa trapelare nulla del target interno.
- **T-141** `fromUrl`: deterministico prima (JSON-LD LocalBusiness → name/address/phone/
  **hours**/geo/email; Open Graph; meta/title/heading), AI solo sul residuo, output validato
  con T-121, proposta mai persistita e `'confirmed'` non rappresentabile.
  **`fromUrl` e' l'unico percorso automatico che riempie `hours`** (la chat non puo', P1-D13).
- **Decisioni registrate**: `P1-D14` (undici dichiarata), `P1-D15` (gate della chiamata al
  modello + solo residuo), `P1-D16` (motivo unico per host non raggiungibili).

### Il workflow di VERIFY e' fallito: cosa ha tenuto al suo posto
13 agenti su 16 sono morti per limite di sessione, **tutti i 12 refutatori inclusi**. I
`confirmed: []` e `refuted: []` del risultato **non erano un via libera**: erano l'artefatto
del fallimento. Peggio, uno **difetto dello script di workflow** ha fatto sparire dai
risultati i 6 rilievi a severita' piu' alta (messi in coda per refutazione, senza voti non
finivano ne' fra i confermati ne' fra i refutati ne' fra i non-verificati).
I 19 rilievi sono stati **recuperati dal `journal.jsonl`** e giudicati dall'orchestratore
**con riproduttori eseguiti**, non accettati su segnalazione.

### Difetti confermati e corretti (10), tutti pinnati da mutazione
1. **[HIGH correttezza]** ricorsione non limitata sul JSON-LD: `RangeError` **fuori** da
   `fromUrl` con ~10 KB di HTML (riprodotto a profondita' 5000/12000/30000 e via `@graph`).
2. **[HIGH sicurezza]** l'estrazione girava sull'**HTML grezzo**: un JSON-LD o un `<meta>`
   dentro un **commento** batteva il markup reale (`business_name = "JSONLD-COMMENTATO"`).
3. **[MEDIUM sicurezza]** **NAT64 `64:ff9b::/96`** e **6to4 `2002::/16`** non bloccati: la
   guardia li lasciava passare, ed erano innocui solo perche' questa rete non li instrada.
   In un ambiente IPv6-only con NAT64, `64:ff9b::a9fe:a9fe` e' l'endpoint metadata cloud.
4. **[MEDIUM sicurezza]** la risposta del modello poteva scrivere campi **non dichiarati dal
   tool** (`social_links`, `brand_hints`, `offerings`): `social_links` e' destinato a un href.
5. **[MEDIUM conformita']** l'output del modello **sovrascriveva** i dati deterministici.
6. **[MEDIUM correttezza]** un valore JSON-LD non testuale (`name: 12345`) occupava lo slot
   e sopprimeva `og:title` e `<title>`, spendendo anche una chiamata al modello.
7. **[LOW correttezza]** un `<script` **letterale** in un attributo azzerava il testo. La
   prima correzione troncava il tag contenitore: chiusa alla radice e resa **lineare**
   (senza, 1 MB di marcatori mai chiusi sarebbe stato quadratico — verificato).
8. **[LOW correttezza]** orari fuori scala accettati (`"25:99-26:00"`).
9. **[robustezza]** una risposta del confine di forma inattesa faceva **lanciare** l'import
   (emerso perche' il gate corretto al punto 5 ha reso il ramo AI finalmente raggiungibile).
10. **[oracoli]** timeout, cablaggio di produzione (`systemResolve`/`pinnedFetch`) e redirect
    303/308 non avevano oracolo: erano rimovibili con la suite verde.

### Checkpoint: un giro ROSSO prima del verde
Primo run **ROSSO** su controllo 2: `gitleaks:1` CRITICAL — **falso positivo** su una
costante di test chiamata `SECRET`. Chiuso **alla fonte** (costante rinominata), non con una
allowlist. `osv:1` era `brace-expansion`, dev-only e preesistente: risolto con `npm audit fix`.
Secondo run **VERDE 4/4**.

### fix_state
Tutte **verified**: riverificate con lo STESSO oracolo (15 mutazioni sulle fix, 15 uccise,
piu' due controlli di sanita' che DEVONO restare rossi) e col checkpoint. Nessuna rimozione
di dead-code.

## 6. Note operative (checkpoint & test)

- **Checkpoint**: `db reset`, `set -a; . .env.local; set +a`, `.env.local` FUORI dal repo +
  `rm -rf .next`, `run_checkpoint.mjs "<repo>" --in-place --mode build` (SENZA `--blueprint`),
  ripristino via trap EXIT. Script in
  `C:/Users/claud/.claude/plugins/cache/trueline-local/trueline/0.1.0/skills/trueline/scripts/`.
- **`gitleaks` e i nomi di variabile**: una costante di test chiamata `SECRET`/`TOKEN`/`KEY`
  con un literal assegnato fa scattare `trueline-generic-assigned-secret`. Nominarle
  diversamente **prima** di scrivere il test.
- **Rate limit auth**: suite/checkpoint una volta per finestra; `db reset` azzera il contatore.
- **Batteria di mutazione**: e' lo strumento che ha trovato tutto. Muta l'IMPLEMENTAZIONE,
  gira i test, ripristina verificando l'hash; includi sempre controlli di sanita' che devono
  restare ROSSI. Passa le stringhe via `argv`, non via heredoc annidati (l'escaping salta).

## 7. Carry-over: rilievi NON corretti (nessuno e' un via libera)

> Consapevolmente non risolti, perche' fuori dagli acceptance_criteria del macrotask che li
> ha fatti emergere. **Non trattarli come chiusi.**

**BLOCCANTI per `onboarding-ui` — leggerli prima di iniziare T-150/T-151:**
1. **Nessun ciclo `tool_result` (da ai-onboarding).** Se il modello risponde con
   `stop_reason:'tool_use'` e T-150 rimanda la history appendendo il turno assistente (che
   contiene blocchi `tool_use`) seguito da un nuovo messaggio utente **senza i `tool_result`
   corrispondenti, l'API risponde 400**. `runInterviewTurn` non restituisce la history ne'
   produce `tool_result`. **Da progettare esplicitamente in T-150.**
2. **`assistantText` vuota su turno di sole tool-call (da ai-onboarding).** Con Haiku e'
   frequente: la UI mostrerebbe una bolla assistente vuota.
3. **`hours` (P1-D13).** Il pannello brief (T-151) **deve** esporre un campo orari editabile:
   la chat non puo' raccoglierli. `url-import` li riempie **solo** se il sito pubblica un
   JSON-LD `openingHours`.
4. **Testo estratto = input non fidato in RENDERING (da url-import).** `description`,
   `highlights` e gli altri campi testuali possono contenere HTML o `javascript:` presi da
   una pagina ostile. La superficie del modello e' stata chiusa (solo campi dichiarati), ma
   **la sanitizzazione in output spetta a T-151/T-152 e al sito generato (P2)**. Non
   inserire testo del brief in `innerHTML` ne' in un `href` senza validazione dello schema.
5. **`P1-D16`: il messaggio d'errore dell'import non puo' distinguere** "indirizzo
   inesistente" da "bloccato" (entrambi `address-blocked`, per negare l'enumerazione DNS).
   T-151 deve usare un messaggio unico.
6. **Nessun tetto di lunghezza sui campi del brief.** Misurato: una pagina da ~900 KB
   produce un `description` da **900.000 caratteri**, che arriva a `upsertBrief` (T-123) e al
   DB. Vale per **entrambe** le sorgenti (chat e import), quindi **la sede giusta della fix e'
   `BriefUpdateSchema`/`CORE_FIELD_SCHEMAS` in `src/domain/onboarding/brief.ts` (T-121)**, non
   il singolo chiamante. Serve un emendamento a T-121.

**Da verificare al primo turno reale (T-150, con chiave configurata):**
7. **Gli schemi strict non sono mai stati validati contro l'API reale** — tutti gli oracoli
   mockano il confine, per costruzione. `update_brief` (T-132) ed `extract_brief` (T-141)
   hanno l'oggetto annidato `updates` con `additionalProperties:false` ma **senza `required`**:
   se l'API applicasse il vincolo ricorsivamente, la prima chiamata vera tornerebbe **400**.

**Robustezza / superfici note (non regressioni):**
8. **`stop_reason` mai ispezionato** e `max_tokens` 2048 in `runOnboardingTurn`: un turno
   troncato produce un `tool_use.input` parziale, la validazione lo scarta e l'aggiornamento
   **si perde in silenzio** (scenario reale: l'utente incolla un menu di 20 voci).
9. **Un solo campo invalido scarta l'INTERA tool-call in `interview.ts`** (fail-closed): si
   perde anche il dato valido dello stesso turno. `fromUrl` usa invece lo scarto per-campo:
   **i due percorsi si comportano diversamente**, ed e' una divergenza da sanare o dichiarare.
10. **`readyForReview` e' pilotato interamente dal modello** (prompt-injectable): corroborazione
    deterministica disponibile e non usata, `isBriefComplete` (T-122).
11. **La history e' accettata come fidata** da `runInterviewTurn` (T-150 la ricevera' dal
    browser: un client ostile puo' fabbricare turni `assistant`).
12. **Timeout SDK Anthropic di default** (10 min x 2 retry ≈ 30 min) in una route Next.
13. **`openingHoursSpecification`** (forma a oggetti) non letta da `fromUrl`; **le porte non
    sono filtrate** su IP pubblici (`:22`, `:6379` su un host pubblico sono permessi);
    `withoutRegions` inserisce uno spazio in piu' a ogni regione rimossa (innocuo).
14. **Oracoli ancora deboli** segnalati e non chiusi: il test del redirect relativo non
    discrimina la base dell'hop; alcuni rami di `fromUrl` (elencati dalla lente `discipline`)
    restano senza asserzione dedicata.

## 8. Prossimi passi & decisioni

1. **BUILD del prossimo macrotask**: `onboarding-ui` (T-150..T-153), l'ultimo di P1.
   **NON avviare in autonomia**: attendere il via dell'utente.
2. **Emendamento da proporre a T-121**: tetto di lunghezza sui campi del brief (§7 punto 6).
   Riguarda un task chiuso e verde: serve una decisione esplicita dell'utente.
3. **DECISIONE APERTA `P1-D11`**: contratto di altitudine (`architecture:`) ancora rinviato.
   La guardia ESLint deny-by-default di T-131 e' ormai un vincolo di layering reale
   (`src/app` → `src/domain` → `src/data`) e rende l'audit del grafo import piu' semplice.
4. **Correzioni al metodo, imparate sul campo** (aggiornate anche nella memoria di sessione):
   - **Un workflow che fallisce a metà restituisce array vuoti che SEMBRANO un verde.**
     Controllare sempre `agents_error` e recuperare i rilievi da `journal.jsonl`; non fidarsi
     del valore di ritorno.
   - **Lo script di workflow deve riportare i rilievi rimasti senza voti.** Chi entra in
     refutazione e non riceve voti deve finire in un array `unjudged`, non svanire.
   - **La refutazione LLM e' il filtro sbagliato** per i test placebo e per i claim
     verificabili: 4-5 refutatori su 6 avevano scartato un rilievo di sicurezza vero nel
     macrotask precedente. Lo strumento che funziona e' **mutation testing + riproduttori
     eseguiti dall'orchestratore**.
   - **Fare le sonde sperimentali PRIMA di lanciare i builder** (qui: pinning del socket,
     forma della callback `lookup`, `redirect:'manual'`, troncamento dello stream) ha evitato
     che scoprissero per tentativi i contratti dell'API.
