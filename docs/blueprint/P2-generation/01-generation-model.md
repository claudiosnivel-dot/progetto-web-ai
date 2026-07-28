# 01-generation-model — Macrotask `generation-model` · I contratti (dati + schemi + persistenza)

> Modulo del blueprint P2 (Generazione dei mockup) di Belora. Un modulo = un macrotask:
> l'unita al cui confine gira il checkpoint e l'unita di commit atomico.
> Task atomici secondo lo schema trueline (id/AC/target_tests/security_notes).
>
> **Substrato P0+P1 (gia costruito, non nel DAG P2 — `P2-D18`):** tenancy
> `accounts`/`account_members`/`profiles`, helper `public.is_account_member(account_id)`,
> entita `sites` account-scoped con RLS (T-100) e il vincolo `sites_account_id_id_key`
> su `(account_id, id)` introdotto da T-120, entita `site_briefs` 1:1 col sito con la sua
> RLS provata a runtime, schema di dominio del Brief `src/domain/onboarding/brief.ts`
> (T-121/T-122) coi tetti di `P1-D17`, server action `getBrief` (T-123), client Supabase a
> tre livelli e utility di test ad auth reale su Supabase locale (T-005).
> I `depends_on` qui sotto referenziano solo task P2.

## Obiettivo del macrotask

