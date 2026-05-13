-- Phase 6e: Secure super-admin onboarding for branch managers (no client-side signup).
create or replace function public.admin_create_branch_manager(
  p_email text,
  p_password text,
  p_full_name text,
  p_branch_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_role public.app_role;
  v_user_id uuid;
  v_org_id uuid;
  v_email text;
begin
  v_role := public.current_role();
  if v_role is distinct from 'super_admin' then
    raise exception 'Only super_admin may create branch manager accounts.';
  end if;

  v_email := lower(trim(p_email));
  if v_email is null or v_email = '' then
    raise exception 'Email is required.';
  end if;

  if p_password is null or length(p_password) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;

  select organization_id into v_org_id
  from public.branches
  where id = p_branch_id;

  if v_org_id is null then
    raise exception 'Branch not found.';
  end if;

  if exists (select 1 from auth.users where lower(email) = v_email and deleted_at is null) then
    raise exception 'A user with this email already exists.';
  end if;

  v_user_id := gen_random_uuid();

  insert into auth.users (
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_sso_user,
    is_anonymous,
    created_at,
    updated_at
  ) values (
    v_user_id,
    'authenticated',
    'authenticated',
    v_email,
    crypt(p_password, gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', array['email']),
    jsonb_build_object('full_name', coalesce(p_full_name, '')),
    false,
    false,
    now(),
    now()
  );

  insert into auth.identities (
    id,
    user_id,
    provider_id,
    provider,
    identity_data,
    created_at,
    updated_at
  ) values (
    gen_random_uuid(),
    v_user_id,
    v_email,
    'email',
    jsonb_build_object('sub', v_user_id::text, 'email', v_email),
    now(),
    now()
  );

  insert into public.profiles (
    id,
    organization_id,
    branch_id,
    role,
    full_name,
    status
  ) values (
    v_user_id,
    v_org_id,
    p_branch_id,
    'branch_manager',
    p_full_name,
    'active'
  );

  return v_user_id;
end;
$$;

revoke all on function public.admin_create_branch_manager(text, text, text, uuid) from public;
grant execute on function public.admin_create_branch_manager(text, text, text, uuid) to authenticated;
