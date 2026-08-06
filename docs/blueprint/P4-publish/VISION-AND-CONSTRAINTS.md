# VISION & CONSTRAINTS — Belora · P4 (Pubblicazione, serving pubblico & media)

> Perché P4 esiste, per chi, cosa NON fa, e i vincoli. Input dall'utente e dalla spec di
> design approvata (`docs/superpowers/specs/2026-08-06-p4-publish-media-design.md`), non
> invenzione dell'LLM. Prosa in italiano, identificatori in inglese.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Owner / stakeholder** | Fondatore non tecnico; costruisce con Claude Code (priorità: managed, bassa manutenzione, task atomici) |

---

## 1. Perché esiste (problema)

P4 è **l'anello tra la modifica (P3) e il mondo**: l'utente prende il proprio sito editato e lo
rende **live e condivisibile** a un URL pubblico, con SEO di base e **foto reali** al posto dei
placeholder del tema. Finché il sito resta nell'area autenticata non serve a un cliente reale:
il valore si sblocca solo quando esiste a un indirizzo che si può mandare a un cliente, indicizzare
su Google, e riconoscere come "il mio sito con le mie foto". È anche il **primo momento** in cui un
artefatto di Belora esce dall'area autenticata e diventa pubblico — quindi la **superficie a più
alto rischio finora**, e la prima volta che entrano **byte non fidati** dell'utente (le foto).

## 2. Per chi (utenti)

Micro-business locali di IT/ES/LATAM, titolari non tecnici, spesso da telefono. Vogliono, in pochi
minuti: mettere online il sito, ottenere un link condivisibile, comparire su una ricerca locale, e
mostrare **le proprie foto** invece degli stock del tema. Non sanno (e non devono sapere) cosa sia
uno slug, una policy RLS o un metadato Open Graph: la pubblicazione è **un pulsante**, l'upload è
**"carica foto"**, e la sicurezza è **strutturale**, non una loro responsabilità.

## 3. Obiettivo (cosa significa "fatto")

Un sotto-progetto che, sul documento corrente di un sito: (a) lo **pubblica** — congela uno
**snapshot** validato in `site_publications`, assegna un **`public_slug` globale unico**, `is_published=true`
(publish/unpublish **gratis**); (b) lo **serve al pubblico** a `/s/<slug>` **standalone** nella locale
del sito, lettura **anon via RLS**, gate `parseDocument` + `SiteView` reale, badge "Made with Belora";
(c) lo rende **indicizzabile** — metadata/Open Graph/canonical, **JSON-LD `LocalBusiness`** serializzato
in sicurezza, sitemap + robots; (d) accetta **foto reali** — upload **re-encodato** (magic-bytes +
`sharp`, strip EXIF, rifiuto SVG, resize), reso via `SiteImage` con URL costruito **da noi**.

Il blueprint scompone l'obiettivo in sei macrotask; i `target_tests` dei task ne diventano l'oracolo
del checkpoint. "Fatto" = oracoli verdi al confine di ogni macrotask, **non** una dichiarazione
dell'LLM (`L-COL-002`, `L-COL-006`).

## 4. Non-goals (cosa NON facciamo in P4 v1)

- **Pass hosting dedicato**: Cloudflare R2/Worker (pre-render statico, egress $0), **sottodomini
  wildcard** `nome.belora.app`, **domini custom** (Cloudflare for SaaS) → pass successivo. In v1 si
  serve **dall'app Next.js**, path-based (P4-D1): un routing per-Host costruito ora sarebbe throwaway.
- **Ritocco / rimozione sfondo AI** sulle foto → **P5** (ledger crediti). L'upload di v1 è **niente
  AI**: solo re-encode sicuro (P4-D7).
- **Gating a pagamento** (one-pager free / multi-page paid, **rimozione badge**) → **P5** (billing).
  In v1 tutti free-tier: publish/unpublish **0 crediti**, badge su ogni sito (P4-D5).
