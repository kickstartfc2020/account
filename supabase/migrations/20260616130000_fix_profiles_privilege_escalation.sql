-- Fix: prevent privilege escalation via direct profiles updates.
--
-- profiles_update_policy only requires (id = auth.uid()) in its WITH CHECK
-- clause, with no restriction on which columns a self-update may touch. Any
-- authenticated organization_admin or branch_manager can therefore call the
-- REST API directly (PATCH /profiles?id=eq.<own id>) and set
-- role = 'super_admin', organization_id = null, branch_id = null on their
-- own row, instantly granting themselves super_admin over every
-- organization. A previous migration (phase7b) attempted to close this with
-- a trigger that unconditionally raised when auth.uid() was null, which
-- would also have broken any trusted service_role/back-office call path; it
-- was rolled back the same day and never reapplied.
--
-- This version only restricts authenticated end-user sessions (auth.uid()
-- is not null) that are not super_admin. Calls made without a JWT context
-- (service_role / postgres, which already bypass RLS by design -- e.g. the
-- admin-create-branch-manager edge function) are left untouched.

CREATE OR REPLACE FUNCTION "public"."profiles_block_privileged_updates"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role public.app_role;
begin
  if auth.uid() is null then
    return new;
  end if;

  v_role := public.current_role();

  if v_role = 'super_admin' then
    return new;
  end if;

  if new.role is distinct from old.role
    or new.organization_id is distinct from old.organization_id
    or new.branch_id is distinct from old.branch_id
    or new.status is distinct from old.status then
    raise exception 'Only super_admin may modify role, organization_id, branch_id, or status.';
  end if;

  return new;
end;
$$;

ALTER FUNCTION "public"."profiles_block_privileged_updates"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "profiles_block_privileged_updates_trigger" ON "public"."profiles";

CREATE TRIGGER "profiles_block_privileged_updates_trigger"
    BEFORE UPDATE ON "public"."profiles"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."profiles_block_privileged_updates"();
