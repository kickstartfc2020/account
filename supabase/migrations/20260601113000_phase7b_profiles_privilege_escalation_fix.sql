-- Phase 7b: Prevent profiles-based privilege escalation.
-- Enforces that only super_admin may mutate authorization-critical profile fields.

create or replace function public.profiles_block_privileged_updates()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_role public.app_role;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to update profiles.';
  end if;

  v_role := public.current_role();

  if v_role is distinct from 'super_admin' then
    if new.role is distinct from old.role
      or new.organization_id is distinct from old.organization_id
      or new.branch_id is distinct from old.branch_id
      or new.status is distinct from old.status then
      raise exception 'Only super_admin may modify role, organization_id, branch_id, or status.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_block_privileged_updates_trigger on public.profiles;
create trigger profiles_block_privileged_updates_trigger
before update on public.profiles
for each row execute function public.profiles_block_privileged_updates();

-- Tighten profiles RLS:
-- - non-super-admin users can update only their own profile row
-- - only super_admin can insert profile rows directly
-- Field-level privileged checks are enforced by trigger above.
drop policy if exists profiles_insert_policy on public.profiles;
create policy profiles_insert_policy
on public.profiles
for insert
with check (public.is_super_admin());

drop policy if exists profiles_update_policy on public.profiles;
create policy profiles_update_policy
on public.profiles
for update
using (
  public.is_super_admin()
  or id = auth.uid()
)
with check (
  public.is_super_admin()
  or id = auth.uid()
);
