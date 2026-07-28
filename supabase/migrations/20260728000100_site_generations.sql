-- T-200 (macrotask generation-model, P2) — Schema account-scoped delle generazioni:
-- public.site_generations (1:N col sito) e public.generation_pools (figlia).
--
-- P2 introduce superficie DB NUOVA: `rls:0` va RICONQUISTATO, non ereditato da P1.
-- Quindi la stessa superficie di sicurezza di sites (T-100) e site_briefs (T-120):
-- RLS abilitata, quattro policy TO authenticated ancorate a
-- public.is_account_member(account_id) con account_id ESPLICITO nel testo di ogni
-- policy → isolamento auditabile staticamente dall'oracolo RLS (lezione RLS004 di
-- tenancy: un predicato nascosto dentro una funzione non e visibile allo static check).
--
-- Applicata dopo tenancy (public.accounts, public.is_account_member), sites
-- (public.sites, col vincolo sites_account_id_id_key su (account_id, id) introdotto
-- da 20260724000200_site_briefs.sql) e site_briefs: questi esistono gia.
--
-- Confine del task: SOLO schema e sicurezza a livello Postgres. Lo schema applicativo
-- del pool (PoolSchema, T-201) e del documento (SiteDocumentSchema, T-202) vive in
-- TypeScript e valida l'uscita del modello PRIMA di ogni scrittura: qui `document` e
-- `content` sono jsonb opachi, e il jsonb non e il gate di validazione.

-- ── site_generations ─────────────────────────────────────────────────────────

create table public.site_generations (
  id             uuid primary key default gen_random_uuid(),
  -- on delete cascade: alla rimozione dell'account (a cascata dall'utente owner) le
  -- generazioni cadono con esso.
  account_id     uuid not null references public.accounts (id) on delete cascade,
  -- Nessuna FK indipendente su site_id: la coerenza site<->account e imposta dalla FK
  -- COMPOSITA in coda alla tabella. Una FK semplice su site_id direbbe "il sito
  -- esiste", non "il sito e TUO" — ed e esattamente la differenza che il site-squatting
  -- cross-tenant sfrutta.
  site_id        uuid not null,
  -- Macchina a stati di P2-D13. Il vocabolario e vincolato qui e non solo nel codice:
  -- uno stato inventato da una chiamata PostgREST diretta non deve essere scrivibile.
  status         text not null default 'generating'
                 check (status in ('generating', 'ready', 'chosen', 'complete', 'failed')),
  -- 5 mockup ⇒ indice 0..4. NULL finche l'utente non ha scelto.
  chosen_variant smallint
                 check (chosen_variant is null or (chosen_variant >= 0 and chosen_variant <= 4)),
  -- Documento CONGELATO consegnato a P3: nullo finche la variante non e scelta.
  -- Validato da parseDocument (T-202) prima della scrittura: il jsonb non valida nulla.
  document       jsonb,
  -- Tetto di pagine deciso alla creazione. >= 1 perche la home esiste sempre.
  max_pages      smallint not null check (max_pages >= 1),
  failure_reason text,
  -- NOT NULL (EMENDAMENTO P2-D22), non solo `default now()`. Queste due colonne sono il
  -- RIFERIMENTO TEMPORALE su cui poggia la riconciliazione di T-203, e il default non le
  -- protegge: una INSERT che passa NULL esplicito lo scavalca. Con entrambe NULL la riga
  -- non ha eta, quindi non e mai stantia: non viene MAI riportata a 'failed', l'indice
  -- UNIQUE parziale qui sotto resta occupato per sempre e quel sito non e piu generabile —
  -- il guasto esatto che P2-D15 esiste per impedire, verificato rappresentabile finche le
  -- due colonne erano NULLABLE. Lo stato va reso IRRAPPRESENTABILE qui, non gestito con un
  -- ripiego nel codice che legge.
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- FK COMPOSITA: generation.account_id DEVE coincidere con l'account del sito. E la
  -- difesa in profondita OLTRE la RLS (stessa lezione di T-120): la RLS ancora
  -- account_id ma non lega da sola site_id all'account, quindi senza questo vincolo un
  -- tenant potrebbe, via chiamata PostgREST diretta, ancorare la propria generazione al
  -- sito di un altro tenant (squatting cross-tenant + DoS sull'indice parziale piu
  -- sotto). Poggia su sites_account_id_id_key (unique su (account_id, id)).
  constraint site_generations_account_site_fk
    foreign key (account_id, site_id) references public.sites (account_id, id) on delete cascade,
  -- (account_id, id) esposto come chiave: e il prerequisito che rende possibile la FK
  -- COMPOSITA di generation_pools qui sotto (stesso ruolo di sites_account_id_id_key
  -- introdotto da T-120 per site_briefs). id e gia PK, quindi questo vincolo non
  -- restringe nulla: aggiunge solo il bersaglio referenziabile dalla figlia.
  constraint site_generations_account_id_id_key unique (account_id, id)
);

