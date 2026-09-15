-- Fixes the find-then-insert race condition in the manual-invoice
-- sport/package bootstrap flow (src/pages/CreateInvoice.tsx).
--
-- Previously the client did: SELECT sport by name -> if none, INSERT sport;
-- SELECT package by name+sport -> if none, INSERT package. Two employees
-- hitting "Create manual invoice" for the first time concurrently could both
-- see no existing row and both attempt the INSERT. The unique constraints
-- already in place (uq_sports_org_name_global / uq_sports_org_branch_name on
-- sports; packages_organization_id_sport_id_name_key on packages) correctly
-- prevented a duplicate row, but the second employee's request failed with a
-- raw Postgres unique-violation error instead of transparently reusing the
-- row the first request just created.
--
-- Fix: a single SECURITY DEFINER RPC that does both upserts atomically using
-- INSERT ... ON CONFLICT ... DO UPDATE, so a concurrent duplicate attempt
-- always resolves to the winning row instead of erroring. No schema change,
-- no new tables, no change to pricing/duration/branch/renewal/reset logic.
-- Existing sport/package rows are only touched by the DO UPDATE branch, which
-- reactivates status/archived_at exactly as the previous client-side "else"
-- branch did -- it never rewrites name, amount, gst_percent, or duration.

CREATE OR REPLACE FUNCTION "public"."get_or_create_manual_billing_context"("p_gst_percent" numeric DEFAULT 18)
RETURNS TABLE (
  "sport_id" uuid,
  "sport_name" text,
  "package_id" uuid,
  "package_name" text
)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_org_id uuid;
  v_role public.app_role;
  v_branch_id uuid;
  v_gst_percent numeric;
  v_sport_id uuid;
  v_sport_name text;
  v_package_id uuid;
  v_package_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  v_org_id := public.current_organization_id();
  if v_org_id is null then
    raise exception 'Organization context is required.';
  end if;

  v_role := public.current_role();
  if v_role is null then
    raise exception 'Role context is missing for current user.';
  end if;

  if v_role = 'branch_manager' then
    v_branch_id := public.current_branch_id();
    if v_branch_id is null then
      raise exception 'Unable to resolve branch context.';
    end if;
  else
    v_branch_id := null;
  end if;

  v_gst_percent := coalesce(p_gst_percent, 18);

  -- Sport: matches uq_sports_org_name_global (branch_id is null) or
  -- uq_sports_org_branch_name (branch_id is not null) depending on role,
  -- exactly mirroring the branch scoping createSport() already used.
  if v_branch_id is null then
    insert into public.sports (organization_id, branch_id, name, status)
    values (v_org_id, null, 'Manual Invoices', 'active')
    on conflict (organization_id, branch_id, name) where branch_id is null
    do update set status = 'active', archived_at = null
    returning id, name into v_sport_id, v_sport_name;
  else
    insert into public.sports (organization_id, branch_id, name, status)
    values (v_org_id, v_branch_id, 'Manual Invoices', 'active')
    on conflict (organization_id, branch_id, name) where branch_id is not null
    do update set status = 'active', archived_at = null
    returning id, name into v_sport_id, v_sport_name;
  end if;

  -- Package: matches packages_organization_id_sport_id_name_key. Amount,
  -- gst_percent, duration and billing_type are only set on first creation;
  -- an existing row is reactivated (status/archived_at) but never rewritten,
  -- so a manually-adjusted manual-billing package price is preserved.
  insert into public.packages (
    organization_id, branch_id, sport_id, name, billing_type,
    duration_months, amount, gst_percent, status
  )
  values (
    v_org_id, v_branch_id, v_sport_id, 'Manual Billing Package', 'one_time',
    1, 0, v_gst_percent, 'active'
  )
  on conflict (organization_id, sport_id, name)
  do update set status = 'active', archived_at = null
  returning id, name into v_package_id, v_package_name;

  return query select v_sport_id, v_sport_name, v_package_id, v_package_name;
end;
$$;

ALTER FUNCTION "public"."get_or_create_manual_billing_context"("p_gst_percent" numeric) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_or_create_manual_billing_context"("p_gst_percent" numeric) FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."get_or_create_manual_billing_context"("p_gst_percent" numeric) TO "authenticated", "service_role";
