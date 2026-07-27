# VISION & CONSTRAINTS — Belora · P2 (Generazione dei mockup)

| | |
|---|---|
| **Progetto** | Belora (nome configurabile via `NEXT_PUBLIC_BRAND_NAME`) |
| **Ecosistema** | supabase-jsts — JS/TS + Supabase (Postgres/Auth/Storage/RLS) |
| **Owner / stakeholder** | Fondatore non tecnico; costruisce con Claude Code |
| **Sotto-progetto** | P2 — Generazione dei mockup (3o dei 10 sotto-progetti) |
| **Design a monte** | `docs/superpowers/specs/2026-07-26-p2-generation-design.md` (17 decisioni chiuse) |

---

## 1. Perche esiste (problema)

Ogni builder AI sul mercato genera **un** sito e ti lascia rigenerarlo alla cieca.
Chi e facile da usare produce siti generici; chi ha potenziale estetico pretende
competenze da designer. **Nessuno garantisce un risultato bello a un non-designer.**

P2 e la risposta: da un Business Brief confermato produce **cinque direzioni di design
fra cui scegliere**, e dalla scelta un **sito completo** — one-pager o multi-pagina.
La bellezza non e affidata al modello: e una proprieta del **codice**, perche la
libreria di blocchi, le cinque ricette e i cinque temi sono nostri e testabili, e il
modello scrive **solo il testo**. E' anche la sola forma per cui, senza chiave API,
esistono oracoli veri.

P1 ha prodotto il brief; **P2 e il primo sotto-progetto che produce qualcosa da
guardare.** E' il "wow" che la visione (§6) indica come il prototipo da validare per primo.

## 2. Per chi (utenti)

- **Utente finale della piattaforma**: il titolare dell'attivita, che ha confermato il
  proprio brief in P1 e ora scegle il design del suo sito.
- P2 e interamente **post-login**, come P1: nessun flusso anonimo (il teaser pubblico e P6).
- **Nessun visitatore del sito generato** compare in P2: il sito non e ancora pubblicato
  (P4). L'unico lettore e il titolare, nell'anteprima.

## 3. Obiettivo (cosa significa "fatto" per P2)

P2 e "fatto" quando, con **oracoli verdi** al confine di ogni macrotask:

- da un brief `status='confirmed'` si ottengono **5 mockup della home** visibilmente
  diversi per **struttura e tema**, con **una sola** chiamata al modello;
- rigenerare il testo di **una** variante non tocca le altre quattro (**copy-on-write**);
- la scelta **congela** un **documento di sito** che non cambia piu se ritocchiamo una
  ricetta, e che l'anteprima rende a piena pagina;
- la **fase 2** costruisce le pagine interne **derivate dai dati**: un sito navigabile
  senza link a pagine inesistenti e **senza pagine sottili** — o, sotto il minimo, una
  one-pager corretta;
- **nessun valore del brief fuori allowlist** raggiunge il confine LLM;
- il **testo ostile** del brief non esegue nulla in un browser reale, provato
  **sull'effetto** e con un **canary** che dimostra che l'oracolo sa diventare rosso.

"Fatto" = `target_tests` dei task verdi al checkpoint, **non** una dichiarazione dell'LLM.

## 4. Non-goals (cosa P2 NON fa — rinviato)

- **Editor inline** dei contenuti → **P3**. P2 si ferma all'anteprima in sola lettura.
- **Pubblicazione**, pre-render statico, R2/Worker, domini, SEO tecnica → **P4**.
- **Ingest di media** (upload, Google Photos Picker, WhatsApp, Web Share Target) → **P4**.
  Fattibilita gia studiata: `docs/superpowers/research/2026-07-26-media-ingest-feasibility.md`.
- **Crediti e addebito** → **P5**. P2 non conta e non scala nulla; il **bound di costo**
  per sito e tuttavia calcolato e asserito da un test.
- **Multi-pagina complesso** (e-commerce, blog, pagine programmatiche settore x citta)
  → **P4/P7**. In P2 il multi-pagina e **semplice e derivato**.
- **Import GBP / Instagram** → **P1.x** (e vedi il rilievo sulle policy GBP nella ricerca).
- **Teaser pubblico** anonimo → **P6**.

## 5. Vincoli