comment on table public.site_generations is
  'Belora — generazione dei mockup di un sito (P2), 1:N nel tempo; account-scoped; RLS per appartenenza.';

-- Indice btree dedicato sulla colonna di policy account_id (R9): sostiene la
-- valutazione della RLS e i filtri per account.
create index site_generations_account_id_idx on public.site_generations (account_id);
-- site_id e la chiave di lettura di getGeneration(siteId) (T-203). L'indice parziale
-- qui sotto NON copre le righe fuori da status='generating', quindi serve comunque
-- un indice completo.
create index site_generations_site_id_idx on public.site_generations (site_id);

-- Una sola generazione IN VOLO per sito: la doppia generazione concorrente diventa
-- IRRAPPRESENTABILE a livello DB invece di essere sorvegliata dal codice. E' PARZIALE
-- di proposito: la relazione col sito resta 1:N (piu generazioni nel tempo), e solo il
-- predicato status='generating' e vincolato a una riga.
-- Contropartita nota (P2-D15): un processo morto lascerebbe la riga 'generating' e
-- bloccherebbe il sito per sempre. Per questo T-203 aggiunge la RICONCILIAZIONE in
-- lettura — servono entrambi, perche un `finally` non gira su un processo ucciso.
create unique index site_generations_one_in_flight_idx
  on public.site_generations (site_id)
  where status = 'generating';

-- ── generation_pools ─────────────────────────────────────────────────────────

create table public.generation_pools (
  id            uuid primary key default gen_random_uuid(),
  -- Colonna di tenancy: e l'ancoraggio delle policy RLS di questa tabella, quindi
  -- deve puntare a un account reale e sparire con esso (la cascata la raggiunge anche
  -- per la via generation_id → site_id → account: entrambe convergono sulle stesse righe).
  account_id    uuid not null references public.accounts (id) on delete cascade,
  -- Nessuna FK indipendente su generation_id: la coerenza generazione<->account e imposta
  -- dalla FK COMPOSITA in coda alla tabella, per la stessa ragione per cui site_id qui
  -- sopra non ne ha una.
  generation_id uuid not null,
  -- home = i 5 mockup della home; inner = le pagine interne della fase 2.
  scope         text not null check (scope in ('home', 'inner')),
  -- NULL = pool CONDIVISO fra le varianti; 0..4 = copia-su-scrittura di una variante.
  variant_index smallint
                check (variant_index is null or (variant_index >= 0 and variant_index <= 4)),
  -- Uscita del modello, gia validata da parsePool (T-201) prima di arrivare qui.
  content       jsonb not null,
  created_at    timestamptz default now(),
  -- NULLS NOT DISTINCT (PG15+, qui PG 17) e deliberato: col default NULLS DISTINCT il
  -- vincolo NON vedrebbe due righe (G, 'home', NULL) come duplicate, e il pool
  -- CONDIVISO — cioe proprio il caso piu comune — potrebbe essere scritto due volte,
  -- lasciando la generazione con due sorgenti di verita silenziosamente divergenti.
  -- Il NULL qui non e "sconosciuto": e un valore di dominio ("condiviso"), quindi va
  -- confrontato come tale.
  unique nulls not distinct (generation_id, scope, variant_index),
  -- FK COMPOSITA: pool.account_id DEVE coincidere con l'account della generazione.
  -- SOSTITUISCE la FK semplice su generation_id (le due non coesistono), perche quella
  -- diceva solo "la generazione esiste", non "la generazione e TUA".
  -- Il vettore reale, osservato prima di questo vincolo: un utente Y, col ruolo
  -- authenticated e la propria identita, inseriva (account_id = Y, generation_id =
  -- generazione di X). La WITH CHECK della policy INSERT guarda SOLO account_id — e Y su
  -- se stesso e legittimo — quindi la riga passava. Conseguenza misurata: Y occupava lo
  -- slot UNIQUE (generation_id, scope, variant_index) della generazione di X e X, suo
  -- legittimo proprietario, veniva poi respinto con 23505 sul PROPRIO pool condiviso —
  -- inquinamento del contenuto altrui e DoS cross-tenant sulla generazione di X, senza
  -- che la RLS avesse nulla da obiettare. Stessa difesa in profondita di T-120: il
  -- legame al tenant sta nel VINCOLO, non nel codice applicativo.
  -- on delete cascade: rimossa la generazione, i suoi pool cadono con essa.
  constraint generation_pools_account_generation_fk
    foreign key (account_id, generation_id)
    references public.site_generations (account_id, id) on delete cascade
);

