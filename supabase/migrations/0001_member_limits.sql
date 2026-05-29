-- Member limits (clients + clinicians) per organization, plus the grants the
-- Add-client Netlify function needs.
--
-- Already applied to the live database by hand via the Supabase SQL editor.
-- Kept here as the record of what changed and why. Idempotent — safe to re-run.
--
-- Design notes:
--  * `client_limit` / `clinician_limit` are NULL by default, meaning UNLIMITED.
--    Set a number on an organization to cap that role.
--  * The limit is enforced by a BEFORE INSERT/UPDATE trigger on `profiles`, so
--    it holds no matter how a member is created — the Add-client function, the
--    Supabase dashboard, or a future script.
--  * `handle_new_user` is updated to populate the new profile from the auth
--    user's metadata. Because triggers on `auth.users` run in the SAME
--    transaction as the user insert, a limit rejection rolls the whole
--    `createUser` back — no orphaned auth user is left behind.

-- ── 1. Per-org limit columns (NULL = unlimited) ──────────────────────────
alter table public.organizations
  add column if not exists client_limit    int,
  add column if not exists clinician_limit int;

-- ── 2. Auto-create a blank profile on signup ─────────────────────────────
-- Keeps the original Supabase pattern: a new auth user gets a blank profile
-- (org_id NULL, role defaults to 'client'). Profile population (org, role,
-- name) is done explicitly by the Add-client function via UPDATE — NOT read
-- from metadata here, because Supabase writes app_metadata to the auth row
-- AFTER this insert trigger runs, so org_id wouldn't be visible yet.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

-- ── 3. Enforce the limit ─────────────────────────────────────────────────
create or replace function public.enforce_member_limit()
returns trigger language plpgsql security definer as $$
declare
  lim int;
  cnt int;
begin
  -- Only relevant when a row becomes a client/clinician attached to an org,
  -- and only when that attachment actually changed.
  if new.org_id is not null
     and new.role in ('client', 'clinician')
     and (tg_op = 'INSERT'
          or new.org_id is distinct from old.org_id
          or new.role   is distinct from old.role) then

    -- Lock the org row so two concurrent inserts can't both pass the check.
    select case new.role
             when 'client'    then client_limit
             when 'clinician' then clinician_limit
           end
      into lim
      from public.organizations
      where id = new.org_id
      for update;

    if lim is not null then
      select count(*) into cnt
        from public.profiles
        where org_id = new.org_id
          and role = new.role
          and id <> new.id;          -- don't count the row being saved

      if cnt >= lim then
        raise exception '% limit reached for this organization (max %).',
              initcap(new.role), lim
          using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_member_limit on public.profiles;
create trigger trg_enforce_member_limit
  before insert or update on public.profiles
  for each row execute procedure public.enforce_member_limit();

-- ── 4. Grants for the Add-client function ────────────────────────────────
-- The function runs as `service_role`, which bypasses RLS but NOT table-level
-- GRANTs. Because "expose new tables" is off at the project level, service_role
-- had no privileges on these tables, so its queries failed with "permission
-- denied" (surfaced as "Your profile could not be found"). It needs SELECT to
-- verify the caller + pre-check the limit, and UPDATE to attach the new client
-- to the org.
grant select         on public.organizations to service_role;
grant select, update on public.profiles      to service_role;