- **Blocco galleria** (P2-D24) → più avanti.
- **hreflang con alternate**: i siti v1 sono **mono-locale** → non serve finché non esistono siti
  multi-locale (P4-D8).

## 5. Vincoli

| Tipo | Vincolo |
|---|---|
| Ecosistema | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| Sicurezza — RLS pubblica | RLS **riconquistata** sulle tabelle nuove `site_publications` e `assets` (R1–R9, no `USING (true)`): **`anon = SELECT solo su `is_published=true``**, colonne private (`account_id`, `source_generation_id`) **mai** esposte; scrittura tenant-scoped anche su `storage.objects`; client di **sessione, mai `service_role`** nel browser (`07`, OWASP A01:2025) |
| Sicurezza — documento pubblico | Il documento pubblicato è input **non fidato** reso al pubblico: gate **`parseDocument`** in scrittura (publish) e in render; **escaping React** del `SiteView` (nessun `dangerouslySetInnerHTML`); **nessun `src/href` da testo libero** (URL asset costruiti da `asset_id`, P2-D12); slug ignoto/non pubblicato → `notFound()` (anti-enumerazione P1-D21) |
| Sicurezza — JSON-LD | `LocalBusiness` serializzato con escaping di `< > &` + `U+2028/2029` (anti-breakout dal tag `<script>`, A03:2025 injection): i campi brief sono non fidati |
| Sicurezza — upload | Upload **sempre re-encodato** (raster pulito) o **rifiutato**, **mai** salvato grezzo: sniff magic-bytes + `sharp` (strip EXIF, rifiuto SVG, resize); la difesa è provata **sull'effetto** |
| Renderer | **Unico**: il sito pubblicato passa sempre dal `SiteView` reale; mai una ri-implementazione (P2-D8) |
| Altitudine | Contratto `architecture:` **attivo repo-wide** (P3-D7 + AH-D6): serving in `src/app`, logica pura in `src/domain`, I/O + `sharp` in `src/data`; `tests/architecture-contract.test.ts` gate assoluto |
| Prodotto | Publish/unpublish **gratis (0 crediti)**; badge "Made with Belora" su ogni sito v1 |
| Git | branch a strati; merge su `main` gated dal verde **e** dal deploy-coupling `coupled` (**human-gated anche sul verde**: pubblicare tocca l'hosting pubblico) (`L-COL-024`, `L-COL-025`) |

## 6. Parity gate (promessa forte)

Conformità alla specifica = i `target_tests` dei task del macrotask passano al checkpoint.
Nessuna promessa di "sicuro/pronto": si dichiara la **copertura**, e il verde di una prova
sull'effetto vale **solo** perché il canary sa diventare rosso (T-417 sulla superficie pubblica).

## 7. Baseline & budget

- **Baseline di sicurezza**: da ricatturare a inizio BUILD (P4 introduce **due tabelle nuove** →
  `rls` da riconquistare a runtime; una **rotta pubblica anon**; una **pipeline di upload** →
  effetto da provare). Registrata in `SESSION-STATE` §4.
- **Baseline d'igiene**: ri-attribuire prima di ricatturare (le impronte sono sensibili alla
  POSIZIONE — R-04); nuove dir (`src/app/s`, `src/data` media, `e2e`) ri-fingerprintano impronte
  pre-esistenti. Registrata in `SESSION-STATE` §4.
- **Budget**: limiti di spesa/tempo per ciclo in `SESSION-STATE` §4.

## 8. Fonti di verità

- **Piano**: il blueprint (`00-INDEX` + `01-publish-core` … `06-e2e-public`).
- **Stato vivo**: `SESSION-STATE.md` (fonte di verità del sotto-progetto P4 — distinta dalle altre
  e da quella della skill trueline).
- **Design a monte**: `docs/superpowers/specs/2026-08-06-p4-publish-media-design.md`.
- **Contratto `architecture:`**: `docs/blueprint/P3-editor/00-INDEX.md` §1bis; enforcement
  `tests/architecture-contract.test.ts` (repo-wide).
