-- Baseline idempotente del progetto Belora (P0 / infra, T-004).
-- Crea uno schema applicativo verificabile nel catalogo di sistema.
-- Le tabelle reali e le policy RLS (accounts, account_members, profiles, sites)
-- arrivano nei macrotask successivi (tenancy, sites). Qui: solo l'infrastruttura.

create schema if not exists app;

comment on schema app is 'Belora — schema applicativo (baseline P0/infra)';
