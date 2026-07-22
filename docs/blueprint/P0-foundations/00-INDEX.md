# 00-INDEX — Blueprint P0 · Fondamenta di Belora

> Mappa, piano di build, decision ledger e manifest del sotto-progetto **P0** del
> progetto Belora (AI website builder, Next.js + Supabase). Generato in modalita
> BOOTSTRAP dalla skill *trueline*. **Nessun codice**: solo il piano.

## 1. Mappa dei macrotask

| # | Macrotask | Cosa fonda |
|---|---|---|
| 01 | `infra` | Impianto infrastrutturale |
| 02 | `design-system` | Design system interno |
| 03 | `i18n` | Internazionalizzazione IT/ES |
| 04 | `auth` | Autenticazione |
| 05 | `tenancy` | Multi-tenant & RLS |
| 06 | `sites` | Entita "sito" & scheletro dashboard |

## 2. Piano di build (ordine topologico del DAG)

```
infra
 ├─ design-system ─┐
 ├─ i18n ──────────┤
 └─ auth ──────────┤
                   └─ tenancy ──→ sites
```

Ordine consigliato: **infra → design-system → i18n → auth → tenancy → sites**.
Ogni macrotask si costruisce sul branch di lavoro, passa il checkpoint (dead-code,
sicurezza, regressioni, conformita-logica sui `target_tests`), poi commit atomico.

## 3. Decision ledger (decisioni chiuse)

| Decisione | Scelta | Nota |
|---|---|---|
| Modello account | Personale, pronto per team | RLS ancorata a `account_members`; in V1 solo la riga owner |
| Login | Email/password + Google OAuth | Google richiede app OAuth (client id/secret server-side) |
| Scope P0 | Include entita `sites` + scheletro dashboard | Segnaposto; generazione AI = P2 |
| Stack | Next.js (App Router, TS) + Supabase | Managed, compatibile trueline |
| i18n | next-intl, IT/ES | Routing /it, /es |
| Design system | Tailwind + shadcn/ui | Componenti vincolati (always-beautiful) |
| Hosting dashboard | Vercel | Hosting siti pubblicati = P4 (Cloudflare R2), fuori P0 |
| Naming | "Belora" configurabile (`NEXT_PUBLIC_BRAND_NAME`) | Da `src/config/brand.ts` (T-006); verifica dominio/marchio: punto aperto |
| Rotte App Router | sotto `src/app/[locale]/**` | Componenti non-route in `src/ui/**`; evita rotte non instradate |
| Client Supabase | `supabase-admin` (service_role, server-only) · `supabase-ssr` (sessione utente, RLS) · `supabase-browser` (anon) | Naming inequivocabile + ESLint no-restricted-imports contro import accidentale del client admin |
| Scritture `account_members` | solo **owner** dell'account | SELECT via appartenenza; previene escalation di ruolo intra-tenant (editor→owner) |
| Unicità slug `sites` | `UNIQUE(account_id, slug)` (per-account) | Evita enumerazione cross-tenant via unique globale |
| Middleware | **unico** `src/middleware.ts` | next-intl (T-080) esteso dalla guardia auth (T-041) — Next.js ammette un solo middleware |
| Test schema/RLS | connessione Postgres diretta (`DATABASE_URL`) + client con auth reale | PostgREST non espone i cataloghi; RLS provata attraverso il client, mai nell'SQL editor |
| Contratto di altitudine (`architecture:`) | **Rinviato** | Convenzione di layering src/ui·domain·data in prosa; il gate `arch_check` si attiva quando i layer sono popolati, per evitare falliti di vacuita nei primi checkpoint |

## 4. Manifest dei task (28 task atomici)

| ID | Macrotask | Titolo | depends_on |
|---|---|---|---|
| `T-001` | infra | Scaffold Next.js (App Router, TypeScript) | [] |
| `T-002` | infra | Wiring client Supabase + gestione env | [T-001] |
| `T-003` | infra | Harness di test e gate qualita (CI) | [T-001] |
| `T-004` | infra | Supabase locale + workflow migrazioni | [T-002] |
| `T-005` | infra | Utility di test per client Supabase autenticati (auth reale locale) | [T-002, T-004] |
| `T-006` | infra | Modulo brand configurabile | [T-001] |
| `T-020` | design-system | Tailwind + design tokens + tema | [T-001] |
| `T-021` | design-system | Primitive UI accessibili | [T-020] |
| `T-022` | design-system | AppShell / layout autenticato | [T-021, T-006] |
| `T-080` | i18n | Setup next-intl + routing per locale | [T-001, T-020] |
| `T-081` | i18n | Cataloghi messaggi IT/ES + parita chiavi | [T-080] |
| `T-082` | i18n | Selettore lingua + persistenza cookie | [T-081] |
| `T-083` | i18n | Persistenza locale su profiles.locale | [T-082, T-061, T-005, T-041] |
| `T-040` | auth | Configurazione Supabase Auth (email/password + Google) | [T-002, T-004] |
| `T-041` | auth | Sessione server-side + guardia di route (middleware) | [T-040, T-080] |
| `T-042` | auth | Signup email/password con validazione server-side | [T-040, T-041, T-021, T-080] |
| `T-043` | auth | Login/logout email-password + Accedi con Google | [T-040, T-041, T-044, T-021, T-080] |
| `T-044` | auth | Route handler /{locale}/auth/callback (scambio code -> sessione) | [T-040, T-041, T-080] |
| `T-060` | tenancy | Schema accounts + account_members + RLS | [T-004, T-005] |
| `T-061` | tenancy | Schema profiles + RLS | [T-004, T-005] |
| `T-062` | tenancy | Auto-provision account/profilo su signup | [T-060, T-061, T-042, T-005] |
| `T-063` | tenancy | Test RLS a runtime (isolamento tenant) | [T-060, T-061, T-062, T-005] |
| `T-100` | sites | Schema sites + RLS + unicità slug | [T-060] |
| `T-101` | sites | Server actions create/list sites | [T-100, T-041, T-104, T-005, T-062] |
| `T-102` | sites | Scheletro dashboard (elenco + crea sito) | [T-101, T-022, T-081] |
| `T-103` | sites | Rinomina/elimina sito | [T-101, T-005] |
| `T-104` | sites | Utility di generazione slug unico (dominio) | [T-001, T-003] |
| `T-105` | sites | Controlli UI rinomina/elimina sito (dashboard) | [T-103, T-102] |

## 5. Fuori scope di P0 (rinviato ai sotto-progetti successivi)

- Onboarding / import GBP·Instagram (**P1**); motore di generazione 5 mockup (**P2**);
  editor (**P3**); pubblicazione & hosting siti su Cloudflare (**P4**); billing/crediti/Stripe (**P5**).
