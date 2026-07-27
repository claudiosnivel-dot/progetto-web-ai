# session-end — Belora · P2 (Generazione dei mockup)

> Da incollare **alla chiusura di ogni sessione** di lavoro su P2. Verifica il checkpoint,
> riassume gli esiti, aggiorna SESSION-STATE, registra lo stato git.

```
Chiudiamo la sessione di lavoro su **P2 (Generazione dei mockup)** di **Belora**
(supabase-jsts). Niente nuovo lavoro: consolida, registra, lascia tutto riprendibile. Il
"fatto" si dichiara per FATTI verificati, mai a sensazione.

1) CHECKPOINT AL CONFINE DEL MACROTASK
   Conferma che il CHECKPOINT e girato e riassumine l'esito controllo per controllo:
   VERDE/ROSSO per dead-code, sicurezza, regressioni, conformita-logica; e il fix_state dei
   finding (verified / mitigated-residual / open). Il verde e l'esito di un ORACOLO o di un
   test, MAI una frase. Un controllo NON eseguito NON e un verde. Il verdetto si legge nel
   JSON (green, summary, controls[]), non dall'exit code e non attraverso `| tail`.
   Dichiara esplicitamente:
   • gitleaks (segreto Anthropic incluso), osv, semgrep, e **rls — che in P2 NON e
     ereditato**: due tabelle nuove, quindi va riconquistato e provato A RUNTIME attraverso
     il client con auth reale su Supabase locale, mai nell'SQL editor;
   • la baseline d'IGIENE: se e cambiata, l'ATTRIBUZIONE delle duplicazioni (quali sono tue,
     quali preesistenti, quali churn di posizione) PRIMA di qualunque ricattura;
   • se il macrotask e generation-e2e o successivo: che il CANARY fa fallire le asserzioni
     sull'effetto. Senza quella prova, il verde dell'end-to-end non significa nulla.

2) AGGIORNA docs/blueprint/P2-generation/SESSION-STATE.md (fonte di verita):
   • Macrotask fatti / in corso / da fare, rispetto al piano:
     generation-model → generation-engine & generation-llm → generation-ui → generation-e2e
   • Baseline e budget consumato (§4).
   • Per ogni task chiuso: id, output prodotto, quale oracolo/test ha prodotto il verde.
   • §6 COPERTURA DICHIARATA: aggiorna cosa e ora verificato e cosa resta NON coperto. Le
     voci che nascono aperte (nessuna chiave API, costanti di budget non misurate, latenza
     non misurata, anti-fuga come match per sottostringa, stile non asserito) si chiudono
     solo con un fatto, non con il passare delle sessioni.
   • §7 CARRY-OVER: sposta fra CHIUSI e APERTI solo cio che un oracolo ha davvero chiuso.

3) REGISTRA LO STATO GIT (git a strati):
   • Branch di lavoro e commit (con id del task + esito del gate).
   • Stato del merge su main: avvenuto SOLO se il checkpoint e verde; altrimenti SOSPESO.
   • DEPLOY-COUPLING: P2 tocca piu aree deploy-sensibili di P1 (due rotte nuove, un endpoint
     /api nuovo, migrazioni DB). Registra se l'override e stato riconfermato in questa
     sessione; deploy non supervisionato BLOCCATO.

4) VERIFICA-FIX RIVERIFICATA
   Per ogni fix applicata, conferma che e stata riverificata con lo STESSO oracolo e con i
   test, e che le rimozioni di dead-code sono passate dall'umano. Registra anche l'esito
   della batteria di mutazione dell'orchestratore: quante mutazioni, quante uccise, quante
   sopravvissute, e se il ripristino e stato verificato con l'hash. Una mutazione
   SOPRAVVISSUTA e un buco d'oracolo, non un dettaglio.

5) FRAMING ONESTO
   Usa "trovato e verificata la correzione di X" / "questi controlli sono passati", MAI
   "P2 e sicuro/pronto". Dichiara sempre la COPERTURA. In particolare, per P2:
   • la QUALITA del copy e la LINGUA generata NON sono oracolate (confine mockato, nessuna
     chiave API);
   • gli SCHEMI STRICT non sono provati contro l'API reale;
   • le costanti di GENERATION_BUDGET sono STIME, non misure (P2-D17): la taratura
     crediti/prezzi non si decide su di esse;
   • lo STILE non e asserito: i controlli sui temi provano che il layer e cablato e distinto,
     non che i temi siano belli;
   • se l'end-to-end e girato: prova l'EFFETTO su Chromium, non su tutti i browser, e non
     percorre login e onboarding.

Produci: (a) il riepilogo dei punti 1, 3, 4 e 5; (b) il DIFF preciso che applicherai a
SESSION-STATE.md. Applicalo solo dopo la mia conferma.
```