I **contratti** su cui poggia tutto P2: le due entita account-scoped
(`site_generations` 1:N col sito, `generation_pools` con l'ambito e la variante), il
**vocabolario degli slot** di contenuto con `PoolSchema` — il gate che valida l'uscita
del modello prima di ogni scrittura —, il **`SiteDocumentSchema` multi-pagina** che e
l'artefatto congelato consegnato a P3, e le server action che li persistono attraverso il
client con sessione (RLS attiva), con la riconciliazione dello stato che impedisce a una
generazione morta di bloccare il sito per sempre.

## Task atomici

```yaml
- id: T-200
  title: "Schema site_generations + generation_pools + RLS + vincoli"
  macrotask: "generation-model"
  depends_on: []
  objective: >
    Creare la migrazione SQL che definisce due tabelle account-scoped.
    public.site_generations: 1:N con un sito (piu generazioni nel tempo), con status
    (generating/ready/chosen/complete/failed), chosen_variant smallint null CHECK 0..4,
    document jsonb null, max_pages smallint not null, failure_reason text null. La
    coerenza site<->account e imposta da una FK COMPOSITA (account_id, site_id) verso
    public.sites (account_id, id), non da una FK indipendente su site_id.
    public.generation_pools: figlia di site_generations, con scope (home/inner),
    variant_index smallint null (NULL = pool condiviso, 0..4 = copy-on-write) e content
    jsonb not null, con UNIQUE(generation_id, scope, variant_index). Piu un indice UNIQUE
    PARZIALE su site_generations(site_id) WHERE status='generating', che rende
    irrappresentabile la doppia generazione in volo. RLS abilitata su entrambe con quattro
    policy TO authenticated ancorate a public.is_account_member(account_id), e indici sulle
    colonne di policy. Solo schema e sicurezza a livello Postgres.
  definition_of_done:
    - "File supabase/migrations/<timestamp>_site_generations.sql presente e applicabile su Supabase locale senza errori"
    - "Tabella public.site_generations con: id uuid pk default gen_random_uuid(); account_id uuid not null references accounts on delete cascade; site_id uuid not null; status text not null default 'generating'; chosen_variant smallint; document jsonb; max_pages smallint not null; failure_reason text; created_at timestamptz default now(); updated_at timestamptz default now()"
    - "Vincolo FK COMPOSITO su site_generations: foreign key (account_id, site_id) references public.sites (account_id, id) on delete cascade"
    - "EMENDAMENTO 2026-07-28 (P2-D19): vincolo UNIQUE (account_id, id) su site_generations — e la chiave che rende referenziabile la coppia (account, generazione) dalla FK composita di generation_pools, come sites_account_id_id_key lo e per (account, sito)"
    - "CHECK (status in ('generating','ready','chosen','complete','failed')); CHECK (chosen_variant is null or (chosen_variant >= 0 and chosen_variant <= 4)); CHECK (max_pages >= 1)"
    - "Tabella public.generation_pools con: id uuid pk; account_id uuid not null references accounts on delete cascade; generation_id uuid not null; scope text not null; variant_index smallint; content jsonb not null; created_at timestamptz default now()"
    - "EMENDAMENTO 2026-07-28 (P2-D19): la FK di generation_pools verso la generazione e COMPOSITA — foreign key (account_id, generation_id) references public.site_generations (account_id, id) on delete cascade — e SOSTITUISCE la FK semplice su generation_id. La versione semplice lasciava scrivibile la coppia discorde (account_id proprio + generation_id altrui), verificata a runtime come ruolo authenticated"
    - "CHECK (scope in ('home','inner')); CHECK (variant_index is null or (variant_index >= 0 and variant_index <= 4)); UNIQUE (generation_id, scope, variant_index)"
    - "Indice UNIQUE PARZIALE: create unique index ... on public.site_generations (site_id) where status = 'generating'"
    - "RLS abilitata su entrambe le tabelle, con quattro policy (SELECT/INSERT/UPDATE/DELETE) TO authenticated che usano is_account_member(account_id); nessuna con USING(true)/WITH CHECK(true)"
    - "Indici btree su site_generations(account_id), site_generations(site_id), generation_pools(account_id), generation_pools(generation_id)"
    - "EMENDAMENTO 2026-07-28 (P2-D22): created_at e updated_at di site_generations sono NOT NULL (oltre al default now()). Sono il riferimento temporale su cui poggia la riconciliazione di T-203: con entrambe NULL una riga 'generating' non e mai stantia e blocca il sito PER SEMPRE attraverso l'indice UNIQUE parziale — il guasto esatto che P2-D15 esiste per impedire. Lo stato va reso IRRAPPRESENTABILE, non gestito nel codice che legge"
    - "GRANT espliciti select/insert/update/delete a authenticated e service_role su entrambe; nessun GRANT ad anon — EMENDAMENTO 2026-07-28 (P2-D19): non basta ASTENERSI dal concedere, perche le default privileges della piattaforma Supabase concedono comunque REFERENCES/TRIGGER/TRUNCATE ad anon su ogni nuova tabella di public. Serve un REVOKE ALL esplicito da anon su entrambe le tabelle, e l'asserzione e che anon abbia ZERO privilegi (non zero DML)"
  acceptance_criteria:
    - id: AC-200-1
      given: "la migrazione applicata su un'istanza Supabase locale"
      when: "interrogo il catalogo pg_class (relrowsecurity) per public.site_generations e public.generation_pools"
      then: "relrowsecurity = true per entrambe le relazioni"
    - id: AC-200-2
      given: "lo schema applicato"
      when: "interrogo information_schema.columns per le due tabelle"
      then: "esistono tutte le colonne dichiarate nella definition_of_done, con account_id NOT NULL, site_id NOT NULL, status NOT NULL default 'generating', max_pages NOT NULL e — EMENDAMENTO P2-D22 — created_at e updated_at NOT NULL su site_generations, e generation_id NOT NULL, scope NOT NULL, content NOT NULL su generation_pools"
    - id: AC-200-3
      given: "il sito S appartenente all'account X, e un account Y diverso"
      when: "inserisco una riga site_generations con account_id=Y e site_id=S (site-squatting cross-tenant)"
      then: "l'INSERT fallisce con violazione di foreign key (SQLSTATE 23503) grazie alla FK composita, indipendentemente dalla RLS"
    - id: AC-200-4
      given: "il catalogo pg_policies per le due tabelle"
      when: "elenco le policy"
      then: "per ciascuna tabella esistono policy per SELECT, INSERT, UPDATE e DELETE, tutte con roles = {authenticated}, e nessuna espressione qual/with_check e la costante true"
    - id: AC-200-5
      given: "lo schema applicato e una riga site_generations con status='generating' per il sito S"
      when: "inserisco una seconda riga site_generations con site_id=S e status='generating'"
      then: "l'INSERT fallisce per violazione del vincolo unique (SQLSTATE 23505); mentre una seconda riga con status='failed' per lo stesso sito viene accettata"
    - id: AC-200-6
      given: "una riga generation_pools con (generation_id=G, scope='home', variant_index=NULL)"
      when: "inserisco una seconda riga con gli stessi tre valori"
      then: "l'INSERT fallisce con violazione unique (SQLSTATE 23505); una riga con scope='inner' o variant_index=2 sulla stessa generazione viene accettata"
    - id: AC-200-7
      given: "lo schema applicato"
      when: "inserisco site_generations con status='queued' (valore non ammesso) e, in una seconda prova, chosen_variant=5"
      then: "entrambi gli INSERT falliscono per violazione di check constraint (SQLSTATE 23514)"
    - id: AC-200-8
      given: "l'utente A membro dell'account X (proprietario del sito S) con una generazione, e l'utente B membro del solo account Y, entrambi con client ad auth reale"
      when: "B tenta SELECT e INSERT su site_generations e generation_pools della generazione di S attraverso il client con la propria sessione"
      then: "le SELECT restituiscono insieme vuoto e gli INSERT non scrivono alcuna riga (la RLS isola per tenant), verificato attraverso il client e non nell'SQL editor"
    - id: AC-200-9
      given: "la generazione G dell'account X, e l'account Y diverso (EMENDAMENTO P2-D19)"
      when: "inserisco in generation_pools la coppia DISCORDE account_id=Y con generation_id=G, sia attraverso il client con la sessione di un membro di Y sia con la RLS bypassata"
      then: "in entrambi i casi l'INSERT fallisce per violazione di foreign key (SQLSTATE 23503) grazie alla FK composita, mentre la coppia COERENTE account_id=X con generation_id=G viene accettata"
    - id: AC-200-10
      given: "lo schema applicato (EMENDAMENTO P2-D19)"
      when: "interrogo information_schema.role_table_grants per le due tabelle nuove"
      then: "il ruolo anon non detiene ALCUN privilegio su nessuna delle due (insieme vuoto, non solo assenza dei quattro DML), mentre authenticated e service_role hanno esattamente select/insert/update/delete"
  target_tests:
    - file: "tests/site-generations-schema.test.ts"
      covers: [AC-200-1, AC-200-2, AC-200-3, AC-200-4, AC-200-5, AC-200-6, AC-200-7, AC-200-8, AC-200-9, AC-200-10]
  security_notes:
    - "R1: RLS abilitata su entrambe le tabelle dello schema public (user-facing)."
    - "R2: almeno una policy per tabella — qui una per ciascun comando, su entrambe."
    - "R3: nessuna policy con USING(true)/WITH CHECK(true) ne 'auth.uid() IS NOT NULL' come sola condizione (verificato in AC-200-4)."
    - "R4: policy vincolate al tenant tramite appartenenza account (is_account_member(account_id)), non a semplice autenticazione (verificato a runtime in AC-200-8 con client ad auth reale)."
    - "R5: clausola TO authenticated su tutte le policy."
    - "R6: la policy UPDATE e accompagnata dalla policy SELECT sulla stessa tabella."
    - "R7: nessun GRANT ad anon; service_role bypassa la RLS ed e confinata server-side."
    - "R9: le colonne di policy account_id sono indicizzate su entrambe le tabelle; generation_id e site_id indicizzati per i filtri."
    - "OWASP A01:2025 (broken access control / RLS-authz): l'isolamento cross-tenant e imposto a livello DB; P2 introduce superficie DB NUOVA, quindi rls:0 va riconquistato e non ereditato da P1."
    - "Difesa in profondita oltre la RLS: la FK COMPOSITA (account_id, site_id) impedisce di ancorare una generazione al sito di un altro tenant anche via chiamata PostgREST diretta (AC-200-3) — stessa lezione di T-120."
    - "EMENDAMENTO P2-D19 (rilievo F-01 della verifica avversariale, riprodotto dall'orchestratore come ruolo authenticated): la stessa difesa serve un livello piu sotto. Con la FK SEMPLICE su generation_id, la WITH CHECK della policy INSERT guarda solo account_id e la FK chiede solo che la generazione ESISTA: un membro di Y poteva scrivere (account_id=Y, generation_id=generazione di X) e, occupando lo slot UNIQUE (generation_id, scope, variant_index), impedire a X di scrivere il proprio pool. Non e una fuga di dati (X non vede quella riga, che ha account_id=Y) e richiede di conoscere l'uuid della generazione altrui, che la RLS non espone: e un buco di autorizzazione in profondita, chiuso dalla FK composita (AC-200-9)."
    - "Trappola del test: R4 verificata attraverso il client con auth reale su Supabase locale (l'SQL editor gira come superuser e darebbe falso verde)."
  out_of_scope:
    - "Server action di lettura/scrittura (T-203)"
    - "Schema applicativo del pool e del documento (T-201, T-202)"
    - "Hosting dei file media (P4): lo slot immagine di v1 non porta alcun URL"

- id: T-201
  title: "Vocabolario degli slot + PoolSchema + POOL_LIMITS"
  macrotask: "generation-model"
  depends_on: []
  objective: >
    Isolare in src/domain/generation/slots.ts il vocabolario degli slot di contenuto
    (id stabile, ruolo di pagina a cui appartiene, e kind fra 'text' | 'list' | 'qa') e in
    src/domain/generation/pool.ts lo schema zod del pool con i tetti in costanti nominate
    POOL_LIMITS. Il pool e la forma dell'uscita del modello: una mappa pagina -> slot ->
    valore, dove il valore rispetta il kind dello slot. E' il gate che valida l'output del
    modello (input NON FIDATO) prima di qualunque scrittura, ed e strict: nessuno slug di
    pagina fuori dall'allowlist passata al parse, nessuno slot id sconosciuto, nessuna
    chiave sconosciuta. Funzioni pure, indipendenti dal DB.
  definition_of_done:
    - "Modulo src/domain/generation/slots.ts con il catalogo degli slot esportato: ogni slot ha id, page_role, kind ('text' | 'list' | 'qa') e una descrizione destinata alla `description` del tool (T-222)"
    - "Modulo src/domain/generation/pool.ts con POOL_LIMITS (costanti nominate: tetto in code unit per kind 'text', tetto per voce e per numero di voci per 'list', tetti su question/answer e sul numero di coppie per 'qa')"
    - "PoolSchema (zod) strict: forma { pages: { <slug>: { <slotId>: valore } } }, con il valore validato secondo il kind dello slot"
    - "parsePool(input, { allowedSlugs }) esportata: ritorna un risultato tipizzato o un errore, senza lanciare su input non fidato, e rifiuta ogni slug non presente in allowedSlugs"
    - "I tetti sono dichiarati UNA volta in POOL_LIMITS e referenziati dallo schema; nessun numero letterale duplicato nel modulo"
    - "EMENDAMENTO 2026-07-28 (P2-D20): la forma della pagina in PoolSchema e DERIVATA dal catalogo di slots.ts, e la coincidenza fra i due e ASSERITA — non affidata a un commento. Il catalogo e il contratto che T-210, T-213 e T-222 ereditano: uno slot omesso dallo schema, cancellato dal catalogo o cambiato di kind deve essere rosso"
    - "EMENDAMENTO 2026-07-28 (P2-D20): parsePool NON restituisce l'errore di validazione grezzo. Il ramo di errore e limitato ALLA FONTE da costanti nominate (numero massimo di issue riportate e lunghezza massima di ogni stringa riportata), perche l'errore trasporta chiavi di slot e slug SCRITTI DAL MODELLO: senza tetto il canale dell'errore resta aperto dove il canale del dato e chiuso"
    - "EMENDAMENTO 2026-07-28 (P2-D20): l'allowlist degli slug e verificata sulle chiavi GREZZE dell'input prima della validazione di forma, cosi lo slug non ammesso e sempre nominato — anche quando il contenuto di quella pagina e a sua volta malformato"
    - "EMENDAMENTO 2026-07-28 (P2-D20): la forma dello slug di pagina e vincolata (minuscole, cifre e trattini singoli) come difesa PER FORMA contro le chiavi speciali di JavaScript in una mappa che nasce da JSON non fidato. E una PRECONDIZIONE DICHIARATA su T-213, che deve produrre slug di quella forma"
  acceptance_criteria:
    - id: AC-201-1
      given: "un pool valido con pages={home:{...}} contenente uno slot 'text', uno 'list' e uno 'qa' entro i tetti"
      when: "lo valido con parsePool(input, { allowedSlugs: ['home'] })"
      then: "la validazione ha successo e restituisce il pool tipizzato con gli stessi valori"
    - id: AC-201-2
      given: "un pool il cui slot di kind 'text' ha un valore lungo esattamente POOL_LIMITS.text code unit, e un secondo pool con lo stesso slot a POOL_LIMITS.text + 1"
      when: "valido entrambi"
      then: "il primo e accettato per intero (nessun troncamento: il valore restituito ha la stessa lunghezza dell'input) e il secondo e rifiutato indicando quello slot"
    - id: AC-201-3
      given: "un pool con uno slot id che non esiste nel catalogo di slots.ts"
      when: "lo valido"
      then: "la validazione fallisce indicando lo slot sconosciuto, e nessun valore sconosciuto compare nel risultato"
    - id: AC-201-4
      given: "un pool con pages={home:{...}, admin:{...}} e allowedSlugs=['home']"
      when: "lo valido"
      then: "la validazione fallisce indicando lo slug 'admin' non ammesso"
    - id: AC-201-5
      given: "un pool il cui slot 'list' ha POOL_LIMITS.list_items + 1 voci, e un altro il cui slot 'qa' ha una risposta oltre POOL_LIMITS.qa_answer"
      when: "valido entrambi"
      then: "entrambi sono rifiutati indicando rispettivamente il numero di voci e lo slot 'qa' fuori scala"
    - id: AC-201-6
      given: "un pool in cui il valore di uno slot di kind 'text' e un array invece di una stringa"
      when: "lo valido"
      then: "la validazione fallisce per tipo, senza lanciare"
    - id: AC-201-7
      given: "il catalogo degli slot di slots.ts (EMENDAMENTO P2-D20)"
      when: "costruisco per via DERIVATA un pool che contiene OGNI slot del catalogo, ciascuno con un valore valido per il proprio kind, e lo valido"
      then: "il pool e accettato e ogni valore torna identico; inoltre l'insieme delle chiavi di slot ammesse dallo schema coincide ESATTAMENTE con gli id del catalogo, e cardinalita e id del catalogo sono pinnati — cosi omettere uno slot dallo schema, cancellarlo dal catalogo o cambiarne il kind e rosso"
    - id: AC-201-8
      given: "un pool con molte chiavi di slot sconosciute, ciascuna di lunghezza enorme e contenente testo ostile (EMENDAMENTO P2-D20)"
      when: "lo valido con parsePool"
      then: "l'errore restituito riporta al piu il numero di issue dichiarato in POOL_LIMITS, nessuna stringa riportata supera il tetto dichiarato, e il testo ostile non compare per intero: il ramo di errore e limitato alla fonte e non e una via d'uscita per contenuto controllato dal modello"
    - id: AC-201-9
      given: "slug PRESENTI in allowedSlugs ma di forme diverse (EMENDAMENTO P2-D20)"
      when: "li valido"
      then: "sono accettati solo quelli conformi alla forma dichiarata e rifiutati gli altri (maiuscole, underscore, lettere accentate, trattini doppi o ai bordi): il vincolo che T-213 eredita e pinnato da un test, non implicito nella regex"
  target_tests:
    - file: "tests/pool-schema.test.ts"
      covers: [AC-201-1, AC-201-2, AC-201-3, AC-201-4, AC-201-5, AC-201-6, AC-201-7, AC-201-8, AC-201-9]
  security_notes:
    - "OWASP A05:2025 (validation & business logic): il pool e l'output del modello, cioe input NON FIDATO; PoolSchema e il confine di validazione server-side che impedisce a valori arbitrari di raggiungere il DB e il rendering (ASVS Validation & Business Logic)."
    - "Strict per costruzione: nessuna chiave sconosciuta, nessuno slot id fuori catalogo, nessuno slug di pagina fuori allowlist — la superficie di cio che il modello puo far arrivare a valle e chiusa, non filtrata."
    - "I tetti vivono qui e non nello schema del tool: lo strict tool use esclude maxLength/maxItems (P1-D20), quindi la validazione DEVE avvenire dopo il ritorno del modello."
    - "Nessun troncamento (AC-201-2): un valore fuori scala e SCARTATO, perche troncare e corruzione silenziosa — stesso contratto di P1-D17."
    - "EMENDAMENTO P2-D20 (rilievo V-201-02 della verifica avversariale, misurato): chiudere il canale del DATO non basta se resta aperto quello dell'ERRORE. Le chiavi di slot fuori catalogo e gli slug finiscono verbatim e senza tetto nell'errore di validazione — misurati 100-143 KB con prompt injection e markup dentro le chiavi non riconosciute — e quell'errore e proprio cio che T-204 traduce in failure_reason (colonna text) e che qualcuno loggherebbe. Il tetto sta ALLA FONTE (AC-201-8), non nella diligenza del chiamante."
    - "EMENDAMENTO P2-D20 (rilievo V-201-01): il catalogo e il contratto ereditato da tre task a valle, e senza AC-201-7 poteva essere svuotato, rinominato o cambiato di kind con la suite verde. Stessa classe del carry-over P1 §6-bis p.13 (i test coglievano rinomine e rimozioni ma non le aggiunte)."
  out_of_scope:
    - "Schema del documento congelato (T-202)"
    - "Tool strict e sua description derivata (T-222)"
    - "Precondizioni dei blocchi e slotsFor (T-210)"

- id: T-202
  title: "SiteDocumentSchema multi-pagina + slot immagine tipato per sorgente"
  macrotask: "generation-model"
  depends_on: [T-201]
  objective: >
    Definire in src/domain/generation/document.ts lo schema zod del SiteDocument, cioe
    l'artefatto CONGELATO che P3 modifichera e P4 pubblichera: { pages: [{ slug, role,
    title, meta_description, blocks: [...] }] }, con almeno la pagina home. Ogni blocco
    porta il proprio id, i contenuti risolti e i riferimenti ai campi del brief che rende
    direttamente. Lo slot immagine e una UNIONE DISCRIMINATA per sorgente:
    { source: 'theme-placeholder', token } | { source: 'uploaded', asset_id } — nessun
    campo URL esiste nel tipo, quindi un photo_ref di terzi e irrappresentabile per tipo e
    non per convenzione (P2-D12). Lo schema e strict e il documento e validato prima di
    essere scritto. Funzione pura.
  definition_of_done:
    - "Modulo src/domain/generation/document.ts con SiteDocumentSchema (zod, strict) e i tipi TS derivati esportati"
    - "pages e una lista con almeno un elemento; ogni pagina ha slug (univoco nel documento), role, title, meta_description e blocks"
    - "Lo slot immagine e una unione discriminata su `source` con esattamente due varianti: theme-placeholder (con token) e uploaded (con asset_id); nessun campo url/src/href esiste in nessuna variante"
    - "DOCUMENT_LIMITS in costanti nominate: tetto sul numero di pagine, sui titoli e sulle meta description"
    - "parseDocument(input) esportata: ritorna un risultato tipizzato o un errore, senza lanciare"
    - "Test che misura il peso serializzato del documento nel caso peggiore (brief a ogni tetto di P1-D17 e set di pagine massimo) e lo asserisce sotto DOCUMENT_LIMITS.max_bytes"
    - "EMENDAMENTO 2026-07-28 (P2-D21): il caso peggiore va misurato anche in TESTO MULTIBYTE, e max_bytes dimensionato sopra QUELLA misura. I tetti per campo contano code unit UTF-16, il tetto totale conta byte UTF-8: un documento agli stessi tetti scritto in italiano o spagnolo accentato pesa quasi il doppio di uno ASCII, e con la politica di non-troncamento un tetto tarato sull'ASCII farebbe fallire la generazione nelle due lingue che il prodotto serve. Il test riporta ENTRAMBE le misure"
    - "EMENDAMENTO 2026-07-28 (P2-D21): il documento registra l'id VERSIONATO della ricetta e del tema, vincolati in forma e lunghezza e NON contro cataloghi (che nascono in T-211/T-212). Anticipati qui perche SiteDocumentSchema e strict: senza, T-214 dovrebbe riaprire un artefatto gia passato dal checkpoint del proprio macrotask"
    - "EMENDAMENTO 2026-07-28 (P2-D21): l'invariante 'la home esiste sempre' e IMPOSTO dallo schema, non solo dichiarato in prosa — almeno una pagina ha role 'home'. Che sia ESATTAMENTE una non e richiesto da alcuna decisione e non va imposto"
    - "EMENDAMENTO 2026-07-28 (P2-D21): il ramo di errore di parseDocument e limitato ALLA FONTE come quello di parsePool, e i due condividono UN SOLO limitatore invece di due copie che divergerebbero"
    - "EMENDAMENTO 2026-07-28 (P2-D21): nessuna chiave dell'input viene scartata in SILENZIO. Una chiave speciale di JavaScript dentro una mappa a chiavi libere (hours) e un RIFIUTO NOMINATO, non una sparizione con ok:true — e la stessa corruzione silenziosa che P1-D17 e T-201 vietano. E il risultato e sempre una copia validata, mai l'input stesso"
  acceptance_criteria:
    - id: AC-202-1
      given: "un documento con una sola pagina home e blocchi validi, e un secondo documento con otto pagine"
      when: "li valido con parseDocument"
      then: "entrambi sono accettati e restituiti tipizzati (one-pager e multi-pagina sono la stessa forma)"
    - id: AC-202-2
      given: "un documento con due pagine che hanno lo stesso slug"
      when: "lo valido"
      then: "la validazione fallisce indicando lo slug duplicato"
    - id: AC-202-3
      given: "un documento con pages=[] (nessuna pagina)"
      when: "lo valido"
      then: "la validazione fallisce: la home esiste sempre"
    - id: AC-202-4
      given: "uno slot immagine { source: 'uploaded' } privo di asset_id, e in una seconda prova { source: 'external', url: 'https://evil.example/x.png' }"
      when: "valido i due documenti"
      then: "entrambi sono rifiutati: il primo per asset_id mancante, il secondo perche 'external' non e una sorgente ammessa e perche la chiave url non esiste nello schema"
    - id: AC-202-5
      given: "uno slot immagine valido { source: 'theme-placeholder', token: '...' } a cui viene aggiunta una chiave src"
      when: "valido il documento"
      then: "la validazione fallisce per chiave sconosciuta (strict), e la chiave src non compare nel documento tipizzato"
    - id: AC-202-6
      given: "un brief con ogni campo e ogni collezione al tetto di P1-D17 e il set di pagine massimo"
      when: "costruisco il documento corrispondente e ne misuro la serializzazione JSON in byte"
      then: "il peso misurato e inferiore a DOCUMENT_LIMITS.max_bytes, e il valore misurato e riportato dal test (bound noto, non supposto)"
    - id: AC-202-7
      given: "lo stesso caso peggiore di AC-202-6 ma riempito con testo MULTIBYTE, cioe le lettere accentate dei due locale del prodotto (EMENDAMENTO P2-D21)"
      when: "ne misuro la serializzazione JSON in byte e lo valido"
      then: "anche quel peso e inferiore a DOCUMENT_LIMITS.max_bytes e il documento e ACCETTATO; entrambe le misure, ASCII e multibyte, sono riportate dal test, e il rapporto fra le due e dichiarato"
    - id: AC-202-8
      given: "un documento senza l'id versionato della ricetta o del tema, e uno che li porta (EMENDAMENTO P2-D21)"
      when: "li valido"
      then: "il primo e rifiutato indicando il campo mancante e il secondo e accettato conservando i due id; un id che eccede la forma o la lunghezza dichiarata e rifiutato, e una chiave sconosciuta accanto a essi cade per strict"
    - id: AC-202-9
      given: "un documento la cui unica pagina ha role 'faq', e lo stesso documento con quella pagina di role 'home' (EMENDAMENTO P2-D21)"
      when: "li valido"
      then: "il primo e rifiutato perche nessuna pagina e la home, il secondo e accettato: l'unica variabile fra i due e il ruolo"
    - id: AC-202-10
      given: "un documento i cui dati resi portano social_links, e uno che porta photo_ref dentro una voce di offerta (EMENDAMENTO P2-D21)"
      when: "li valido"
      then: "il primo e ACCETTATO e il secondo e RIFIUTATO: la scelta e pinnata da un test invece di essere affidata a un commento, perche i due campi hanno la stessa destinazione href ma sorte diversa, e quella differenza e una precondizione dichiarata su T-237 e T-241"
    - id: AC-202-11
      given: "un input con molte chiavi sconosciute, ciascuna di lunghezza enorme e contenente testo ostile (EMENDAMENTO P2-D21)"
      when: "lo valido con parseDocument"
      then: "l'errore restituito rispetta gli stessi tetti dichiarati per parsePool su numero di issue e lunghezza delle stringhe, e il testo ostile non compare per intero"
    - id: AC-202-12
      given: "un documento i cui dati resi portano, dentro la mappa a chiavi libere degli orari, una chiave speciale di JavaScript accanto a una chiave legittima (EMENDAMENTO P2-D21)"
      when: "lo valido"
      then: "il documento e RIFIUTATO nominando quella chiave — non accettato con la chiave scomparsa in silenzio — mentre lo stesso documento con le sole chiavi legittime e accettato e il risultato e una COPIA validata, non l'oggetto d'ingresso"
  target_tests:
    - file: "tests/site-document-schema.test.ts"
      covers: [AC-202-1, AC-202-2, AC-202-3, AC-202-4, AC-202-5, AC-202-6, AC-202-7, AC-202-8, AC-202-9, AC-202-10, AC-202-11, AC-202-12]
  security_notes:
    - "OWASP A05:2025 (validation): il documento incorpora testo che proviene da siti terzi via fromUrl (T-141) e dal modello; e validato con schema strict prima di essere scritto e prima di essere reso."
    - "Irrappresentabilita per tipo invece di sorveglianza: lo slot immagine non ha alcun campo url/src, quindi un photo_ref di terzi NON PUO diventare un attributo di rete nel sito generato (P2-D12). Conserva vera l'asserzione di P1 secondo cui photo_ref non finisce in un src, e mantiene significativa l'asserzione end-to-end 'nessuna richiesta verso host fuori allowlist' (T-241)."
    - "Il peso del documento e un bound MISURATO (AC-202-6): in P1 lo stesso numero (~405 KB per la riga del brief) era un limite senza oracolo (§6-bis p.10)."
    - "EMENDAMENTO P2-D21 — PORTATA REALE dell'irrappresentabilita (rilievo V-202-01, misurato su 18 punti del documento): l'argomento 'per TIPO' vale per lo SLOT IMMAGINE e per photo_ref, NON per il documento intero. I dati del brief resi direttamente contengono campi liberi che accettano un URL, e fra questi social_links, che il repo stesso dichiara destinato a un href (BriefPanel, ReviewConfirm, fromUrl) ed e scrivibile dal modello via il tool update_brief. La scelta e di TENERLO — i link ai profili social sono una funzione legittima — e di dichiararla: la difesa sul link non sta nel tipo del documento ma nel VALIDATORE del campo al momento di costruire l'href (T-237), piu l'asserzione sull'effetto in T-241. Chi legge questo schema non deve dedurne che AC-214-6 sia vera per tipo."
    - "EMENDAMENTO P2-D21 — l'unita di misura dei tetti (rilievo V-202-03, misurato): tetti per campo in code unit UTF-16 e tetto totale in byte UTF-8 sono due unita che divergono fino a x1,92 sulle lettere accentate e x2,84 sul CJK. Un max_bytes tarato sull'ASCII rifiuterebbe un documento legittimo agli stessi tetti scritto in italiano o spagnolo, e con la politica di non-troncamento questo significa una generazione fallita. Il tetto sta sopra la misura MULTIBYTE (AC-202-7), non sopra quella ASCII."
  out_of_scope:
    - "Costruzione del documento (resolve, T-214)"
    - "Rendering dei blocchi (T-231)"
    - "Sede definitiva del documento: decisione di P3"

- id: T-203
  title: "Server actions generations in LETTURA e creazione (create/get/listStatuses) + riconciliazione"
  macrotask: "generation-model"
  depends_on: [T-200, T-202]
  objective: >
    Implementare in src/data/generations.ts le server action di creazione e lettura,
    eseguite solo server-side, che usano il client Supabase legato alla sessione (RLS
    attiva) e MAI la service_role: createGeneration(siteId, maxPages),
    getGeneration(siteId), listGenerationStatuses(). L'account_id e derivato dall'identita
    (auth.uid() -> owner_id, come sites/T-101 e briefs/T-123), non da input client. Solo
    metodi tipati (.eq/.select/.insert), mai interpolazione in .or()/.filter().
    getGeneration applica la RICONCILIAZIONE: una riga 'generating' piu vecchia di
    GENERATION_TIMEOUTS.phase1, o 'chosen' senza pagine interne piu vecchia di
    GENERATION_TIMEOUTS.phase2, e riportata come 'failed' — altrimenti un processo morto
    bloccherebbe il sito per sempre attraverso l'indice UNIQUE parziale.
    listGenerationStatuses legge lo stato di TUTTI i siti dell'account in UNA query.
  definition_of_done:
    - "Modulo server-side src/data/generations.ts con createGeneration, getGeneration e listGenerationStatuses, invocabili solo dal server"
    - "l'account_id e derivato dall'appartenenza/owner dell'utente autenticato, non da input client arbitrario"
    - "GENERATION_TIMEOUTS in costanti nominate; getGeneration riporta come 'failed' le righe stantie secondo P2-D15 senza cancellarle"
    - "listGenerationStatuses esegue UNA sola query per N siti (nessun N+1) e non fa select('*')"
    - "le azioni usano il client con sessione (RLS) e metodi tipati; nessuna interpolazione in .or()/.filter(); nessun uso della service_role"
    - "EMENDAMENTO 2026-07-28 (P2-D22): l'assenza di N+1 e l'assenza di select('*') si misurano sulle RICHIESTE HTTP realmente emesse verso PostgREST, non sulle invocazioni di un metodo del client ne sul testo del sorgente. Un doppio che intercetta il solo `from` conta se stesso: un N+1 instradato per altra via (schema(), rpc(), riuso di un builder) resta invisibile, ed e stato costruito e misurato. Lo stesso contatore rende ispezionabile il parametro select= della richiesta, dove un wildcard sulla risorsa EMBEDDED sfugge a qualunque regex ancorata all'inizio della stringa"
    - "EMENDAMENTO 2026-07-28 (P2-D22): i valori di GENERATION_TIMEOUTS vivono dove un test PURO possa asserirne l'invariante (un modulo 'use server' non puo esportare costanti). L'invariante non e il numero ma la relazione: ogni timeout deve stare SOPRA la vita massima della richiesta che possiede la riga, altrimenti l'indice UNIQUE parziale verrebbe liberato SOTTO una generazione ancora viva, autorizzando un secondo scrittore — cioe esattamente cio che l'indice esiste per impedire"
  acceptance_criteria:
    - id: AC-203-1
      given: "l'utente A autenticato, membro dell'account X proprietario del sito S"
      when: "chiama createGeneration(S, maxPages=8)"
      then: "esiste una riga site_generations con account_id=X, site_id=S, status='generating', max_pages=8 e document nullo"
    - id: AC-203-2
      given: "una generazione del sito S nell'account X (utente A) e l'utente B del solo account Y"
      when: "B autenticato chiama getGeneration(S)"
      then: "il risultato e vuoto/negato (la RLS isola per tenant); A che chiama getGeneration(S) ottiene la propria generazione"
    - id: AC-203-3
      given: "nessuna sessione autenticata"
      when: "si invoca createGeneration, getGeneration e listGenerationStatuses"
      then: "ognuna fallisce con errore di autenticazione e non viene scritta ne restituita alcuna riga"
    - id: AC-203-4
      given: "una generazione del sito S con status='generating'"
      when: "l'utente A chiama di nuovo createGeneration(S, ...)"
      then: "l'azione e rifiutata con un errore riconoscibile di generazione già in volo, e la riga esistente resta invariata (status e id inalterati)"
    - id: AC-203-5
      given: "una riga site_generations con status='generating' e updated_at piu vecchio di GENERATION_TIMEOUTS.phase1"
      when: "l'utente A chiama getGeneration(S)"
      then: "lo stato riportato e 'failed' e una successiva createGeneration(S, ...) riesce; la riga stantia non e stata cancellata"
    - id: AC-203-6
      given: "un account con N siti (N maggiore di 1), ciascuno con una generazione, e un doppio del client che conta le chiamate"
      when: "chiamo listGenerationStatuses()"
      then: "il numero di RICHIESTE HTTP verso PostgREST e 1 e resta 1 al crescere di N (misurato sul trasporto, non sulle invocazioni di un metodo del client), e il risultato contiene lo stato di ciascuno degli N siti"
    - id: AC-203-7
      given: "le costanti di GENERATION_TIMEOUTS e il tetto di durata della richiesta dichiarato (EMENDAMENTO P2-D22)"
      when: "le confronto in un test puro"
      then: "ogni timeout e maggiore del tetto di durata della richiesta e il timeout della fase 2 e maggiore di quello della fase 1: accorciare un timeout sotto quella soglia, o scambiare i due valori, e ROSSO — l'invariante dichiarata a parole diventa eseguibile"
  target_tests:
    - file: "tests/generations-read-actions.test.ts"
      covers: [AC-203-1, AC-203-2, AC-203-3, AC-203-4, AC-203-5, AC-203-6, AC-203-7]
  security_notes:
    - "R1/R4: l'isolamento cross-tenant si appoggia alla RLS delle due tabelle (appartenenza account), verificato con client ad auth reale su Supabase locale (AC-203-2)."
    - "R7: la service_role bypassa la RLS ed e confinata server-side; queste azioni usano deliberatamente il client con sessione utente perche la RLS resti attiva."
    - "OWASP A01:2025: l'account_id e derivato dall'identita (auth.uid()->owner_id) e mai fidato dal client."
    - "OWASP A05:2025 (injection, incl. PostgREST filter injection): solo metodi tipati .eq()/.insert()/.select(), mai .or()/.filter() con input interpolato."
    - "Disponibilita (P2-D15): l'indice UNIQUE parziale e la difesa contro la doppia generazione ED E anche il modo di incastrarsi. La riconciliazione in lettura (AC-203-5) e il secondo meccanismo: senza, un processo morto renderebbe il sito non piu generabile in modo permanente. Servono entrambi, perche un finally non gira su un processo ucciso."
  out_of_scope:
    - "Azioni di scrittura del pool e del documento (T-204)"
    - "Rotta HTTP e stream (T-230)"
    - "Costruzione del documento (T-214)"

- id: T-204
  title: "Server actions generations in SCRITTURA (writePool/chooseVariant/appendPages)"
  macrotask: "generation-model"
  depends_on: [T-200, T-202]
  objective: >
    Implementare in src/data/generations.ts le server action di scrittura, server-side, col
    client legato alla sessione (RLS attiva) e MAI la service_role: writePool(generationId,
    scope, variantIndex, content), chooseVariant(generationId, index) e
    appendPages(generationId, pages). writePool valida il content con parsePool (T-201);
    chooseVariant e appendPages validano il documento con parseDocument (T-202) prima di
    scrivere. Le tre azioni rispettano la macchina a stati di P2-D13: chooseVariant opera
    su 'ready' e porta a 'chosen' scrivendo il documento con la sola home; appendPages opera
    su 'chosen' e porta a 'complete' estendendo document.pages. Uno stato di partenza
    sbagliato e un errore, non un no-op silenzioso.
  definition_of_done:
    - "writePool, chooseVariant e appendPages esportate da src/data/generations.ts, invocabili solo dal server"
    - "writePool rifiuta un content che non valida contro parsePool, senza scrivere nulla"
    - "chooseVariant scrive chosen_variant e document (sola pagina home) e porta status a 'chosen'; appendPages estende document.pages e porta status a 'complete'"
    - "Le transizioni sono vincolate allo stato di partenza; una transizione non ammessa e rifiutata con un errore riconoscibile e non modifica la riga"
    - "Un indice di variante fuori 0..4 e rifiutato prima di raggiungere il DB"
    - "le azioni usano il client con sessione (RLS) e metodi tipati; nessuna interpolazione in .or()/.filter(); nessun uso della service_role"
    - "EMENDAMENTO 2026-07-28 (P2-D23) — FIRME REALI: writePool(generationId, scope, variantIndex, content, allowedSlugs) e chooseVariant(generationId, index, document). L'allowlist degli slug e il documento non sono derivabili dentro l'azione: la prima dipende dal set di pagine di T-213, il secondo e prodotto da resolve (T-214). Sono precondizioni su quei due task, non parametri di comodo"
    - "EMENDAMENTO 2026-07-28 (P2-D23): il max_pages DELLA RIGA e imposto da appendPages, non solo il tetto globale di DOCUMENT_LIMITS. E il giunto verso P5 dichiarato da P2-D13 (piano free -> una pagina): se non e imposto dove si SCRIVE, il limite di piano e aggirabile e la colonna e decorativa"
    - "EMENDAMENTO 2026-07-28 (P2-D23): writePool rifiuta sugli stati TERMINALI ('complete', 'failed'), dove un pool nuovo e solo inquinamento; resta ammesso sugli stati vivi. La mappa fine scope->stato (fase 1 contro fase 2, e la rigenerazione copy-on-write di P2-D3) appartiene a T-230/T-232 ed e dichiarata come precondizione, non indovinata qui"
    - "EMENDAMENTO 2026-07-28 (P2-D23): chooseVariant pretende che esista il pool della variante scelta OPPURE il pool CONDIVISO (variant_index NULL). Ammettere entrambi non e lassismo: per P2-D3 le cinque varianti nascono normalmente dal pool condiviso e solo quella rigenerata ne ha uno proprio"
    - "EMENDAMENTO 2026-07-28 (P2-D23): la prova di vita (updated_at) e scritta SOLO sul ramo riuscito. Scriverla prima di un'operazione che puo fallire fa ringiovanire la riga a ogni tentativo respinto: un chiamante che ritenta impedisce PER SEMPRE la riconciliazione di P2-D15, cioe il sito non e piu generabile"
    - "EMENDAMENTO 2026-07-28 (P2-D23): generationId e validato come uuid PRIMA di qualunque round-trip, come ogni altro input esterno. Un identificatore malformato deve costare 400 con zero richieste, non un 500 opaco che la rotta di T-230 dovrebbe poi tradurre all'utente"
    - "EMENDAMENTO 2026-07-28 (P2-D23): una lista di pagine VUOTA e un esito legittimo (la one-pager resta una one-pager) e la scelta e dichiarata, non implicita"
  acceptance_criteria:
    - id: AC-204-1
      given: "una generazione in stato 'generating'"
      when: "chiamo writePool con un content che viola PoolSchema (uno slot fuori tetto)"
      then: "l'azione e rifiutata con errore di validazione e nessuna riga generation_pools viene scritta"
    - id: AC-204-2
      given: "una generazione in stato 'ready' con un pool home"
      when: "chiamo chooseVariant(G, 2) e poi appendPages(G, pagine)"
      then: "dopo la prima la generazione ha chosen_variant=2, status='chosen' e document con esattamente una pagina di role 'home'; dopo la seconda status='complete' e document.pages ha piu di una pagina"
    - id: AC-204-3
      given: "nessuna sessione autenticata"
      when: "si invoca writePool, chooseVariant e appendPages"
      then: "ognuna fallisce con errore di autenticazione e nessuna riga viene scritta o modificata"
    - id: AC-204-4
      given: "l'utente B autenticato che NON e membro dell'account di A e la generazione G del sito S di A"
      when: "B chiama writePool(G, ...), chooseVariant(G, 0) e appendPages(G, ...)"
      then: "tutte e tre sono rifiutate (derivazione server-side dell'account e/o RLS) e nessuna riga della generazione di S viene modificata"
    - id: AC-204-5
      given: "una generazione in stato 'ready'"
      when: "chiamo chooseVariant(G, 5) e chooseVariant(G, -1)"
      then: "entrambe sono rifiutate prima di raggiungere il DB e chosen_variant resta invariato"
    - id: AC-204-6
      given: "una generazione in stato 'generating' (fase 1 non conclusa)"
      when: "chiamo appendPages(G, pagine)"
      then: "l'azione e rifiutata con un errore riconoscibile di transizione non ammessa, e la riga resta in 'generating' con document invariato"
    - id: AC-204-7
      given: "un documento valido di taglia pari al tetto dichiarato da DOCUMENT_LIMITS.max_bytes (EMENDAMENTO P2-D21, precondizione misurata in T-202)"
      when: "lo scrivo davvero attraverso il client con sessione, come fa chooseVariant"
      then: "la scrittura riesce e il documento riletto e identico; se invece il gateway davanti a PostgREST la rifiuta per taglia della richiesta, il test lo riporta come un fatto MISURATO e il tetto va abbassato — non si presume che passi"
    - id: AC-204-8
      given: "una generazione 'chosen' con max_pages dichiarato basso e un pacchetto di pagine che lo supera (EMENDAMENTO P2-D23)"
      when: "chiamo appendPages"
      then: "l'azione e rifiutata e la riga resta invariata; lo stesso appendPages che resta ENTRO max_pages e accettato — il tetto della riga e imposto dove si scrive, non solo dichiarato alla creazione"
    - id: AC-204-9
      given: "generazioni negli stati terminali 'complete' e 'failed' (EMENDAMENTO P2-D23)"
      when: "chiamo writePool su ciascuna"
      then: "entrambe sono rifiutate con un errore riconoscibile e nessuna riga di pool viene scritta; lo stesso writePool su una generazione in uno stato VIVO e accettato"
    - id: AC-204-10
      given: "una generazione 'ready' senza alcun pool, e una con il solo pool CONDIVISO (variant_index NULL) (EMENDAMENTO P2-D23)"
      when: "chiamo chooseVariant su entrambe"
      then: "la prima e rifiutata e la riga resta invariata; la seconda e ACCETTATA per qualunque indice ammesso, perche per P2-D3 le cinque varianti nascono dal pool condiviso"
    - id: AC-204-11
      given: "una generazione 'chosen' e un pacchetto di pagine ostili — slug duplicato di una gia congelata, chiave sconosciuta, sorgente immagine non ammessa, o una SECONDA pagina di ruolo home (EMENDAMENTO P2-D23)"
      when: "chiamo appendPages"
      then: "ogni caso e rifiutato dal gate parseDocument prima di scrivere, la riga resta in 'chosen' col documento identico e updated_at non avanzato; le stesse pagine LEGITTIME sono accettate — il gate della fase 2 ha lo stesso oracolo di quello della fase 1, e l'invariante della home unica non si disfa in fase 2"
    - id: AC-204-12
      given: "un generationId malformato, uno ben formato ma inesistente, e una scrittura di pool duplicata sulla stessa terna (EMENDAMENTO P2-D23)"
      when: "chiamo writePool nei tre casi"
      then: "il primo e rifiutato prima del DB con ZERO richieste, il secondo con un errore di risorsa assente, il terzo con un errore riconoscibile di duplicato — e in TUTTI E TRE updated_at della generazione resta INVARIATO, perche la prova di vita appartiene al ramo riuscito"
  target_tests:
    - file: "tests/generations-write-actions.test.ts"
      covers: [AC-204-1, AC-204-2, AC-204-3, AC-204-4, AC-204-5, AC-204-6, AC-204-7, AC-204-8, AC-204-9, AC-204-10, AC-204-11, AC-204-12]
  security_notes:
    - "R1/R4: l'isolamento cross-tenant delle tre scritture si appoggia alla RLS delle due tabelle, verificato con client ad auth reale su Supabase locale (AC-204-4)."
    - "R7: nessun uso della service_role: la scrittura passa dal client con sessione perche la RLS resti attiva."
    - "OWASP A05:2025 (validation): writePool ri-valida con parsePool (T-201) e chooseVariant/appendPages con parseDocument (T-202) — l'output del modello non viene mai scritto grezzo."
    - "OWASP A01:2025: l'account_id e derivato dall'identita; l'indice di variante e vincolato prima del DB (AC-204-5), che e difesa in profondita rispetto al CHECK di T-200."
    - "Integrita della macchina a stati (AC-204-6): una transizione non ammessa e un ERRORE e non un no-op. Un appendPages accettato su una generazione non scelta produrrebbe un documento incoerente senza che nulla protesti."
    - "EMENDAMENTO P2-D21 — TAGLIA DELLA RICHIESTA, dichiarata da T-202 e da verificare QUI (AC-204-7). parseDocument accetta fino a 8 MiB e il caso peggiore reale in italiano/spagnolo misura 6.397.198 byte. Il repo NON dichiara alcun tetto sul corpo della richiesta (supabase/config.toml ha solo max_rows, che riguarda le righe della RISPOSTA): il limite vive nel gateway davanti a PostgREST, fuori dal repo, e i default di quella classe di gateway stanno un ordine di grandezza sotto. Il modo di fallire e insidioso: un documento che il gate ha dichiarato VALIDO verrebbe respinto al livello HTTP con un errore opaco, e la scrittura lo tradurrebbe in un failure_reason con una causa che nel documento non c'e. Va MISURATO con una scrittura reale al tetto, non presunto."
    - "EMENDAMENTO P2-D21 — i rami di errore di parsePool (T-201) e parseDocument (T-202) sono ora limitati alla fonte dallo STESSO limitatore condiviso, con gli stessi tetti (24 issue, 120 code unit per stringa) e l'uguaglianza asserita. I due si traducono in failure_reason con lo stesso trattamento; nessuno dei due riproduce l'input, quindi failure_reason dice DOVE e non QUANTE volte."
  out_of_scope:
    - "Azioni di creazione e lettura (T-203)"
    - "Rotta HTTP e stream (T-230)"
    - "Conferma utente sulla riscelta (T-233)"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir del blueprint P2 — atteso exit 0.
- **Semantico** (checklist guidata): punti 6–10 su ogni task; i rilievi vanno all'human-in-the-loop.
