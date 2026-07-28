# AUDIT DEGLI ORACOLI — superfici di sicurezza di P0 e P1

> Piano di lavoro deciso il **2026-07-28**, alla chiusura del macrotask
> `generation-model` di P2. Da eseguire in una sessione dedicata, **prima** di
> proseguire con altri macrotask.
>
> Non e un audit del CODICE: il codice e gia stato ripassato. E un audit degli
> **ORACOLI** — la domanda e se i test verdi di P0 e P1 sappiano diventare rossi.

---

## 1. Perche, e perche NON per il motivo che sembrava

### Cosa e stato escluso per misura, non per opinione
Il sospetto iniziale era il cambio di versione della skill trueline (0.1.0 → 0.2.0
a meta sessione, con la directory di versione sparita sotto la sessione). **Verificato
confrontando i due alberi**: gli `scripts/**` sono byte-identici salvo un file.

| | Esito |
|---|---|
| checkpoint, oracoli, baseline, blueprint | **identici** |
| `oracles/gitleaks.toml` | 41 righe presenti **solo** nell'albero di sviluppo, **zero** presenti solo in 0.2.0 |
| `scan_scope.mjs` | assente da 0.2.0, ma **nessuno lo importa**: non e un modulo mancante |

Le 41 righe sono un'**allowlist per i JWT demo di Supabase locale**, aggiunta all'albero
di sviluppo alle 23:07 del 28/07 — cioe **dopo** che 0.2.0 era stato pacchettizzato
(13:17 dello stesso giorno). Ne segue che il checkpoint del 28/07 ha girato con la
configurazione dei segreti **piu severa delle due** e ha comunque dato `gitleaks:0`.
**Il cambio di versione non ha invalidato nulla e non ha degradato alcun oracolo**
(`degraded: []`, nessun import pendente).

### Il motivo vero
Nel BUILD di `generation-model`, in **4 task su 5** il difetto trovato dalla verifica
avversariale era nell'**oracolo**, non nel codice. Tre esempi misurati:

- un doppio del client contava **le proprie invocazioni** invece delle richieste al DB:
  un N+1 reale instradato per un'altra via lasciava la suite verde;
- il gate di validazione di una scrittura poteva essere **rimosso per intero** con la
  suite verde, mentre scriveva nell'artefatto congelato un URL di terzi che lo schema
  dichiara irrappresentabile;
- un vincolo di integrita poteva essere **declassato** senza che nessun test protestasse.

P0 (28 task, 137 AC) e P1 (13 task, 61 AC) sono stati costruiti **prima** che alcune di
queste lezioni esistessero. Il rischio non e che il codice sia sbagliato: e che, se un
giorno lo diventasse, nessuno se ne accorgerebbe.

## 2. Ampiezza decisa (dall'utente, 2026-07-28)

**Sweep di mutazione sulle sole superfici dove un buco d'oracolo e una VULNERABILITA e
non un bug.** Non la riverifica completa dei 41 task: si comincia dove un buco costa di
piu, e si decide se allargare **con i dati** invece che per prudenza.

### In scope

| Superficie | Sorgente | Oracoli (file di test) |
|---|---|---|
| Tenancy e appartenenza | `20260723000100_accounts_account_members.sql`, `20260723000400_accounts_owner_unique.sql` | `accounts_schema.test.ts`, `account_members_rls.test.ts`, `is_account_member.test.ts`, `tenant_isolation.test.ts` |
| Profili e auto-provisioning | `20260723000200_profiles.sql`, `20260723000300_auto_provision.sql` | `profiles_rls.test.ts`, `profiles-locale-rls.test.ts`, `auto_provision.test.ts`, `auto_provision_secdef.test.ts` |
| Auth e sessione | `src/domain/auth/**`, `src/data/supabase-{ssr,browser,admin}.ts` | `auth-middleware.test.ts`, `auth-server-session.test.ts`, `auth-callback.test.ts`, `auth-signup-validation.test.ts` |
| Siti account-scoped | `20260724000100_sites.sql`, `src/data/sites.ts` | `sites-schema.test.ts`, `sites-actions.test.ts`, `sites-mutations.test.ts` |
| Brief 1:1 e azioni | `20260724000200_site_briefs.sql`, `src/data/briefs.ts` | `site-briefs-schema.test.ts`, `briefs-actions.test.ts` |
| Import da URL (SSRF) | `src/domain/import/fetchSafe.ts`, `fromUrl.ts`, `src/data/import.ts` | `import-fromurl.test.ts` |

