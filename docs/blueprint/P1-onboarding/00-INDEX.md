# 00-INDEX — Blueprint P1 · Onboarding di Belora

> Mappa, piano di build, decision ledger e manifest del sotto-progetto **P1**
> (Onboarding, 2o dei 10) del progetto Belora (AI website builder, Next.js + Supabase).
> Generato in modalita BOOTSTRAP dalla skill *trueline*. **Nessun codice**: solo il piano.
> Fonte dell'intento: `docs/superpowers/specs/2026-07-24-p1-onboarding-design.md`.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js App Router + TypeScript + Supabase) |
| **Sotto-progetto** | P1 — Onboarding (interview-core) |
| **Poggia su** | P0 (Fondamenta) — **completo e verde su `main`** (auth, tenancy, i18n IT/ES, design system, entita `sites` con RLS, dashboard scheletro) |
| **Schema task** | schema atomico trueline (`L-COL-019`): definition_of_done + acceptance_criteria + target_tests |

---

## 1. Mappa dei macrotask

| # | File | Macrotask | Cosa costruisce |
|---|---|---|---|
| 01 | `01-brief-model.md` | `brief-model` | Entita `site_briefs` (1:1 con sito, RLS), schema di dominio del Brief (zod), fusione/completamento puri, server action con RLS |
| 02 | `02-ai-onboarding.md` | `ai-onboarding` | Config segreto/modello Anthropic (server-only), confine LLM mockabile, orchestrazione intervista (tool-use `update_brief` strict) |
| 03 | `03-url-import.md` | `url-import` | Fetch SSRF-safe, estrazione deterministica-prima (JSON-LD/OG) → brief proposto |
| 04 | `04-onboarding-ui.md` | `onboarding-ui` | Rotta protetta + chat streaming, ChatPanel/BriefPanel live/UrlImportBar, Rivedi&conferma, aggancio dashboard |

## 2. Piano di build (ordine topologico del DAG)

Il DAG dei `depends_on` e **interno a P1** (P0 e un substrato gia costruito, referenziato
in prosa nei moduli, non nel DAG — vedi Decision `P1-D6`).

```
brief-model
 ├─ T-120 site_briefs (schema+RLS)          [ ]
 ├─ T-121 brief schema (zod)                [ ]
 ├─ T-122 applyBriefUpdate/isComplete       [T-121]
 └─ T-123 briefs server actions + RLS       [T-120, T-122]

ai-onboarding
 ├─ T-130 env Anthropic (segreto+modello)   [ ]
 ├─ T-131 anthropic.ts confine LLM          [T-130]
 └─ T-132 interview.ts orchestrazione       [T-131, T-122]

url-import
 ├─ T-140 fetch SSRF-safe                    [ ]
 └─ T-141 estrazione fromUrl                 [T-140, T-121]

onboarding-ui
 ├─ T-150 rotta + chat streaming             [T-123, T-132]
 ├─ T-151 ChatPanel/BriefPanel/UrlImportBar  [T-150, T-141]
 ├─ T-152 Rivedi&conferma                    [T-150]
 └─ T-153 dashboard: avvio/continua          [T-150]
```

**Ordine consigliato dei macrotask:** `brief-model` → `ai-onboarding` e `url-import`
(indipendenti fra loro, paralleli con worktree solo se mutano file in parallelo) →
`onboarding-ui`. Ogni macrotask si chiude al suo confine col checkpoint (dead-code ·
sicurezza · regressioni · conformita-logica sui `target_tests`), poi commit atomico sul
branch (`L-COL-024`); merge su `main` gated dal verde (asimmetria BUILD: merge autonomo
sul verde, salvo deploy-coupling — vedi §7 e SESSION-STATE §3).

## 3. Aggancio alla sicurezza (`07`)

Macrotask che toccano dati/auth/superfici di rischio — **tutti e quattro** — portano la
baseline di sicurezza (`11` §5.2 p.9):

- **`brief-model`**: RLS per-tenant su `site_briefs` (R1–R9, OWASP A01:2025), validazione
  server-side dell'input non fidato (A05:2025).
- **`ai-onboarding`**: segreto Anthropic server-only (A07/A02:2025, gitleaks 0), output del
  modello trattato come input non fidato e validato (A05:2025).
- **`url-import`**: **SSRF** — blocco IP privati/riservati + metadata cloud, re-check sui
  redirect (OWASP A01:2025, CWE-918).
- **`onboarding-ui`**: rotte protette server-side + isolamento cross-tenant via RLS (A01),
  nessuna chiave privilegiata nel browser.

## 4. Decision ledger

> Le decisioni si modificano SOLO con emendamento esplicito registrato qui.

