# SESSION-STATE — Belora · P1 (Onboarding)

> Fonte di verita sullo **stato vivo** del sotto-progetto P1. Letta da BUILD a ogni
> apertura e aggiornata a ogni chiusura (`prompts/session-end.md`). Distinta dalla
> SESSION-STATE della skill trueline e da quella di P0.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (JS/TS + Supabase) |
| **Ultimo aggiornamento** | 2026-07-24 (BOOTSTRAP P1 — blueprint generato) |
| **Sessione corrente** | bootstrap-P1 — blueprint pronto. **Nessun macrotask ancora costruito.** Prossima sessione: **BUILD** del 1o macrotask (`brief-model`). |

---

## 1. Stato dei macrotask

> Stati: `todo` | `in_progress` | `done`. Ordine = piano di build (00-INDEX §2).

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| brief-model | **todo** | — | T-120..T-123 (la spina dorsale) |
| ai-onboarding | **todo** | — | T-130..T-132 |
| url-import | **todo** | — | T-140..T-141 |
| onboarding-ui | **todo** | — | T-150..T-153 |

**→ Nessun macrotask P1 costruito.** Il blueprint (`00-INDEX` + 4 moduli) e stato generato
in BOOTSTRAP; il self-check strutturale/semantico e la conferma umana precedono il BUILD.

## 2. Macrotask corrente

- **Ultimo chiuso**: nessuno (P1 appena bootstrappato).
- **Prossimo eseguibile**: **`brief-model`** (T-120..T-123) — nessuna dipendenza P1 aperta.
  Selezionare col DAG (00-INDEX §2), costruire sul branch di lavoro, checkpoint al confine.

## 3. Stato git

| Campo | Valore |
|---|---|
| Branch di lavoro | nessuno ancora per P1 (il BUILD del 1o macrotask creera `trueline/build/brief-model`) |
| Ultimo commit | il commit dei doc di blueprint P1 su `main` (BOOTSTRAP non produce codice) |
| Stato merge su `main` | n/a (nessun macrotask P1 costruito) |
| Deploy-coupling | **`main_deploy_coupled: false`** — override umano confermato a livello di progetto il 2026-07-23 (vedi SESSION-STATE di P0 §3). NB: `detect_deploy_coupling.mjs` ri-flagga `main` come coupled sul solo `supabase/config.toml` (dev locale), non un hook di deploy-on-push; nessun `vercel.json`/GH-Actions-on-push/Cloudflare/Netlify presente. L'override registrato governa. **Da riconfermare una volta** all'inizio del BUILD P1 |

## 4. Baseline & budget

- **Baseline di sicurezza**: **vuota** (BOOTSTRAP non esegue oracoli). Verra popolata al 1o
  BUILD: attesi `gitleaks 0 · osv 0 · semgrep 0 · rls 0`, dead-code 0.
- **Attenzione P1 (nuove superfici vs P0):** (a) segreto `ANTHROPIC_API_KEY` — gitleaks
  deve restare a 0; (b) **SSRF** dell'import — coperto da T-140 e dal ruleset semgrep/authz;
  (c) output del modello e HTML importato = input non fidato, validati (T-121).
- **Budget**: definito per-ciclo in BUILD. Il metodo di esecuzione e il **dynamic workflow
  multi-agente** (builder / verifier diversi / fixer diversi), oracolo unico giudice.

## 5. Note operative (checkpoint & AI)

- **Test AI deterministici**: il confine LLM `src/data/anthropic.ts` (T-131) e **mockato**
  nei test (turni/tool-call preconfezionati), come in P0 si mocka `createServerSupabaseClient`.
  La qualita dell'intervista NON entra nel checkpoint (eval offline opzionale, `*.eval.ts`
  escluso dalla suite).
- **RLS a runtime**: `site_briefs` (T-120) e le server action briefs (T-123) provano
  l'isolamento cross-tenant attraverso il client con auth reale su Supabase locale (mai
  nell'SQL editor, che gira come superuser → falso verde). Riuso del pattern P0 (T-063/T-101).
- **SSRF (T-140)**: testare il blocco IP privati/riservati (127/8, 10/8, 192.168/16,
  169.254.169.254, ::1) e il re-check sui redirect con DNS/network mockati.
- **Checkpoint con test runtime Supabase**: riusare lo schema P0 (`scratchpad/run-checkpoint-*.sh`):
  `set -a; . .env.local; set +a`, spostare `.env.local` FUORI dal repo (gitleaks pulito) +
  `rm -rf .next`, `db reset` prima del run (rate-limit auth azzerato), `--mode build`
  SENZA `--blueprint` (il manifest supabase-jsts usa `node --test`, incompatibile con
  vitest+jsdom → falso rosso).

## 6. Prossimi passi & decisioni aperte

1. **Self-check del blueprint**: strutturale (`validate_blueprint.mjs`, exit 0) + semantico
   (checklist 6–10) → human-in-the-loop → chiusura del blueprint.
2. **BUILD del 1o macrotask** `brief-model` (T-120..T-123): schema `site_briefs` + RLS →
   dominio brief (zod, merge/complete) → server action con RLS a runtime.
3. **DECISIONE APERTA `P1-D11`**: contratto di altitudine (`architecture:`) ancora rinviato
   — attivare `arch_check` solo dopo audit del grafo import reale (evitare rossi su
   violazioni pre-esistenti). Ereditata da P0.
4. **DA RICONFERMARE**: deploy-coupling di `main` all'inizio del BUILD (override false).
5. **Metodo attivo**: dynamic workflow multi-agente (orchestratore costruisce test-first +
   verifica avversariale multi-lente con refutazione), **oracolo unico giudice** (checkpoint 4/4).
