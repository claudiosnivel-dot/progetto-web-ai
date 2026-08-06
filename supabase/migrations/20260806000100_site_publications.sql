-- T-401 (macrotask publish-core, P4) — Schema account-scoped del LAYER PUBBLICATO:
-- public.site_publications (uno snapshot per-sito del SiteDocument congelato al momento
-- della pubblicazione).
--
-- P4 apre la PRIMA superficie DB leggibile da `anon`: la RLS va RICONQUISTATA, non
-- ereditata (OWASP A01:2025). Ci sono DUE popolazioni distinte:
--  - i MEMBRI dell'account, in CRUD sulle proprie righe — stessa superficie di
--    sites (T-100) / site_generations (T-200) / site_document_revisions (T-301):
--    quattro policy TO authenticated ancorate a public.is_account_member(account_id)
--    con account_id ESPLICITO nel testo di OGNI policy → isolamento auditabile
--    staticamente dall'oracolo RLS (lezione RLS004 di tenancy: un predicato nascosto
--    dentro una funzione non e visibile allo static check; MAI USING (true));
--  - `anon`, in SOLA lettura e SOLO sul pubblicato — una quinta policy TO anon con
--    USING (is_published = true): anon legge le righe pubblicate di QUALSIASI tenant
--    (il serving pubblico e per definizione globale), mai una riga non pubblicata.
--
-- Colonne private non esposte ad anon: il GRANT ad anon e COLUMN-LEVEL, limitato a
-- (public_slug, document, locale). account_id / site_id / source_generation_id NON
-- sono concessi ad anon — difesa a livello DB oltre la SELECT mirata della rotta (T-405).
--
-- UNIQUE GLOBALE su public_slug: e l'ancora autorevole dell'identita pubblica (P4-D4),
-- distinta dallo slug PER-ACCOUNT di sites. UNIQUE su site_id: uno snapshot per-sito,
-- upsert-abile (re-publish sostituisce lo snapshot, non ne crea un secondo).
--
-- Applicata dopo tenancy (public.accounts, public.is_account_member), sites (col vincolo
-- sites_account_id_id_key su (account_id, id)) e site_generations (col vincolo
-- site_generations_account_id_id_key su (account_id, id)): questi esistono gia.
--
-- Confine del task: SOLO schema e sicurezza a livello Postgres. La validazione del
-- documento (SiteDocumentSchema / parseDocument, gate di T-403) vive in TypeScript e
-- valida PRIMA di ogni scrittura dello snapshot: qui `document` e jsonb opaco, il jsonb
-- non e il gate.

-- ── Tabella ──────────────────────────────────────────────────────────────────