| Tipo | Vincolo |
|---|---|
| Ecosistema | supabase-jsts (Next.js App Router + TypeScript + Supabase) |
| Ingresso | brief `status='confirmed'`, forma di T-121, coi tetti di P1-D17: fino a **200 offerte**, riga fino a **~405 KB**. Il generatore deve reggerla |
| Sicurezza — RLS | RLS per-tenant obbligatoria su `site_generations` e `generation_pools` (standard R1–R9), ancorata a `is_account_member(account_id)`, isolamento provato **a runtime** col client con sessione |
| Sicurezza — input non fidato in **rendering** | `description`, `highlights`, nomi e descrizioni delle offerte possono venire da una pagina ostile via `fromUrl` (T-141). In P1 il rendering e sicuro; **nel sito generato la sanificazione e di P2**. E' il carry-over P1 §7 p.5 |
| Sicurezza — prompt injection | il brief entra nel prompt: **allowlist nominata** in ingresso + **nessuna leva** in uscita. Un'iniezione riuscita ottiene un copy diverso, non un'escalation |
| Sicurezza — segreti | `ANTHROPIC_API_KEY` server-only, mai `NEXT_PUBLIC`, mai nel sorgente; baseline gitleaks 0 |
| AI | confine **unico** `src/data/anthropic.ts` (P1-D7), server-only e **mockabile**; guardia ESLint deny-by-default. Strict tool use su un sottoinsieme JSON Schema **ristretto** (P1-D20): niente `maxLength`/`maxItems`/vincoli numerici |
| AI — nessuna chiave | **non esiste una chiave API**: ogni oracolo mocka il confine, e "gli schemi strict non sono provati contro l'API reale" resta **aperto** anche in P2 |
| Modello | Sonnet 5 (`claude-sonnet-5`), configurabile via `ANTHROPIC_MODEL_GENERATION`; pensiero **adaptive acceso**, mai `disabled` |
| Budget | costanti in **un solo posto** (`GENERATION_BUDGET`); i numeri sono **stime dichiarate provvisorie** (P2-D17) fino alla prima misura reale |
| i18n | IT/ES: le **etichette** dei blocchi dai cataloghi i18n, il modello scrive **solo la prosa**. Un sito = una lingua (T-121) |
| Design | i **temi di P2** sono un layer **separato** dal design system dell'app, e la separazione e **imposta** da `no-restricted-imports`, non convenuta |
| Browser | P2 e il primo sotto-progetto con un **end-to-end vero** (Chromium): in P1 nulla era mai girato in un browser (§6-bis p.1) |
| Git | Branch a strati; merge su `main` gated dal verde del checkpoint; deploy non supervisionato bloccato |
| Altitudine | Layering `src/ui · src/domain · src/data` come convenzione; contratto `architecture:` formale **ancora rinviato** (P1-D11, ereditata) |

## 6. Parity gate (promessa)

Conformita alla specifica = i `target_tests` dei task del macrotask passano al checkpoint
(BUILD). P2 e greenfield sul substrato P0+P1: si costruisce verso i criteri, non si
caratterizza un brownfield.

## 7. Baseline & budget

- **Baseline di sicurezza** (eredita da P1): `gitleaks:0 · osv:0 · semgrep:0 · rls:0`.
  P2 **introduce superficie DB** (due tabelle nuove), quindi `rls:0` va **riconquistato**,
  non ereditato.
- **Baseline d'igiene** (eredita da P1): `.trueline/hygiene-baseline.json`, **41 impronte**,
  tracciata in git. Il controllo 1 e rosso se manca, **anche con zero duplicazioni nuove**.
- **Budget**: definito per-ciclo in BUILD; vedi `SESSION-STATE.md` §4.

## 8. Fonti di verita

- **Piano**: `00-INDEX.md` + i moduli numerati `01-…` … `05-…`.
- **Stato vivo**: `SESSION-STATE.md` (fonte di verita del sotto-progetto P2 — distinta da
  quelle di P0, P1 e della skill trueline).
- **Design a monte**: `docs/superpowers/specs/2026-07-26-p2-generation-design.md`;
  visione: `docs/superpowers/specs/2026-07-22-ai-website-builder-design.md`;
  ricerca media: `docs/superpowers/research/2026-07-26-media-ingest-feasibility.md`.
- **Substrato costruito**: `docs/blueprint/P0-foundations/`, `docs/blueprint/P1-onboarding/`
  (in particolare `SESSION-STATE.md` §6-bis copertura dichiarata e §7 carry-over).
