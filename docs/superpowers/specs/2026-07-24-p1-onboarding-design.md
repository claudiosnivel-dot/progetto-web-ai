# P1 — Onboarding (intervista → Business Brief) · Documento di Design

> **Progetto:** Belora · **Sotto-progetto:** P1 (2° dei 10) · **Data:** 2026-07-24 · **Stato:** design approvato in brainstorming; pronto per **trueline BOOTSTRAP** (generazione blueprint di task atomici).
> **A monte:** `docs/superpowers/specs/2026-07-22-ai-website-builder-design.md` (visione) · `docs/blueprint/P0-foundations/` (fondamenta costruite).
> **Deliverable di questa sessione:** SOLO questo documento (nessun codice). Il blueprint tecnico verrà generato in una sessione successiva via trueline.

---

## 1. Visione di P1 in una frase

**Trasformare un'attività locale in un _Business Brief_ strutturato e confermato — tramite un'intervista AI conversazionale con pannello live — così che P2 possa generarne i 5 mockup.**

**Confini:**
- **P0 (fatto)** fornisce: auth, tenancy (`accounts`/`account_members`/`profiles`, `UNIQUE(owner_id)`), i18n IT/ES, design system, entità `sites` account-scoped con RLS, dashboard scheletro.
- **P1 (questo)** consegna: l'**onboarding** che riempie un **Business Brief 1:1 con un sito**, e lo porta a `status='confirmed'`.
- **P2 (dopo)** consuma il brief confermato per generare i 5 mockup. *P1 da solo non produce un sito visibile: produce il brief.*

---

## 2. Scope di P1 v1 — decisioni chiuse in brainstorming

P1 come da visione = «wizard + chat + auto-import GBP/IG/sito» si scompone in 6 pezzi indipendenti: **(a)** Business Brief (modello dati), **(b)** wizard, **(c)** chat AI, **(d)** import da sito, **(e)** import Google Business Profile, **(f)** import Instagram.

