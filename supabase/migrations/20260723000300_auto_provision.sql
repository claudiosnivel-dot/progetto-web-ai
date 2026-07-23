-- Belora — P0 / tenancy (T-062): auto-provision di account + membership + profilo su signup.
--
-- Trigger AFTER INSERT su auth.users che, alla creazione di ogni nuovo utente,
-- provisiona il suo "account personale, pronto per team": 1 riga accounts
-- (owner_id = NEW.id), 1 riga account_members (role='owner', user_id = NEW.id),
-- 1 riga profiles (id = NEW.id, locale='it').
--
-- Sicurezza (security_notes T-062 / OWASP 2025):
--   R8:  funzione SECURITY DEFINER con search_path FISSO (public, pg_temp) per
--        impedire hijack del search_path / privilege escalation. Opera SOLO su
--        NEW.id e schema-qualifica ogni oggetto referenziato.
--   A05: nessun SQL dinamico ne interpolazione di stringhe; si usa NEW.id tipato.
--   A01: il ruolo 'owner' e assegnato esclusivamente all'utente appena creato.
--
-- Idempotenza (AC-062-5): un ritentativo di provisioning per lo stesso id non deve
-- produrre righe duplicate ne violazioni di PK non gestite.
--   - account_members e profiles hanno PK deterministiche -> ON CONFLICT DO NOTHING.
--   - accounts ha PK random (gen_random_uuid()): un ON CONFLICT sul PK NON
--     intercetterebbe un secondo account per lo stesso owner e, non esistendo un
--     vincolo UNIQUE su owner_id (contratto T-060), si usa una guardia EXISTS su
--     owner_id che riusa l'account gia esistente invece di crearne un altro.
--
-- Applicata dopo 20260723000100 (accounts/account_members) e 20260723000200
-- (profiles): le tabelle, i PK e le policy referenziati sono gia definiti la.

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
begin
  -- Account personale — idempotente via guardia EXISTS su owner_id (PK random):
  -- se l'account dell'utente esiste gia lo si riusa, altrimenti lo si crea.
  select a.id
    into v_account_id
    from public.accounts a
   where a.owner_id = new.id
   limit 1;

  if v_account_id is null then
    insert into public.accounts (owner_id)
    values (new.id)
    returning id into v_account_id;
  end if;

  -- Membership owner — idempotente via PK composita (account_id, user_id).
  insert into public.account_members (account_id, user_id, role)
  values (v_account_id, new.id, 'owner')
  on conflict (account_id, user_id) do nothing;

  -- Profilo — idempotente via PK (id); locale di default 'it'.
  insert into public.profiles (id, locale)
  values (new.id, 'it')
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Belora — auto-provision (T-062): crea account personale + membership owner + profilo per il nuovo utente. SECURITY DEFINER, search_path fisso, idempotente.';

-- Trigger di provisioning: una esecuzione per ogni nuovo utente inserito in auth.users.
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
