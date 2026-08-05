# KICKOFF — Belora · `architecture-hardening` (gate di altitudine reale, repo-wide)

> **Handoff di PRE-BOOTSTRAP.** Macrotask trasversale deciso nella sessione BUILD di **P3
> `editor-core`** (decisione **D1**, opzione "fixa tutte le 8", con **split**: le fix locali sono
> entrate in editor-core, il grosso resta qui). NON è ancora bootstrappato: nessun `00-INDEX`,
> nessun modulo, nessun task atomico. È il punto d'ingresso pulito per la **prossima sessione**.

| | |
|---|---|
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Poggia su** | P0/P1/P2 + P3 `editor-core` — tutti verdi su `main` (`7844d8e`) |
| **Stato** | **DA BOOTSTRAPPARE / COSTRUIRE.** Refactor di codice già in `main` (P0/P1/P2) + attivazione del gate `architecture:` repo-wide. |
| **Deploy-coupling** | `coupled` (CONFERMATO): merge su `main` **human-gated anche sul verde**. |

---

## 1. Perché esiste (il difetto misurato in `editor-core`)

Il gate `architecture:` (P3-D7 / ex P1-D11) è stato **attivato** in P3, ma il verifier BLIND di
**T-312** ha misurato che l'oracolo reale `arch_check.mjs` gira **`madge` SENZA `--ts-config`**:
non risolve gli import alias **`@/`** (usati per **318/318** import cross-module del repo), quindi
vede **0 archi cross-layer** → il gate era **VACUO** (falsa assicurazione di altitudine).

Rendendo il grafo **alias-aware** (risoluzione dei path di `tsconfig`) emergono **8 violazioni reali**
del contratto `forbidden` (00-INDEX §1bis: `domain→ui/data/app`, `data→ui`). In `editor-core`:
- il gate T-312 è stato reso **alias-aware ma SCOPED alla superficie P3** (denti reali lì, 0 violazioni);
- l'unica violazione **`data→ui`** è stata **già bonificata** (`generation-choose` importava
  `@/ui/generation/variant-document` → il modulo è stato spostato in `src/domain/generation/variant-document.ts`).

Restano da chiudere qui le **7 `domain→data`** (tutte via alias `@/`, tutte in codice P0/P1/P2 già in `main`).

## 2. Le 7 violazioni `domain→data` (misurate, esatte)

| # | Modulo (from = `domain`) | Import (to = `data`) |
|---|---|---|
| 1 | `src/domain/setLocale.ts` | `@/data/updateProfileLocale` |
| 2 | `src/domain/auth/login.ts` | `@/data/supabase-ssr` (createServerSupabaseClient) |
| 3 | `src/domain/auth/signup.ts` | `@/data/supabase-ssr` |
| 4 | `src/domain/onboarding/interview.ts` | `@/data/anthropic` (runOnboardingTurn) |
| 5 | `src/domain/import/fromUrl.ts` | `@/data/anthropic` |
| 6 | `src/domain/generation/phase1.ts` | `@/data/anthropic` (runGenerationTurn) |
| 7 | `src/domain/generation/phase2.ts` | `@/data/anthropic` |

> Grep di verifica: `rg "from ['\"]@/(ui|data|app)/" src/domain` e `rg "from ['\"]@/ui/" src/data`.

## 3. La decisione già presa (D1-B) e il punto di design da riconfermare

- **D1-B (utente):** **contratto invariato** — `domain→data` resta vietato; si **conforma il CODICE**
  (non si ammorbidisce la regola). NON aggiungere `domain→data` alla `allow`.
