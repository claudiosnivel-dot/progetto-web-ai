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
    - "CHECK (status in ('generating','ready','chosen','complete','failed')); CHECK (chosen_variant is null or (chosen_variant >= 0 and chosen_variant <= 4)); CHECK (max_pages >= 1)"
    - "Tabella public.generation_pools con: id uuid pk; account_id uuid not null; generation_id uuid not null references site_generations on delete cascade; scope text not null; variant_index smallint; content jsonb not null; created_at timestamptz default now()"
    - "CHECK (scope in ('home','inner')); CHECK (variant_index is null or (variant_index >= 0 and variant_index <= 4)); UNIQUE (generation_id, scope, variant_index)"
    - "Indice UNIQUE PARZIALE: create unique index ... on public.site_generations (site_id) where status = 'generating'"
    - "RLS abilitata su entrambe le tabelle, con quattro policy (SELECT/INSERT/UPDATE/DELETE) TO authenticated che usano is_account_member(account_id); nessuna con USING(true)/WITH CHECK(true)"
    - "Indici btree su site_generations(account_id), site_generations(site_id), generation_pools(account_id), generation_pools(generation_id)"
    - "GRANT espliciti select/insert/update/delete a authenticated e service_role su entrambe; nessun GRANT ad anon"
  acceptance_criteria:
    - id: AC-200-1
      given: "la migrazione applicata su un'istanza Supabase locale"
      when: "interrogo il catalogo pg_class (relrowsecurity) per public.site_generations e public.generation_pools"
      then: "relrowsecurity = true per entrambe le relazioni"
    - id: AC-200-2
      given: "lo schema applicato"
      when: "interrogo information_schema.columns per le due tabelle"
      then: "esistono tutte le colonne dichiarate nella definition_of_done, con account_id NOT NULL, site_id NOT NULL, status NOT NULL default 'generating', max_pages NOT NULL su site_generations, e generation_id NOT NULL, scope NOT NULL, content NOT NULL su generation_pools"
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
  target_tests:
    - file: "tests/site-generations-schema.test.ts"
      covers: [AC-200-1, AC-200-2, AC-200-3, AC-200-4, AC-200-5, AC-200-6, AC-200-7, AC-200-8]
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
  target_tests:
    - file: "tests/pool-schema.test.ts"
      covers: [AC-201-1, AC-201-2, AC-201-3, AC-201-4, AC-201-5, AC-201-6]
  security_notes:
    - "OWASP A05:2025 (validation & business logic): il pool e l'output del modello, cioe input NON FIDATO; PoolSchema e il confine di validazione server-side che impedisce a valori arbitrari di raggiungere il DB e il rendering (ASVS Validation & Business Logic)."
    - "Strict per costruzione: nessuna chiave sconosciuta, nessuno slot id fuori catalogo, nessuno slug di pagina fuori allowlist — la superficie di cio che il modello puo far arrivare a valle e chiusa, non filtrata."
    - "I tetti vivono qui e non nello schema del tool: lo strict tool use esclude maxLength/maxItems (P1-D20), quindi la validazione DEVE avvenire dopo il ritorno del modello."
    - "Nessun troncamento (AC-201-2): un valore fuori scala e SCARTATO, perche troncare e corruzione silenziosa — stesso contratto di P1-D17."
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
  target_tests:
    - file: "tests/site-document-schema.test.ts"
      covers: [AC-202-1, AC-202-2, AC-202-3, AC-202-4, AC-202-5, AC-202-6]
  security_notes:
    - "OWASP A05:2025 (validation): il documento incorpora testo che proviene da siti terzi via fromUrl (T-141) e dal modello; e validato con schema strict prima di essere scritto e prima di essere reso."
    - "Irrappresentabilita per tipo invece di sorveglianza: lo slot immagine non ha alcun campo url/src, quindi un photo_ref di terzi NON PUO diventare un attributo di rete nel sito generato (P2-D12). Conserva vera l'asserzione di P1 secondo cui photo_ref non finisce in un src, e mantiene significativa l'asserzione end-to-end 'nessuna richiesta verso host fuori allowlist' (T-241)."
    - "Il peso del documento e un bound MISURATO (AC-202-6): in P1 lo stesso numero (~405 KB per la riga del brief) era un limite senza oracolo (§6-bis p.10)."
  out_of_scope:
    - "Costruzione del documento (resolve, T-214)"
    - "Rendering dei blocchi (T-231)"
    - "Sede definitiva del documento: decisione di P3"

