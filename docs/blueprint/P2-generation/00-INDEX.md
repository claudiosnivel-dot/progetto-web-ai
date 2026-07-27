# 00-INDEX — Blueprint P2 · Generazione dei mockup di Belora

> Mappa, piano di build, decision ledger e manifest del sotto-progetto **P2**
> (Generazione dei mockup, 3o dei 10) del progetto Belora (AI website builder,
> Next.js + Supabase). Generato in modalita BOOTSTRAP dalla skill *trueline*.
> **Nessun codice**: solo il piano.
> Fonte dell'intento: `docs/superpowers/specs/2026-07-26-p2-generation-design.md`.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js App Router + TypeScript + Supabase) |
| **Sotto-progetto** | P2 — Generazione dei mockup (motore blocchi x temi) |
| **Poggia su** | P0 (Fondamenta) e P1 (Onboarding) — **entrambi completi e verdi su `main`** |
| **Ingresso** | brief `status='confirmed'` (T-121/T-123), tetti di P1-D17: fino a 200 offerte, riga fino a ~405 KB |
| **Schema task** | schema atomico trueline (`L-COL-019`): definition_of_done + acceptance_criteria + target_tests |

---

## 1. Mappa dei macrotask

| # | File | Macrotask | Cosa costruisce |
|---|---|---|---|
| 01 | `01-generation-model.md` | `generation-model` | **I contratti**: entita `site_generations` + `generation_pools` (RLS, FK composita, indice UNIQUE parziale), vocabolario degli slot + `PoolSchema`, `SiteDocumentSchema` multi-pagina, server action con RLS e riconciliazione dello stato |
| 02 | `02-generation-engine.md` | `generation-engine` | **La trasformazione pura**: libreria di blocchi con precondizioni, 5 temi di P2 (layer separato e imposto), 5 ricette, `pagesFor` + navigazione derivata, `resolve`, `generatable` |
| 03 | `03-generation-llm.md` | `generation-llm` | **Il confine**: proiezione allowlist a due profili, normalizzatore conservativo, tool strict del pool, system prompt per-locale, `runGenerationTurn` con guardie sul ritorno, `GENERATION_BUDGET` + harness di misura |
| 04 | `04-generation-ui.md` | `generation-ui` | Rotta protetta + stream a due flush, blocchi del sito con rendering sanificato, selettore dei 5 mockup, scegli&congela, fase 2 a chunk, anteprima navigabile, aggancio dashboard |
| 05 | `05-generation-e2e.md` | `generation-e2e` | **Il primo end-to-end vero del progetto**: harness Chromium, **canary** che prova che l'oracolo sa diventare rosso, documento ostile asserito sull'effetto, raggiungibilita del deliverable |

## 2. Piano di build (ordine topologico del DAG)

Il DAG dei `depends_on` e **interno a P2** (P0 e P1 sono substrati gia costruiti,
referenziati in prosa nei moduli e non nel DAG — stessa scelta di `P1-D6`, ereditata
come `P2-D18`). `validate_blueprint` resta quindi pulito sulla dir P2.

```
generation-model
 ├─ T-200 site_generations + generation_pools (schema+RLS)   [ ]
 ├─ T-201 slots + PoolSchema + POOL_LIMITS                   [ ]
 ├─ T-202 SiteDocumentSchema multi-pagina + slot immagine    [T-201]
 └─ T-203 server actions generations + riconciliazione       [T-200, T-202]

generation-engine
 ├─ T-210 libreria dei blocchi (precondizioni, ruoli)        [T-201]
 ├─ T-211 5 temi di P2 + guardia di separazione              [ ]
 ├─ T-212 5 ricette (home + composizione pagine interne)     [T-210, T-211]
 ├─ T-213 pagesFor + navigazione e link derivati             [T-210]
 ├─ T-214 resolve -> SiteDocument (puro, deterministico)      [T-202, T-212, T-213]
 └─ T-215 generatable (soglia derivata, cosa sblocca)        [T-213]

generation-llm
 ├─ T-220 projection: allowlist, 2 profili, tetto            [ ]
 ├─ T-221 normalize: normalizzatore conservativo             [ ]
 ├─ T-222 tool strict del pool + guardia di sottoinsieme     [T-201]
 ├─ T-223 system prompt per-locale + GENERATION_BUDGET       [T-220]
 ├─ T-224 runGenerationTurn + guardie sul ritorno            [T-220, T-221, T-222, T-223]
 └─ T-225 harness di misura reale (P2-D17)                   [T-224]

generation-ui
 ├─ T-230 rotta protetta + POST /api/generate + 2 flush      [T-203, T-212, T-224]
 ├─ T-231 blocchi del sito, rendering sanificato             [T-210, T-211]
 ├─ T-232 selettore dei 5 mockup + rigenera una variante     [T-230, T-231, T-214]
 ├─ T-233 scegli & congela il documento                      [T-232]
 ├─ T-234 fase 2: pagine interne a chunk                     [T-233, T-213, T-224]
 ├─ T-235 anteprima navigabile /preview                      [T-233, T-231]
 └─ T-236 aggancio dashboard (una query sola)                [T-203, T-230]

generation-e2e
 ├─ T-240 harness Chromium + canary insicuro                 [T-235]
 └─ T-241 documento ostile + raggiungibilita deliverable     [T-240]
```

