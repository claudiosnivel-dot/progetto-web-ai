# VISION & CONSTRAINTS — `architecture-hardening` di Belora

> Perché esiste, per chi, cosa NON è, e i vincoli. Complementa `00-INDEX` (il piano) e la spec
> di design `docs/superpowers/specs/2026-08-05-architecture-hardening-design.md` (l'intento).

## Perché

Il contratto di altitudine `architecture:` è stato **attivato** in P3 (P3-D7), ma il verifier
BLIND di T-312 ha misurato che l'oracolo reale gira `madge` **senza `--ts-config`**: non risolve
gli alias `@/` (usati da 318/318 import cross-module), quindi vede **0 archi cross-layer** → il
gate era **VACUO** (falsa assicurazione di altitudine). Reso alias-aware, emergono **8 violazioni
reali**; in editor-core sono state chiuse la `data→ui` e lo scope-P3. Restano le **7 `domain→data`**
(codice P0/P1/P2 già in `main`). Questo macrotask le bonifica e rende il gate **reale e repo-wide**.

## Per chi

- Chi mantiene Belora: un dominio che non dipende dai dettagli di IO/persistenza è più semplice da
  testare, spostare e ragionare (i moduli di dominio restano puri).
- Il gate stesso: un controllo che **sa diventare rosso** su una violazione reale, non un
  blind-green che dà falsa sicurezza.

## Cosa NON è (non-goals)

- **Non** cambia comportamento osservabile: refactor a **iso-comportamento**. La suite (oggi 1214
  test) è il guardrail di regressione.
- **Non** ammorbidisce la regola: `domain→data` resta vietato (`AH-D1`); nessun arco vietato entra
  in una `allow`.
- **Non** introduce feature, superfici DB, rotte o server action nuove.
- **Non** corregge l'oracolo trueline upstream (`--ts-config`): è fuori dal repo (carry-over).
- **Non** sposta il blocco `architecture:` fuori da P3 `00-INDEX` §1bis (resta la fonte unica).

## Vincoli

- **Ecosistema**: supabase-jsts (Next.js 16 App Router + TypeScript + Supabase).
- **Deploy-coupling `coupled` (confermato)**: merge su `main` **human-gated anche sul verde**.
- **Invarianti di sicurezza da preservare**: session-client-mai-`service_role` (auth); chiave
  Anthropic confinata a `data`, `src/app` non importa `@/data/anthropic`; `maxRetries:0`+timeout e
  cache-prefix byte-identico (generation); best-effort try/catch che non blocca cookie/redirect
  (setLocale); client LLM lazy; output del modello come input non fidato (validazione zod).
- **Metodo**: 1 workflow build (builder + verifier BLIND per task) → 1 fermata umana → 1 workflow
  fixer; checkpoint `run_checkpoint.mjs --in-place --mode build --baseline <sicurezza>` **senza
  `--blueprint`**, verdetto dal JSON `.green`; batteria di mutazione con sanità fatale + ripristino
  per sha256; worktree **solo** se due agenti mutano lo stesso file (qui i refactor sono disgiunti).
- **Oracolo del verde**: 0 archi `forbidden` alias-aware repo-wide + falsificabilità + testimone di
  non-vacuità positivo + suite 1214 verde + **checkpoint VERDE 4/4**.
