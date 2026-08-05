# session-end — Belora · P3 (Editor inline)

> Da incollare **alla chiusura di ogni sessione** di lavoro su P3. Verifica il checkpoint,
> riassume gli esiti, aggiorna SESSION-STATE, registra lo stato git.

```
Chiudiamo la sessione di lavoro su **P3 (Editor inline)** di **Belora** (supabase-jsts).
Niente nuovo lavoro: consolida, registra, lascia tutto riprendibile. Il "fatto" si dichiara
per FATTI verificati, mai a sensazione.

1) CHECKPOINT AL CONFINE DEL MACROTASK
   Conferma che il CHECKPOINT è girato e riassumine l'esito controllo per controllo:
   VERDE/ROSSO per dead-code, sicurezza, regressioni, conformità-logica; e il fix_state dei
   finding (verified / mitigated-residual / open). Il verde è l'esito di un ORACOLO o di un
   test, MAI una frase. Un controllo NON eseguito NON è un verde. Il verdetto si legge nel
   JSON (green, summary, controls[]), non dall'exit code e non attraverso `| tail`.
   Dichiara esplicitamente:
   • gitleaks, osv, semgrep, e **rls — che in P3 NON è ereditato**: la tabella NUOVA
     site_document_revisions va riconquistata e provata A RUNTIME attraverso il client con
     auth reale su Supabase locale, mai nell'SQL editor;
   • **arch_check** (nuovo in P3, P3-D7): il contratto architecture: è attivo; dichiara il
     suo esito e che nessuna regola forbidden è vacua (vacuity guard);
   • lo **scan statico esteso** a src/ui/editor (T-306): che copre davvero la superficie
     editor e che è falsificabile;
   • la baseline d'IGIENE: se è cambiata, l'ATTRIBUZIONE delle duplicazioni (quali sono tue,
     quali preesistenti, quali churn di posizione — R-04) PRIMA di qualunque ricattura;
   • se il macrotask è editor-blocks: che il CANARY fa fallire le asserzioni sull'effetto
     sulla ROTTA EDITOR (T-317). Senza quella prova, il verde dell'end-to-end non significa
     nulla.

2) AGGIORNA docs/blueprint/P3-editor/SESSION-STATE.md (fonte di verità):
   • Macrotask fatti / in corso / da fare: editor-core → editor-blocks.
   • Baseline e budget consumato (§4).
   • Per ogni task chiuso: id, output prodotto, quale oracolo/test ha prodotto il verde.
   • §6 COPERTURA DICHIARATA: aggiorna cosa è ora verificato e cosa resta NON coperto. Le
     voci che nascono aperte (nessuna prova a runtime, e2e solo Chromium, CI mai girata) si
     chiudono solo con un fatto, non col passare delle sessioni.
   • §7 CARRY-OVER: sposta fra CHIUSI e APERTI solo ciò che un oracolo ha davvero chiuso.

3) REGISTRA LO STATO GIT (git a strati):
   • Branch di lavoro e commit (con id del task + esito del gate).
   • Stato del merge su main: avvenuto SOLO se il checkpoint è verde E il deploy-coupling lo
     consente; altrimenti SOSPESO.
   • DEPLOY-COUPLING: P3 aggiunge la rotta /editor e nuove server action. Registra se
     l'override è stato riconfermato in questa sessione; deploy non supervisionato BLOCCATO.

4) VERIFICA-FIX RIVERIFICATA
   Per ogni fix applicata, conferma che è stata riverificata con lo STESSO oracolo e con i
   test, e che le rimozioni di dead-code sono passate dall'umano. Registra anche l'esito
   della batteria di mutazione: quante mutazioni, quante uccise, quante sopravvissute, e se
   il ripristino è stato verificato con l'hash. Una mutazione SOPRAVVISSUTA è un buco
   d'oracolo, non un dettaglio.

5) FRAMING ONESTO
   Usa "trovato e verificata la correzione di X" / "questi controlli sono passati", MAI
   "P3 è sicuro/pronto". Dichiara sempre la COPERTURA. In particolare, per P3:
   • l'estetica e l'usabilità dell'editor NON sono oracolate: i controlli provano che il
     renderer è unico e che l'escaping regge, non che l'editor sia bello o comodo;
   • la prova sull'EFFETTO dell'iniezione è su Chromium (non tutti i browser) e non percorre
     login/onboarding;
   • gli invarianti del documento (home-unica, ≤8 MiB, slug unici) sono provati sul percorso
     di scrittura reale (parseDocument), non solo sullo schema;
   • le foto reali NON esistono ancora (upload = P4): in P3 sono placeholder del tema.

Produci: (a) il riepilogo dei punti 1, 3, 4 e 5; (b) il DIFF preciso che applicherai a
SESSION-STATE.md. Applicalo solo dopo la mia conferma.
```
