# session-end — Belora · P4 (Pubblicazione, serving pubblico & media)

> Da incollare **alla chiusura di ogni sessione** di lavoro su P4. Verifica il checkpoint,
> riassume gli esiti, aggiorna SESSION-STATE, registra lo stato git.

```
Chiudiamo la sessione di lavoro su **P4 (Pubblicazione, serving pubblico & media)** di **Belora**
(supabase-jsts). Niente nuovo lavoro: consolida, registra, lascia tutto riprendibile. Il "fatto"
si dichiara per FATTI verificati, mai a sensazione.

1) CHECKPOINT AL CONFINE DEL MACROTASK
   Conferma che il CHECKPOINT è girato SU STATO PULITO (rm -rf .next + db:reset) e riassumine
   l'esito controllo per controllo: VERDE/ROSSO per dead-code, sicurezza, regressioni,
   conformità-logica; e il fix_state dei finding (verified / mitigated-residual / open). Il verde
   è l'esito di un ORACOLO o di un test, MAI una frase. Un controllo NON eseguito NON è un verde.
   Il verdetto si legge nel JSON (green, summary, controls[]), non dall'exit code e non attraverso
   `| tail`.
   Dichiara esplicitamente:
   • gitleaks, osv, semgrep, e **rls — che in P4 NON è ereditato**: le tabelle NUOVE
     site_publications e assets + il bucket Storage vanno riconquistati e provati A RUNTIME
     attraverso il client con auth reale su Supabase locale, mai nell'SQL editor. In particolare
     la RLS PUBBLICA (T-407): il client ANON legge il pubblicato, NON il non-pubblicato né di
     altri tenant, e le colonne private (account_id, source_generation_id) NON sono esposte;
   • **arch_check** (repo-wide, P3-D7 + AH-D6): il contratto architecture: è attivo; dichiara il
     suo esito e che nessuna regola forbidden è vacua (vacuity guard) — serving in src/app,
     logica pura in src/domain, sharp/accesso-dati in src/data;
   • per seo-base: che l'escaping del **JSON-LD** (< > & U+2028/2029) è provato con brief ostile
     (anti-breakout dal tag script, T-410);
   • per media-storage: che il **re-encode è provato sull'EFFETTO** (payload ostili → raster
     pulito o rifiuto, EXIF strippato, SVG rifiutato — T-413) e che l'URL asset è costruito da
     asset_id, mai da testo libero (T-414);
   • la baseline d'IGIENE: se è cambiata, l'ATTRIBUZIONE delle duplicazioni (quali sono tue, quali
     preesistenti, quali churn di posizione — R-04) PRIMA di qualunque ricattura (nuove dir:
     src/app/s, src/data media, e2e);
   • se il macrotask è e2e-public: che il CANARY fa fallire assertNoInjectionEffect sulla ROTTA
     PUBBLICA /s/<slug> con documento ostile + ASSET CARICATO (T-417). Senza quella prova, il
     verde dell'end-to-end non significa nulla.

2) AGGIORNA docs/blueprint/P4-publish/SESSION-STATE.md (fonte di verità):
   • Macrotask fatti / in corso / da fare: publish-core → public-serving → seo-base;
     media-storage → media-editor-render; e2e-public.
   • Baseline e budget consumato (§4).
   • Per ogni task chiuso: id, output prodotto, quale oracolo/test ha prodotto il verde.
   • §6 COPERTURA DICHIARATA: aggiorna cosa è ora verificato e cosa resta NON coperto. Le voci
     che nascono aperte (RLS pubblica a runtime, effetto del re-encode, e2e solo Chromium, CI mai
     girata) si chiudono solo con un fatto, non col passare delle sessioni.
   • §7 CARRY-OVER: sposta fra CHIUSI e APERTI solo ciò che un oracolo ha davvero chiuso.

3) REGISTRA LO STATO GIT (git a strati):
   • Branch di lavoro e commit (con id del task + esito del gate).
   • Stato del merge su main: avvenuto SOLO se il checkpoint è verde E il deploy-coupling lo
     consente; altrimenti SOSPESO.
   • DEPLOY-COUPLING = coupled (CONFERMATO in P3, valido in P4): P4 apre una ROTTA PUBBLICA
     /s/<slug>, tabelle nuove e un bucket Storage. Il merge di ogni macrotask resta HUMAN-GATED
     anche sul verde; deploy non supervisionato BLOCCATO. Registra se è stato riconfermato in
     questa sessione.

4) VERIFICA-FIX RIVERIFICATA
   Per ogni fix applicata, conferma che è stata riverificata con lo STESSO oracolo e con i test,
   e che le rimozioni di dead-code sono passate dall'umano. Registra anche l'esito della batteria
   di mutazione: quante mutazioni, quante uccise, quante sopravvissute, e se il ripristino è stato
   verificato con l'hash. Una mutazione SOPRAVVISSUTA è un buco d'oracolo, non un dettaglio.

5) FRAMING ONESTO
   Usa "trovato e verificata la correzione di X" / "questi controlli sono passati", MAI "P4 è
   sicuro/pronto". Dichiara sempre la COPERTURA. In particolare, per P4:
   • la RLS pubblica è provata a RUNTIME sul client anon (pubblicato sì / non-pubblicato/altrui
     no), non dedotta dallo schema; le colonne private non esposte sono verificate sulla SELECT
     reale;
   • la difesa dell'upload è il RE-ENCODE, provato sull'EFFETTO (raster pulito / rifiuto), non
     una CSP né la fiducia nel content-type dichiarato dal client;
   • l'assenza di effetto dell'iniezione sulla rotta pubblica è su Chromium (non tutti i browser)
     e non percorre login/onboarding (cookie iniettati, seed via service_role nei test);
   • gli invarianti del documento (home-unica, ≤8 MiB, slug unici) sono provati sul percorso di
     scrittura reale (parseDocument in publish), non solo sullo schema;
   • il serving è dall'app Next.js path-based: R2/sottodomini/domini custom NON esistono ancora
     (pass hosting dedicato, P4-D1); il badge "Made with Belora" è presente (rimozione = P5).

Produci: (a) il riepilogo dei punti 1, 3, 4 e 5; (b) il DIFF preciso che applicherai a
SESSION-STATE.md. Applicalo solo dopo la mia conferma.
```
