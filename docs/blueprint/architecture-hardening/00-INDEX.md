# 00-INDEX — Blueprint `architecture-hardening` di Belora

> Mappa, piano di build, decision ledger e manifest del macrotask **trasversale**
> `architecture-hardening` di Belora (AI website builder, Next.js 16 + Supabase). Generato in
> modalità BOOTSTRAP dalla skill *trueline*. **Nessun codice**: solo il piano. Fonte
> dell'intento: `docs/superpowers/specs/2026-08-05-architecture-hardening-design.md`. Handoff
> d'origine: `KICKOFF.md` (pre-bootstrap, ora superato da questo indice + `SESSION-STATE`).

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Tipo** | Macrotask **trasversale** (non un sotto-progetto Pn): refactor a iso-comportamento + gate |
| **Poggia su** | P0, P1, P2 e P3 `editor-core` — tutti completi e verdi su `main` |
| **Ingresso** | 7 archi `domain→data` misurati (già in `main`) + gate `architecture:` alias-aware ma **scoped alla superficie P3** |
| **Uscita** | 0 archi `forbidden` repo-wide + gate `architecture:` **repo-wide** con testimone di non-vacuità positivo |
| **Schema task** | schema atomico trueline (`L-COL-019`): definition_of_done + acceptance_criteria + target_tests |

---

## 1. Mappa dei macrotask

| # | File | Macrotask | Cosa costruisce |
|---|---|---|---|
| 01 | `01-architecture-hardening.md` | `architecture-hardening` | **Conforma il codice e alza il gate**: relayer di 3 Server Action (`setLocale`, `auth/login`, `auth/signup`) in `src/app`; DI di una porta LLM di onboarding (`interview`, `fromUrl`); relayer delle funzioni I/O di generazione (`phase1`, `phase2`) in `src/data`; **flip del gate** `architecture:` da scoped-P3 a **repo-wide** (drop del pin `LEGACY_DOMAIN_DATA`, testimone di non-vacuità positivo) |

## 1bis. Contratto di altitudine — dove vive (NON duplicato qui)

Il blocco `architecture:` (strati `ui`/`domain`/`data`/`app` + regole `forbidden`
`domain→ui/data/app`, `data→ui`) è dichiarato **una volta sola** in
`docs/blueprint/P3-editor/00-INDEX.md` §1bis (attivato da **P3-D7 / ex P1-D11**). Questo
macrotask **non lo ridichiara** (evita una seconda fonte di verità): il gate versionato
`tests/architecture-contract.test.ts` lo carica da lì via `loadContract()`. Di conseguenza il
controllo strutturale `(6) ARCH_CONTRACT_WELL_FORMED` di `validate_blueprint` è uno **skip
legittimo** sulla dir di questo blueprint (nessun blocco `architecture:` presente → nessun check).

## 2. Piano di build (ordine topologico del DAG)

Il DAG dei `depends_on` è **interno** al macrotask. I 5 refactor toccano file **disgiunti** e
sono indipendenti; il gate `T-AH6` dipende da tutti (0 archi vietati richiede che tutti gli
archi siano rimossi). I refactor **non toccano** `tests/architecture-contract.test.ts`: l'intera
transizione del gate è di `T-AH6` (nessun file condiviso fra builder concorrenti → niente worktree).

```
architecture-hardening
 ├─ T-AH1 relayer setLocale → src/app                             [ ]
 ├─ T-AH2 relayer auth login/logout/signInWithGoogle → src/app    [ ]
 ├─ T-AH3 relayer auth signup → src/app                           [ ]
 ├─ T-AH4 DI porta LLM onboarding (interview + fromUrl)           [ ]
 ├─ T-AH5 relayer generation phase1/phase2 (I/O → src/data)       [ ]
 └─ T-AH6 gate repo-wide (flip + drop pin + testimone positivo)   [T-AH1,T-AH2,T-AH3,T-AH4,T-AH5]
```

**Confine e commit.** Un macrotask è l'unità al cui confine gira il **checkpoint**
(dead-code · sicurezza · regressioni · conformità-logica sui `target_tests`), poi commit atomico
sul branch `trueline/build/architecture-hardening` (`L-COL-024`); **mai** su `main`. Merge su
`main` gated dal verde **e** dal deploy-coupling `coupled` (human-gated anche sul verde).

## 3. Aggancio alla sicurezza (`07`)

Il macrotask **non introduce** superfici nuove (nessuna tabella, nessuna rotta, nessuna server
action nuova): è refactor di altitudine a iso-comportamento. Gli agganci di sicurezza sono
**invarianti da preservare**, non nuove superfici:

- **`auth` (T-AH1/T-AH2/T-AH3)**: le azioni spostate continuano a costruire il client con
  `createServerSupabaseClient()` (anon key + cookie, **RLS attiva**), **mai `service_role`**; lo
  spostamento **non** apre un seam d'iniezione dove sostituire un client admin. Messaggi generici
  (anti-enumerazione, CWE-204). `redirect()` resta dentro Server Action `'use server'`.
