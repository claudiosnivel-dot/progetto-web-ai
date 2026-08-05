# SESSION-STATE — Belora · P3 (Editor inline)

> Fonte di verità sullo **stato vivo** del sotto-progetto P3, consumata da BUILD e
> aggiornata a ogni chiusura di sessione (`prompts/session-end.md`). Istanza distinta
> dalle SESSION-STATE di P0/P1/P2 e da quella della skill trueline. Prosa in italiano,
> identificatori/nomi-file in inglese.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Ultimo aggiornamento** | 2026-08-05 (BUILD `editor-core` CHIUSO; checkpoint VERDE 4/4; mergiato su `main` `7844d8e`) |
| **Sessione corrente** | — (editor-core costruito, verde e mergiato; prossime: **`architecture-hardening`** poi **`editor-blocks`**) |

---

## 1. Stato dei macrotask

> Aggiornato a ogni `session-end`. Stati: `todo` | `in_progress` | `done`.

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| `editor-core` | done | **VERDE 4/4** | Commit `7844d8e`, mergiato su `main`. 13 task; batteria mutazione 4/4; suite 1214/1214 |
| `editor-blocks` | todo | — | 5 task (T-313…T-317). Dipendenze ora VERDI (usa renderer editabile, persistenza, rotta di editor-core) |

## 2. Macrotask corrente

- **`editor-core`**: **DONE** — costruito, checkpoint VERDE 4/4, mergiato su `main` (`7844d8e`).
- **Prossimo (dispatch trueline → BUILD)**, due macrotask eseguibili:
  1. **`architecture-hardening`** (dalla decisione D1/split): i **7 `domain→data`** (auth/onboarding/
     generation, già in `main`) via dependency-inversion + gate `architecture:` reso **alias-aware
     repo-wide**. Il gate T-312 di editor-core è oggi alias-aware ma **scoped alla superficie P3**;
     questo pass lo estende a tutto il repo e bonifica gli archi legacy. NON è ancora un modulo del
     blueprint P3 → va bootstrappato/eseguito come pass dedicato (branch/checkpoint propri).
  2. **`editor-blocks`** (T-313…T-317): l'altro modulo P3, dipendenze ora verdi. Modulo `02-editor-blocks.md`.
- **Criteri/test di riferimento**: i `target_tests` dei task sono l'oracolo del controllo 4 in BUILD.

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

1. **`editor-core` chiuso e mergiato** (§1/§3). Baseline ri-attribuite (§4).
2. **Prossimo macrotask** (§2): `architecture-hardening` (7 domain→data DI + gate arch alias-aware
   repo-wide) e/o `editor-blocks` (T-313…T-317). Aprire con `prompts/session-start.md`.
3. **Deploy-coupling = `coupled` CONFERMATO** (§3): il merge di ogni macrotask resta human-gated.
4. Disciplina invariata: 1 workflow build (builder + verifier BLIND per task) → 1 fermata umana →
   1 workflow fixer; checkpoint `run_checkpoint.mjs --in-place --mode build --baseline <sicurezza>`
   **SENZA `--blueprint`**, verdetto dal JSON `.green`; batteria di mutazione con sanità fatale +
   ripristino per sha256; `db reset` azzera il rate-limit auth.
