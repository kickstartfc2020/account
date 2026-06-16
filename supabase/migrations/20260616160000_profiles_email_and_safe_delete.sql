-- Fix: User Management page was displaying the *branch's* contact email
-- (branches.email) instead of each user's real login email, because
-- profiles never stored an email at all. Every branch_manager assigned to
-- the same branch therefore rendered with the identical (wrong) email,
-- which looked like duplicate accounts and made newly added logins appear
-- as if they "didn't take" once the page was refreshed.
--
-- Also fixes admin_delete_auth_user(): profiles_id_fkey is
-- ON DELETE RESTRICT, so deleting from auth.users while a profiles row
-- still references it always failed with a foreign-key violation. There
-- was no working delete path for any user that had a profile (i.e. every
-- admin/branch_manager/org_admin in the system).

-- 1) Add email to profiles and backfill from auth.users.
ALTER TABLE "public"."profiles" ADD COLUMN IF NOT EXISTS "email" "text";

UPDATE "public"."profiles" p
SET "email" = lower(u.email)
FROM "auth"."users" u
WHERE u.id = p.id
  AND p.email IS NULL
  AND u.email IS NOT NULL;

-- One email maps to exactly one profile (case-insensitive), matching how
-- Supabase Auth already treats auth.users.email as globally unique.
DROP INDEX IF EXISTS "uq_profiles_email";
CREATE UNIQUE INDEX "uq_profiles_email" ON "public"."profiles" (lower("email")) WHERE ("email" IS NOT NULL);

-- 2) Keep profiles.email in sync for the super_admin bootstrap trigger.
CREATE OR REPLACE FUNCTION "public"."sync_admin_profile_for_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if lower(coalesce(new.email, '')) = 'admin@kickstartaccounts.com' then
    insert into public.profiles (
      id,
      organization_id,
      branch_id,
      role,
      full_name,
      status,
      email
    ) values (
      new.id,
      null,
      null,
      'super_admin',
      coalesce(nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''), 'Admin'),
      'active',
      lower(new.email)
    )
    on conflict (id) do update
      set organization_id = null,
          branch_id = null,
          role = 'super_admin',
          full_name = excluded.full_name,
          status = 'active',
          email = excluded.email,
          updated_at = now();
  end if;

  return new;
end;
$$;

-- 3) Make user deletion actually work. Two separate problems here:
-- (a) profiles_id_fkey is ON DELETE RESTRICT, so the profile row must be
--     removed first (with a friendly error if financial history blocks it).
-- (b) this function was only ever GRANTed to service_role, never to
--     authenticated -- so calling it from the browser client (which is
--     what src/lib/adminManagement.ts deleteAuthUser() actually does)
--     always failed with "permission denied", regardless of role. The
--     function already enforces super_admin internally, so granting
--     EXECUTE to authenticated is safe.
CREATE OR REPLACE FUNCTION "public"."admin_delete_auth_user"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_role public.app_role;
  v_deleted integer := 0;
begin
  v_role := public.current_role();
  if v_role is distinct from 'super_admin' then
    raise exception 'Only super_admin may delete auth users.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot delete your own account.';
  end if;

  begin
    delete from public.profiles where id = p_user_id;
  exception
    when foreign_key_violation then
      raise exception 'Cannot delete this user: they have created or updated invoices, payments, or students. Deactivate the account instead.';
  end;

  delete from auth.users
  where id = p_user_id;

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

GRANT EXECUTE ON FUNCTION "public"."admin_delete_auth_user"("p_user_id" "uuid") TO "authenticated";
