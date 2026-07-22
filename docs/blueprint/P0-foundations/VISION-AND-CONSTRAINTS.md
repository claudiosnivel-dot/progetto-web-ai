# VISION & CONSTRAINTS — Belora · P0 (Fondamenta)

| | |
|---|---|
| **Progetto** | Belora (nome configurabile via `NEXT_PUBLIC_BRAND_NAME`) |
| **Ecosistema** | supabase-jsts — JS/TS + Supabase (Postgres/Auth/Storage/RLS) |
| **Owner / stakeholder** | Fondatore non tecnico; costruisce con Claude Code |
| **Sotto-progetto** | P0 — Fondamenta (1° dei 10 sotto-progetti) |

---

## 1. Perché esiste (problema)

I micro-business locali (ristoranti, palestre, saloni, artigiani, negozi, studi) in
IT/ES/LATAM non hanno un modo semplice per avere un sito **bello, trovabile e pronto a
convertire** senza competenze da designer. Belora è la piattaforma AI che risolve
questo. **P0 non costruisce ancora quel prodotto**: costruisce le **fondamenta**
tecniche su cui poggiano tutti i sotto-progetti successivi — l'impianto, l'identità
degli utenti, l'isolamento multi-tenant dei dati, la lingua e il sistema visivo.

## 2. Per chi (utenti)

- **Utente finale della piattaforma** (a partire da P1): il titolare dell'attività che
  si registra e gestisce i propri siti.
- **In P0** l'unico flusso utente reale è **registrazione/accesso** e una **dashboard
  scheletro** che elenca e crea "siti" (segnaposto, nessuna generazione AI).

## 3. Obiettivo (cosa significa "fatto" per P0)

P0 è "fatto" quando, con **oracoli verdi** al confine di ogni macrotask:

- un utente può **registrarsi/accedere** (email/password + Google) con sessione e
  guardia di route server-side;
- i dati sono **isolati per account** via **RLS** (accounts, account_members, profiles,
  sites), con isolamento **provato a runtime** attraverso il client;
- alla registrazione viene **auto-provisionato** un account personale + profilo;
- l'app è **bilingue IT/ES** (routing per locale, cataloghi con parità di chiavi);
- esiste un **design system interno** a componenti vincolati;
- esiste un'**entità `sites` minima** con una **dashboard scheletro** (crea/elenca/
  rinomina/elimina).

"Fatto" = `target_tests` dei task verdi al checkpoint, **non** una dichiarazione dell'LLM.

## 4. Non-goals (cosa P0 NON fa — rinviato)

- Onboarding / import Google Business Profile · Instagram → **P1**
- Motore di generazione (blocchi + temi → 5 mockup) → **P2**
- Editor inline → **P3**
- Pubblicazione & hosting dei siti (Cloudflare R2/Workers, domini custom) → **P4**
- Billing, crediti, Stripe/MoR, PPP LATAM → **P5**
- Vetrina/teaser pubblico, blog, GEO, roadmap pubblica → **P6–P9**

## 5. Vincoli

| Tipo | Vincolo |
|---|---|
| Ecosistema | supabase-jsts (Next.js App Router + TypeScript + Supabase) |
| Sicurezza | RLS per-tenant obbligatoria su ogni tabella user-facing (standard R1–R9); nessun segreto nel sorgente; `service_role` solo server-side |
| Multi-tenant | Isolamento ancorato all'appartenenza all'account (`account_members`); in V1 solo la riga `owner` |
| i18n | IT/ES dal giorno uno (next-intl, routing /it e /es) |
| Design | Tailwind + shadcn/ui, componenti vincolati ("always-beautiful") |
| Git | Branch a strati; merge su `main` gated dal verde del checkpoint; deploy non supervisionato bloccato |
| Naming | "Belora" da un unico punto di configurazione; verifica dominio/marchio = punto aperto |
| Altitudine | Layering `src/ui · src/domain · src/data` come convenzione; contratto `architecture:` formale **rinviato** (si attiva quando i layer sono popolati) |

## 6. Parity gate (promessa forte)

Conformità alla specifica = i `target_tests` dei task del macrotask passano al
checkpoint (BUILD). Nessun degrado a "invarianza" qui: P0 è greenfield, si costruisce
verso i criteri, non si caratterizza un brownfield.

## 7. Baseline & budget

- **Baseline di sicurezza**: vuota alla chiusura di BOOTSTRAP; popolata al primo BUILD.
- **Budget**: definito per-ciclo in BUILD; vedi `SESSION-STATE.md` §4.

## 8. Fonti di verità

- **Piano**: `00-INDEX.md` + i moduli numerati `01-…` … `06-…`.
- **Stato vivo**: `SESSION-STATE.md` (fonte di verità del progetto Belora — distinta
  dalla SESSION-STATE della skill trueline).
- **Design & strategia (a monte)**: `docs/superpowers/specs/2026-07-22-ai-website-builder-design.md`.
