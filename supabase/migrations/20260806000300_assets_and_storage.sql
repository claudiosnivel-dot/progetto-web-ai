-- T-412 (macrotask media-storage, P4) — Substrato di storage dei media: tabella
-- public.assets (RLS owner-only RICONQUISTATA) + bucket Storage a lettura pubblica +
-- RLS di scrittura su storage.objects a CONFINE-OWNER.
--
-- EMENDAMENTO P4-D6a (00-INDEX §4, Opzione A, assenso esplicito dell'utente all'apertura di
-- BUILD media-storage): l'oggetto Storage vive a CHIAVE PIATTA <asset_id> (uuid v4 opaco,
-- generato server-side, non enumerabile); assets.storage_path = <asset_id>. NIENTE cartelle
-- <account_id>/<site_id>/. La RLS di scrittura su storage.objects e' a confine-OWNER
-- (owner = auth.uid()), NON a confine di cartella: con la chiave piatta non c'e' un prefisso
-- di account su cui fare binding. La lezione-prefisso P1/P2 e' onorata DIVERSAMENTE — chiavi
-- uuid non predicibili (A non puo' scegliere la chiave di B) + modifica owner-bound (A non
-- modifica/cancella l'oggetto di B). assetPublicUrl(asset_id) (src/config/storage.ts, VERDE
-- da M3) costruisce l'URL pubblico dal SOLO asset_id: coerente con questa chiave piatta.
--
-- DUE superfici, DUE regimi di sicurezza — la differenza e' portante:
--  1) public.assets — tabella APPLICATIVA: RLS RICONQUISTATA (OWASP A01:2025), owner-only,
--     QUATTRO policy TO authenticated ancorate a public.is_account_member(account_id) con
--     account_id ESPLICITO nel testo (isolamento auditabile staticamente dall'oracolo RLS —
--     lezione RLS004: mai USING(true), mai predicato di tenancy nascosto in una funzione che
--     lo static check non vede). NESSUNA policy anon: assets non ha colonne pubbliche, quindi
--     anon SELECT su assets = 42501 (l'oggetto e' pubblico per uuid, la RIGA no). GRANT
--     revocati su TUTTA la superficie (le default privileges della piattaforma concedono da
--     sole REFERENCES/TRIGGER/TRUNCATE a ogni ruolo, e TRUNCATE BYPASSA la RLS) e ri-concessi
--     PRECISI a authenticated/service_role, NIENTE ad anon.
--  2) storage.objects / storage.buckets — tabelle di PIATTAFORMA Supabase: NON si revocano i
--     grant (li gestisce la piattaforma), si AGGIUNGONO solo policy per il bucket site-assets.
--     La lettura pubblica anon NON e' una policy: e' il FLAG public=true del bucket.
--
-- Applicata dopo tenancy (public.accounts, public.is_account_member) e sites (col vincolo
-- sites_account_id_id_key su (account_id, id), introdotto in 20260724000200_site_briefs):
-- questi esistono gia'.

-- ── Tabella assets ────────────────────────────────────────────────────────────

