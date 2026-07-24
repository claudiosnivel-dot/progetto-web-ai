# session-end — Belora · P1 (Onboarding)

> Da incollare **alla chiusura di ogni sessione** di lavoro su P1. Verifica il checkpoint,
> riassume gli esiti, aggiorna SESSION-STATE, registra lo stato git.

```
Chiudiamo la sessione di lavoro su **P1 (Onboarding)** di **Belora** (supabase-jsts). Niente
nuovo lavoro: consolida, registra, lascia tutto riprendibile. Il "fatto" si dichiara per
FATTI verificati, mai a sensazione.

1) CHECKPOINT AL CONFINE DEL MACROTASK
   Conferma che il CHECKPOINT e girato e riassumine l'esito controllo per controllo:
   VERDE/ROSSO per dead-code, sicurezza, regressioni, conformita-logica; e il fix_state dei
   finding (verified / mitigated-residual / open). Il verde e l'esito di un ORACOLO o di un
   test, MAI una frase. Un controllo NON eseguito NON e un verde. Dichiara esplicitamente:
   gitleaks (segreto Anthropic incluso), osv, semgrep, rls; e la copertura SSRF (T-140) e
   RLS-a-runtime (site_briefs) provata attraverso il client con auth reale.

2) AGGIORNA docs/blueprint/P1-onboarding/SESSION-STATE.md (fonte di verita):
   • Macrotask fatti / in corso / da fare, rispetto al piano:
     brief-model → ai-onboarding & url-import → onboarding-ui
   • Baseline e budget consumato (§4).
   • Per ogni task chiuso: id, output prodotto, quale oracolo/test ha prodotto il verde.

3) REGISTRA LO STATO GIT (git a strati):
   • Branch di lavoro e commit (con id del task + esito del gate).
   • Stato del merge su main: avvenuto SOLO se il checkpoint e verde; altrimenti SOSPESO.
   • DEPLOY-COUPLING: override false a livello progetto; nota se il macrotask tocca aree
     deploy-sensibili; deploy non supervisionato BLOCCATO.

4) VERIFICA-FIX RIVERIFICATA
   Per ogni fix applicata, conferma che e stata riverificata con lo STESSO oracolo e con i
   test, e che le rimozioni di dead-code sono passate dall'umano.

5) FRAMING ONESTO
   Usa "trovato e verificata la correzione di X" / "questi controlli sono passati", MAI
   "P1 e sicuro/pronto". Dichiara sempre la COPERTURA: cosa e stato verificato e cosa no
   (in particolare: la qualita dell'intervista AI NON e oracolata — eval offline opzionale,
   fuori dal checkpoint).

Produci: (a) il riepilogo dei punti 1, 3 e 5; (b) il DIFF preciso che applicherai a
SESSION-STATE.md. Applicalo solo dopo la mia conferma.
```
