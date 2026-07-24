-- T-120 (macrotask brief-model, P1) — Schema account-scoped public.site_briefs.
--
-- Il Business Brief e l'entita 1:1 con un sito (site_id UNIQUE, FK verso
-- public.sites on delete cascade): e l'artefatto che P2 consumera per generare i
-- 5 mockup. E' account-scoped e isolato per tenant dalla RLS, con la stessa
-- superficie di sicurezza di public.sites (T-100): policy ancorate a
-- public.is_account_member(account_id), con account_id ESPLICITO nel testo di
-- ogni policy → isolamento auditabile staticamente dall'oracolo RLS (lezione
-- RLS004 di tenancy). UNIQUE(site_id) impone il vincolo 1:1 sito<->brief.
--
-- Confine media (P1-D10): i campi foto vivono come riferimenti/URL dentro content
-- (jsonb); nessun file e ospitato qui (hosting = P4).
--
-- Applicata dopo tenancy (public.accounts, public.is_account_member) e sites
-- (public.sites): questi esistono gia.

-- ── Tabella ──────────────────────────────────────────────────────────────────

create table public.site_briefs (
  id            uuid primary key default gen_random_uuid(),
  -- on delete cascade: alla rimozione dell'account (a cascata dall'utente owner)
  -- il brief e eliminato.
  account_id    uuid not null references public.accounts (id) on delete cascade,
  -- 1:1 con il sito: alla rimozione del sito, il suo brief e eliminato.
  site_id       uuid not null references public.sites (id) on delete cascade,
  business_name text,
  vertical      text not null default 'altro'
                check (vertical in ('ristorazione', 'fitness', 'salone_studio', 'negozio_artigiano', 'altro')),
  description   text,
  address       text,
  geo           jsonb,
  hours         jsonb,
  phone         text,
  whatsapp      text,
  email         text,
  primary_goal  text
                check (primary_goal is null or primary_goal in ('prenota', 'ordina', 'contatta')),
  locale        text not null check (locale in ('it', 'es')),
  -- content: lista offerta flessibile + sezioni (offerings), social_links,
  -- highlights, brand_hints (P1-D3). Default oggetto vuoto.
  content       jsonb not null default '{}'::jsonb,
  status        text not null default 'draft' check (status in ('draft', 'confirmed')),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  -- 1:1 sito<->brief: un solo brief per sito. L'indice implicito copre site_id.
  unique (site_id)
);

comment on table public.site_briefs is
  'Belora — Business Brief 1:1 con un sito (P1); account-scoped; RLS per appartenenza; artefatto-contratto per P2.';

-- Indice btree dedicato sulla colonna di policy account_id (R9): sostiene la
-- valutazione della RLS e i filtri per account. site_id e gia indicizzato dal
-- vincolo UNIQUE(site_id).
create index site_briefs_account_id_idx on public.site_briefs (account_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.site_briefs enable row level security;

-- SELECT: un utente legge i brief degli account di cui e membro. Companion della
-- policy UPDATE (R6). account_id nel testo → isolamento auditabile (R4).
create policy site_briefs_select_member
  on public.site_briefs
  for select
  to authenticated
  using (public.is_account_member(account_id));

-- INSERT: si crea un brief SOLO in un account di cui si e membri (WITH CHECK). La
-- server action (T-123) deriva account_id dall'identita e verifica che il sito
-- appartenga all'account; questa WITH CHECK e il gate a livello DB, indipendente
-- dal codice (AC-120-6: un account_id verso un altro tenant e respinto qui).
create policy site_briefs_insert_member
  on public.site_briefs
  for insert
  to authenticated
  with check (public.is_account_member(account_id));

-- UPDATE: modifica consentita solo sui brief dei propri account.
create policy site_briefs_update_member
  on public.site_briefs
  for update
  to authenticated
  using (public.is_account_member(account_id))
  with check (public.is_account_member(account_id));

-- DELETE: eliminazione consentita solo sui brief dei propri account.
create policy site_briefs_delete_member
  on public.site_briefs
  for delete
  to authenticated
  using (public.is_account_member(account_id));

-- ── GRANT privilegi ai ruoli della Data API ──────────────────────────────────
-- config.toml non attiva auto_expose_new_tables: GRANT espliciti (RLS = gate FINE
-- su quali righe; GRANT = gate COARSE su quali tabelle rispondono via PostgREST).
-- Nessun GRANT ad anon: il brief non prevede accesso anonimo. service_role
-- (oracolo/setup) bypassa la RLS ma necessita comunque del GRANT di tabella.
grant select, insert, update, delete on public.site_briefs to authenticated;
grant select, insert, update, delete on public.site_briefs to service_role;
