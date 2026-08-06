# SESSION-STATE — Belora · P3 (Editor inline)

> Fonte di verità sullo **stato vivo** del sotto-progetto P3, consumata da BUILD e
> aggiornata a ogni chiusura di sessione (`prompts/session-end.md`). Istanza distinta
> dalle SESSION-STATE di P0/P1/P2 e da quella della skill trueline. Prosa in italiano,
> identificatori/nomi-file in inglese.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Ultimo aggiornamento** | 2026-08-06 (BUILD `editor-blocks` CHIUSO; checkpoint VERDE 4/4 + e2e Chromium 7/7; mergiato su `main` `11a6c13`) → **P3 COMPLETO** |
| **Sessione corrente** | — (P3 chiuso: editor-core + architecture-hardening + editor-blocks tutti verdi e mergiati su `main`; prossimo sotto-progetto: **P4 pubblicazione**, richiede bootstrap trueline) |

---

## 1. Stato dei macrotask

> Aggiornato a ogni `session-end`. Stati: `todo` | `in_progress` | `done`.

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| `editor-core` | done | **VERDE 4/4** | Commit `7844d8e`, mergiato su `main`. 13 task; batteria mutazione 4/4; suite 1214/1214 |
| `editor-blocks` | **done** | **VERDE 4/4 + e2e 7/7** | Commit `11a6c13`, mergiato ff su `main` (`67ea444→11a6c13`). 5 task (T-313…T-317, 1 workflow/task builder+verifier BLIND); mutazione per-task (sha256); suite 1266/1266; e2e Chromium `editor-hostile` + canary rosso. hygiene R-04 ri-baselinata 103→107 |

## 2. Macrotask corrente

- **P3 COMPLETO**: entrambi i macrotask del blueprint (`editor-core` `7844d8e`, `editor-blocks` `11a6c13`)
  costruiti, checkpoint VERDE 4/4, mergiati su `main`. Più il pass dedicato `architecture-hardening`
  (`7dd614f`, gate `architecture:` reso repo-wide). Nessun macrotask P3 aperto.
- **`editor-blocks`**: **DONE** — 5 task (T-313 renderDraftPage nel layer app · T-314 aggiungi blocco
  model-free · T-315 riordina · T-316 sostituisci · T-317 e2e ostile su editor). Checkpoint VERDE 4/4
  (suite 1266/1266) + e2e Chromium 7/7 (editor-hostile + canary che rende ROSSO lo stesso oracolo).
- **Follow-up potenziali non bloccanti** (polish, fuori dagli AC): T-319 (chrome cablato in `/editor`,
  deciso in editor-core); label i18n al posto degli id grezzi nei controlli-lista riordina/sostituisci;
  swap in loco dell'anteprima strutturale via `renderDraftPage` (oggi riflessa solo a save+refresh).

## 3. Stato git

> Registrato a ogni `session-end`. Mai lavorare su `main`.

| Campo | Valore |
|---|---|
| Branch di lavoro | `trueline/build/editor-core` (pushato). `main` = `7844d8e` (editor-core mergiato) |
| Ultimo commit | `7844d8e` — feat(P3): editor-core (53 file, +7148/−242), su `main` e pushato |
| Stato merge su `main` | **MERGIATO** (ff `964d821→7844d8e`, pushato) su via ESPLICITO dell'utente (deploy-coupled) |
| Deploy-coupling | **`coupled` — CONFERMATO dall'utente**. Il merge di ogni macrotask P3 resta **human-gated anche sul verde** (mergiare può innescare il deploy della dashboard) |

## 4. Baseline & budget

- **Baseline di sicurezza**: **ricatturata** (`.trueline/baseline.json`, gitignored) = 1 finding
  (osv MODERATE carry-over). `rls` **riconquistata** (checkpoint `rls:0`), scan anti-XSS **esteso**
  a `src/ui/editor`. **Baseline d'igiene ri-attribuita** (R-04): `.trueline/hygiene-baseline.json`
  (versionata) = **97 findings** (20 dup LOW nuove strutturali/documentate baselinate).
  Gotcha: `baseline.mjs capture <dir> --hygiene` scrive nel default `baseline.json` — serve
  `--out <hygiene path>`.