### Fuori scope (dichiarato)
Cataloghi i18n, design system, UI di dashboard e onboarding, harness di test. Non perche
siano corretti per certo, ma perche un buco d'oracolo li costa un bug e non una falla —
e la scelta e di spendere lo sforzo dove costa di piu.

## 3. Metodo (lo stesso che ha funzionato in P2)

Per **ogni** superficie, un ciclo a 2 agenti + batteria dell'orchestratore:

1. **VERIFIER AVVERSARIALE** (agente dedicato): per ogni AC della superficie, la domanda
   non e "il test passa?" ma **"se l'implementazione fosse sbagliata in un modo plausibile,
   questo test diventerebbe rosso?"**. Mutazioni reali su copia fuori dal repo o sui file
   veri con **ripristino verificato per hash**.
2. **BATTERIA DI MUTAZIONE dell'orchestratore** sulle proprieta portanti di ciascuna
   superficie. Le mutazioni che in P2 hanno trovato piu buchi, da riusare qui:
   - policy RLS: `TO authenticated` tolto · predicato allargato con `or true` ·
     `USING(true)` · RLS disabilitata · il predicato spostato dentro una funzione
     (invisibile allo static check — lezione RLS004);
   - vincoli: FK composita → FK semplice · `ON DELETE CASCADE` → `NO ACTION` ·
     UNIQUE rimosso o allargato · `NOT NULL` tolto · CHECK allentato;
   - codice: filtro per account rimosso (**lo copre la RLS? allora il test non prova cio
     che dice**) · guardia di auth rimossa · validazione bypassata · troncamento al posto
     del rifiuto · confronto per prefisso al posto dell'uguaglianza;
   - SSRF: allowlist di schema/host allentata · redirect non riseguito · IP privati e
     link-local riammessi · DNS rebinding.
   Piu, in ogni batteria, **una mutazione palesemente fatale** (per provare che lo
   strumento sa diventare rosso) e **almeno una attesa VERDE** (una riscrittura
   equivalente: se diventa rossa, l'oracolo e rigido, non forte).
3. **FIXER diversi** sui rilievi confermati, e l'orchestratore riesegue **lo stesso**
   oracolo dopo la patch (L-COL-003).
4. **Human-in-the-loop** su ogni fix che cambi comportamento o tocchi una DoD gia
   checkpointata: P0 e P1 sono **gia mergeati su `main`**, quindi ogni emendamento e una
   modifica a lavoro chiuso e va approvato, non dedotto.

### Invarianti che restano validi
Oracle-as-judge mai LLM-as-judge · nessun falso via libera · copertura sempre dichiarata ·
dead-code mai cancellato in autonomia · e, prima di credere a un verde, provare che lo
strumento sa diventare rosso.

## 4. Cosa NON e in discussione

Il **codice** di P0 e P1 e stato ripassato il 28/07 dal checkpoint con lo strumento nuovo
e la configurazione dei segreti piu severa: `gitleaks:0 · osv:0 · semgrep:0 · rls:0 ·
dead-code:0 · cycle:0 · twin:0`, **593 test verdi in 61 file**, `degraded: []`. Se questo
audit trovera qualcosa, sara **un oracolo debole**, non necessariamente un difetto attivo —
e la distinzione va mantenuta nel referto, perche sono due cose diverse per chi legge.

## 5. Criterio di uscita

- Ogni superficie in scope ha una batteria eseguita, con l'elenco delle mutazioni
  **applicate** (mai "saltate in silenzio": una mutazione non applicata non prova nulla) e
  del loro esito.
- I rilievi confermati sono chiusi o **dichiarati aperti** in una sezione di copertura.
- Si decide **con i dati raccolti** se estendere alle superfici fuori scope.
- Checkpoint verde al termine, e SESSION-STATE aggiornata con gli esiti per fatti.
