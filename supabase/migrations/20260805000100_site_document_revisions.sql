-- T-301 (macrotask editor-core, P3) — Schema account-scoped delle revisioni del
-- documento editato: public.site_document_revisions (N revisioni nel tempo per una
-- generazione, append-only).
--
-- P3 introduce superficie DB NUOVA: `rls:0` va RICONQUISTATO, non ereditato da P2.
-- Stessa superficie di sicurezza di site_generations (T-200) / site_briefs (T-120):
-- RLS abilitata, policy TO authenticated ancorate a public.is_account_member(account_id)
-- con account_id ESPLICITO nel testo di OGNI policy → isolamento auditabile
-- staticamente dall'oracolo RLS (lezione RLS004 di tenancy: un predicato nascosto
-- dentro una funzione non e visibile allo static check; MAI USING (true)).
--
-- Applicata dopo tenancy (public.accounts, public.is_account_member), sites e
-- site_generations (col vincolo site_generations_account_id_id_key su (account_id, id)
-- introdotto da 20260728000100_site_generations.sql): questi esistono gia.
--
-- APPEND-ONLY (P3-D): una revisione, una volta scritta, non si modifica MAI — la storia
-- e immutabile e "l'ultima vince" (read-path T-304). Da qui l'assenza DELIBERATA di una
-- policy UPDATE: il vocabolario dei comandi ammessi e SELECT / INSERT / DELETE. Il DELETE
-- non e per l'editing ma per la POTATURA FIFO (T-303, cap 20 revisioni per generazione),
-- che gira sotto RLS col client di SESSIONE — quindi la sua policy e ancorata a
-- is_account_member(account_id) come le altre (nessun tenant pota le revisioni altrui).
--
-- Confine del task: SOLO schema e sicurezza a livello Postgres. La validazione del
-- documento (SiteDocumentSchema / parseDocument) vive in TypeScript e valida PRIMA di
-- ogni scrittura (gate di T-302): qui `document` e jsonb opaco, e il jsonb non e il gate.

-- ── Tabella ──────────────────────────────────────────────────────────────────

create table public.site_document_revisions (
  id                 uuid primary key default gen_random_uuid(),
  -- Nessuna FK indipendente su site_generation_id: la coerenza generazione<->account
  -- e imposta dalla FK COMPOSITA in coda alla tabella (stessa scelta di site_id in
  -- site_generations). Una FK semplice direbbe "la generazione esiste", non "e TUA".
  site_generation_id uuid not null,
  -- Colonna di tenancy: e l'ancoraggio delle policy RLS di questa tabella, quindi deve
  -- puntare a un account reale e sparire con esso. on delete cascade: rimosso l'account
  -- (a cascata dall'utente owner), le sue revisioni cadono con esso (la cascata la
  -- raggiunge anche per la via site_generation_id → account_id, che converge sulle
  -- stesse righe).
  account_id         uuid not null references public.accounts (id) on delete cascade,
  -- Snapshot CONGELATO del SiteDocument, gia validato da parseDocument (T-302) prima di
  -- arrivare qui. NOT NULL: una revisione senza documento non ha senso.
  document           jsonb not null,
  -- Provenienza della revisione. Vincolata qui e non solo nel codice: una fonte
  -- inventata da una chiamata PostgREST diretta non deve essere scrivibile.
  --   generated = snapshot iniziale dalla baseline; edited = editing manuale inline
  --   (T-302); rechosen = riscelta non distruttiva dal design fresco (T-310);
  --   restored = ripristino non distruttivo di una revisione passata (T-318, D4) —
  --   distinto da 'edited' cosi il picker mostra la provenienza per cio che e.
  source             text not null check (source in ('generated', 'edited', 'rechosen', 'restored')),
  -- Numero di sequenza monotono per generazione: e il criterio di ordinamento
  -- DETERMINISTICO del read-path (T-304 sceglie il seq MASSIMO, non il created_at, per
  -- restare deterministico a timestamp uguali) e la chiave della potatura FIFO (T-303
  -- elimina i seq minori). bigint: la storia e potata a 20 righe vive ma seq non viene
  -- mai riusato, quindi il contatore cresce senza tetto pratico.
  seq                bigint not null,
  created_at         timestamptz not null default now(),
  -- UNIQUE (site_generation_id, seq): due revisioni della STESSA generazione non
  -- possono condividere un seq — e cio che rende "seq massimo" un puntatore univoco al
  -- documento corrente e la sequenza priva di ambiguita. L'indice implicito copre il
  -- prefisso site_generation_id.
  unique (site_generation_id, seq),
  -- FK COMPOSITA: revision.account_id DEVE coincidere con l'account della generazione.
  -- E la difesa in profondita OLTRE la RLS (stessa lezione di T-120 / T-200): la RLS
  -- ancora account_id ma non lega da sola site_generation_id all'account, quindi senza
  -- questo vincolo un tenant potrebbe, via chiamata PostgREST diretta col PROPRIO
  -- account_id (legittimo per la WITH CHECK, che guarda solo account_id), ancorare la
  -- propria revisione alla generazione di un ALTRO tenant — squatting cross-tenant e
  -- inquinamento della storia altrui, senza che la RLS avesse nulla da obiettare. Il
  -- legame al tenant sta nel VINCOLO, non nel codice applicativo. Poggia su
  -- site_generations_account_id_id_key (unique su (account_id, id)). on delete cascade:
  -- rimossa la generazione, le sue revisioni cadono con essa.
  constraint site_document_revisions_account_generation_fk
    foreign key (account_id, site_generation_id)
    references public.site_generations (account_id, id) on delete cascade
);

