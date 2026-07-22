# 05-tenancy — Macrotask `tenancy` · Multi-tenant & RLS

> Modulo del blueprint P0 (fondamenta) di Belora. Un modulo = un macrotask:
> l'unita al cui confine gira il checkpoint e l'unita di commit atomico.
> Task atomici secondo lo schema trueline (id/AC/target_tests/security_notes).

## Obiettivo del macrotask

Modello dati multi-tenant (accounts, account_members, profiles) con RLS ancorata all appartenenza all account, auto-provision dell account personale su signup, isolamento tenant provato a runtime attraverso il client.

## Task atomici

```yaml
- id: T-060
  title: "Schema accounts + account_members + RLS"
  macrotask: "tenancy"
  depends_on: [T-004, T-005]
  objective: "Creare la migrazione SQL che definisce nello schema public le tabelle accounts e account_members secondo il contratto di naming, crea la funzione helper public.is_account_member(a_id uuid) che fa EXISTS su account_members usando (select auth.uid()), abilita RLS su entrambe le tabelle e definisce policy TO authenticated: la LETTURA (SELECT) su accounts e account_members e vincolata all'appartenenza (is_account_member), mentre le MUTAZIONI di account_members (INSERT/UPDATE/DELETE) sono ristrette al solo OWNER dell'account (accounts.owner_id = (select auth.uid())) per impedire l'escalation di ruolo intra-tenant. Nessuna USING(true)/WITH CHECK(true) e nessuna condizione basata solo su auth.uid() IS NOT NULL."
  definition_of_done:
    - "File supabase/migrations/<timestamp>_accounts_account_members.sql presente e applicabile con supabase db reset senza errori."
    - "Tabella public.accounts creata con colonne id uuid pk default gen_random_uuid(), owner_id uuid not null references auth.users, name text, created_at timestamptz default now()."
    - "Tabella public.account_members creata con colonne account_id uuid references accounts on delete cascade, user_id uuid references auth.users, role text not null check (role in ('owner','editor')), created_at timestamptz default now(), primary key (account_id, user_id)."
    - "Funzione public.is_account_member(a_id uuid) returns boolean definita come EXISTS(select 1 from account_members m where m.account_id = a_id and m.user_id = (select auth.uid()))."
    - "RLS abilitata su accounts e account_members (relrowsecurity = true nel catalogo pg_class)."
    - "Policy TO authenticated: SELECT vincolata via is_account_member; INSERT/UPDATE/DELETE su account_members ristrette all'owner dell'account (owner_id = (select auth.uid())); nessuna USING(true)/WITH CHECK(true); ogni UPDATE accompagnato da una policy SELECT companion."
  acceptance_criteria:
    - id: AC-060-1
      given: "la migrazione applicata su un DB Supabase locale pulito"
      when: "interrogo information_schema.columns per public.accounts e public.account_members"
      then: "accounts espone esattamente le colonne id (uuid, NOT NULL, default gen_random_uuid()), owner_id (uuid, NOT NULL), name (text), created_at (timestamptz); account_members espone account_id (uuid), user_id (uuid), role (text, NOT NULL), created_at (timestamptz)"
    - id: AC-060-2
      given: "la tabella account_members creata"
      when: "interrogo pg_constraint / information_schema.table_constraints per account_members"
      then: "esiste una PRIMARY KEY composta su (account_id, user_id), un CHECK che limita role ai valori 'owner' e 'editor', e una FOREIGN KEY account_id -> accounts con ON DELETE CASCADE"
    - id: AC-060-3
      given: "la migrazione applicata"
      when: "interrogo pg_class.relrowsecurity per public.accounts e public.account_members"
      then: "relrowsecurity = true per entrambe le tabelle"
    - id: AC-060-4
      given: "le policy definite sulle due tabelle"
      when: "interrogo pg_policies filtrando per accounts e account_members"
      then: "ogni tabella ha almeno una policy, nessuna policy ha qualifica USING (true) o WITH CHECK (true) o auth.uid() IS NOT NULL come sola condizione, e ogni policy ha roles = {authenticated}"
    - id: AC-060-5
      given: "un account e una membership owner inseriti via service_role, con l'utente owner autenticato tramite client reale"
      when: "l'utente esegue select public.is_account_member('<account_id>')"
      then: "ritorna true per il proprio account e false per un account di cui non è membro"
    - id: AC-060-6
      given: "l'insieme delle policy di accounts e account_members"
      when: "elenco i comandi coperti in pg_policies (cmd)"
      then: "per ogni tabella che possiede una policy per UPDATE esiste anche una policy per SELECT (companion R6)"
    - id: AC-060-7
      given: "un account con un membro editor E (role='editor') inserito via service_role, con E autenticato tramite client reale"
      when: "E tenta un UPDATE account_members set role='owner' sulla propria riga oppure un INSERT di un nuovo membro nel proprio account"
      then: "entrambe le operazioni colpiscono 0 righe (RLS owner-only) e, verificato via service_role, il ruolo di E resta 'editor' e nessun nuovo membro risulta aggiunto"
  target_tests:
    - file: "tests/accounts_schema.test.ts"
      covers: [AC-060-1, AC-060-2, AC-060-3, AC-060-4, AC-060-6]
    - file: "tests/is_account_member.test.ts"
      covers: [AC-060-5]
    - file: "tests/account_members_rls.test.ts"
      covers: [AC-060-7]
  security_notes:
    - "R1: RLS abilitata su accounts e account_members (relrowsecurity=true)."
    - "R2: almeno una policy per tabella."
    - "R3: vietate USING(true)/WITH CHECK(true) e la sola auth.uid() IS NOT NULL."
    - "R4: policy vincolate per identità/tenant tramite public.is_account_member (appartenenza) e owner_id."
    - "R5: clausola TO authenticated su tutte le policy."
    - "R6: ogni policy UPDATE accompagnata da una policy SELECT."
    - "R9: usa (select auth.uid()) per caching del planner; le colonne di policy (account_members.account_id, user_id) sono indicizzate dalla PRIMARY KEY composita."
    - "OWASP A01:2025 (Broken Access Control): l'isolamento tenant è imposto dalla RLS lato DB."
    - "R4 / A01:2025 (escalation di ruolo intra-tenant): le scritture su account_members sono limitate all'owner dell'account; un membro editor non puo auto-promuoversi a owner ne aggiungere membri (verificato in AC-060-7). L'appartenenza generica (is_account_member) governa la sola lettura."
  out_of_scope:
    - "Tabella sites e relative policy (macrotask separato)."
    - "Auto-provision di account/membership su signup (T-062)."
    - "Qualsiasi UI di dashboard o endpoint applicativo."

- id: T-061
  title: "Schema profiles + RLS"
  macrotask: "tenancy"
  depends_on: [T-004, T-005]
  objective: "Creare la migrazione SQL per la tabella public.profiles secondo il contratto di naming (id references auth.users on delete cascade, display_name, locale check in ('it','es') default 'it', created_at), abilitare RLS e definire policy che vincolano l'accesso alla sola riga dell'utente con id = (select auth.uid()), TO authenticated, coprendo SELECT/INSERT/UPDATE con la SELECT come companion della UPDATE."
  definition_of_done:
    - "File supabase/migrations/<timestamp>_profiles.sql presente e applicabile con supabase db reset senza errori."
    - "Tabella public.profiles con colonne id uuid primary key references auth.users on delete cascade, display_name text, locale text check (locale in ('it','es')) default 'it', created_at timestamptz default now()."
    - "RLS abilitata su profiles (relrowsecurity = true)."
    - "Policy TO authenticated con condizione (select auth.uid()) = id per SELECT/INSERT/UPDATE, senza USING(true)/WITH CHECK(true)."
  acceptance_criteria:
    - id: AC-061-1
      given: "la migrazione applicata su DB locale pulito"
      when: "interrogo information_schema.columns e pg_constraint per public.profiles"
      then: "esiste public.profiles con id (uuid, PRIMARY KEY), display_name (text), locale (text), created_at (timestamptz) e una FOREIGN KEY id -> auth.users con ON DELETE CASCADE"
    - id: AC-061-2
      given: "la colonna locale di profiles"
      when: "interrogo il CHECK e il valore di default della colonna"
      then: "il CHECK limita locale ai valori 'it' e 'es' e il default della colonna è 'it'"
    - id: AC-061-3
      given: "la migrazione applicata"
      when: "interrogo pg_class.relrowsecurity per public.profiles"
      then: "relrowsecurity = true"
    - id: AC-061-4
      given: "le policy di profiles"
      when: "interrogo pg_policies per profiles"
      then: "ogni policy ha roles = {authenticated}, usa la condizione (select auth.uid()) = id (nessuna USING(true)/WITH CHECK(true) né auth.uid() IS NOT NULL da sola) e la policy UPDATE è accompagnata da una policy SELECT"
    - id: AC-061-5
      given: "due utenti autenticati A e B con le rispettive righe profiles inserite via service_role"
      when: "A, tramite client con auth reale, esegue select * from profiles e poi tenta update profiles set display_name = 'x' where id = <id di B>"
      then: "la select restituisce SOLO la riga di A (riga di B assente) e la update aggiorna 0 righe lasciando invariata la riga di B"
  target_tests:
    - file: "tests/profiles_schema.test.ts"
      covers: [AC-061-1, AC-061-2, AC-061-3, AC-061-4]
    - file: "tests/profiles_rls.test.ts"
      covers: [AC-061-5]
  security_notes:
    - "R1: RLS abilitata su profiles."
    - "R2: almeno una policy per il comando SELECT/INSERT/UPDATE."
    - "R3: vietate USING(true)/WITH CHECK(true)."
    - "R4: policy vincolata per identità con (select auth.uid()) = id."
    - "R5: clausola TO authenticated."
    - "R6: policy UPDATE accompagnata da policy SELECT."
    - "OWASP A01:2025 (Broken Access Control): ogni utente accede solo alla propria riga profilo, imposto dalla RLS."
    - "Validazione lato server: locale ammesso solo tra i valori del CHECK, mai fidarsi del client."
    - "R9: uso di (select auth.uid()) nelle policy per il caching del planner; la colonna di policy id e indicizzata dalla PRIMARY KEY."
  out_of_scope:
    - "Auto-provision della riga profiles su signup (T-062)."
    - "UI/logica di cambio lingua (next-intl) e componenti dashboard."

- id: T-062
  title: "Auto-provision account/profilo su signup"
  macrotask: "tenancy"
  depends_on: [T-060, T-061, T-042, T-005]
  objective: "Creare la funzione public.handle_new_user() SECURITY DEFINER con search_path fisso e authz propria che opera esclusivamente su NEW.id, e il trigger AFTER INSERT su auth.users che, alla creazione di un nuovo utente, crea un account personale, la membership owner in account_members e la riga profiles con locale di default. L'operazione è idempotente (ON CONFLICT DO NOTHING) così che ritentativi non producano duplicati."
  definition_of_done:
    - "File supabase/migrations/<timestamp>_auto_provision.sql presente e applicabile con supabase db reset senza errori."
    - "Funzione public.handle_new_user() definita SECURITY DEFINER con search_path esplicito (es. set search_path = public, pg_temp) che opera solo su NEW.id."
    - "Trigger AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user() installato."
    - "Alla creazione di un nuovo utente vengono create: 1 riga accounts (owner_id = nuovo utente), 1 riga account_members (role='owner', user_id = nuovo utente), 1 riga profiles (id = nuovo utente, locale='it')."
    - "Le insert usano ON CONFLICT DO NOTHING per garantire idempotenza."
  acceptance_criteria:
    - id: AC-062-1
      given: "il trigger installato su un DB locale"
      when: "creo un nuovo utente U tramite Supabase Auth (admin API / signup)"
      then: "esiste esattamente 1 riga in accounts con owner_id = U"
    - id: AC-062-2
      given: "lo stesso signup dell'utente U"
      when: "interrogo account_members"
      then: "esiste esattamente 1 riga con account_id = l'account creato per U, user_id = U e role = 'owner'"
    - id: AC-062-3
      given: "lo stesso signup dell'utente U"
      when: "interrogo profiles"
      then: "esiste esattamente 1 riga con id = U e locale = 'it'"
    - id: AC-062-4
      given: "la funzione handle_new_user creata"
      when: "interrogo pg_proc (prosecdef, proconfig) / pg_get_functiondef"
      then: "prosecdef = true (SECURITY DEFINER) e proconfig contiene un search_path esplicito impostato sulla funzione"
    - id: AC-062-5
      given: "un utente U già provisionato"
      when: "il trigger viene rieseguito o il signup viene ritentato per lo stesso id U"
      then: "il conteggio delle righe accounts con owner_id = U resta 1, nessuna riga duplicata in account_members/profiles e nessun errore di violazione PK non gestito"
  target_tests:
    - file: "tests/auto_provision.test.ts"
      covers: [AC-062-1, AC-062-2, AC-062-3, AC-062-5]
    - file: "tests/auto_provision_secdef.test.ts"
      covers: [AC-062-4]
  security_notes:
    - "R7: la service_role usata dal test per creare utenti resta confinata server-side (mai nel browser); ogni uso fa authz esplicita."
    - "R8: la funzione SECURITY DEFINER fa authz propria operando solo su NEW.id e imposta un search_path fisso per prevenire hijack/privilege escalation."
    - "A05:2025 (Injection): nessuna interpolazione di stringhe nella funzione, si usa NEW.id parametrizzato/tipato."
    - "A07:2025/A02:2025 (Secret/Crypto): la service_role key è letta da env server-side, mai hardcoded."
    - "OWASP A01:2025 (Broken Access Control): il provisioning assegna il ruolo owner solo all'utente appena creato."
  out_of_scope:
    - "Gestione di inviti/collaboratori multipli (in V1 esiste solo la riga owner)."
    - "UI di onboarding o dashboard."
    - "Import da Google Business Profile / Instagram (macrotask separato)."

- id: T-063
  title: "Test RLS a runtime (isolamento tenant)"
  macrotask: "tenancy"
  depends_on: [T-060, T-061, T-062, T-005]
  objective: "Realizzare una suite di test a runtime eseguita ATTRAVERSO il client Supabase con autenticazione reale su istanza locale (supabase start) che prova l'isolamento tenant: l'utente A non può leggere né scrivere (insert/update/delete) dati dell'account B su accounts e account_members, e non può aggiungersi come membro di un account di cui non fa parte. La suite include un guardrail che confronta la vista del client autenticato con quella della service_role per escludere il falso verde da assenza di dati; i test non girano mai nell'SQL editor di Supabase (che gira come superuser e bypassa la RLS)."
  definition_of_done:
    - "File tests/tenant_isolation.test.ts presente ed eseguibile con vitest contro Supabase locale."
    - "Setup che provisiona due utenti A e B, ciascuno con il proprio account (via signup + auto-provision) e client autenticati distinti."
    - "Ogni blocco di test che esercita un AC riporta un commento // covers: <AC-id>."
    - "I test usano metodi tipati (.eq(), .insert(), .update(), .delete()) e non .or()/.filter() con input interpolato."
    - "La suite fallisce se la RLS viene disabilitata (verde = isolamento provato dalla RLS, non da assenza di dati)."
  acceptance_criteria:
    - id: AC-063-1
      given: "utenti A e B autenticati con account distinti"
      when: "A, tramite il proprio client autenticato, esegue select su accounts"
      then: "il result set contiene SOLO l'account di A e l'account di B è assente"
    - id: AC-063-2
      given: "A autenticato"
      when: "A esegue select su account_members con .eq('account_id', <account di B>)"
      then: "il result set è vuoto (0 righe)"
    - id: AC-063-3
      given: "A autenticato"
      when: "A tenta un insert in account_members per aggiungersi come membro dell'account di B"
      then: "l'operazione è rifiutata dalla RLS (errore o 0 righe inserite) e nessuna nuova membership per l'account di B risulta creata (verificato via service_role)"
    - id: AC-063-4
      given: "A autenticato"
      when: "A tenta update di accounts.name con .eq('id', <account di B>)"
      then: "0 righe aggiornate e il name dell'account di B resta invariato (verificato via service_role)"
    - id: AC-063-5
      given: "A autenticato"
      when: "A tenta delete su accounts con .eq('id', <account di B>)"
      then: "0 righe eliminate e l'account di B esiste ancora (verificato via service_role)"
    - id: AC-063-6
      given: "la stessa asserzione di isolamento eseguita sia col client autenticato di A sia con la service_role"
      when: "confronto le due letture dell'account di B"
      then: "la service_role VEDE l'account di B mentre il client autenticato di A NON lo vede, confermando che il verde deriva dalla RLS e non dall'assenza di dati"
    - id: AC-063-7
      given: "un account con un membro editor E (creato via service_role) e E autenticato"
      when: "E tenta update account_members set role='owner' sulla propria riga o insert di un nuovo membro nel proprio account"
      then: "0 righe modificate/inserite (policy owner-only) e, verificato via service_role, il ruolo di E resta 'editor'"
  target_tests:
    - file: "tests/tenant_isolation.test.ts"
      covers: [AC-063-1, AC-063-2, AC-063-3, AC-063-4, AC-063-5, AC-063-6, AC-063-7]
  security_notes:
    - "R4: le policy vincolate per tenant (appartenenza account) sono provate a runtime su lettura e scrittura."
    - "R7: la service_role è usata solo nel setup/asserzioni server-side (mai nel browser) e serve da oracolo di verità per distinguere isolamento da assenza di dati."
    - "Trappola SQL editor: i test RLS girano ATTRAVERSO il client con auth reale su Supabase locale, MAI nell'SQL editor che esegue come superuser e bypassa la RLS producendo falso verde."
    - "A05:2025 (Injection / PostgREST filter injection): si usano metodi tipati .eq()/.insert()/.update()/.delete(), non .or()/.filter() con input interpolato."
    - "OWASP A01:2025 (Broken Access Control): la suite è la prova a runtime dell'isolamento tenant."
    - "R4 / A01:2025: la suite prova, oltre all'isolamento cross-tenant, l'assenza di escalation di ruolo intra-tenant (un editor non diventa owner ne aggiunge membri)."
  out_of_scope:
    - "Test di isolamento sulla tabella sites (macrotask separato)."
    - "Test di performance/carico."
    - "Test end-to-end della UI dashboard."
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir del blueprint — atteso exit 0.
- **Semantico** (checklist guidata): punti 6–10 su ogni task; i rilievi vanno all'human-in-the-loop.