create table public.site_publications (
  id                   uuid primary key default gen_random_uuid(),
  -- Colonna di tenancy: e l'ancoraggio delle policy RLS di questa tabella, quindi deve
  -- puntare a un account reale e sparire con esso. on delete cascade: rimosso l'account
  -- (a cascata dall'utente owner), le sue publication cadono con esso.
  account_id           uuid not null references public.accounts (id) on delete cascade,
  -- Nessuna FK indipendente su site_id: la coerenza site<->account e imposta dalla FK
  -- COMPOSITA in coda alla tabella. Una FK semplice direbbe "il sito esiste", non "e TUO".
  site_id              uuid not null,
  -- Provenienza dello snapshot: la generazione da cui il documento e stato congelato.
  -- Vincolata dalla FK COMPOSITA (in coda), non da una FK indipendente, per la stessa
  -- ragione di site_id. NOT NULL: una publication e sempre lo snapshot DI una generazione.
  source_generation_id uuid not null,
  -- Snapshot CONGELATO del SiteDocument, gia validato da parseDocument (T-403) prima di
  -- arrivare qui. NOT NULL: una publication senza documento non ha senso. Disaccoppiato
  -- dalla potatura FIFO delle revisioni (T-303): questo snapshot non e cancellabile da li.
  document             jsonb not null,
  -- Identita pubblica del sito. UNIQUE GLOBALE (vincolo in coda): e l'ancora autorevole
  -- (P4-D4), la chiave della rotta /s/<slug>. NOT NULL: assegnato al primo publish (T-403)
  -- e PRESERVATO al re-publish; nessun percorso crea una riga senza slug.
  public_slug          text not null,
  -- Lingua del sito pubblicato, stesso vocabolario di site_briefs.locale / profiles.locale.
  locale               text not null check (locale in ('it', 'es')),
  -- Stato di pubblicazione: e il predicato della policy anon (SOLO is_published=true e
  -- visibile ad anon). default false: irrilevante nel percorso di T-403 (che pubblica con
  -- true esplicito), ma rende l'assenza = "non pubblicato" per costruzione.
  is_published         boolean not null default false,
  -- Momento dell'ultima pubblicazione; NULL finche non pubblicato.
  published_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- UNIQUE GLOBALE su public_slug: due tenant NON possono rivendicare lo stesso percorso
  -- pubblico. E' l'ancora d'identita contro la race di dedup del generatore (T-402): il
  -- generatore e cortesia, il VINCOLO e il gate.
  unique (public_slug),
  -- UNIQUE su site_id: un solo snapshot per sito. Il re-publish e un upsert su questa
  -- chiave (T-403), non un secondo snapshot divergente.
  unique (site_id),
  -- FK COMPOSITA: publication.account_id DEVE coincidere con l'account del sito. Difesa in
  -- profondita OLTRE la RLS (lezione T-120 / T-301): la RLS ancora account_id ma non lega
  -- da sola site_id all'account, quindi senza questo vincolo un tenant potrebbe, via
  -- chiamata PostgREST diretta col PROPRIO account_id (legittimo per la WITH CHECK, che
  -- guarda solo account_id), pubblicare uno snapshot ancorato al sito di un ALTRO tenant.
  -- Poggia su sites_account_id_id_key (unique su (account_id, id)). on delete cascade:
  -- rimosso il sito, la sua publication cade con esso.
  constraint site_publications_account_site_fk
    foreign key (account_id, site_id)
    references public.sites (account_id, id) on delete cascade,
  -- FK COMPOSITA: publication.account_id DEVE coincidere con l'account della generazione
  -- da cui lo snapshot proviene. Stessa difesa cross-tenant sull'asse della generazione:
  -- niente snapshot ancorato alla generazione altrui. Poggia su
  -- site_generations_account_id_id_key (unique su (account_id, id)). on delete cascade:
  -- rimossa la generazione, la publication che la cita cade con essa.
  constraint site_publications_account_generation_fk
    foreign key (account_id, source_generation_id)
    references public.site_generations (account_id, id) on delete cascade
);

comment on table public.site_publications is
  'Belora — layer pubblicato (P4): uno snapshot per-sito del SiteDocument congelato; account-scoped; RLS membri in CRUD + anon in SELECT solo sul pubblicato; public_slug unico globale.';

-- ── Indici ────────────────────────────────────────────────────────────────────
-- R9: colonne di policy e di join indicizzate. Gli indici impliciti dei vincoli UNIQUE
-- coprono gia public_slug e il prefisso site_id, ma un indice dedicato rende l'intento
-- esplicito e indipendente dall'evoluzione del vincolo (stessa scelta di T-100/T-200/T-301).
create index site_publications_account_id_idx on public.site_publications (account_id);
create index site_publications_site_id_idx on public.site_publications (site_id);
create index site_publications_source_generation_id_idx on public.site_publications (source_generation_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.site_publications enable row level security;

-- SELECT (membri): un utente legge le publication degli account di cui e membro.
-- account_id nel testo → isolamento auditabile (R4); nessuna USING (true).
create policy site_publications_select_member
  on public.site_publications
  for select
  to authenticated
  using (public.is_account_member(account_id));

-- INSERT: si pubblica SOLO in un account di cui si e membri. La server action (T-403)
-- deriva account_id dall'identita e valida il documento con parseDocument PRIMA della
-- scrittura; questa WITH CHECK e il gate a livello DB, indipendente dal codice applicativo.
create policy site_publications_insert_member
  on public.site_publications
  for insert
  to authenticated
  with check (public.is_account_member(account_id));

-- UPDATE (re-publish / unpublish, T-403/T-404): USING filtra le righe modificabili;
-- WITH CHECK impedisce anche di "spostare" una publication verso un account non proprio
-- riscrivendo account_id.
create policy site_publications_update_member
  on public.site_publications
  for update
  to authenticated
  using (public.is_account_member(account_id))
  with check (public.is_account_member(account_id));

-- DELETE: eliminazione consentita solo sulle publication dei propri account.
create policy site_publications_delete_member
  on public.site_publications
  for delete
  to authenticated
  using (public.is_account_member(account_id));

-- SELECT (anon): la PRIMA superficie leggibile senza sessione. Ristretta a
-- is_published = true — anon legge SOLO il pubblicato, mai una riga non pubblicata.
-- Nessuna clausola di tenant: il serving pubblico e globale per natura; l'isolamento
-- qui e sul FLAG di pubblicazione, non sull'account (il column-level GRANT piu sotto
-- impedisce comunque ad anon di leggere account_id / site_id / source_generation_id).
create policy site_publications_select_anon
  on public.site_publications
  for select
  to anon
  using (is_published = true);

-- ── GRANT privilegi ai ruoli della Data API ──────────────────────────────────
-- config.toml non attiva auto_expose_new_tables: GRANT espliciti (RLS = gate FINE su
-- quali righe; GRANT = gate COARSE su quali tabelle/colonne rispondono via PostgREST).
--
-- Le default privileges della piattaforma Supabase su schema public concedono da sole
-- REFERENCES / TRIGGER / TRUNCATE a TUTTI i ruoli (anon, authenticated, service_role) su
-- OGNI tabella nuova: "non concedere" non equivale a "non avere", e TRUNCATE in
-- particolare BYPASSA la RLS (un ruolo con TRUNCATE cancellerebbe le publication di OGNI
-- tenant in un colpo). Le annulliamo su TUTTA la superficie — non solo su anon — e
-- ri-concediamo il vocabolario PRECISO a ciascun ruolo (lezione P2-D19).
revoke all on public.site_publications from anon, authenticated, service_role;

-- authenticated: CRUD completo sulle proprie righe (le policy membro fanno il gate fine).
grant select, insert, update, delete on public.site_publications to authenticated;
-- service_role (oracolo/setup) bypassa la RLS ma necessita comunque del GRANT di tabella,
-- ed e confinata server-side (mai nel browser).
grant select, insert, update, delete on public.site_publications to service_role;
-- anon: SELECT COLUMN-LEVEL SOLO sulle colonne pubbliche. Nessun GRANT di tabella (che
-- esporrebbe OGNI colonna), nessun account_id / site_id / source_generation_id: le colonne
-- private non sono leggibili nemmeno interrogandole esplicitamente. E' la PRIMA superficie
-- del progetto con GRANT a livello di colonna — la difesa DB dietro la SELECT mirata di T-405.
grant select (public_slug, document, locale) on public.site_publications to anon;
