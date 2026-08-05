# SESSION-STATE — Belora · P3 (Editor inline)

> Fonte di verità sullo **stato vivo** del sotto-progetto P3, consumata da BUILD e
> aggiornata a ogni chiusura di sessione (`prompts/session-end.md`). Istanza distinta
> dalle SESSION-STATE di P0/P1/P2 e da quella della skill trueline. Prosa in italiano,
> identificatori/nomi-file in inglese.

| | |
|---|---|
| **Progetto** | Belora |
| **Ecosistema** | supabase-jsts (Next.js 16 App Router + TypeScript + Supabase) |
| **Ultimo aggiornamento** | 2026-08-05 (bootstrap del blueprint P3) |
| **Sessione corrente** | bootstrap (nessun codice prodotto) |

---

## 1. Stato dei macrotask

> Aggiornato a ogni `session-end`. Stati: `todo` | `in_progress` | `done`.

| Macrotask | Stato | Checkpoint | Note |
|---|---|---|---|
| `editor-core` | todo | — | 13 task (T-301…T-312, T-318). Nessuna dipendenza aperta: è il primo eseguibile |
| `editor-blocks` | todo | — | 5 task (T-313…T-317). Dipende da `editor-core` (renderer editabile, persistenza, rotta) |

## 2. Macrotask corrente

- **Selezionato**: nessuno ancora (bootstrap appena concluso).
- **Prossimo eseguibile**: `editor-core` (dipendenze P3 tutte verdi; T-301 e T-305 senza
  dipendenze aperte, punti d'ingresso paralleli — worktree solo se due agenti mutano lo
  stesso file).
- **Criteri/test di riferimento**: modulo `01-editor-core.md`; i `target_tests` dei task
  sono l'oracolo del controllo 4 in BUILD.

## 3. Stato git

> Registrato a ogni `session-end`. Mai lavorare su `main`.

| Campo | Valore |
|---|---|
| Branch di lavoro | — (nessuno; il bootstrap produce solo docs) |
| Ultimo commit | il commit di bootstrap del blueprint P3 (docs-only su `main`) |
| Stato merge su `main` | n/a per il bootstrap (solo documenti di piano) |
| Deploy-coupling | `unknown` — **da rilevare e riconfermare** a inizio BUILD (P3 aggiunge la rotta `/editor` e nuove server action → `main` potenzialmente deploy-coupled; in ambiguità si assume coupled e il merge resta human-gated anche sul verde, `05` §8.3 / `L-COL-025`) |

## 4. Baseline & budget

- **Baseline di sicurezza**: da **ricatturare** a inizio BUILD. P3 introduce la tabella
  `site_document_revisions` (`rls` da **riconquistare**, non ereditare) e la superficie
  `src/ui/editor` (scan statico anti-XSS da **estendere**). Baseline d'igiene (jscpd) da
  ri-attribuire prima di ricatturare (l'aggiunta di file ri-fingerprinta impronte
  pre-esistenti — R-04).
- **Budget consumato**: 0 (nessun ciclo di BUILD ancora).

## 5. Esiti dell'ultima sessione (framing onesto)

> Solo fatti: "generato e validato il blueprint", mai "P3 è pronto/sicuro" (`L-COL-006`).

- Blueprint P3 **generato** (`00-INDEX`, `01-editor-core`, `02-editor-blocks`, `VISION`,
  questa `SESSION-STATE`, i 3 prompt di lifecycle) dal design approvato del 2026-08-05.
- Self-check **strutturale** (`validate_blueprint.mjs`) e **semantico** (checklist 6–10):
  esito registrato al bootstrap (vedi §6).

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

1. Aprire la sessione di BUILD con `prompts/session-start.md`; selezionare `editor-core`.
2. **Preflight** delle dipendenze (`scripts/preflight.mjs`) + **riconfermare il
   deploy-coupling** (§3).
3. Ricatturare la **baseline** di sicurezza e igiene (§4) prima del primo checkpoint.
4. Costruire `editor-core` con la disciplina consueta (builder + verifier BLIND per task →
   una fermata umana → fixer; `run_checkpoint.mjs` unico giudice; batteria di mutazione con
   sanità fatale + ripristino per hash).