- id: T-203
  title: "Server actions generations (create/writePool/choose/appendPages/get/list) + riconciliazione"
  macrotask: "generation-model"
  depends_on: [T-200, T-202]
  objective: >
    Implementare in src/data/generations.ts le server action eseguite solo server-side che
    usano il client Supabase legato alla sessione (RLS attiva) e MAI la service_role:
    createGeneration(siteId, maxPages), writePool(generationId, scope, variantIndex,
    content), chooseVariant(generationId, index), appendPages(generationId, pages),
    getGeneration(siteId), listGenerationStatuses(). L'account_id e derivato
    dall'identita (auth.uid() -> owner_id, come sites/T-101 e briefs/T-123), non da input
    client. writePool valida il content con parsePool (T-201) e chooseVariant/appendPages
    validano il documento con parseDocument (T-202) prima di scrivere. Solo metodi tipati
    (.eq/.select/.insert/.update), mai interpolazione in .or()/.filter().
    getGeneration applica la RICONCILIAZIONE: una riga 'generating' piu vecchia di
    GENERATION_TIMEOUTS.phase1, o 'chosen' senza pagine interne piu vecchia di
    GENERATION_TIMEOUTS.phase2, e riportata come 'failed' — altrimenti un processo morto
    bloccherebbe il sito per sempre attraverso l'indice UNIQUE parziale.
    listGenerationStatuses legge lo stato di TUTTI i siti dell'account in UNA query.
  definition_of_done:
    - "Modulo server-side src/data/generations.ts con le sei azioni, invocabili solo dal server"
    - "l'account_id e derivato dall'appartenenza/owner dell'utente autenticato, non da input client arbitrario"
    - "writePool rifiuta un content che non valida contro parsePool, senza scrivere nulla"
    - "chooseVariant scrive chosen_variant e document (sola pagina home) e porta status a 'chosen'; appendPages estende document.pages e porta status a 'complete'"
    - "GENERATION_TIMEOUTS in costanti nominate; getGeneration riporta come 'failed' le righe stantie secondo P2-D15 senza cancellarle"
    - "listGenerationStatuses esegue UNA sola query per N siti (nessun N+1) e non fa select('*')"
    - "le azioni usano il client con sessione (RLS) e metodi tipati; nessuna interpolazione in .or()/.filter(); nessun uso della service_role"
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
      when: "si invoca ciascuna delle sei azioni"
      then: "ogni azione fallisce con errore di autenticazione e non viene scritta ne restituita alcuna riga"
    - id: AC-203-4
      given: "una generazione del sito S con status='generating'"
      when: "l'utente A chiama di nuovo createGeneration(S, ...)"
      then: "l'azione e rifiutata con un errore riconoscibile di generazione già in volo, e la riga esistente resta invariata (status e id inalterati)"
    - id: AC-203-5
      given: "una generazione in stato 'generating'"
      when: "chiamo writePool con un content che viola PoolSchema (uno slot fuori tetto)"
      then: "l'azione e rifiutata con errore di validazione e nessuna riga generation_pools viene scritta"
    - id: AC-203-6
      given: "una generazione in stato 'ready' con un pool home"
      when: "chiamo chooseVariant(G, 2) e poi getGeneration(S)"
      then: "la generazione ha chosen_variant=2, status='chosen' e document con esattamente una pagina di role 'home'; una successiva appendPages porta status='complete' e document.pages a piu di una pagina"
    - id: AC-203-7
      given: "una riga site_generations con status='generating' e updated_at piu vecchio di GENERATION_TIMEOUTS.phase1"
      when: "l'utente A chiama getGeneration(S)"
      then: "lo stato riportato e 'failed' e una successiva createGeneration(S, ...) riesce; la riga stantia non e stata cancellata"
    - id: AC-203-8
      given: "un account con N siti (N maggiore di 1), ciascuno con una generazione, e un doppio del client che conta le chiamate"
      when: "chiamo listGenerationStatuses()"
      then: "il numero di chiamate al DB e 1 e resta 1 al crescere di N, e il risultato contiene lo stato di ciascuno degli N siti"
    - id: AC-203-9
      given: "l'utente B autenticato che NON e membro dell'account di A e la generazione G del sito S di A"
      when: "B chiama writePool(G, ...) e chooseVariant(G, 0)"
      then: "entrambe sono rifiutate (derivazione server-side dell'account e/o RLS) e nessuna riga della generazione di S viene modificata"
  target_tests:
    - file: "tests/generations-actions.test.ts"
      covers: [AC-203-1, AC-203-2, AC-203-3, AC-203-4, AC-203-5, AC-203-6, AC-203-7, AC-203-8, AC-203-9]
  security_notes:
    - "R1/R4: l'isolamento cross-tenant delle sei azioni si appoggia alla RLS delle due tabelle (appartenenza account), verificato con client ad auth reale su Supabase locale (AC-203-2, AC-203-9)."
    - "R7: la service_role bypassa la RLS ed e confinata server-side; la CRUD delle generazioni usa deliberatamente il client con sessione utente perche la RLS resti attiva."
    - "OWASP A01:2025: l'account_id e derivato dall'identita (auth.uid()->owner_id) e mai fidato dal client."
    - "OWASP A05:2025 (injection, incl. PostgREST filter injection): solo metodi tipati .eq()/.insert()/.select()/.update(), mai .or()/.filter() con input interpolato; writePool ri-valida con parsePool (T-201) e chooseVariant/appendPages con parseDocument (T-202)."
    - "Disponibilita (P2-D15): l'indice UNIQUE parziale e la difesa contro la doppia generazione ED E anche il modo di incastrarsi. La riconciliazione in lettura (AC-203-7) e il secondo meccanismo: senza, un processo morto renderebbe il sito non piu generabile in modo permanente. Servono entrambi, perche un finally non gira su un processo ucciso."
  out_of_scope:
    - "Rotta HTTP e stream (T-230)"
    - "Chiamata al modello (T-224)"
    - "Costruzione del documento (T-214)"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir del blueprint P2 — atteso exit 0.
- **Semantico** (checklist guidata): punti 6–10 su ogni task; i rilievi vanno all'human-in-the-loop.
