-- T-100 (macrotask sites) — Schema account-scoped public.sites + RLS + unicità slug.
--
-- Strato dati minimo del "segnaposto sito" (nessuna generazione AI: quella è P2).
-- L'isolamento cross-tenant è imposto a livello DB dalle policy RLS, ancorate
-- all'appartenenza all'account tramite public.is_account_member(account_id)
-- (definita in 20260723000100_accounts_account_members.sql): un utente accede
-- SOLO ai siti degli account di cui è membro (R1/R4).
--
-- account_id compare ESPLICITAMENTE nel testo di ogni policy: l'isolamento resta
-- così auditabile staticamente dall'oracolo RLS (lezione RLS004 di tenancy —
-- un predicato di tenancy nascosto solo dentro una funzione DEFINER non è
-- visibile allo static check). Qui la colonna di tenancy è account_id ed è citata
-- direttamente nell'argomento di is_account_member(account_id).
--
-- Unicità slug PER-ACCOUNT (UNIQUE(account_id, slug)), NON globale: due account
-- possono avere lo stesso slug, evitando che un fallimento di unique cross-account
-- riveli l'esistenza di uno slug in un altro tenant (A01:2025 — no enumerazione
-- cross-tenant).
--
-- Riferimenti: docs/blueprint/P0-foundations/06-sites.md (T-100),
--              docs/blueprint/P0-foundations/00-INDEX.md (decision ledger).
-- Applicata dopo le migrazioni di tenancy: public.accounts e la funzione
-- public.is_account_member(uuid) esistono già.

-- ── Tabella ──────────────────────────────────────────────────────────────────

create table public.sites (
  id         uuid primary key default gen_random_uuid(),
  -- on delete cascade: alla rimozione dell'account (a sua volta a cascata dalla
  -- rimozione dell'utente owner) i siti dell'account vengono eliminati.
  account_id uuid not null references public.accounts (id) on delete cascade,
  name       text not null,
  slug       text not null,
  status     text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz default now(),
  -- Unicità PER-ACCOUNT dello slug: evita l'enumerazione cross-tenant che una
  -- unique globale renderebbe possibile (un 23505 cross-account rivelerebbe uno
  -- slug altrui). L'indice implicito di questo vincolo copre anche il prefisso
  -- account_id.
  unique (account_id, slug)
);

comment on table public.sites is
  'Belora — sito (segnaposto V1) account-scoped; RLS per appartenenza; slug unico per-account.';

-- Indice btree dedicato sulla colonna di policy account_id (R9): sostiene la
-- valutazione della RLS e i filtri per account. È richiesto esplicitamente dal
-- contratto T-100; l'indice del vincolo UNIQUE(account_id, slug) copre lo stesso
-- prefisso, ma un indice dedicato rende l'intento (colonna di policy indicizzata)
-- esplicito e indipendente dall'evoluzione del vincolo.
create index sites_account_id_idx on public.sites (account_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.sites enable row level security;

-- SELECT: un utente legge i siti degli account di cui è membro. È la companion
-- della policy UPDATE (R6). account_id nel testo → isolamento auditabile (R4).
create policy sites_select_member
  on public.sites
  for select
  to authenticated
  using (public.is_account_member(account_id));

-- INSERT: si può creare un sito SOLO in un account di cui si è membri (WITH
-- CHECK). La server action (T-101) deriva comunque account_id dall'identità
-- dell'utente; questa WITH CHECK è il gate a livello DB, indipendente dal codice
-- applicativo (AC-101-5: un account_id forzato verso un altro tenant è respinto qui).
create policy sites_insert_member
  on public.sites
  for insert
  to authenticated
  with check (public.is_account_member(account_id));

-- UPDATE: modifica consentita solo sui siti dei propri account. USING filtra le
-- righe visibili; WITH CHECK impedisce anche di "spostare" un sito verso un
-- account non proprio riscrivendo account_id.
create policy sites_update_member
  on public.sites
  for update
  to authenticated
  using (public.is_account_member(account_id))
  with check (public.is_account_member(account_id));

-- DELETE: eliminazione consentita solo sui siti dei propri account.
create policy sites_delete_member
  on public.sites
  for delete
  to authenticated
  using (public.is_account_member(account_id));

-- ── GRANT privilegi ai ruoli della Data API ──────────────────────────────────
-- Come per accounts/account_members/profiles: config.toml non attiva
-- auto_expose_new_tables, quindi la nuova tabella in public va resa raggiungibile
-- via GRANT espliciti. La RLS resta il gate FINE (quali righe); il GRANT è il gate
-- COARSE (la tabella risponde via PostgREST). Nessun GRANT ad anon: i siti non
-- prevedono accesso anonimo. service_role (oracolo/setup) bypassa la RLS ma
-- necessita comunque del GRANT di tabella.
grant select, insert, update, delete on public.sites to authenticated;
grant select, insert, update, delete on public.sites to service_role;