create table public.assets (
  id           uuid primary key default gen_random_uuid(),
  -- Colonna di tenancy: ancoraggio delle policy RLS. on delete cascade: rimosso l'account
  -- (a cascata dall'utente owner) i suoi asset cadono con esso.
  account_id   uuid not null references public.accounts (id) on delete cascade,
  -- Nessuna FK indipendente su site_id: la coerenza site<->account e' imposta dalla FK
  -- COMPOSITA in coda. Una FK semplice direbbe "il sito esiste", non "e' TUO".
  site_id      uuid not null,
  -- Chiave PIATTA dell'oggetto Storage = l'asset_id opaco (P4-D6a). E' l'unico ingresso da cui
  -- assetPublicUrl costruisce l'URL pubblico (mai da testo libero: P2-D12).
  storage_path text not null,
  -- Content-type del RASTER ricodificato (T-413): solo i tre raster ammessi. SVG mai qui.
  mime         text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  -- Dimensioni del raster ricodificato: positive per costruzione (guardia sanity + anti 0x0).
  width        int not null check (width > 0),
  height       int not null check (height > 0),
  created_at   timestamptz not null default now(),
  -- UNIQUE GLOBALE su storage_path: una chiave = un asset. Due righe non possono puntare allo
  -- stesso oggetto Storage. L'oggetto e' pubblico per uuid, ma la mappa oggetto->tenant vive
  -- QUI e resta privata (owner-only, nessuna colonna anon).
  unique (storage_path),
  -- FK COMPOSITA (account_id, site_id) -> sites (account_id, id): difesa in profondita' P2-D19.
  -- Un asset NON puo' legarsi al sito di un altro tenant: la RLS ancora account_id ma non lega
  -- da sola site_id all'account; senza questo vincolo un tenant potrebbe, via PostgREST col
  -- PROPRIO account_id (legittimo per la WITH CHECK, che guarda solo account_id), inserire un
  -- asset ancorato al sito ALTRUI. Poggia su sites_account_id_id_key (unique su (account_id,
  -- id)). on delete cascade: rimosso il sito, i suoi asset cadono con esso.
  constraint assets_account_site_fk
    foreign key (account_id, site_id)
    references public.sites (account_id, id) on delete cascade
);

comment on table public.assets is
  'Belora — media asset (P4): metadati di un oggetto Storage (chiave piatta storage_path = asset_id, P4-D6a); account-scoped; RLS owner-only (nessuna colonna pubblica: anon negato, l''oggetto e'' pubblico per uuid ma la riga no).';

-- ── Indici ────────────────────────────────────────────────────────────────────
-- R9: colonne di policy e di join indicizzate. L'indice implicito di unique(storage_path)
-- copre gia' storage_path; indici dedicati sulle colonne di policy/join rendono l'intento
-- esplicito (stessa scelta di sites/site_generations/site_publications).
create index assets_account_id_idx on public.assets (account_id);
create index assets_site_id_idx on public.assets (site_id);

-- ── RLS assets ────────────────────────────────────────────────────────────────

alter table public.assets enable row level security;

-- SELECT (membri): un membro legge SOLO gli asset dei propri account. account_id nel testo →
-- isolamento auditabile (R4); nessuna USING(true). NESSUNA policy anon (assets non ha colonne
-- pubbliche): anon SELECT = 42501, il che soddisfa AC-412-2.
create policy assets_select_member
  on public.assets
  for select
  to authenticated
  using (public.is_account_member(account_id));

-- INSERT: si inserisce un asset SOLO in un account di cui si e' membri. uploadAsset (T-413)
-- deriva account_id dall'identita' e verifica l'ownership del sito PRIMA della scrittura;
-- questa WITH CHECK e' il gate a livello DB, indipendente dal codice applicativo.
create policy assets_insert_member
  on public.assets
  for insert
  to authenticated
  with check (public.is_account_member(account_id));

-- UPDATE: modifica consentita solo sui propri asset. USING filtra le righe modificabili;
-- WITH CHECK impedisce di "spostare" un asset verso un account non proprio riscrivendo
-- account_id.
create policy assets_update_member
  on public.assets
  for update
  to authenticated
  using (public.is_account_member(account_id))
  with check (public.is_account_member(account_id));

-- DELETE: eliminazione consentita solo sui propri asset (AC-412-5: DELETE cross-tenant → 0 righe).
create policy assets_delete_member
  on public.assets
  for delete
  to authenticated
  using (public.is_account_member(account_id));

-- ── GRANT assets ──────────────────────────────────────────────────────────────
-- config.toml non attiva auto_expose_new_tables: GRANT espliciti (RLS = gate FINE su quali
-- righe; GRANT = gate COARSE su quali tabelle rispondono via PostgREST). revoke all annulla
-- anche REFERENCES/TRIGGER/TRUNCATE delle default privileges della piattaforma (TRUNCATE
-- BYPASSA la RLS). NIENTE ad anon: assets non prevede accesso anonimo (nessuna colonna pubblica).
revoke all on public.assets from anon, authenticated, service_role;
grant select, insert, update, delete on public.assets to authenticated;
grant select, insert, update, delete on public.assets to service_role;

-- ── Bucket Storage a lettura pubblica ─────────────────────────────────────────
-- public = true: la LETTURA anon degli oggetti e' data dal FLAG del bucket, NON da una policy
-- (trade-off dichiarato P4-D6: l'oggetto e' raggiungibile per uuid non enumerabile — AC-412-4;
-- la riga assets resta privata). file_size_limit e allowed_mime_types come difesa in
-- profondita' (il gate VERO e' il re-encode sharp di T-413; un cap a livello bucket e'
-- cintura+bretelle). on conflict do nothing: idempotente su db reset / re-run.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-assets',
  'site-assets',
  true,
  10485760, -- 10 MiB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- ── RLS di scrittura su storage.objects (bucket site-assets) — CONFINE-OWNER ───
-- storage.objects e' tabella di PIATTAFORMA Supabase: NON revochiamo i suoi grant (li gestisce
-- la piattaforma), AGGIUNGIAMO solo policy. Confine-OWNER (P4-D6a): owner = auth.uid()
-- (Supabase valorizza objects.owner con l'uploader autenticato). A non modifica/cancella
-- l'oggetto di B (AC-412-3); e la chiave e' un uuid generato server-side che A non puo'
-- predire/scegliere. NESSUNA policy SELECT: la lettura pubblica e' il flag public=true del
-- bucket, non una policy anon.

create policy site_assets_insert_owner
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'site-assets' and owner = auth.uid());

create policy site_assets_update_owner
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'site-assets' and owner = auth.uid())
  with check (bucket_id = 'site-assets' and owner = auth.uid());

create policy site_assets_delete_owner
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'site-assets' and owner = auth.uid());
