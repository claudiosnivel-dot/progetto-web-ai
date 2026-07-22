# session-end — Belora · P0

> Da incollare **alla chiusura di ogni sessione** di lavoro. Verifica il checkpoint,
> riassume gli esiti, aggiorna SESSION-STATE, registra lo stato git.

```
Chiudiamo la sessione di lavoro su **Belora** (supabase-jsts). Niente nuovo lavoro:
consolida, registra, lascia tutto riprendibile. Il "fatto" si dichiara per FATTI
verificati, mai a sensazione.

1) CHECKPOINT AL CONFINE DEL MACROTASK
   Conferma che il CHECKPOINT è girato e riassumine l'esito controllo per controllo:
   VERDE/ROSSO per dead-code, sicurezza, regressioni, conformità-logica; e il fix_state
   dei finding (verified / mitigated-residual / open). Il verde è l'esito di un ORACOLO o
   di un test, MAI una frase. Un controllo NON eseguito NON è un verde.

2) AGGIORNA docs/blueprint/P0-foundations/SESSION-STATE.md (fonte di verità):
   • Macrotask fatti / in corso / da fare, rispetto al piano:
     infra → design-system → i18n → auth → tenancy → sites
   • Baseline e budget consumato (§4).
   • Per ogni task chiuso: id, output prodotto, quale oracolo/test ha prodotto il verde.

3) REGISTRA LO STATO GIT (git a strati):
   • Branch di lavoro e commit (con id del task + esito del gate).
   • Stato del merge su main: avvenuto SOLO se il checkpoint è verde; altrimenti SOSPESO.
   • DEPLOY-COUPLING: nota se il macrotask tocca aree deploy-sensibili; deploy non
     supervisionato BLOCCATO.

4) VERIFICA-FIX RIVERIFICATA
   Per ogni fix applicata, conferma che è stata riverificata con lo STESSO oracolo e con i
   test, e che le rimozioni di dead-code sono passate dall'umano.

5) FRAMING ONESTO
   Usa "trovato e verificata la correzione di X" / "questi controlli sono passati", MAI
   "Belora è sicuro/pronto". Dichiara sempre la COPERTURA: cosa è stato verificato e cosa no.

Produci: (a) il riepilogo dei punti 1, 3 e 5; (b) il DIFF preciso che applicherai a
SESSION-STATE.md. Applicalo solo dopo la mia conferma.
```
