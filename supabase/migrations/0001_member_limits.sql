-- Member limits (clients + clinicians) per organization.
--
-- Run this in the Supabase SQL editor. It is idempotent — safe to re-run.
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

-- ── 2. Populate profile from auth metadata on signup ─────────────────────
-- Backward compatible: a user added via the Supabase dashboard carries no
-- org_id/role metadata, so this falls back to the old "blank profile" behaviour
-- (org_id NULL, role 'client'). org_id + role are read from app_metadata
-- (server-set, not user-editable); display_name from user_metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, org_id, role, display_name)
  values (
    new.id,
    (new.raw_app_meta_data ->> 'org_id')::uuid,
    coalesce(new.raw_app_meta_data ->> 'role', 'client'),
    new.raw_user_meta_data ->> 'display_name'
  );
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
