-- Phase 6w: ensure the primary admin email always resolves to a super-admin profile.

create or replace function public.sync_admin_profile_for_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.email, '')) = 'admin@kickstartaccounts.com' then
    insert into public.profiles (
      id,
      organization_id,
      branch_id,
      role,
      full_name,
      status
    ) values (
      new.id,
      null,
      null,
      'super_admin',
      coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''), 'Admin'),
      'active'
    )
    on conflict (id) do update
      set organization_id = null,
          branch_id = null,
          role = 'super_admin',
          full_name = excluded.full_name,
          status = 'active',
          updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists sync_admin_profile_for_email on auth.users;
create trigger sync_admin_profile_for_email
after insert or update of email on auth.users
for each row
execute function public.sync_admin_profile_for_email();

do $$
declare
  v_user_id uuid;
begin
  select id
    into v_user_id
  from auth.users
  where lower(email) = 'admin@kickstartaccounts.com'
    and deleted_at is null
  order by created_at asc
  limit 1;

  if v_user_id is not null then
    insert into public.profiles (
      id,
      organization_id,
      branch_id,
      role,
      full_name,
      status
    ) values (
      v_user_id,
      null,
      null,
      'super_admin',
      'Admin',
      'active'
    )
    on conflict (id) do update
      set organization_id = null,
          branch_id = null,
          role = 'super_admin',
          full_name = excluded.full_name,
          status = 'active',
          updated_at = now();
  end if;
end;
$$;