**Ordine consigliato dei macrotask:** `generation-model` → `generation-engine` e
`generation-llm` (indipendenti fra loro, paralleli solo con worktree se mutano file in
parallelo) → `generation-ui` → `generation-e2e`. Ogni macrotask si chiude al suo confine
col checkpoint (dead-code · sicurezza · regressioni · conformita-logica sui
`target_tests`), poi commit atomico sul branch (`L-COL-024`); merge su `main` gated dal
verde (asimmetria BUILD: merge autonomo sul verde, salvo deploy-coupling — vedi §7 e
`SESSION-STATE` §3).

**Nota sui `covers:` nei file di test.** In BUILD col controllo 4 attivo (`--blueprint`),
ogni blocco che esercita un AC deve portare `// covers: AC-xxx-n` nel file del test:
un AC non tracciato rende il controllo 4 **rosso prima di eseguire**. Convenzione del
file di test, non campo del blueprint.

## 3. Aggancio alla sicurezza (`07`)

**Tutti e cinque** i macrotask toccano dati, auth o superfici di rischio, quindi portano
la baseline di sicurezza (`11` §5.2 p.9). P2 **introduce superficie DB nuova**: `rls:0`
va **riconquistato**, non ereditato da P1.

- **`generation-model`**: RLS per-tenant su **due tabelle nuove** (R1–R9, OWASP
  A01:2025), **FK composita** `(account_id, site_id)` come difesa in profondita oltre la
  RLS (anti site-squatting cross-tenant, lezione di T-120), validazione server-side
  dell'output del modello prima di ogni scrittura (A05:2025).
- **`generation-engine`**: nessuna superficie DB, ma e qui che si dichiara **quale campo
  del brief ogni blocco rende** — cioe dove nasce il contratto di sanificazione che
  T-231 deve rispettare. Piu la **separazione del layer temi imposta** da
  `no-restricted-imports` (senza, il chrome del builder puo cambiare i siti dei clienti).
- **`generation-llm`**: **prompt injection** — il testo del brief entra nel prompt, e la
  difesa e strutturale (allowlist in ingresso, nessuna leva in uscita), non una frase nel
  prompt (A05:2025); segreto Anthropic **server-only** (A07/A02:2025, gitleaks 0);
  conformita del sottoinsieme JSON Schema dello strict tool use (P1-D20) come **guardia
  eseguibile** sull'oggetto realmente passato al confine.
- **`generation-ui`**: rotte protette server-side + isolamento cross-tenant via RLS
  (A01:2025), same-origin **fail-closed** e tetto sui byte del body (pattern T-150),
  nessuna chiave privilegiata nel browser, e **il punto piu esposto di tutto P2**: il
  **rendering del testo non fidato** del brief nel sito generato (carry-over P1 §7 p.5).
- **`generation-e2e`**: prova la difesa di rendering **sull'effetto** invece che sulla
  forma, e con un **canary** che dimostra che l'asserzione sa diventare rossa.

## 4. Decision ledger

> Le decisioni si modificano SOLO con emendamento esplicito registrato qui.
> `P2-D1`…`P2-D17` vengono dalla spec approvata del 2026-07-26 (§2 e §11), riportate qui
> in forma compatta: la motivazione integrale sta nella spec.

