-- Belora — P0 / tenancy (T-061): tabella public.profiles + RLS.
-- Profilo 1:1 con auth.users (profiles.id = id utente). RLS ancorata all'identita:
-- ogni utente accede SOLO alla propria riga tramite (select auth.uid()) = id.
-- Coperti SELECT/INSERT/UPDATE; la SELECT e la companion della UPDATE (R6).
-- Binding per identita: nessuna USING(true)/WITH CHECK(true) e nessuna sola
-- auth.uid() IS NOT NULL (R3/R4). Uso di (select auth.uid()) per il caching del
-- planner (R9); la colonna di policy id e indicizzata dalla PRIMARY KEY.

create table public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text,
  -- NOT NULL: chiude il gap del CHECK (NULL IN (...) -> NULL, che soddisferebbe il
  -- CHECK) e impone davvero l'invariante "locale solo tra 'it'/'es'" del security_note.
  -- Allineato al default 'it' e all'insert dell'auto-provision (T-062, locale='it').
  locale       text not null check (locale in ('it', 'es')) default 'it',
  created_at   timestamptz default now()
);

comment on table public.profiles is 'Belora — profilo utente (1:1 con auth.users); locale IT/ES.';

alter table public.profiles enable row level security;

-- SELECT: l'utente legge SOLO la propria riga (companion della UPDATE, R6).
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

-- INSERT: l'utente puo creare SOLO la riga con il proprio id.
create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

-- UPDATE: l'utente modifica SOLO la propria riga (USING + WITH CHECK per identita).
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ── GRANT privilegi ai ruoli della Data API ──────────────────────────────────
-- Come accounts/account_members: senza auto_expose_new_tables, profiles va reso
-- raggiungibile via GRANT espliciti; la RLS resta il gate fine (ogni utente
-- vede/scrive solo la propria riga). service_role (oracolo) bypassa la RLS ma
-- necessita comunque del GRANT di tabella. Nessun GRANT ad anon.
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;
