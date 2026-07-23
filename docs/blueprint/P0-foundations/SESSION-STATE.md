# SESSION-STATE — Belora · P0 (Fondamenta)

> Fonte di verità sullo **stato vivo** del sotto-progetto P0. Letta da BUILD a ogni
> apertura e aggiornata a ogni chiusura (`prompts/session-end.md`). Distinta dalla
> SESSION-STATE della skill trueline.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (JS/TS + Supabase) |
| **Ultimo aggiornamento** | 2026-07-23 (chiusura sessione build-P0-design-system) |
| **Sessione corrente** | build-P0-design-system — **CHIUSA** (riprendere con `prompts/session-start.md`) |

---

## 1. Stato dei macrotask

> Stati: `todo` | `in_progress` | `done`. Ordine = piano di build (00-INDEX §2).

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| infra | **done** | **VERDE 4/4** | T-001..T-006; merged su `main` |
| design-system | **done** | **VERDE 4/4** | T-020..T-022; commit `7fd35fd`, ff-merge su `main` |
| i18n | todo | — | Dipende da infra ✅, design-system ✅ (tema) → **prossimo eseguibile** |
| auth | todo | — | Dipende da infra ✅, i18n, design-system ✅ |
| tenancy | todo | — | Dipende da infra ✅, auth |
| sites | todo | — | Dipende da tenancy, design-system ✅, i18n, auth |

## 2. Macrotask corrente

- **Ultimo chiuso**: `design-system` (checkpoint verde 4/4). **Prossimo eseguibile**: **`i18n`** (dipendenze infra + design-system verdi).
- **Criteri/test di riferimento**: `03-i18n.md` e i `target_tests` dei task T-080..T-083 (T-080 setup next-intl + routing per locale → T-081 cataloghi IT/ES + parità chiavi → T-082 selettore lingua + cookie → T-083 persistenza su `profiles.locale`, che dipende anche da auth/tenancy).

## 3. Stato git

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/design-system` (pushato; mergeto su main; non cancellato) |
| Ultimo commit | `7fd35fd` su `main` (HEAD) — working tree PULITO, `origin/main` allineato |
| Stato merge su `main` | **MERGED** (fast-forward `56b31bf..7fd35fd`, pushato) — checkpoint verde + non deploy-coupled |
| Deploy-coupling | `main_deploy_coupled: **false**` — confermato dall'utente 2026-07-23 → **merge su main autonomi** su checkpoint verde |

## 4. Baseline & budget

- **Baseline di sicurezza**: checkpoint `design-system` verde con baseline vuota (0 finding nuovi ≥ HIGH). Controllo 2: `gitleaks 0 · osv 0 · semgrep 0 · rls 0`.
- **Budget consumato**: build via dynamic workflow multi-agente (6 agenti: 3 builder + 3 verifier), ~533k token subagente.

## 5. Esiti dell'ultima sessione (framing onesto)

- Macrotask `design-system` costruito **test-first** via **dynamic workflow multi-agente** (builder T-020/T-021/T-022 sequenziali sul DAG → verifier avversariali diversi in parallelo → orchestratore esegue l'oracolo).
- **Checkpoint trueline VERDE 4/4** (l'oracolo decide): dead-code [knip 0 · twin 0] · sicurezza [gitleaks 0 · osv 0 · semgrep 0 · rls 0] · regressioni [suite vitest verde] · conformità [test d'accettazione verdi].
- **Provenienza AC** verificata a parte con l'oracolo `ac_assertion_trace_check` → `ok:true, untracked:[]` (ogni AC di infra+design-system tracciato da un tag `// covers:` al path esatto). I 4 file target girano 16/16 sotto vitest.
- Stack risolto: **Tailwind v3** (il DoD richiede direttive `@tailwind base/components/utilities` + `tailwind.config.ts` con `theme.extend`), token semantici via `var(--color-*)` (hex solo in `globals.css`, set `:root`/`[data-theme=dark]`), primitive shadcn-style hand-authored (Button/Input/Label/Card) con `cn`(clsx+tailwind-merge)+`cva`, AppShell presentazionale con landmark/skip-link/`aria-current`.
- Rilievi verifier residui (non bloccanti, non fix richiesta): (a) `AC-021-3` è un AC debole ("className differisce") ma il test è fedele all'AC; (b) `AppShell` passa `item.href` a `next/link` senza sanificare schemi `javascript:` — sorgente = config nav trusted (non input utente), difesa-in-profondità **rinviata** (non AC-required, non gate).

## 6. Note operative (checkpoint & runner)

- **Invocazione checkpoint (IMPORTANTE)**: eseguire **senza `--blueprint`** (ramo legacy = suite vitest), come per `infra`.
  `node "<skill>/scripts/checkpoint/run_checkpoint.mjs" "<repo>" --in-place --mode build`.
  **Perché**: il manifest ecosistema `supabase-jsts` ha `test_runner.run_file = "node --test {file}"`; il ramo AC-acceptance del controllo 4 (`--blueprint`) esegue i target_test con `node --test`, **incompatibile** coi test vitest+jsdom+alias `@/` mandati dal blueprint (P0 usa `@testing-library/react`) → tutti i file risulterebbero "vacuo" → rosso falso. Il gate reale del controllo 4 è quindi la **suite vitest** (runner del progetto), con la provenienza dei tag `// covers:` verificata separatamente via `ac_assertion_trace_check`. **Raccomandazione upstream** (fuori scope Belora): allineare `run_file` a vitest + adeguare il parser di `run_file.mjs` (che oggi parsa solo il formato `node --test`).
- **Prima del checkpoint sicurezza**: rimuovere `.next/` da disco (gitleaks bundled scansiona anche i gitignorati); `.env.local` assente → i test Supabase si **skippano** in modo dichiarato (design-system non tocca il DB). Env Supabase via shell se serve farli girare.
- **Supabase locale**: porte `546xx` (config.toml). Avvio: `supabase start`; parametri: `supabase status -o env`.
- **Convenzioni test** (da imitare): file al path esatto del blueprint con estensione `.test.ts`; per il DOM docblock `// @vitest-environment jsdom` in prima riga + `React.createElement` (niente JSX in `.test.ts`); ogni AC con tag `// covers: <AC-id>` in commento.

## 7. Prossimi passi

1. **Sessione CHIUSA.** Riprendere con `prompts/session-start.md`.
2. Prossimo macrotask BUILD: **`i18n`** — branch `trueline/build/i18n`; T-080 (setup next-intl + routing `/it` `/es`) → T-081 (cataloghi IT/ES + parità chiavi) → T-082 (selettore lingua + cookie). T-083 (persistenza `profiles.locale`) dipende anche da auth/tenancy → verrà dopo o in coda.
3. **Metodo di esecuzione attivo**: dynamic workflow multi-agente (builder → verifier diversi → fixer diversi + orchestratore), con l'**oracolo unico giudice** — vedi `prompts/session-start.md` §6.
4. Merge su `main` **autonomo** su checkpoint verde (coupling confermato false).