| ID | Decisione | Scelta | Stato |
|---|---|---|---|
| `P2-D1` | Cosa varia fra i 5 mockup | **Tema + struttura**, copy condiviso; **5 direzioni dichiarate a mano da noi**, non inventate dal modello; **il confronto avviene sulla home** (vedi `P2-D13`). 5 direzioni universali x blocco offerte che si specializza per verticale (5 ricette, non 25) | chiusa |
| `P2-D2` | Quante chiamate al modello | **Una**: produce un **pool di contenuti** (superset normalizzato di slot). Le 5 varianti sono `render(resolve(pool, ricetta, tema))`, **funzioni pure** | chiusa |
| `P2-D3` | Semantica del "rigenera" | **Copy-on-write per variante**: le 5 nascono sullo stesso pool; rigenerarne una le da un pool proprio (1 chiamata), le altre 4 non si muovono. Cambiare tema/ricetta e puro: 0 chiamate. Deciso ORA perche e una **forma dello schema** | chiusa |
| `P2-D4` | Cosa del brief arriva al modello | **Allowlist in ingresso** (proiezione nominata con tetto in code unit) **+ nessuna leva in uscita** (solo testo in slot nominati). Le offerte **non passano dal modello**. Busta con delimitatori presente ma **non contata come difesa** | chiusa |
| `P2-D5` | Dove vive l'output | **Due tabelle**; le 5 varianti sono **codice, non righe**; **congelamento alla scelta** in `site_generations.document`. File in Storage scartati (media/hosting e P4, `P1-D10`) | chiusa |
| `P2-D6` | Come si aspetta la generazione | **Sincrona con stream di trasporto** (pattern `P1-D18`); **durabilita dalla riga, non dal trasporto**. Le 5 cornici partono nel primo flush (struttura e tema sono nostri e deterministici), il pool nel secondo | chiusa |
| `P2-D7` | Brief confermato ma povero | **Blocchi condizionati ai dati**: senza dati un blocco **non esiste** (ne vuoto ne lorem ipsum). La soglia **deriva** da quanti blocchi sopravvivono. `slotsFor(brief)` toglie al modello la *possibilita* di scrivere la sezione senza base | chiusa |
| `P2-D8` | Cosa accade dopo la scelta | **Anteprima a piena pagina in sola lettura**. Rendering in **due funzioni pure in fila**: `resolve(...) -> documento` e `render(documento) -> pagina`. **Un solo renderer** per card e anteprima | chiusa |
| `P2-D9` | End-to-end vero | **Si, minimo e dichiarato**: Chromium, due scenari, **piu un canary**. Non serve la chiave API: l'artefatto sotto test e il **documento**, che in un E2E e una fixture | chiusa |
| `P2-D10` | Lingua del contenuto | **Etichette dai cataloghi i18n** `it`/`es`; il modello scrive **solo la prosa**. La CTA derivata da `primary_goal` fa rispettare **dal codice** la regola Meta del 15/01/2026 | chiusa |
| `P2-D11` | Modello e budget | **Sonnet 5** (`claude-sonnet-5`), env `ANTHROPIC_MODEL_GENERATION` col pattern di `P1-D4`. Pensiero **adaptive acceso**, `effort` come leva. **Mai `thinking: disabled`**: su Sonnet 5 riduce la propensione a usare i tool, e su Opus 5 la tool-call puo arrivare come **testo visibile** (turno riuscito, pool inesistente) | chiusa |
| `P2-D12` | Foto nei mockup di v1 | **Imagery del tema**, non le foto del brief. Il documento nasce con lo **slot immagine tipato per sorgente** (`theme-placeholder` \| `uploaded`). `photo_ref` non diventa mai un `src`: cadrebbe l'asserzione di P1 | chiusa |
| `P2-D13` | Multi-pagina in v1 | **Si: one-pager *e* multi-pagina semplice** (5-10 pagine). Set di pagine **derivato**: `pagesFor(brief, { maxPages })`, puro; una pagina senza dati non esiste; sotto il minimo il sito resta una one-pager. Generazione in **due fasi**: fase 1 = pool della home (i 5 mockup), fase 2 = pagine interne **una volta sola dopo la scelta**, a chunk di ~4 pagine | chiusa |
| `P2-D14` | Separazione del layer temi | **Imposta** da `no-restricted-imports` (`src/ui/site/**` non puo importare `src/ui/theme/tokens`), non convenuta — lo stesso meccanismo di `P1-D7` | chiusa |
| `P2-D15` | Riconciliazione dello stato | Una riga `generating` piu vecchia del timeout dichiarato si legge come `failed`; idem una riga `chosen` senza pagine interne oltre il timeout della fase 2. **Servono due meccanismi, non uno**: l'indice UNIQUE parziale e la difesa contro la doppia generazione **ed e anche il modo di incastrarsi** (se il processo muore nessun `finally` gira) | chiusa |
| `P2-D16` | Guasto di lettura vs brief povero | Un guasto di lettura del brief **non si rende come "brief povero"**: e la lezione di T-152 spostata (la sua versione era: un errore transitorio reso come brief vuoto) | chiusa |
| `P2-D17` | Le costanti di budget sono **provvisorie per dichiarazione** | I numeri di `GENERATION_BUDGET` sono **stime a tavolino**, non misure: `count_tokens` e un endpoint API e senza chiave il proxy in code unit al rapporto ~4:1 e tutto cio che abbiamo. **La taratura crediti/prezzi non si decide su queste stime**: attende la prima misura reale di `usage` su brief veri. I candidati piu probabili a essere rivisti **in alto**: crescita del system prompt (1,5k → 3-5k) e uscita della fase 2 (~300 → 400-600 parole/pagina). Sede: **T-225**, che gira **solo** con una chiave e altrimenti si dichiara *non eseguito*, mai verde | chiusa |
| `P2-D18` | DAG e dipendenze su P0/P1 | I `depends_on` di P2 referenziano **solo task P2**; i substrati P0 e P1 (gia costruiti) sono citati in prosa nei moduli, non nel DAG → `validate_blueprint` pulito sulla dir P2. **Eredita `P1-D6`** | chiusa |
| `P1-D11` | Contratto di altitudine (`architecture:`) | **Ancora rinviato** (ereditato da P0 e P1): nessun blocco `architecture:` in questo `00-INDEX`, quindi `arch_check` resta inattivo. Attivarlo solo dopo un audit del grafo import reale, per evitare rossi su violazioni pre-esistenti. **Nota**: P1 §7 p.14 osserva che le condizioni sono ormai piu favorevoli (`cycle:0` misurato, la guardia ESLint di T-131 e un vincolo di layering reale) | aperta |

