# 06-sites — Macrotask `sites` · Entita "sito" & scheletro dashboard

> Modulo del blueprint P0 (fondamenta) di Belora. Un modulo = un macrotask:
> l'unita al cui confine gira il checkpoint e l'unita di commit atomico.
> Task atomici secondo lo schema trueline (id/AC/target_tests/security_notes).

## Obiettivo del macrotask

Entita sites minima account-scoped con RLS, server actions crea/elenca/rinomina/elimina e scheletro dashboard localizzato. Segnaposto: nessuna generazione AI (quella e P2).

## Task atomici

```yaml
- id: T-100
  title: "Schema sites + RLS + unicità slug"
  macrotask: "sites"
  depends_on: [T-060]
  objective: "Creare la migrazione SQL che definisce la tabella account-scoped `public.sites` esattamente come da contratto di naming (id, account_id, name, slug, status, created_at), con RLS abilitata e policy per SELECT/INSERT/UPDATE/DELETE basate sull'appartenenza all'account tramite public.is_account_member(account_id), più il vincolo di unicità (account_id, slug), il check su status e un indice sulla colonna di policy account_id. È lo strato dati minimo del segnaposto sito: nessuna logica applicativa, solo schema e sicurezza a livello Postgres."
  definition_of_done:
    - "File supabase/migrations/<timestamp>_sites.sql presente e applicabile su Supabase locale senza errori"
    - "Tabella public.sites creata con le colonne e i tipi esatti del contratto: id uuid pk default gen_random_uuid(), account_id uuid not null references accounts on delete cascade, name text not null, slug text not null, status text not null default 'draft', created_at timestamptz default now()"
    - "RLS abilitata su public.sites (alter table ... enable row level security)"
    - "Quattro policy (SELECT, INSERT, UPDATE, DELETE) TO authenticated che usano is_account_member(account_id) in USING e/o WITH CHECK; nessuna con USING(true)/WITH CHECK(true)"
    - "Vincolo UNIQUE(account_id, slug) e CHECK (status in ('draft','published'))"
    - "Indice btree su sites(account_id)"
  acceptance_criteria:
    - id: AC-100-1
      given: "la migrazione sites applicata su un'istanza Supabase locale"
      when: "interrogo il catalogo pg_class (relrowsecurity) per la relazione public.sites"
      then: "relrowsecurity = true per public.sites (RLS abilitata nel catalogo)"
    - id: AC-100-2
      given: "lo schema applicato"
      when: "interrogo information_schema.columns per public.sites"
      then: "esistono esattamente le colonne id, account_id, name, slug, status, created_at con name NOT NULL, slug NOT NULL, status NOT NULL default 'draft' e account_id NOT NULL"
    - id: AC-100-3
      given: "una riga sites nell'account X con slug='pizzeria'"
      when: "inserisco nell'account X una seconda riga con slug='pizzeria'"
      then: "l'INSERT fallisce con violazione del vincolo unique (SQLSTATE 23505)"
    - id: AC-100-4
      given: "il catalogo pg_policies per public.sites"
      when: "elenco le policy della tabella"
      then: "esistono policy per i comandi SELECT, INSERT, UPDATE e DELETE, tutte con roles = {authenticated}, e nessuna espressione qual/with_check è la costante true"
    - id: AC-100-5
      given: "lo schema applicato"
      when: "inserisco una riga con status='archived' (valore non ammesso)"
      then: "l'INSERT fallisce per violazione del check constraint su status (SQLSTATE 23514)"
    - id: AC-100-6
      given: "una riga sites nell'account X con slug='pizzeria'"
      when: "inserisco una riga con slug='pizzeria' in un account Y diverso"
      then: "l'INSERT ha successo (l'unicita e per-account: due account possono avere lo stesso slug), evitando la fuga/enumerazione cross-tenant"
  target_tests:
    - file: "tests/sites-schema.test.ts"
      covers: [AC-100-1, AC-100-2, AC-100-3, AC-100-4, AC-100-5, AC-100-6]
  security_notes:
    - "R1: RLS abilitata su public.sites (tabella dello schema public)."
    - "R2: almeno una policy per tabella — qui una per ciascun comando."
    - "R3: nessuna policy con USING(true)/WITH CHECK(true) né 'auth.uid() IS NOT NULL' come sola condizione (verificato in AC-100-4)."
    - "R4: policy vincolate al tenant tramite appartenenza account (is_account_member(account_id)), non a semplice autenticazione."
    - "R5: clausola TO authenticated su tutte le policy."
    - "R6: la policy UPDATE è accompagnata dalla policy SELECT sulla stessa tabella."
    - "R9: helper is_account_member usa (select auth.uid()) per la cache e la colonna di policy account_id è indicizzata."
    - "OWASP A01:2025 (broken access control / RLS-authz): l'isolamento cross-tenant è imposto a livello DB dalle policy."
    - "OWASP A01:2025 (no cross-tenant enumeration): l'unicita dello slug e per-account (UNIQUE(account_id, slug)); due account possono usare lo stesso slug, evitando che un fallimento di unique cross-account riveli l'esistenza di uno slug in un altro tenant."
  out_of_scope:
    - "Generazione AI dei siti (P2)"
    - "Pubblicazione/hosting dei siti (P4)"
    - "Colonne di contenuto/tema del sito oltre al segnaposto minimo"

- id: T-101
  title: "Server actions create/list sites"
  macrotask: "sites"
  depends_on: [T-100, T-041, T-104, T-005, T-062]
  objective: "Implementare le server action createSite e listSites per il segnaposto sito, eseguite solo server-side, che usano il client Supabase legato alla sessione autenticata (RLS attiva) e NON la service_role. createSite valida il name lato server, risolve l'account_id dall'appartenenza dell'utente autenticato (auth.uid()) invece di fidarsi di un account_id arbitrario dal client, genera uno slug unico tramite l'utility di T-104 e inserisce la riga; listSites restituisce i soli siti dell'account dell'utente. Nessuna generazione AI: si crea/elenca un record vuoto."
  definition_of_done:
    - "Modulo server-side (es. src/data/sites.ts) con createSite(input) e listSites() invocabili solo dal server"
    - "createSite valida name server-side (non vuoto/non solo spazi, entro lunghezza massima) e rifiuta input invalido senza inserire"
    - "createSite deriva l'account_id dall'appartenenza dell'utente autenticato (account_members), non da input client arbitrario"
    - "createSite usa generateUniqueSlug (T-104) con un predicato exists che interroga sites via metodi tipati e inserisce con status di default 'draft'"
    - "listSites usa il client server con sessione (RLS) e metodi tipati .eq/.select — nessuna interpolazione in .or()/.filter()"
    - "Le azioni non importano né usano la service_role key per la CRUD tenant"
  acceptance_criteria:
    - id: AC-101-1
      given: "l'utente A autenticato, membro owner dell'account X"
      when: "chiama createSite con name='Bar Sole'"
      then: "viene inserita una riga in sites con account_id=X, status='draft', slug non nullo, e l'azione ritorna l'id del sito creato"
    - id: AC-101-2
      given: "l'utente A con 2 siti nell'account X e l'utente B con 1 sito nell'account Y"
      when: "A (autenticato) chiama listSites"
      then: "il risultato contiene esattamente i 2 siti dell'account X e nessun sito dell'account Y"
    - id: AC-101-3
      given: "l'utente A autenticato"
      when: "chiama createSite con name=' ' (solo spazi)"
      then: "l'azione rifiuta con errore di validazione e il conteggio delle righe in sites resta invariato"
    - id: AC-101-4
      given: "l'utente A autenticato"
      when: "chiama createSite due volte con lo stesso name='Pizzeria' nello stesso account"
      then: "vengono creati due siti con slug distinti (es. 'pizzeria' e 'pizzeria-2') senza violazione del vincolo unique"
    - id: AC-101-5
      given: "l'utente A autenticato che NON è membro dell'account Y"
      when: "forza createSite con un account_id=Y"
      then: "l'operazione è rifiutata (dalla derivazione server-side dell'account e/o dalla WITH CHECK RLS) e nessuna riga con account_id=Y viene creata"
    - id: AC-101-6
      given: "nessuna sessione autenticata"
      when: "si invoca createSite o listSites"
      then: "l'azione fallisce con errore di autenticazione e non viene scritta né restituita alcuna riga"
  target_tests:
    - file: "tests/sites-actions.test.ts"
      covers: [AC-101-1, AC-101-2, AC-101-3, AC-101-4, AC-101-5, AC-101-6]
  security_notes:
    - "R1/R4: l'isolamento cross-tenant di listSites/createSite si appoggia alla RLS di sites (appartenenza account), non al codice applicativo da solo (verificato in AC-101-2 e AC-101-5 con client ad auth reale su Supabase locale)."
    - "R7: la service_role bypassa la RLS ed è confinata server-side; qui la CRUD tenant usa deliberatamente il client con sessione utente perché la RLS resti attiva; se un handler usasse la service_role dovrebbe fare authz esplicita."
    - "OWASP A01:2025: controllo d'accesso — l'account_id è derivato dall'identità (auth.uid()/account_members) e mai fidato dal client (validazione identità sempre server-side)."
    - "OWASP A05:2025 (injection, incl. PostgREST filter injection): si usano solo metodi tipati .eq()/.insert()/.select(), mai .or()/.filter() con input interpolato."
    - "OWASP A07:2025/A02:2025 (segreti): anon key da NEXT_PUBLIC_SUPABASE_ANON_KEY, service_role solo da env server; nessun segreto hardcoded."
  out_of_scope:
    - "Rinomina/eliminazione (T-103)"
    - "UI dashboard (T-102)"
    - "Generazione AI e temi (P2)"

- id: T-102
  title: "Scheletro dashboard (elenco + crea sito)"
  macrotask: "sites"
  depends_on: [T-101, T-022, T-081]
  objective: "Realizzare la pagina dashboard autenticata e localizzata (/it e /es) che elenca i siti dell'account dell'utente tramite listSites e permette di crearne uno tramite createSite, montata dentro AppShell e costruita con le primitive del design system interno (T-021, via AppShell T-022) e le stringhe next-intl (T-081). La rotta è protetta: un utente non autenticato viene reindirizzato al login. È solo lo scheletro segnaposto: nessun editor, nessuna generazione."
  definition_of_done:
    - "Rotta localizzata src/app/[locale]/dashboard/page.tsx resa dentro AppShell"
    - "La pagina è protetta: senza sessione autenticata reindirizza alla pagina di login"
    - "Elenco dei siti dell'account (name + status) ottenuto tramite listSites"
    - "Form/azione 'crea sito' che invoca createSite e, dopo il refresh, mostra il nuovo sito nell'elenco"
    - "Tutte le stringhe UI (titolo, bottone crea, stato vuoto) provengono da chiavi next-intl con traduzioni presenti sia in it sia in es"
    - "Stato vuoto esplicito quando l'account non ha siti"
  acceptance_criteria:
    - id: AC-102-1
      given: "un utente autenticato senza siti"
      when: "apre /it/dashboard"
      then: "la pagina risponde 200 e rende lo stato vuoto localizzato (testo dalla chiave i18n dell'empty state, in italiano)"
    - id: AC-102-2
      given: "un utente autenticato con N siti nel proprio account"
      when: "apre la dashboard"
      then: "vengono resi esattamente N elementi di lista, ciascuno con il name del sito corrispondente"
    - id: AC-102-3
      given: "nessuna sessione autenticata"
      when: "si richiede /it/dashboard"
      then: "la risposta è un redirect alla rotta di login e il contenuto della dashboard non viene reso"
    - id: AC-102-4
      given: "un utente autenticato sul form crea-sito"
      when: "invia un name valido e la pagina viene ricaricata"
      then: "createSite è stata invocata e il nuovo sito appare nell'elenco della dashboard"
    - id: AC-102-5
      given: "un utente autenticato con locale 'es'"
      when: "apre /es/dashboard"
      then: "titolo, etichetta del bottone 'crea' ed empty state sono resi in spagnolo dalle chiavi i18n (testo diverso dalla versione italiana)"
  target_tests:
    - file: "tests/dashboard-sites.test.tsx"
      covers: [AC-102-1, AC-102-2, AC-102-3, AC-102-4, AC-102-5]
  security_notes:
    - "OWASP A01:2025: la rotta dashboard è protetta lato server e reindirizza al login in assenza di sessione (verificato in AC-102-3); l'autorizzazione non è affidata al solo nascondere elementi UI."
    - "R7: la service_role non è mai esposta al browser; la pagina legge/scrive tramite listSites/createSite (client con sessione, RLS attiva) e non incorpora chiavi privilegiate."
    - "Validazione input sempre server-side: la creazione passa da createSite (T-101), che ri-valida name e deriva l'account dall'identità; la UI non è l'unico gate."
    - "OWASP A07:2025/A02:2025 (segreti): nel browser solo NEXT_PUBLIC_SUPABASE_ANON_KEY; nessun segreto hardcoded."
  out_of_scope:
    - "Rinomina/eliminazione dei siti (T-103)"
    - "Editor e generazione AI (P2/P3)"
    - "Pubblicazione (P4)"

- id: T-103
  title: "Rinomina/elimina sito"
  macrotask: "sites"
  depends_on: [T-101, T-005]
  objective: "Aggiungere le server action renameSite e deleteSite (eseguite server-side, client con sessione e RLS attiva, non service_role): rinomina con name validato server-side ed eliminazione. Grazie alla RLS di sites, un utente puo modificare/eliminare solo i siti del proprio account; i tentativi cross-tenant non hanno effetto. I controlli UI sono in T-105. Segnaposto: si opera sul record, nessuna logica di contenuto/AI."
  definition_of_done:
    - "Server action renameSite(siteId, newName) che valida newName server-side e aggiorna sites via .update().eq(), efficace solo sui siti dell'account dell'utente (RLS)"
    - "Server action deleteSite(siteId) che elimina via .delete().eq(), efficace solo sui siti dell'account dell'utente (RLS)"
    - "Le azioni usano il client server con sessione (RLS attiva) e metodi tipati .eq/.update/.delete — nessuna interpolazione in .or()/.filter()"
  acceptance_criteria:
    - id: AC-103-1
      given: "l'utente A autenticato, proprietario del sito S"
      when: "chiama renameSite(S, 'Nuovo Nome') con name valido"
      then: "la riga S ha name='Nuovo Nome' e l'azione ritorna successo"
    - id: AC-103-2
      given: "l'utente A proprietario del sito S"
      when: "chiama renameSite(S, ' ') con name solo spazi"
      then: "l'azione rifiuta con errore di validazione e il name di S resta invariato"
    - id: AC-103-3
      given: "l'utente A proprietario del sito S"
      when: "chiama deleteSite(S)"
      then: "una SELECT su S restituisce insieme vuoto (la riga non esiste più)"
    - id: AC-103-4
      given: "l'utente B autenticato, non membro dell'account di A, e il sito S di A"
      when: "B chiama renameSite(S, 'Hack') e deleteSite(S)"
      then: "nessuna riga è modificata o eliminata (per la RLS): S esiste ancora con il name originale"
  target_tests:
    - file: "tests/sites-mutations.test.ts"
      covers: [AC-103-1, AC-103-2, AC-103-3, AC-103-4]
  security_notes:
    - "R1/R4: UPDATE e DELETE sono isolati per tenant dalla RLS di sites (is_account_member(account_id)); il diniego cross-tenant è verificato con client ad auth reale (AC-103-4), non nell'SQL editor (che gira come superuser e darebbe falso verde)."
    - "R6: la policy UPDATE di sites è accompagnata dalla policy SELECT (definite in T-100)."
    - "R7: nessuna service_role per la CRUD tenant; se usata, richiederebbe authz esplicita server-side."
    - "OWASP A01:2025: controllo d'accesso cross-tenant su rinomina/eliminazione."
    - "OWASP A05:2025 (injection, incl. PostgREST filter injection): solo metodi tipati .eq()/.update()/.delete(), mai .or()/.filter() con input interpolato."
    - "Validazione input sempre server-side: newName ri-validato nel server, non fidandosi del client."
  out_of_scope:
    - "Undo/cestino o soft-delete"
    - "Rinomina dello slug pubblico (fuori dal segnaposto V1)"
    - "Generazione AI e pubblicazione (P2/P4)"

- id: T-104
  title: "Utility di generazione slug unico (dominio)"
  macrotask: "sites"
  depends_on: [T-001, T-003]
  objective: "Isolare in src/domain una funzione pura, indipendente dal database, che trasforma il name di un'attività in uno slug URL-safe (minuscolo, diacritici IT/ES rimossi, spazi in trattini, solo caratteri [a-z0-9-], troncamento) e una strategia di unicità che, dato un predicato exists(slug), restituisce il primo slug libero aggiungendo un suffisso. Rende T-101 atomico e testabile a unità senza toccare Postgres, e garantisce che lo slug sia un identificatore sanitizzato prima di finire in query/URL."
  definition_of_done:
    - "Modulo src/domain/sites/slug.ts con export slugify(name: string): string e generateUniqueSlug(name: string, exists: (slug: string) => Promise<boolean> | boolean): Promise<string>"
    - "slugify normalizza i diacritici (à→a, é→e, ñ→n, ç→c…), converte spazi/underscore in trattini, forza minuscolo e rimuove ogni carattere fuori da [a-z0-9-], collassando trattini multipli"
    - "slugify produce un fallback non vuoto per name vuoto/degenerato e tronca a una lunghezza massima definita senza terminare con un trattino"
    - "generateUniqueSlug interroga il predicato exists e restituisce lo slug base se libero, altrimenti base-2, base-3, … fino al primo libero"
  acceptance_criteria:
    - id: AC-104-1
      given: "il name 'Trattoria Málaga & Niño'"
      when: "chiamo slugify(name)"
      then: "ritorna la stringa 'trattoria-malaga-nino'"
    - id: AC-104-2
      given: "il name ' ' (soli spazi) oppure la stringa vuota"
      when: "chiamo slugify(name)"
      then: "ritorna uno slug fallback non vuoto composto solo da [a-z0-9-] (mai la stringa vuota)"
    - id: AC-104-3
      given: "un predicato exists che ritorna true per 'pizzeria' e 'pizzeria-2' e false per 'pizzeria-3'"
      when: "chiamo generateUniqueSlug('Pizzeria', exists)"
      then: "ritorna 'pizzeria-3'"
    - id: AC-104-4
      given: "un name la cui slugificazione supera la lunghezza massima definita"
      when: "chiamo slugify(name)"
      then: "l'output ha lunghezza minore o uguale al massimo definito e non termina con il carattere '-'"
  target_tests:
    - file: "tests/slug.test.ts"
      covers: [AC-104-1, AC-104-2, AC-104-3, AC-104-4]
  security_notes:
    - "OWASP A05:2025 (injection / output encoding): lo slug è un identificatore usato in URL e in filtri di query, quindi slugify restringe l'output al solo set [a-z0-9-], eliminando alla fonte caratteri che potrebbero abilitare path/filter injection a valle."
  out_of_scope:
    - "Accesso al database o al client Supabase (il predicato exists è iniettato dal chiamante)"
    - "Persistenza dello slug"

- id: T-105
  title: "Controlli UI rinomina/elimina sito (dashboard)"
  macrotask: "sites"
  depends_on: [T-103, T-102]
  objective: "Aggiungere alla dashboard i controlli UI per rinominare ed eliminare un sito, collegati alle server action renameSite/deleteSite (T-103). La rinomina usa un campo controllato e localizzato; l'eliminazione richiede una conferma esplicita dell'utente prima di invocare deleteSite. Livello UI puro: nessuna logica dati (delegata a T-103)."
  definition_of_done:
    - "Controllo UI di rinomina nella dashboard collegato alla server action renameSite (T-103)"
    - "Controllo UI di eliminazione che richiede una conferma esplicita prima di invocare deleteSite (T-103)"
    - "Le stringhe (rinomina, elimina, conferma) provengono da chiavi next-intl presenti sia in it sia in es"
    - "File di test tests/dashboard-sites-actions.test.tsx eseguibile con vitest"
  acceptance_criteria:
    - id: AC-105-1
      given: "la UI dashboard con l'azione di eliminazione"
      when: "l'utente attiva l'eliminazione di un sito"
      then: "e richiesta una conferma esplicita e deleteSite NON viene invocata finche la conferma non e accettata"
    - id: AC-105-2
      given: "la UI di rinomina con un name valido"
      when: "l'utente conferma la rinomina"
      then: "renameSite viene invocata con il nuovo name e, dopo il refresh, l'elenco della dashboard mostra il name aggiornato"
    - id: AC-105-3
      given: "la dashboard resa in locale es"
      when: "si ispezionano i controlli rinomina/elimina/conferma"
      then: "le etichette sono in spagnolo (chiavi i18n diverse dalla versione it)"
  target_tests:
    - file: "tests/dashboard-sites-actions.test.tsx"
      covers: [AC-105-1, AC-105-2, AC-105-3]
  security_notes:
    - "OWASP A01:2025: i controlli UI non sono il gate di sicurezza; l'autorizzazione cross-tenant e imposta dalla RLS nelle server action di T-103."
    - "Validazione input server-side: la UI invia il name ma la validazione autoritativa avviene in renameSite (T-103)."
  out_of_scope:
    - "Server action renameSite/deleteSite e RLS (T-103)"
    - "Undo/cestino o soft-delete"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir del blueprint — atteso exit 0.
- **Semantico** (checklist guidata): punti 6–10 su ogni task; i rilievi vanno all'human-in-the-loop.