- **`llm` (T-AH4/T-AH5)**: la **chiave Anthropic server-only** resta confinata al layer `data`;
  `src/app` non importa mai `@/data/anthropic` (accesso via provider `src/data/llm-ports.ts`). La
  porta iniettata è tipizzata solo sul SDK. L'output del modello resta **input non fidato**
  (validazione zod invariata). Preservate `maxRetries:0`+timeout (no doppia fatturazione) e il
  client lazy.
- **gate (T-AH6)**: controllo di **altitudine** (OWASP A04/A05) — impedisce che il dominio
  dipenda dai dettagli di IO/persistenza. Enforcement nel test versionato + **falsificabilità**.

## 4. Decision ledger (AH-D*)

> Le decisioni si modificano SOLO con emendamento esplicito registrato qui. `AH-D1`…`AH-D7`
> vengono dal design approvato del 2026-08-05 (§3), in forma compatta; la motivazione integrale
> sta nella spec e nella mappa del blast radius.

| ID | Decisione | Scelta | Stato |
|---|---|---|---|
| `AH-D1` | Come togliere gli archi `domain→data` | **Conformare il codice, regola invariata** (ex D1-B). Vietato aggiungere `domain→data` alla `allow` | chiusa |
| `AH-D2` | Gruppo A — Server Actions (`setLocale`, `auth/login`, `auth/signup`) | **relayer → `src/app`**: sono `use server` framework-bound (cookie/redirect/auth); i chiamanti sono client component → DI sarebbe finta purezza. Validazione resta in `domain` | chiusa |
| `AH-D3` | Gruppo B — LLM onboarding (`interview`, `fromUrl`) | **DI**: una porta LLM iniettata, tipizzata solo su `@anthropic-ai/sdk`. `src/app` è vietato da ESLint dall'importare `@/data/anthropic` → relayer-to-app impossibile per `interview` | chiusa |
| `AH-D4` | Gruppo C — LLM generation (`phase1`, `phase2`) | **relayer → `src/data`**: sposta le funzioni I/O accanto ai chiamanti (già in `src/data`); i builder puri restano in `domain` | chiusa |
| `AH-D5` | Dove vive l'enforcement del gate | **Nel test vitest `tests/architecture-contract.test.ts`**, non nell'oracolo `arch_check.mjs` (plugin-cache immutabile, blind sugli alias) | chiusa |
| `AH-D6` | Scope del gate dopo la bonifica | **Repo-wide**: `evaluateContract().violations` vuoto su tutte e 4 le regole; drop del pin `LEGACY_DOMAIN_DATA` | chiusa |
| `AH-D7` | Testimone di non-vacuità post-bonifica | **Positivo**: alias-aware risolve ≥1 arco `@/` cross-layer lecito, il grafo cieco 0. Sostituisce l'ex "esattamente questi 7 `domain→data`" | chiusa |

## 5. Fonti di verità

- **Piano**: questo blueprint (`00-INDEX` + modulo `01-architecture-hardening`).
- **Design a monte**: `docs/superpowers/specs/2026-08-05-architecture-hardening-design.md`.
- **Handoff d'origine**: `KICKOFF.md` (pre-bootstrap, superato).
- **Contratto `architecture:`**: `docs/blueprint/P3-editor/00-INDEX.md` §1bis (fonte unica).
- **Gate versionato**: `tests/architecture-contract.test.ts` (alias-aware, scoped-P3 → repo-wide).
- **Stato vivo**: `SESSION-STATE.md` (fonte di verità di questo macrotask — distinta da quelle di
  P0/P1/P2/P3 e della skill trueline).
- **Superficie da bonificare**: `src/domain/{setLocale.ts, auth/login.ts, auth/signup.ts,
  onboarding/interview.ts, import/fromUrl.ts, generation/phase1.ts, generation/phase2.ts}` + i
  loro chiamanti in `src/app/**` / `src/data/**` e i test relativi.

## 6. Self-check del blueprint

- **Strutturale**: `node <trueline>/scripts/blueprint/validate_blueprint.mjs docs/blueprint/architecture-hardening`
  — atteso exit 0 (`11` §5.1). Il check (6) è skip legittimo (nessun blocco `architecture:` qui).
- **Semantico**: `self-check-checklist.md` punti 6–10 su ogni task (`11` §5.2); rilievi →
  human-in-the-loop.

## 7. Fuori scope (rimandato / carry-over)

- **Fix upstream dell'oracolo** `arch_check.mjs`/`module_graph.mjs` (passare `--ts-config` a
  `madge`): **non azionabile dal repo** (plugin-cache immutabile version-pinned). Va registrato
  come **carry-over** in `SESSION-STATE`; **complementa**, non sostituisce, l'enforcement nel test.
- **Spostamento del blocco `architecture:`** fuori da P3 `00-INDEX`: non necessario ora; il gate
  lo carica da lì. Fuori scope.
- **Nessuna nuova feature, nessuna nuova superficie DB/rotta**: solo altitudine.