## 5. Fonti di verita

- **Piano**: questo blueprint (`00-INDEX` + moduli `01-…` … `05-…`).
- **Design a monte**: `docs/superpowers/specs/2026-07-26-p2-generation-design.md`.
- **Ricerca collegata**: `docs/superpowers/research/2026-07-26-media-ingest-feasibility.md`
  (foto del cliente; sede P4/P1.x, con un rilievo che tocca il differenziatore #4).
- **Stato vivo**: `SESSION-STATE.md` (fonte di verita del sotto-progetto P2 — distinta da
  quelle di P0, P1 e della skill trueline).
- **Substrato**: `docs/blueprint/P0-foundations/`, `docs/blueprint/P1-onboarding/`.

## 6. Self-check del blueprint

- **Strutturale**: `node <trueline>/scripts/blueprint/validate_blueprint.mjs docs/blueprint/P2-generation`
  — atteso exit 0 (`11` §5.1).
- **Semantico**: `self-check-checklist.md` punti 6–10 su ogni task (`11` §5.2); rilievi →
  human-in-the-loop.

## 7. Fuori scope di P2 v1 (rinviato)

- **Editor inline** dei contenuti → **P3**. La sede definitiva del documento e una
  decisione di P3: qui vive in `site_generations.document` come punto di consegna.
- **Pubblicazione**, pre-render statico, R2/Worker, domini custom, SEO **tecnica**
  (sitemap XML, hreflang, canonical, robots) → **P4**. In P2 nascono i **testi** di
  `title` e `meta description`, perche sono copy.
- **Ingest di media** → **P4**; **import GBP/Instagram** → **P1.x**.
- **Crediti, addebito e taratura dei prezzi** → **P5** (input registrati in `P2-D17` e
  nella spec §13).
- **Multi-pagina complesso** (e-commerce, blog, pagine settore x citta) → **P4/P7**.
- **Teaser pubblico** anonimo → **P6**.
