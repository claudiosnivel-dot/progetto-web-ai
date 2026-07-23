-- Belora — P0 / tenancy (EMENDAMENTO al ledger, 2026-07-23): UNIQUE(owner_id) su accounts.
--
-- Decisione (00-INDEX §3, emendata): in P0/V1 un utente possiede AL PIU' un account
-- (personale). Il vincolo:
--   - rende l'idempotenza dell'auto-provision (T-062) provabile PER COSTRUZIONE
--     (impossibile un secondo account per lo stesso owner, non solo per guardia app);
--   - rende sicuri per costruzione i lookup .single() per-owner (is_account_member,
--     account_members_rls, tenant_isolation, e le future server action di sites);
--   - indicizza owner_id (beneficio ai filtri .eq('owner_id', ...)).
--
-- Reversibile: se servira' il multi-account ownership (agenzie/team con piu' business),
-- drop del vincolo o indice unico PARZIALE su una colonna kind='personal' — decisione
-- da prendere allora, con requisiti reali (nuovo emendamento al ledger). Il modello
-- team resta comunque supportato da account_members (piu' UTENTI per account), che il
-- vincolo NON tocca.
--
-- Applicata dopo 20260723000300: accounts esiste; al db reset la tabella e' vuota
-- (nessuna violazione). L'auto-provision crea 1 account/utente -> vincolo rispettato.

alter table public.accounts
  add constraint accounts_owner_id_key unique (owner_id);
