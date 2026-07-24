# 01-brief-model — Macrotask `brief-model` · Il Business Brief (dati + dominio + persistenza)

> Modulo del blueprint P1 (Onboarding) di Belora. Un modulo = un macrotask:
> l'unita al cui confine gira il checkpoint e l'unita di commit atomico.
> Task atomici secondo lo schema trueline (id/AC/target_tests/security_notes).
>
> **Substrato P0 (gia costruito, non nel DAG P1):** entita `sites` account-scoped
> con RLS (T-100), helper `public.is_account_member(account_id)`, tenancy
> `accounts`/`account_members`/`profiles` con `UNIQUE(owner_id)`, client Supabase a
> tre livelli (admin server-only · ssr/RLS · browser/anon), utility di test ad auth
> reale su Supabase locale (T-005). I `depends_on` qui sotto referenziano solo task P1.

## Obiettivo del macrotask

La spina dorsale di P1: l'entita **Business Brief** 1:1 con un sito (`site_briefs`,
account-scoped, RLS clonata da `sites`), lo schema di dominio del brief (zod) con la
logica pura di fusione e completamento, e le server action di persistenza via client
RLS. E' l'artefatto-contratto che P2 consumera per generare i 5 mockup.

## Task atomici

```yaml
- id: T-120
  title: "Schema site_briefs + RLS + vincoli (1:1 con site)"
  macrotask: "brief-model"
  depends_on: []
  objective: >
    Creare la migrazione SQL che definisce la tabella account-scoped
    public.site_briefs, legata 1:1 a un sito (site_id UNIQUE, FK verso public.sites
    on delete cascade) e all'account (account_id, FK verso public.accounts on delete
    cascade). Colonne core tipizzate (business_name, vertical, description, address,
    geo jsonb, hours jsonb, phone, whatsapp, email, primary_goal, locale) piu una
    colonna content jsonb per la lista offerta flessibile e le sezioni, e status
    (draft/confirmed). RLS abilitata con quattro policy TO authenticated ancorate a
    public.is_account_member(account_id) (stesso pattern di sites/T-100), vincoli
    CHECK su vertical/primary_goal/locale/status, UNIQUE(site_id), e indici sulle
    colonne di policy account_id e site_id. Solo schema e sicurezza a livello Postgres.
  definition_of_done:
    - "File supabase/migrations/<timestamp>_site_briefs.sql presente e applicabile su Supabase locale senza errori"
    - "Tabella public.site_briefs con: id uuid pk default gen_random_uuid(); account_id uuid not null references accounts on delete cascade; site_id uuid not null references sites on delete cascade; business_name text; vertical text not null default 'altro'; description text; address text; geo jsonb; hours jsonb; phone text; whatsapp text; email text; primary_goal text; locale text not null; content jsonb not null default '{}'::jsonb; status text not null default 'draft'; created_at timestamptz default now(); updated_at timestamptz default now()"
    - "RLS abilitata su public.site_briefs (enable row level security)"
    - "Quattro policy (SELECT, INSERT, UPDATE, DELETE) TO authenticated che usano is_account_member(account_id) in USING e/o WITH CHECK; nessuna con USING(true)/WITH CHECK(true)"
    - "Vincolo UNIQUE(site_id) (una sola riga brief per sito); CHECK (status in ('draft','confirmed')); CHECK (vertical in ('ristorazione','fitness','salone_studio','negozio_artigiano','altro')); CHECK (locale in ('it','es')); CHECK (primary_goal is null or primary_goal in ('prenota','ordina','contatta'))"
    - "Indici btree su site_briefs(account_id) e site_briefs(site_id)"
  acceptance_criteria:
    - id: AC-120-1
      given: "la migrazione site_briefs applicata su un'istanza Supabase locale"
      when: "interrogo il catalogo pg_class (relrowsecurity) per la relazione public.site_briefs"
      then: "relrowsecurity = true per public.site_briefs (RLS abilitata nel catalogo)"
    - id: AC-120-2
      given: "lo schema applicato"
      when: "interrogo information_schema.columns per public.site_briefs"
      then: "esistono le colonne id, account_id, site_id, business_name, vertical, description, address, geo, hours, phone, whatsapp, email, primary_goal, locale, content, status, created_at, updated_at con account_id NOT NULL, site_id NOT NULL, locale NOT NULL, status NOT NULL default 'draft', content NOT NULL default '{}'"
    - id: AC-120-3
      given: "una riga site_briefs per il sito S"
      when: "inserisco una seconda riga site_briefs con lo stesso site_id=S"
      then: "l'INSERT fallisce con violazione del vincolo unique (SQLSTATE 23505) — 1:1 sito<->brief"
    - id: AC-120-4
      given: "il catalogo pg_policies per public.site_briefs"
      when: "elenco le policy della tabella"
      then: "esistono policy per i comandi SELECT, INSERT, UPDATE e DELETE, tutte con roles = {authenticated}, e nessuna espressione qual/with_check e la costante true"
    - id: AC-120-5
      given: "lo schema applicato"
      when: "inserisco una riga con status='archived' (valore non ammesso)"
      then: "l'INSERT fallisce per violazione del check constraint su status (SQLSTATE 23514)"
    - id: AC-120-6
      given: "l'utente A membro dell'account X (proprietario del sito S) e l'utente B membro del solo account Y, con client ad auth reale"
      when: "B tenta una SELECT/INSERT sul brief del sito S (account X) attraverso il client con la propria sessione"
      then: "la SELECT restituisce insieme vuoto e l'INSERT non scrive alcuna riga (la RLS isola per tenant), verificato attraverso il client e non nell'SQL editor"
  target_tests:
    - file: "tests/site-briefs-schema.test.ts"
      covers: [AC-120-1, AC-120-2, AC-120-3, AC-120-4, AC-120-5, AC-120-6]
  security_notes:
    - "R1: RLS abilitata su public.site_briefs (tabella dello schema public / user-facing)."
    - "R2: almeno una policy per tabella — qui una per ciascun comando."
    - "R3: nessuna policy con USING(true)/WITH CHECK(true) ne 'auth.uid() IS NOT NULL' come sola condizione (verificato in AC-120-4)."
    - "R4: policy vincolate al tenant tramite appartenenza account (is_account_member(account_id)), non a semplice autenticazione (verificato a runtime in AC-120-6 con client ad auth reale)."
    - "R5: clausola TO authenticated su tutte le policy."
    - "R6: la policy UPDATE e accompagnata dalla policy SELECT sulla stessa tabella."
    - "R9: helper is_account_member usa (select auth.uid()) per la cache; le colonne di policy account_id e site_id sono indicizzate."
    - "OWASP A01:2025 (broken access control / RLS-authz): l'isolamento cross-tenant del brief e imposto a livello DB dalle policy; il brief eredita la stessa superficie di sicurezza di sites/T-100."
    - "Trappola del test: R4 verificata attraverso il client con auth reale su Supabase locale (l'SQL editor gira come superuser e darebbe falso verde)."
  out_of_scope:
    - "Server action di lettura/scrittura del brief (T-123)"
    - "Schema di dominio/validazione applicativa (T-121)"
    - "Hosting dei file media (P4): le foto sono solo riferimenti/URL nel content jsonb"

- id: T-121
  title: "Schema di dominio del Business Brief (zod) + validazione"
  macrotask: "brief-model"
  depends_on: []
  objective: >
    Isolare in src/domain/onboarding/brief.ts lo schema zod del Business Brief:
    core (business_name, vertical con allowlist, description, address, geo, hours,
    phone, whatsapp, email, primary_goal con allowlist, locale con allowlist) e
    content flessibile (offerings[] con voce {name, description?, price?, photo_ref?,
    section?}, social_links, highlights[], brand_hints). E' il gate che valida
    l'output del modello e dell'import (input non fidato) prima di qualunque scrittura.
    Funzione pura, indipendente dal DB.
  definition_of_done:
    - "Modulo src/domain/onboarding/brief.ts con BriefSchema (zod) e i tipi TS derivati esportati"
    - "vertical vincolato all'allowlist ('ristorazione','fitness','salone_studio','negozio_artigiano','altro'); primary_goal a ('prenota','ordina','contatta'); locale a ('it','es')"
    - "offerings e una lista di oggetti con name obbligatorio (non vuoto) e campi opzionali description/price/photo_ref/section"
    - "lo schema rifiuta oggetti con valori fuori allowlist e non abilita passthrough di chiavi sconosciute al top-level (strict)"
    - "export di una funzione di parsing sicura (es. parseBrief / safeParse) che ritorna un risultato tipizzato o un errore, senza lanciare su input non fidato"
  acceptance_criteria:
    - id: AC-121-1
      given: "un oggetto brief valido (vertical='ristorazione', primary_goal='contatta', locale='it', un'offerta con name)"
      when: "lo valido con BriefSchema"
      then: "la validazione ha successo e restituisce il brief tipizzato"
    - id: AC-121-2
      given: "un brief con vertical='casino' (fuori allowlist)"
      when: "lo valido con BriefSchema"
      then: "la validazione fallisce indicando il campo vertical, e non restituisce un brief valido"
    - id: AC-121-3
      given: "un brief con primary_goal='spam' (fuori allowlist)"
      when: "lo valido con BriefSchema"
      then: "la validazione fallisce indicando il campo primary_goal"
    - id: AC-121-4
      given: "un'offerta priva di name (o con name vuoto)"
      when: "valido il brief"
      then: "la validazione fallisce indicando la voce offerings priva di name"
    - id: AC-121-5
      given: "un brief con una chiave sconosciuta al top-level (es. is_admin=true)"
      when: "lo valido con BriefSchema in modalita strict"
      then: "la chiave sconosciuta e rifiutata o rimossa, e non finisce nel brief tipizzato"
  target_tests:
    - file: "tests/brief-schema.test.ts"
      covers: [AC-121-1, AC-121-2, AC-121-3, AC-121-4, AC-121-5]
  security_notes:
    - "OWASP A05:2025 (validation & business logic): il brief e alimentato da output del modello e da HTML importato — input NON FIDATO; lo schema e il confine di validazione server-side che impedisce a valori arbitrari di raggiungere il DB (ASVS Validation & Business Logic)."
    - "Le allowlist (vertical/primary_goal/locale) sono enum chiusi: nessun valore inatteso puo passare a valle."
  out_of_scope:
    - "Fusione degli aggiornamenti e completamento (T-122)"
    - "Persistenza (T-123)"

- id: T-122
  title: "applyBriefUpdate + isBriefComplete (fusione e completamento, puri)"
  macrotask: "brief-model"
  depends_on: [T-121]
  objective: >
    In src/domain/onboarding/brief.ts, aggiungere due funzioni pure: applyBriefUpdate
    (brief, update) che fonde un aggiornamento parziale (proveniente da una tool-call
    update_brief o da un import) nel brief in modo deterministico — valida l'update con
    BriefSchema (T-121), sovrascrive i campi core presenti, e per offerings aggiorna la
    voce con lo stesso name o la appende; e isBriefComplete(brief) che ritorna true solo
    quando i campi core richiesti (almeno business_name, vertical, primary_goal, locale)
    sono presenti. Nessun effetto collaterale, nessuna dipendenza dal DB.
  definition_of_done:
    - "Funzione pura applyBriefUpdate(brief, update): valida l'update (T-121), applica i soli campi presenti, non cancella campi non menzionati"
    - "Merge delle offerings: una voce con name gia presente aggiorna quella voce; un name nuovo la appende (nessun duplicato per name)"
    - "Un update con un campo invalido (es. vertical fuori allowlist) e rifiutato/ignorato per quel campo e non corrompe il brief"
    - "Funzione pura isBriefComplete(brief): true solo se business_name, vertical, primary_goal e locale sono valorizzati"
  acceptance_criteria:
    - id: AC-122-1
      given: "un brief con business_name assente e altri campi valorizzati"
      when: "applico un update {business_name: 'Bar Sole'}"
      then: "il brief risultante ha business_name='Bar Sole' e tutti gli altri campi restano invariati"
    - id: AC-122-2
      given: "un brief con offerings=[{name:'Caffe'}]"
      when: "applico un update con offerings=[{name:'Caffe', price:'1.20'},{name:'Cornetto'}]"
      then: "il risultato ha la voce 'Caffe' aggiornata con price='1.20' e la voce 'Cornetto' appesa (due offerte, nessun duplicato)"
    - id: AC-122-3
      given: "un brief valido"
      when: "applico un update con vertical='casino' (fuori allowlist)"
      then: "il campo vertical del brief resta invariato e la funzione segnala/scarta il valore invalido senza lanciare"
    - id: AC-122-4
      given: "un brief privo di primary_goal"
      when: "chiamo isBriefComplete(brief)"
      then: "ritorna false"
    - id: AC-122-5
      given: "un brief con business_name, vertical, primary_goal e locale tutti valorizzati"
      when: "chiamo isBriefComplete(brief)"
      then: "ritorna true"
  target_tests:
    - file: "tests/brief-apply.test.ts"
      covers: [AC-122-1, AC-122-2, AC-122-3, AC-122-4, AC-122-5]
  security_notes:
    - "OWASP A05:2025 (validation): applyBriefUpdate ri-valida ogni update con BriefSchema (T-121) prima di fondere — l'output del modello (untrusted) non viene mai scritto grezzo nel brief."
  out_of_scope:
    - "Persistenza / RLS (T-123)"
    - "Orchestrazione della chat (T-132)"

- id: T-123
  title: "Server actions briefs (get/upsert/confirm) + isolamento RLS a runtime"
  macrotask: "brief-model"
  depends_on: [T-120, T-122]
  objective: >
    Implementare in src/data/briefs.ts le server action getBrief(siteId),
    upsertBrief(siteId, update) e confirmBrief(siteId), eseguite solo server-side, che
    usano il client Supabase legato alla sessione (RLS attiva) e MAI la service_role.
    L'account_id e derivato dall'identita (auth.uid() -> owner_id, come sites/T-101),
    non da input client. upsertBrief valida l'update con applyBriefUpdate/BriefSchema
    (T-122/T-121) prima di scrivere e usa solo metodi tipati (.eq/.select/.upsert), mai
    interpolazione in .or()/.filter(). confirmBrief imposta status='confirmed'.
  definition_of_done:
    - "Modulo server-side src/data/briefs.ts con getBrief(siteId), upsertBrief(siteId, update), confirmBrief(siteId) invocabili solo dal server"
    - "upsertBrief valida l'update (T-122/T-121) e rifiuta input invalido senza scrivere"
    - "l'account_id e derivato dall'appartenenza/owner dell'utente autenticato, non da input client arbitrario"
    - "le azioni usano il client con sessione (RLS) e metodi tipati .eq/.select/.upsert/.update — nessuna interpolazione in .or()/.filter()"
    - "confirmBrief imposta status='confirmed' sul brief del sito"
    - "le azioni non importano ne usano la service_role key per la CRUD del brief"
  acceptance_criteria:
    - id: AC-123-1
      given: "l'utente A autenticato, membro dell'account X proprietario del sito S"
      when: "chiama upsertBrief(S, {business_name:'Bar Sole', vertical:'ristorazione'})"
      then: "esiste una riga site_briefs con account_id=X, site_id=S, business_name='Bar Sole', status='draft'"
    - id: AC-123-2
      given: "il brief del sito S nell'account X (utente A) e l'utente B del solo account Y"
      when: "B autenticato chiama getBrief(S)"
      then: "il risultato e vuoto/negato (la RLS isola per tenant); A che chiama getBrief(S) ottiene il proprio brief"
    - id: AC-123-3
      given: "l'utente A con un brief draft sul sito S"
      when: "chiama confirmBrief(S)"
      then: "una successiva getBrief(S) mostra status='confirmed'"
    - id: AC-123-4
      given: "l'utente A autenticato sul sito S"
      when: "chiama upsertBrief(S, {vertical:'casino'}) con valore fuori allowlist"
      then: "l'azione rifiuta con errore di validazione e nessun campo invalido viene scritto"
    - id: AC-123-5
      given: "nessuna sessione autenticata"
      when: "si invoca getBrief/upsertBrief/confirmBrief"
      then: "l'azione fallisce con errore di autenticazione e non viene scritta ne restituita alcuna riga"
    - id: AC-123-6
      given: "l'utente B autenticato che NON e membro dell'account di A e il sito S di A"
      when: "B chiama upsertBrief(S, {...})"
      then: "l'operazione e rifiutata (derivazione server-side dell'account e/o WITH CHECK RLS) e nessuna riga del brief di S viene modificata"
  target_tests:
    - file: "tests/briefs-actions.test.ts"
      covers: [AC-123-1, AC-123-2, AC-123-3, AC-123-4, AC-123-5, AC-123-6]
  security_notes:
    - "R1/R4: l'isolamento cross-tenant di get/upsert/confirm si appoggia alla RLS di site_briefs (appartenenza account), verificata con client ad auth reale su Supabase locale (AC-123-2, AC-123-6)."
    - "R7: la service_role bypassa la RLS ed e confinata server-side; la CRUD del brief usa deliberatamente il client con sessione utente perche la RLS resti attiva."
    - "OWASP A01:2025: l'account_id e derivato dall'identita (auth.uid()->owner_id) e mai fidato dal client (validazione identita sempre server-side)."
    - "OWASP A05:2025 (injection, incl. PostgREST filter injection): solo metodi tipati .eq()/.upsert()/.select()/.update(), mai .or()/.filter() con input interpolato; upsertBrief ri-valida l'update (T-121)."
    - "OWASP A07:2025/A02:2025 (segreti): anon key da NEXT_PUBLIC_SUPABASE_ANON_KEY; service_role solo da env server; nessun segreto hardcoded."
  out_of_scope:
    - "Orchestrazione della chat / modello (T-132)"
    - "UI onboarding (macrotask onboarding-ui)"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir del blueprint P1 — atteso exit 0.
- **Semantico** (checklist guidata): punti 6–10 su ogni task; i rilievi vanno all'human-in-the-loop.