| # | Decisione | Scelta | Motivazione |
|---|---|---|---|
| D1 | **Scope v1** | **Interview core = a + b + c + d** | Costruibile subito, zero approvazioni esterne; produce il brief che alimenta il "wow" di P2. `e`/`f` → **P1.x** (attriti d'approvazione). Coerente con roadmap §14 (maturità auto-import GBP/IG in V1.x). |
| D2 | **Forma del flusso** | **Chat-led + pannello brief live** (opzione A) | Un solo flusso da costruire, massimo "wow", insegna la struttura tenendola visibile. Il wizard (b) è realizzato *come pannello editabile*, non come modalità separata. |
| D3 | **Struttura del Brief** | **Core tipizzato + lista "offerta" flessibile + tag verticale** | YAGNI: una lista offerta unica copre menù/servizi/catalogo/portfolio; P2 non esiste ancora, quindi non si sovra-modella. |
| D4 | **Modello LLM** | **Haiku 4.5** default, configurabile via `ANTHROPIC_MODEL_ONBOARDING` | Il più veloce/economico ($1/$5 per 1M); regge un'intervista strutturata con tool-use tipato. Si sale a Sonnet 5 con una env se serve più calore. |
| D5 | **Import-URL** | Porta d'ingresso opzionale che **pre-riempie** il pannello (non una modalità separata) | Nell'opzione A l'import è un accendino del brief, poi la chat continua. |

---

## 3. Non-goals di P1 v1 (rinviato — esplicito)

- **Import Google Business Profile** → **P1.x** (richiede richiesta+approvazione accesso API GBP; il fondatore avvia le verifiche in parallelo).
- **Import Instagram** → **P1.x** (Meta app review + business verification — l'attrito più alto).
- **Generazione dei 5 mockup** → **P2**.
- **Pipeline media/hosting** dei file (Cloudflare R2/Workers) → **P4**. In v1 il brief salva solo **riferimenti/URL** di foto.
- **Teaser pubblico anonimo** (modello economico, email-gated) → **P6** (P1 è interamente post-login).
- **Editor inline** del sito → **P3**.
- **Eval di qualità** dell'intervista → harness offline opzionale, **fuori dal checkpoint**.

---

## 4. Flusso utente (opzione A)

```
Dashboard (P0)
  └─ crea sito nuovo (riuso createSite)  ── oppure ──  «Continua onboarding» su sito con brief draft
       └─ /[locale]/onboarding/[siteId]  (protetta)
            ┌─ barra Import-URL (opzionale) → pre-riempie il pannello
            ├─ CHAT AI (streaming, nel locale utente)   │   PANNELLO BRIEF (stato live, editabile a mano)
            │   • intervista conversazionale             │   • i campi si riempiono via tool `update_brief`
            │   • tool `update_brief` per scrivere campi │   • l'utente può correggere ogni campo
            └─ a brief completo (o su scelta) →
                 «Rivedi & conferma» (recap editabile) → conferma → status='confirmed'
                      └─ ritorno dashboard: sito con brief completo («pronto per generare» = P2)
```

Il **brief `confirmed`** è l'artefatto-contratto che P2 consuma.

---

## 5. Architettura & moduli

Seguono le convenzioni di P0 (`src/ui · src/domain · src/data`, rotte sotto `src/app/[locale]/**`, client Supabase a tre livelli).

| Layer | File/cartella | Ruolo | Testabile |
|---|---|---|---|
| **data** | `src/data/anthropic.ts` | **Confine unico con l'LLM**, server-only (chiave da env), ESLint-guarded come `supabase-admin.ts`. È il seam che i test **mockano**. | (seam da mockare) |
| **config** | `src/config/env.ts` (esteso) | Aggiunge `ANTHROPIC_API_KEY` (server) + `ANTHROPIC_MODEL_ONBOARDING` allo schema env. Nessun segreto nel sorgente. | sì |
| **domain** | `src/domain/onboarding/brief.ts` | Schema Brief (zod) + `applyBriefUpdate()` (fusione aggiornamento→brief) + `isBriefComplete()`. Puro, deterministico. | sì (cuore) |
| **domain** | `src/domain/onboarding/interview.ts` | Orchestrazione: costruisce il prompt localizzato, dichiara il tool `update_brief` (`strict`), interpreta le tool-call. Chiama `anthropic.ts`. | sì (LLM mockato) |
| **domain** | `src/domain/import/fromUrl.ts` | Fetch **SSRF-safe** + estrazione (JSON-LD/OG → brief). | sì |
| **data** | `src/data/briefs.ts` | Persistenza Supabase (client SSR/RLS, mai service_role): `getBrief`/`upsertBrief`/`confirmBrief`, account-scoped. | sì (RLS runtime) |
| **ui** | `src/ui/onboarding/*` | `ChatPanel`, `BriefPanel` (stato live), `ReviewConfirm`, `UrlImportBar`. | sì |
| **app** | `src/app/[locale]/onboarding/*` | Rotta protetta + route handler/server action per il turno di chat (streaming). | sì |

**Relazione entità:** un **Brief appartiene 1:1 a un `site`** — nuova tabella `site_briefs` (`site_id UNIQUE`, `account_id` per la tenancy), RLS ancorata a `is_account_member(account_id)` (**stesso pattern di `sites`/T-100**, quindi auditabile staticamente dall'oracolo). Il sito è creato prima (riuso `createSite`), l'onboarding lo popola.

---

## 6. Il Business Brief (modello dati)

| Parte | Campi |
|---|---|
| **Core (colonne tipizzate)** | `business_name`, `vertical` (enum: `ristorazione`\|`fitness`\|`salone_studio`\|`negozio_artigiano`\|`altro`), `description`, `address`, `geo?`, `hours` (strutturati), `phone`, `whatsapp`, `email`, `primary_goal` (`prenota`\|`ordina`\|`contatta`), `locale` (it\|es) |
| **JSONB `content`** | `offerings[]` (voce: `name`, `description`, `price?`, `photo_ref?`, `section?`), `social_links`, `highlights` (USP), `brand_hints` (tono/colori suggeriti) |
| **Meta** | `status` (`draft`\|`confirmed`), `created_at`, `updated_at` |

**Storage & RLS:** tabella `site_briefs`, account-scoped. 4 policy (SELECT/INSERT/UPDATE/DELETE) `TO authenticated` ancorate a `is_account_member(account_id)`; `UNIQUE(site_id)`; `account_id` presente nel testo di ogni policy (evita RLS004 per costruzione); GRANT espliciti; vincoli provati a runtime. **Confine media:** i campi foto sono **riferimenti/URL**, nessun file ospitato in v1 (hosting = P4).

---

## 7. La chat AI

**Meccanismo (tool-use tipato).** A ogni turno il modello (1) **parla** in testo (intervista) e (2) chiama il tool **`update_brief`** con campi tipati. `strict: true` sul tool (`additionalProperties:false` + `required`) garantisce input conforme. L'harness applica l'input con `applyBriefUpdate()` (deterministico) → il **BriefPanel** si aggiorna live. Un tool `mark_ready_for_review` (o `isBriefComplete()`) segnala la transizione a «Rivedi & conferma».

**Streaming.** Il testo assistente è streammato al ChatPanel (route handler Next.js); le tool-call `update_brief` si applicano man mano → pannello live.

**Modello.** Default **Haiku 4.5** (`claude-haiku-4-5`), via `ANTHROPIC_MODEL_ONBOARDING`. Nota: Haiku 4.5 non usa thinking adattivo/effort — non serve per estrazione strutturata. Salire a `claude-sonnet-5` è un cambio di env.

**i18n.** System prompt e intervista nel **locale** dell'utente (it/es, già risolto in P0); contenuto del brief memorizzato in quella lingua. Un sito = una lingua in v1.

**Costo & abuso.** Post-login only → superficie ridotta. Guardrail: tetto ai **turni** per sessione di onboarding, `max_tokens` per chiamata, rate-limit per-account, budget token per onboarding limitato.

**Sicurezza (per l'oracolo).** `ANTHROPIC_API_KEY` **server-only** (env, mai client, mai sorgente → gitleaks pulito). La server action della chat richiede **sessione autenticata** (401 altrimenti), è **account-scoped**. L'output del modello è **input non fidato**: l'input di `update_brief` è **ri-validato server-side** prima di toccare il DB (niente PostgREST filter injection; scritture via client RLS con campi validati).

---

## 8. Import-da-URL

**Fetch server-side SSRF-safe** (scarichiamo URL arbitrari forniti dall'utente — sicurezza critica). Guardrail obbligatori:
- solo schemi `http`/`https`;
- **risoluzione DNS + blocco IP privati/riservati**: `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, **`169.254.169.254` (metadata cloud)**, `::1`, `fc00::/7`, ecc. — **ri-controllati a ogni hop di redirect**;
- timeout, **dimensione massima** risposta, numero massimo di redirect;
- solo `text/html`; User-Agent corretto (nota ToS §12 visione).

**Estrazione deterministica-prima, AI-poi:**
1. parsing **JSON-LD / schema.org `LocalBusiness`** (nome, indirizzo, orari, telefono, geo, priceRange), **Open Graph**, meta description, `<title>`, heading;
2. *opzionale*: testo ripulito → LLM (Haiku, **structured-outputs** `output_config.format` con schema Brief) per strutturare il non-strutturato — una chiamata non-streaming, **stesso confine mockabile**;
3. output = **brief proposto** → l'utente rivede (mai auto-commit).

---

## 9. Testabilità sotto trueline (ORACLE-AS-JUDGE)

L'unica cosa non-deterministica è la chiamata al modello, **isolata in `src/data/anthropic.ts`**. I test **mockano quel modulo** (come in P0 si mocka `createServerSupabaseClient`), iniettando turni/tool-call preconfezionati. Gli oracoli restano deterministici.

**Verificato dai `target_tests`:**
- `applyBriefUpdate()` — fusione input-tool → brief (inclusa lista offerta);
- schema Brief (zod) — allowlist categorie/verticali, rifiuto dati spazzatura;
- `isBriefComplete()` — euristica di completamento;
- **orchestrazione**: turno-modello mockato (testo + tool-call `update_brief`) → asserisce aggiornamento brief e chiamata al client con modello/tool/`strict`/system-prompt localizzato corretti;
- `briefs.ts` — **isolamento RLS provato a runtime** con auth reale (come T-063/T-101);
- `fromUrl.ts` — **guardia SSRF** (IP privati bloccati) + estrazione deterministica (HTML preconfezionato → campi) testate; strutturazione AI mockata.

**Fuori dal checkpoint:** la *qualità* dell'intervista (non-deterministica). Al massimo un harness di **eval offline** (`*.eval.ts`), **escluso** dalla suite del checkpoint, così non genera falsi rossi. L'LLM non è mai giudice.

---

## 10. Definition of Done di P1 (checkpoint 4/4)

- `site_briefs`: schema + **RLS** (4 policy `TO authenticated` su `is_account_member(account_id)`, `UNIQUE(site_id)`, `account_id` nel testo policy), vincoli provati a runtime;
- `briefs.ts`: server action `get/upsert/confirm` via client RLS, account-scoped, **isolamento RLS provato a runtime**;
- `brief.ts`: schema zod + `applyBriefUpdate` + `isBriefComplete` — unit test;
- `anthropic.ts` + `interview.ts`: testati con **modello mockato** (params, wiring tool, fusione brief);
- `fromUrl.ts`: **guardia SSRF** + estrazione deterministica testate; strutturazione AI mockata;
- UI onboarding (chat + pannello live + barra URL) + «Rivedi & conferma»: protette (redirect login), **localizzate it/es**; chat in **streaming**;
- trasversale: typecheck/lint/knip puliti, `next build` verde, provenienza AC tracciata (`ac_assertion_trace_check`), checkpoint deterministico 4/4 (dead-code · sicurezza · regressioni · conformità-logica).

---

## 11. Decisioni di ledger da portare al bootstrap

Oltre alle decisioni D1–D5 (§2), il bootstrap fisserà:
- **Confine LLM** = `src/data/anthropic.ts` server-only, unico punto di chiamata, mockabile; ESLint no-restricted-imports contro import accidentale lato client.
- **Modello estrazione** = tool-use `strict` per la chat (`update_brief`) + structured-outputs per l'import.
- **Brief 1:1 con Site** via `site_briefs.site_id UNIQUE`; RLS clonata da `sites`.
- **Media = solo riferimenti** in v1 (hosting rinviato a P4).
- **SSRF** come requisito di sicurezza di prima classe (parte del controllo 2 dell'oracolo).
- **Segreto Anthropic** = env server-only; baseline gitleaks deve restare a 0.

---

## 12. DAG previsto dei task atomici

```
site_briefs (schema + RLS)            ← la spina dorsale
   ├─ brief.ts (schema / merge / complete)
   ├─ briefs.ts (server actions + RLS runtime)
   ├─ anthropic.ts (confine LLM)  →  interview.ts (orchestrazione, LLM mockato)
   └─ fromUrl.ts (SSRF + estrazione)
                    └─ UI onboarding (chat + pannello live + import)
                            └─ Rivedi & conferma  →  streaming / wiring end-to-end
```

Il blueprint P1 avrà lo stesso formato di P0 (`00-INDEX`: mappa → DAG → decision ledger → manifest `T-xxx` con `definition_of_done` / `acceptance_criteria` / `target_tests`).

---

## 13. Rischi & punti aperti

- **Approvazioni API GBP/Instagram (P1.x):** verificare limiti/termini d'uso e tempi di app review in fase di blueprint P1.x; il fondatore avvia le verifiche business Meta/Google **in parallelo** allo sviluppo di v1.
- **ToS di scraping (import-URL):** rispettare robots/ToS del sito importato; User-Agent identificabile; l'import è best-effort e sempre revisionato dall'utente.
- **Calibrazione costo onboarding:** misurare il costo reale per onboarding su Haiku 4.5 e decidere se/quando salire di modello (manopola env).
- **Qualità dell'intervista:** non gated dall'oracolo; validare con eval offline e feedback reale.

---

## 14. Prossimo passo

**trueline BOOTSTRAP** su questo documento → genera il blueprint P1 (`docs/blueprint/P1-onboarding/` con `00-INDEX`, `VISION-AND-CONSTRAINTS`, moduli, `SESSION-STATE`) e i task atomici verificabili. Poi si costruisce **un macrotask alla volta** con il dynamic workflow multi-agente (builder / verifier diversi / fixer diversi), oracolo unico giudice.
