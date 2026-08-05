# session-end — Belora · `architecture-hardening`

> Da incollare **alla chiusura di ogni sessione** di lavoro sul macrotask. Verifica il checkpoint,
> riassume gli esiti, aggiorna SESSION-STATE, registra lo stato git.

```
Chiudiamo la sessione di lavoro su **architecture-hardening** di **Belora** (supabase-jsts).
Niente nuovo lavoro: consolida, registra, lascia tutto riprendibile. Il "fatto" si dichiara per
FATTI verificati, mai a sensazione.

1) CHECKPOINT AL CONFINE DEL MACROTASK
   Conferma che il CHECKPOINT è girato e riassumine l'esito controllo per controllo: VERDE/ROSSO
   per dead-code, sicurezza, regressioni, conformità-logica; e il fix_state dei finding (verified /
   mitigated-residual / open). Il verde è l'esito di un ORACOLO o di un test, MAI una frase. Un
   controllo NON eseguito NON è un verde. Il verdetto si legge nel JSON (green, summary,
   controls[]), non dall'exit code e non attraverso `| tail`. Dichiara esplicitamente:
   • gitleaks, osv, semgrep, rls (invariato: nessuna tabella nuova qui, ma il refactor auth NON
     deve aver introdotto un client service_role o un import non di sessione);
   • dead-code (knip): i file di ORIGINE svuotati dal relayer (setLocale, auth/login, auth/signup,
     e le funzioni I/O di phase1/phase2) NON devono restare come orfani; le rimozioni passano
     dall'umano;
   • **il GATE T-AH6**: che tests/architecture-contract.test.ts è ora REPO-WIDE (0 archi forbidden
     su tutti i sorgenti), che il pin LEGACY_DOMAIN_DATA è rimosso, che la fixture di
     falsificabilità fa diventare il gate ROSSO, e che il testimone di non-vacuità positivo
     (alias-aware ≥1 arco lecito, cieco 0) regge;
   • la baseline d'IGIENE: se è cambiata, l'ATTRIBUZIONE delle duplicazioni PRIMA di qualunque
     ricattura (i file spostati ri-fingerprintano impronte pre-esistenti — R-04).

2) AGGIORNA docs/blueprint/architecture-hardening/SESSION-STATE.md (fonte di verità):
   • Stato del macrotask e dei task T-AH1..T-AH6 (todo/in_progress/done).
   • Baseline e budget consumato (§4).
   • Per ogni task chiuso: id, output prodotto (file spostato/porta iniettata/gate esteso), quale
     oracolo/test ha prodotto il verde.
   • §6 COPERTURA DICHIARATA: aggiorna cosa è ora verificato (grafo alias-aware repo-wide
     0-violazioni; iso-comportamento; falsificabilità; non-vacuità) e cosa resta NON coperto.
   • §7 CARRY-OVER: il fix upstream dell'oracolo (--ts-config) resta APERTO (non azionabile dal
     repo); sposta fra CHIUSI e APERTI solo ciò che un oracolo ha davvero chiuso.

3) REGISTRA LO STATO GIT (git a strati):
   • Branch di lavoro (trueline/build/architecture-hardening) e commit (con id del task + esito del gate).
   • Stato del merge su main: avvenuto SOLO se il checkpoint è verde E il deploy-coupling lo
     consente; altrimenti SOSPESO (deploy-coupling COUPLED → human-gated anche sul verde).
   • DEPLOY-COUPLING: registra che l'override coupled è confermato; deploy non supervisionato BLOCCATO.

4) VERIFICA-FIX RIVERIFICATA
   Per ogni fix applicata, conferma che è stata riverificata con lo STESSO oracolo e con i test, e
   che le rimozioni di dead-code sono passate dall'umano. Registra l'esito della batteria di
   mutazione: quante mutazioni, quante uccise, quante sopravvissute, e se il ripristino è stato
   verificato con l'hash. Una mutazione SOPRAVVISSUTA è un buco d'oracolo, non un dettaglio.

5) FRAMING ONESTO
   Usa "trovato e verificata la correzione di X" / "questi controlli sono passati", MAI "il repo è
   a norma di altitudine". Dichiara sempre la COPERTURA. In particolare:
   • il gate prova l'ASSENZA di archi forbidden nel grafo import STATICO alias-aware (non l'assenza
     di accoppiamenti a runtime via injection/DI legittimi);
   • l'iso-comportamento è provato dai target_tests esistenti (che restano verdi), non da una prova
     esaustiva di equivalenza;
   • l'oracolo trueline upstream resta CIECO sugli alias (carry-over): il verde viene dal test
     vitest versionato, non da arch_check.mjs.

Produci: (a) il riepilogo dei punti 1, 3, 4 e 5; (b) il DIFF preciso che applicherai a
SESSION-STATE.md. Applicalo solo dopo la mia conferma.
```
