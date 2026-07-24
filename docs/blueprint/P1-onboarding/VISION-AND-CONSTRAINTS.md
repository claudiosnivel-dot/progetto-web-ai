# VISION & CONSTRAINTS — Belora · P1 (Onboarding)

| | |
|---|---|
| **Progetto** | Belora (nome configurabile via `NEXT_PUBLIC_BRAND_NAME`) |
| **Ecosistema** | supabase-jsts — JS/TS + Supabase (Postgres/Auth/Storage/RLS) |
| **Owner / stakeholder** | Fondatore non tecnico; costruisce con Claude Code |
| **Sotto-progetto** | P1 — Onboarding (2o dei 10 sotto-progetti) |
| **Design a monte** | `docs/superpowers/specs/2026-07-24-p1-onboarding-design.md` |

---

## 1. Perche esiste (problema)

I micro-business locali in IT/ES/LATAM non hanno un modo semplice per dare a una
piattaforma i **contenuti** della propria attivita — la frizione #1 nel costruire un
sito. P1 la elimina: **trasforma un'attivita in un Business Brief strutturato tramite
un'intervista AI con pannello live**, cosi che P2 possa generarne i 5 mockup. P1 **non**
genera ancora il sito: costruisce e conferma il **brief** — l'artefatto-contratto che P2
consumera.

## 2. Per chi (utenti)

- **Utente finale della piattaforma**: il titolare dell'attivita, gia registrato (P0),
  che avvia l'onboarding di un proprio sito e ne compila il brief.
- P1 e interamente **post-login**: nessun flusso anonimo (il teaser pubblico e P6).

## 3. Obiettivo (cosa significa "fatto" per P1)

P1 e "fatto" quando, con **oracoli verdi** al confine di ogni macrotask:

- esiste l'entita **`site_briefs`** 1:1 con un sito, isolata per account via **RLS**
  provata a runtime;
- una **chat AI** (Haiku 4.5, configurabile) intervista nel locale dell'utente e riempie
  il brief via **tool-use tipato** (`update_brief` strict), con il confine LLM isolato e
  **mockabile**;
- un **pannello brief live** riflette lo stato ed e editabile a mano;
- un **import-da-URL SSRF-safe** pre-riempie il brief con estrazione deterministica-prima;
- una schermata **Rivedi&conferma** porta il brief a `status='confirmed'`;
- l'app resta **bilingue IT/ES** e le rotte sono protette.

"Fatto" = `target_tests` dei task verdi al checkpoint, **non** una dichiarazione dell'LLM.

## 4. Non-goals (cosa P1 NON fa — rinviato)

- Import **Google Business Profile** · **Instagram** → **P1.x** (approvazioni API/app review)
- Generazione **5 mockup** (blocchi + temi) → **P2**
- **Editor** inline → **P3**
- **Pubblicazione & hosting** dei siti, pipeline **media** (Cloudflare R2) → **P4**
- **Billing/crediti** → **P5**
- **Teaser pubblico** anonimo, blog, GEO → **P6–P9**

## 5. Vincoli

| Tipo | Vincolo |
|---|---|
| Ecosistema | supabase-jsts (Next.js App Router + TypeScript + Supabase) |
| Sicurezza — RLS | RLS per-tenant obbligatoria su `site_briefs` (standard R1–R9), ancorata a `is_account_member(account_id)`, isolamento provato a runtime |
| Sicurezza — segreti | `ANTHROPIC_API_KEY` server-only (mai `NEXT_PUBLIC`, mai nel sorgente); baseline gitleaks 0 |
| Sicurezza — SSRF | l'import scarica URL arbitrari: blocco IP privati/riservati + metadata cloud, re-check sui redirect (OWASP A01:2025, CWE-918) |
| Sicurezza — input non fidato | l'output del modello e l'HTML importato sono untrusted: validati server-side con BriefSchema prima di ogni scrittura |
| AI | primo LLM del progetto; confine unico `src/data/anthropic.ts` server-only e **mockabile** → oracoli deterministici (ORACLE-AS-JUDGE) |
| i18n | IT/ES: intervista e brief nel locale utente; un sito = una lingua in v1 |
| Design | Tailwind + shadcn/ui, componenti vincolati (AppShell/primitive P0) |
| Git | Branch a strati; merge su `main` gated dal verde del checkpoint; deploy non supervisionato bloccato |
| Altitudine | Layering `src/ui · src/domain · src/data` come convenzione; contratto `architecture:` formale **ancora rinviato** (P1-D11) — attivare dopo audit del grafo import |

## 6. Parity gate (promessa)

Conformita alla specifica = i `target_tests` dei task del macrotask passano al checkpoint
(BUILD). P1 e greenfield sul substrato P0: si costruisce verso i criteri, non si
caratterizza un brownfield.

## 7. Baseline & budget

- **Baseline di sicurezza**: vuota alla chiusura di BOOTSTRAP; popolata al primo BUILD.
- **Budget**: definito per-ciclo in BUILD; vedi `SESSION-STATE.md` §4.

## 8. Fonti di verita

- **Piano**: `00-INDEX.md` + i moduli numerati `01-…` … `04-…`.
- **Stato vivo**: `SESSION-STATE.md` (fonte di verita del sotto-progetto P1).
- **Design & strategia (a monte)**: `docs/superpowers/specs/2026-07-24-p1-onboarding-design.md`
  e `docs/superpowers/specs/2026-07-22-ai-website-builder-design.md` (visione).
- **Substrato costruito**: `docs/blueprint/P0-foundations/`.