| ID | Decisione | Scelta | Stato |
|---|---|---|---|
| `P1-D1` | Scope v1 | **Interview-core** (Brief + wizard-come-pannello + chat AI + import-URL). Import GBP/Instagram → **P1.x** | chiusa |
| `P1-D2` | Forma del flusso | **Chat-led + pannello brief live** (opzione A); il wizard e il pannello editabile, non una modalita separata | chiusa |
| `P1-D3` | Struttura del Brief | **Core tipizzato + lista `offerings` flessibile + tag `vertical`** (una lista offerta copre menu/servizi/catalogo/portfolio) | chiusa |
| `P1-D4` | Modello LLM onboarding | **Haiku 4.5** (`claude-haiku-4-5`) default, configurabile via `ANTHROPIC_MODEL_ONBOARDING` | chiusa |
| `P1-D5` | Import-URL | Porta d'ingresso **opzionale** che pre-riempie il pannello (non modalita separata) | chiusa |
| `P1-D6` | DAG e dipendenze su P0 | I `depends_on` P1 referenziano **solo task P1**; il substrato P0 (gia costruito) e citato in prosa, non nel DAG → `validate_blueprint` pulito sulla dir P1 | chiusa |
| `P1-D7` | Confine LLM | Unico punto di chiamata `src/data/anthropic.ts` **server-only e mockabile**; guardia ESLint no-restricted-imports (come `supabase-admin` in P0) | chiusa |
| `P1-D8` | Estrazione tipata | Chat: tool-use `update_brief` **strict**; import: structured-outputs. Merge e completamento **puri** e testabili | chiusa |
| `P1-D9` | Entita Brief | `site_briefs` **1:1 con `site`** (`UNIQUE(site_id)`), RLS clonata da `sites`/T-100 | chiusa |
| `P1-D10` | Media | In v1 il brief salva **solo riferimenti/URL** di foto; hosting file → **P4** | chiusa |
| `P1-D11` | Contratto di altitudine (`architecture:`) | **Ancora rinviato** (ereditato da P0): attivare `arch_check` solo dopo audit del grafo import reale, per evitare rossi su violazioni pre-esistenti | aperta |
| `P1-D12` | Forma dell'input del tool `update_brief` (T-132) | **Wrapper `{updates:{...}}`**: la patch di T-121 vive sotto l'unica chiave obbligatoria `updates`. Necessario perche' `BriefUpdateSchema` ha tutti i campi opzionali, quindi una patch FLAT non puo' avere il `required` **valorizzato** che AC-132-2 impone. Di conseguenza il `{business_name:'Bar Sole'}` nel *given* di AC-132-1 va letto come il **contenuto** della tool-call, non come il suo involucro JSON | chiusa (BUILD 2026-07-24) |
| `P1-D16` | Motivo del rifiuto per host non risolvibili (T-140) | Una risoluzione DNS che **fallisce** e un host che risolve a un IP **interno** danno lo STESSO motivo (`address-blocked`). Distinguerli renderebbe la guardia un **oracolo di enumerazione del DNS interno** (si potrebbe sondare quali nomi esistono nella rete del server leggendo il motivo). Costo accettato: T-151 non puo' dire all'utente "questo indirizzo non esiste" distinguendolo da "bloccato" | chiusa (BUILD 2026-07-25) |
| `P1-D15` | Quando si spende la chiamata al modello nell'import (T-141) | Il confine LLM si invoca quando la pagina **non si e' dichiarata**: nessun nodo JSON-LD dell'attivita **e** nessun `og:title`. `<title>` e `<h1>` sono **ripieghi**, non dati strutturati (l'objective di T-141 li elenca a parte): gatare sul solo `business_name` rendeva il ramo AI irraggiungibile in pratica, perche' ogni pagina ha un titolo — la DoD "la strutturazione AI del residuo passa per il confine" sarebbe stata vera solo nei test. Il modello riempie **solo il residuo**: non sovrascrive cio' che il sito dichiara di se stesso | chiusa (BUILD 2026-07-25) |
| `P1-D14` | `undici` come dipendenza dichiarata (T-140) | Promossa da **phantom dependency** (era in `node_modules` per via di terzi, usata senza dichiarazione) a `dependencies`. Serve il hook `connect.lookup` per **pinnare l'IP validato** a livello di socket: senza, fra il controllo della guardia e la connessione resta una finestra di **DNS rebinding**. Alternativa scartata: riscrivere l'URL con l'IP, che romperebbe SNI e verifica del certificato su https | chiusa (BUILD 2026-07-25) |
| `P1-D13` | `hours` fuori dal tool `update_brief` (T-132) | **Omesso dallo schema del tool**: `hours` e' `z.record` (chiavi libere) e lo strict tool use pretende `additionalProperties:false` su ogni oggetto, quindi non e' esprimibile. Gli orari **non sono raccoglibili dalla chat**; restano raccoglibili da `upsertBrief` (T-123). **Vincolo su `onboarding-ui`: il pannello brief (T-151) DEVE esporre un campo orari editabile**, altrimenti il dato non entra mai nel Brief | chiusa (BUILD 2026-07-24) |

## 5. Fonti di verita

- **Piano**: questo blueprint (`00-INDEX` + moduli `01-…` … `04-…`).
- **Design a monte**: `docs/superpowers/specs/2026-07-24-p1-onboarding-design.md`.
- **Stato vivo**: `SESSION-STATE.md` (fonte di verita del sotto-progetto P1 — distinta
  dalla SESSION-STATE della skill trueline e da quella di P0).
- **Substrato**: `docs/blueprint/P0-foundations/` (fondamenta gia costruite).

## 6. Self-check del blueprint

- **Strutturale**: `node <trueline>/scripts/blueprint/validate_blueprint.mjs docs/blueprint/P1-onboarding` — atteso exit 0 (11 §5.1).
- **Semantico**: `self-check-checklist.md` punti 6–10 su ogni task (11 §5.2); rilievi → human-in-the-loop.

## 7. Fuori scope di P1 v1 (rinviato)

- Import **Google Business Profile** e **Instagram** → **P1.x** (approvazioni API/app review).
- Generazione **5 mockup** → **P2**. Pipeline **media/hosting** → **P4**.
- **Teaser pubblico** anonimo → **P6**. **Editor** inline → **P3**.