comment on table public.site_document_revisions is
  'Belora — revisioni append-only del SiteDocument editato (P3), N nel tempo per generazione; account-scoped; RLS per appartenenza; "ultima vince" per seq massimo.';

-- ── Indici ────────────────────────────────────────────────────────────────────
-- R9: colonna di policy e colonna di join indicizzate. L'indice implicito del vincolo
-- UNIQUE copre gia il prefisso site_generation_id, ma un indice dedicato rende l'intento
-- esplicito e indipendente dall'evoluzione del vincolo (stessa scelta di T-100/T-200) —
-- ed e la chiave di lettura del read-path (T-304) e della potatura (T-303).
create index site_document_revisions_account_id_idx on public.site_document_revisions (account_id);
create index site_document_revisions_site_generation_id_idx on public.site_document_revisions (site_generation_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.site_document_revisions enable row level security;

-- SELECT: un utente legge le revisioni degli account di cui e membro. account_id nel
-- testo → isolamento auditabile (R4); nessuna USING (true).
create policy site_document_revisions_select_member
  on public.site_document_revisions
  for select
  to authenticated
  using (public.is_account_member(account_id));

-- INSERT: si scrive una revisione SOLO in un account di cui si e membri. La server
-- action (T-302/T-310/T-318) deriva account_id dall'identita e valida il documento con
-- parseDocument PRIMA della scrittura; questa WITH CHECK e il gate a livello DB,
-- indipendente dal codice applicativo.
create policy site_document_revisions_insert_member
  on public.site_document_revisions
  for insert
  to authenticated
  with check (public.is_account_member(account_id));

-- DELETE: consentito SOLO sulle revisioni dei propri account. NON e per l'editing (la
-- tabella e append-only) ma per la POTATURA FIFO (T-303): il cap di 20 revisioni per
-- generazione e imposto dal client di SESSIONE, quindi la potatura deve poter eliminare
-- SOTTO RLS — e ancorata a is_account_member(account_id) come le altre, cosi nessun
-- tenant pota le revisioni altrui.
create policy site_document_revisions_delete_member
  on public.site_document_revisions
  for delete
  to authenticated
  using (public.is_account_member(account_id));

-- NESSUNA policy UPDATE, DELIBERATAMENTE: la tabella e append-only. Una revisione non si
-- muta mai; la si supera scrivendone una nuova con seq maggiore ("ultima vince").

-- ── GRANT privilegi ai ruoli della Data API ──────────────────────────────────
-- config.toml non attiva auto_expose_new_tables: GRANT espliciti (RLS = gate FINE su
-- quali righe; GRANT = gate COARSE su quali tabelle rispondono via PostgREST). L'insieme
-- di privilegi rispecchia il vocabolario append-only: SELECT/INSERT/DELETE, NIENTE
-- UPDATE. Nessun GRANT ad anon (R7): l'editor non prevede accesso anonimo. service_role
-- (oracolo/setup) bypassa la RLS ma necessita comunque del GRANT di tabella, ed e
-- confinata server-side.
-- Le default privileges della piattaforma Supabase su schema public concedono da sole
-- REFERENCES / TRIGGER / TRUNCATE a TUTTI i ruoli (anon, authenticated, service_role) su OGNI
-- tabella nuova: "non concedere" non equivale a "non avere", e TRUNCATE in particolare BYPASSA
-- la RLS (un ruolo con TRUNCATE cancellerebbe le revisioni di OGNI tenant in un colpo). Le
-- annulliamo su TUTTA la superficie — non solo su anon — e ri-concediamo il SOLO vocabolario DML
-- append-only (SELECT/INSERT/DELETE, NIENTE UPDATE) ai ruoli che ne hanno bisogno. anon resta a
-- ZERO privilegi di qualunque tipo (R7): l'editor non prevede accesso anonimo.
revoke all on public.site_document_revisions from anon, authenticated, service_role;
grant select, insert, delete on public.site_document_revisions to authenticated;
grant select, insert, delete on public.site_document_revisions to service_role;