comment on table public.generation_pools is
  'Belora — pool di contenuti di una generazione (P2), per ambito e variante; NULL su variant_index = pool condiviso.';

-- R9: colonna di policy e colonna di join indicizzate. L'indice implicito del vincolo
-- UNIQUE copre gia il prefisso generation_id, ma un indice dedicato rende l'intento
-- esplicito e indipendente dall'evoluzione del vincolo (stessa scelta di T-100).
create index generation_pools_account_id_idx on public.generation_pools (account_id);
create index generation_pools_generation_id_idx on public.generation_pools (generation_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.site_generations enable row level security;
alter table public.generation_pools enable row level security;

-- site_generations — SELECT: un utente legge le generazioni degli account di cui e
-- membro. Companion della policy UPDATE (R6). account_id nel testo → auditabile (R4).
create policy site_generations_select_member
  on public.site_generations
  for select
  to authenticated
  using (public.is_account_member(account_id));

-- INSERT: si crea una generazione SOLO in un account di cui si e membri. Le server
-- action (T-203) derivano account_id dall'identita; questa WITH CHECK e il gate a
-- livello DB, indipendente dal codice applicativo.
create policy site_generations_insert_member
  on public.site_generations
  for insert
  to authenticated
  with check (public.is_account_member(account_id));

-- UPDATE: USING filtra le righe modificabili; WITH CHECK impedisce anche di
-- "spostare" una generazione verso un account non proprio riscrivendo account_id.
create policy site_generations_update_member
  on public.site_generations
  for update
  to authenticated
  using (public.is_account_member(account_id))
  with check (public.is_account_member(account_id));

create policy site_generations_delete_member
  on public.site_generations
  for delete
  to authenticated
  using (public.is_account_member(account_id));

-- generation_pools — stessa ancora di tenancy: il pool contiene il testo generato dal
-- brief del cliente, quindi e dato del tenant a tutti gli effetti.
create policy generation_pools_select_member
  on public.generation_pools
  for select
  to authenticated
  using (public.is_account_member(account_id));

create policy generation_pools_insert_member
  on public.generation_pools
  for insert
  to authenticated
  with check (public.is_account_member(account_id));

create policy generation_pools_update_member
  on public.generation_pools
  for update
  to authenticated
  using (public.is_account_member(account_id))
  with check (public.is_account_member(account_id));

create policy generation_pools_delete_member
  on public.generation_pools
  for delete
  to authenticated
  using (public.is_account_member(account_id));

-- ── GRANT privilegi ai ruoli della Data API ──────────────────────────────────
-- config.toml non attiva auto_expose_new_tables: GRANT espliciti (RLS = gate FINE su
-- quali righe; GRANT = gate COARSE su quali tabelle rispondono via PostgREST).
-- Nessun GRANT ad anon (R7): la generazione non prevede accesso anonimo. service_role
-- (oracolo/setup) bypassa la RLS ma necessita comunque del GRANT di tabella, ed e
-- confinata server-side.
grant select, insert, update, delete on public.site_generations to authenticated;
grant select, insert, update, delete on public.site_generations to service_role;
grant select, insert, update, delete on public.generation_pools to authenticated;
grant select, insert, update, delete on public.generation_pools to service_role;

-- "Nessun GRANT ad anon" non basta a rendere anon SENZA privilegi: le default privileges
-- della piattaforma Supabase su schema public concedono da sole REFERENCES / TRIGGER /
-- TRUNCATE ad anon su OGNI tabella nuova, quindi non concedere non equivale a non avere.
-- Su superficie NUOVA (P2) le annulliamo esplicitamente: dopo questa revoca anon ha ZERO
-- privilegi su entrambe le tabelle, non "zero DML". REFERENCES in mano a un ruolo
-- anonimo, in particolare, consente di appendere FK alle nostre colonne (e quindi di
-- osservarne/vincolarne il contenuto dall'esterno del nostro schema).
revoke all on public.site_generations from anon;
revoke all on public.generation_pools from anon;