- **Da riconfermare in brainstorming/bootstrap:** l'approccio. I 7 sono **orchestrazione con I/O**
  (auth crea un client Supabase; interview/generation chiamano l'LLM). Due strade pulite:
  1. **Dependency inversion**: il `domain` riceve il client/porta come **argomento**; è il layer `app`
     (rotte/azioni) a costruirlo e iniettarlo. Il domain resta puro (business logic, nessun import di `data`).
  2. **Ri-classificazione di layer**: se un modulo è di fatto un *use-case* con I/O, potrebbe
     appartenere ad `app` (che PUÒ usare `data`) più che a `domain`. Sposta il confine invece del grafo.
  La scelta va fatta **per modulo** (login/signup ≠ generation/phase). Entrambe tengono la regola;
  cambiano solo dove atterra il codice. Ricade sui **chiamanti** (rotte/azioni) e sui loro **test**.

## 4. La modifica al GATE (il cuore del macrotask)

- Rendere l'enforcement **alias-aware repo-wide** (risolvere `@/` via i path di `tsconfig`), non solo
  sulla superficie P3. Due opzioni: (a) cambiare l'**oracolo** `arch_check.mjs`/`module_graph.mjs`
  (vive nella plugin cache, **fuori dal repo** — non banale) perché passi `--ts-config`; (b) tenere
  l'enforcement nel **test vitest** `tests/architecture-contract.test.ts` (già alias-aware) ed
  **estenderne lo scope da superficie-P3 a REPO-WIDE**, rimuovendo il pin legacy delle 7 `domain→data`.
- **Vacuity guard** reale (già impostato in editor-core): provare che il resolver **vede** gli archi
  cross-layer (non è cieco) — quando le 7 sono bonificate, il pin esatto `LEGACY_DOMAIN_DATA` va
  **aggiornato/rimosso** (handoff documentato nel test di editor-core).
- **Falsificabilità**: un import vietato deliberato → ROSSO; poi pulizia della fixture.

## 5. Acceptance (l'oracolo del verde)

- Grafo import **alias-aware repo-wide**: **0 archi `forbidden`** (`domain→ui/data/app`, `data→ui`).
- Test di falsificabilità verde (prova il rosso su una violazione deliberata) + vacuity guard reale.
- **Suite completa verde** (i refactor DI/relayer non rompono P0/P1/P2; oggi 1214 test).
- **Checkpoint VERDE 4/4** (`run_checkpoint.mjs --in-place --mode build --baseline <sicurezza>`,
  SENZA `--blueprint`; verdetto dal JSON `.green`).

## 6. Vincoli & disciplina (invariati)

- **Deploy-coupling `coupled`** → merge su `main` **human-gated** anche sul verde.
- Mantenere VERDI i test P0/P1/P2; **non ammorbidire** asserzioni per assorbire un refactor.
- Metodo: 1 workflow build (builder + verifier BLIND per task) → 1 fermata umana → 1 workflow fixer;
  worktree **solo** se due agenti concorrenti mutano lo stesso file; batteria di mutazione con
  sanità fatale + ripristino per **sha256**. Gotcha ricattura igiene: `baseline.mjs capture <dir>
  --hygiene --out <hygiene path>` (il default scrive in `baseline.json`).

## 7. Prossima azione (per la prossima sessione)

1. **`superpowers:brainstorming`** sul punto §3 (DI vs relayer, per modulo) — è codice già in `main`,
   blast radius reale: decidere PRIMA di toccare.
2. **BOOTSTRAP via skill `trueline`** → `docs/blueprint/architecture-hardening/`: `00-INDEX` (mappa +
   piano build + ledger), i moduli/task atomici (uno per cluster di violazione + il task del gate),
   `SESSION-STATE`, `prompts/`. Valida con `validate_blueprint.mjs` (exit 0) + self-check semantico.
3. **BUILD** con la disciplina consueta; branch `trueline/build/architecture-hardening` (mai su `main`);
   merge human-gated sul verde.

## 8. Input da leggere all'avvio

- `docs/blueprint/P3-editor/00-INDEX.md` §1bis (il blocco `architecture:` e le regole `forbidden`).
- `tests/architecture-contract.test.ts` (il gate alias-aware scoped-P3 di editor-core, con l'handoff
  `LEGACY_DOMAIN_DATA` e i commenti che descrivono l'estensione repo-wide).
- `src/domain/**` (i 7 moduli §2) + i loro chiamanti in `src/app/**` e i test relativi.
- L'oracolo `arch_check.mjs` / `module_graph.mjs` nella plugin cache trueline (per decidere se
  cambiare l'oracolo o tenere l'enforcement nel test vitest).
