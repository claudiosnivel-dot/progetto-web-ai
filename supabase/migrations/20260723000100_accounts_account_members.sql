-- T-060 (macrotask tenancy) — Schema multi-tenant: accounts + account_members + RLS.
--
-- Modello account "personale, pronto per team": la LETTURA e ancorata
-- all'appartenenza all'account (account_members) tramite public.is_account_member,
-- mentre le SCRITTURE su account_members sono ristrette al solo OWNER dell'account
-- (accounts.owner_id), cosi da impedire l'escalation di ruolo intra-tenant
-- (un editor non puo auto-promuoversi a owner ne aggiungere membri).
--
-- Riferimenti: docs/blueprint/P0-foundations/05-tenancy.md (T-060),
--              docs/blueprint/P0-foundations/00-INDEX.md (decision ledger).
-- Applicata dopo 20260723000000_baseline.sql; l'auto-provision (T-062) e la
-- tabella profiles (T-061) arrivano nelle migrazioni successive del macrotask.

-- ── Tabelle ──────────────────────────────────────────────────────────────────

create table public.accounts (
  id         uuid primary key default gen_random_uuid(),
  -- on delete cascade: alla rimozione dell'utente il suo account personale
  -- (creato dall'auto-provision T-062) e i dati derivati vengono eliminati.
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name       text,
  created_at timestamptz not null default now()
);

create table public.account_members (
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

-- ── Helper di appartenenza (usato dalle policy di lettura) ───────────────────
-- SECURITY DEFINER: la funzione e invocata DENTRO la policy SELECT di
-- account_members e deve leggere account_members BYPASSANDO la RLS, altrimenti
-- si innescherebbe una ricorsione infinita di policy. search_path fisso e corpo
-- solo-parametro + (select auth.uid()), senza SQL dinamico, prevengono
-- hijack/injection (R8/R9). (select auth.uid()) abilita il caching del planner.

create function public.is_account_member(a_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.account_members m
    where m.account_id = a_id
      and m.user_id = (select auth.uid())
  );
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.accounts enable row level security;
alter table public.account_members enable row level security;

-- accounts: LETTURA vincolata all'appartenenza all'account. Il predicato di tenancy
-- e' reso ESPLICITO ((select auth.uid()) = owner_id) ACCANTO al check di appartenenza
-- generale public.is_account_member(id): l'owner e' sempre membro del proprio account
-- (auto-provision T-062), quindi la semantica "accesso per appartenenza" NON cambia a
-- runtime (provata da tenant_isolation AC-063-1), ma auth.uid()/owner_id compaiono nel
-- TESTO della policy -> isolamento tenant auditabile staticamente (no predicato nascosto
-- nella funzione). is_account_member resta per i membri non-owner (team, futuro).
create policy accounts_select_member
  on public.accounts
  for select
  to authenticated
  using (
    (select auth.uid()) = owner_id
    or public.is_account_member(id)
  );

-- account_members: LETTURA vincolata all'appartenenza (i co-membri sono visibili).
create policy account_members_select_member
  on public.account_members
  for select
  to authenticated
  using (public.is_account_member(account_id));

-- account_members: INSERT consentito solo all'OWNER dell'account di destinazione.
create policy account_members_insert_owner
  on public.account_members
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.accounts a
      where a.id = account_id
        and a.owner_id = (select auth.uid())
    )
  );

-- account_members: UPDATE consentito solo all'OWNER; la SELECT sopra e la sua
-- companion (R6). Blocca l'auto-promozione editor -> owner.
create policy account_members_update_owner
  on public.account_members
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.accounts a
      where a.id = account_id
        and a.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.accounts a
      where a.id = account_id
        and a.owner_id = (select auth.uid())
    )
  );

-- account_members: DELETE consentito solo all'OWNER.
create policy account_members_delete_owner
  on public.account_members
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.accounts a
      where a.id = account_id
        and a.owner_id = (select auth.uid())
    )
  );

-- ── GRANT privilegi ai ruoli della Data API ──────────────────────────────────
-- config.toml NON attiva auto_expose_new_tables (default: nuove entita in public
-- NON raggiungibili da anon/authenticated/service_role senza GRANT espliciti).
-- La RLS resta il gate FINE (quali righe); il GRANT e il gate COARSE (la tabella).
-- Le operazioni prive di policy (es. UPDATE/DELETE di accounts da authenticated)
-- restano bloccate dalla RLS (default-deny): il GRANT non allarga l'accesso alle
-- righe, serve solo a far rispondere PostgREST (0 righe) invece di 42501. Nessun
-- GRANT ad anon: queste tabelle non prevedono accesso anonimo.
grant select, insert, update, delete on public.accounts to authenticated;
grant select, insert, update, delete on public.account_members to authenticated;
grant select, insert, update, delete on public.accounts to service_role;
grant select, insert, update, delete on public.account_members to service_role;

-- is_account_member e chiamata sia via RPC dal client autenticato sia dentro la
-- policy SELECT (valutata come ruolo authenticated): serve EXECUTE esplicito
-- (auto_expose-off puo revocare il default EXECUTE a PUBLIC sulle nuove funzioni).
grant execute on function public.is_account_member(uuid) to authenticated;