- **Budget consumato**: 1 macrotask (`editor-core`), checkpoint VERDE 4/4.

## 5. Esiti dell'ultima sessione (framing onesto)

> Solo fatti: "generato e validato il blueprint", mai "P3 è pronto/sicuro" (`L-COL-006`).

- Blueprint P3 **generato e committato** (`e6394b3`): `00-INDEX`, `01-editor-core` (13 task),
  `02-editor-blocks` (5 task), `VISION`, questa `SESSION-STATE`, i 3 prompt di lifecycle.
- **Oracolo strutturale** `validate_blueprint.mjs`: **exit 0, 18 task, 7/7 controlli OK**
  (campi obbligatori, copertura AC→test, DAG aciclico, id univoci, ownership, contratto
  `architecture:` ben formato).
- **Self-check semantico** (punti 6–10): punti 6/7/9/10 OK; 1 rilievo di copertura chiuso su
  conferma utente → **T-318** (ripristino da storia, append-only). Nessun codice prodotto.

## 6. Copertura dichiarata (cosa è verificato, cosa NO)

> In BOOTSTRAP l'unico oracolo è `validate_blueprint` (strutturale). Il resto è **piano**,
> non ancora provato: si chiude solo in BUILD con gli oracoli del checkpoint.

- **Verificato ora**: forma strutturale del blueprint (campi obbligatori, copertura
  AC→test, DAG aciclico, id univoci, ownership del macrotask, contratto `architecture:`
  ben formato).
- **NON ancora coperto** (attende BUILD): RLS runtime sulla tabella nuova; il gate
  `parseDocument` sul percorso reale di scrittura; l'assenza di effetto dell'iniezione
  sulla rotta editor (Chromium + canary); la falsificabilità dello scan statico esteso;
  `arch_check` contro il grafo import reale. Nessuno di questi è un verde finché un oracolo
  non lo produce.

## 7. Carry-over ereditati (da P0/P1/P2, rilevanti per P3)

**Aperti:**
- `osv`: 2 advisory **MODERATE** (`next`, `postcss`) — carry-over separato, non introdotto
  da P3.
- **CI mai provata da una run reale** (`gh` non installato); `test:e2e` esiste ma non è
  cablato in `ci.yml`.
- e2e solo **Chromium** (non Firefox/WebKit); non percorre login/onboarding (cookie
  iniettati, seed via service_role nei test).
- Assenza di **CSP** dichiarata: la difesa provata è la **sanificazione**, non una CSP.
- `readyForReview` verifica presenza non provenienza; history chat non persistita;
  `upsertBrief` non riporta i campi scartati; T-122 fonde le offerte per nome.

**Chiusi (da onorare, non riaprire):**
- Disciplina del **testo non fidato** provata sull'effetto in P2 (T-241): da **preservare
  ed estendere** (T-306, T-317).
- Separazione layer temi (P2-D14) imposta da `no-restricted-imports`: la UI editor eredita
  il divieto di importare `src/ui/theme/tokens`.
- CAS TOCTOU-safe della riscelta (P2-D23): da preservare in T-310.

## 8. Prossimi passi

1. **P3 COMPLETO** (§1/§2/§3): `editor-core`, `architecture-hardening` ed `editor-blocks` tutti verdi e
   mergiati su `main`. hygiene-baseline ri-attribuita 103→107 (§4).
2. **Prossimo sotto-progetto: P4 (pubblicazione/hosting)** — non ancora bootstrappato: richiede
   design→blueprint via skill trueline (come P0..P3). Nessun macrotask P3 residuo (solo follow-up di
   polish opzionali, §2).
3. **Deploy-coupling = `coupled` CONFERMATO** (§3): il merge di ogni macrotask resta human-gated.
4. Disciplina invariata: 1 workflow build (builder + verifier BLIND per task) → 1 fermata umana →
   1 workflow fixer; checkpoint `run_checkpoint.mjs --in-place --mode build --baseline <sicurezza>`
   **SENZA `--blueprint`**, verdetto dal JSON `.green`; batteria di mutazione con sanità fatale +
   ripristino per sha256; `db reset` azzera il rate-limit auth.
