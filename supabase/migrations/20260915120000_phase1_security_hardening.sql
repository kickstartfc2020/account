-- Phase 1 security hardening (see REMEDIATION_PLAN.md, section A)
--
-- Scope of this migration:
--   1. Lock down generate_monthly_renewals: remove anon/authenticated execute,
--      restrict to service_role, add run auditing.
--   2. Close the direct-PostgREST-write gap on invoices.invoice_date by moving
--      it behind an audited RPC and revoking blanket UPDATE at the column level.
--   3. Tighten anon/helper grants: remove anon's blanket table access to
--      financial/business tables and remove anon's execute grant on
--      admin_reset_financial_year / get_financial_year_reset_preview.
--   4. Add a generic RPC audit log used by the hardened functions.
--
-- This migration does NOT delete, rewrite, or otherwise alter any existing
-- row in invoices, payments, renewals, packages, students, or invoice_items.
-- It only changes function definitions, grants, and adds one new,
-- append-only audit table.

-- ---------------------------------------------------------------------------
-- 1. Audit log table (append-only, service-role/definer-only writes)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."rpc_audit_log" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    "action" text NOT NULL,
    "actor_id" uuid,
    "organization_id" uuid,
    "details" jsonb,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "public"."rpc_audit_log" OWNER TO "postgres";

ALTER TABLE "public"."rpc_audit_log" ENABLE ROW LEVEL SECURITY;

-- Only super admins (and service_role, which bypasses RLS) may read the log.
-- No INSERT/UPDATE/DELETE policy is defined for anon/authenticated: rows are
-- written exclusively by SECURITY DEFINER functions running as the table
-- owner, never directly by client roles.
DROP POLICY IF EXISTS "rpc_audit_log_select_policy" ON "public"."rpc_audit_log";
CREATE POLICY "rpc_audit_log_select_policy" ON "public"."rpc_audit_log"
  FOR SELECT USING ("public"."is_super_admin"());

REVOKE ALL ON TABLE "public"."rpc_audit_log" FROM PUBLIC, "anon", "authenticated";
GRANT SELECT ON TABLE "public"."rpc_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."rpc_audit_log" TO "service_role";

-- ---------------------------------------------------------------------------
-- 2. Lock down generate_monthly_renewals
-- ---------------------------------------------------------------------------
-- Previously: SECURITY DEFINER, no auth check at all, and EXECUTE granted to
-- anon. Any holder of the public anon API key could invoke it directly via
-- PostgREST (POST /rest/v1/rpc/generate_monthly_renewals) for any org.
--
-- Fix: restrict EXECUTE to service_role only (this function is meant to run
-- from a trusted scheduled context, e.g. pg_cron or a service-role-invoked
-- job, never from the browser client) and record every run in the audit log.
-- Business logic (which students/packages qualify, the on-conflict dedupe)
-- is unchanged.

CREATE OR REPLACE FUNCTION "public"."generate_monthly_renewals"("p_run_date" "date" DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_cycle_start date;
  v_cycle_end date;
  v_count integer := 0;
begin
  -- Authorization is enforced at the grant level below (EXECUTE is revoked
  -- from anon/authenticated and granted only to service_role), which is the
  -- same mechanism Postgres/PostgREST uses to gate every other role in this
  -- schema, so no additional in-function role check is needed here.

  v_cycle_start := date_trunc('month', p_run_date)::date;
  v_cycle_end := (date_trunc('month', p_run_date) + interval '1 month - 1 day')::date;

  insert into public.renewals (
    organization_id,
    branch_id,
    student_id,
    package_id,
    cycle_start,
    cycle_end,
    due_date,
    status,
    balance_amount
  )
  select
    s.organization_id,
    s.branch_id,
    s.id,
    p.id,
    v_cycle_start,
    v_cycle_end,
    v_cycle_end,
    'pending',
    p.amount
  from public.students s
  join public.packages p
    on p.id = s.current_package_id
  where s.status = 'active'
    and p.status = 'active'
    and p.billing_type = 'recurring_monthly'
  on conflict (student_id, package_id, cycle_start, cycle_end) do nothing;

  get diagnostics v_count = row_count;

  insert into public.rpc_audit_log (action, actor_id, organization_id, details)
  values (
    'generate_monthly_renewals',
    auth.uid(),
    null,
    jsonb_build_object('run_date', p_run_date, 'cycle_start', v_cycle_start, 'cycle_end', v_cycle_end, 'rows_inserted', v_count)
  );

  return v_count;
end;
$$;

ALTER FUNCTION "public"."generate_monthly_renewals"("p_run_date" "date") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."generate_monthly_renewals"("p_run_date" "date") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."generate_monthly_renewals"("p_run_date" "date") TO "service_role";

-- ---------------------------------------------------------------------------
-- 3. Audited RPC for invoice date edits (closes the direct-PostgREST-write
--    gap identified in the audit: src/lib/invoiceMutations.ts previously
--    issued a bare .from('invoices').update({ invoice_date }) relying on RLS
--    alone, with no audit trail).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."update_invoice_date_audited"("p_invoice_number" "text", "p_invoice_date" "date") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_invoice_id uuid;
  v_org_id uuid;
  v_branch_id uuid;
  v_old_date date;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select id, organization_id, branch_id, invoice_date
    into v_invoice_id, v_org_id, v_branch_id, v_old_date
  from public.invoices
  where invoice_number = p_invoice_number
  for update;

  if not found then
    raise exception 'Invoice not found.';
  end if;

  if not public.can_access_organization(v_org_id) then
    raise exception 'You do not have access to this invoice.';
  end if;

  if public.current_role() = 'branch_manager' and v_branch_id <> public.current_branch_id() then
    raise exception 'Branch managers can only edit invoices in their own branch.';
  end if;

  if public.current_role() not in ('super_admin', 'organization_admin', 'branch_manager') then
    raise exception 'Insufficient role to edit invoice date.';
  end if;

  update public.invoices
  set invoice_date = p_invoice_date,
      updated_by = auth.uid(),
      updated_at = now()
  where id = v_invoice_id;

  insert into public.rpc_audit_log (action, actor_id, organization_id, details)
  values (
    'update_invoice_date',
    auth.uid(),
    v_org_id,
    jsonb_build_object('invoice_number', p_invoice_number, 'old_date', v_old_date, 'new_date', p_invoice_date)
  );

  return true;
end;
$$;

ALTER FUNCTION "public"."update_invoice_date_audited"("p_invoice_number" "text", "p_invoice_date" "date") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."update_invoice_date_audited"("p_invoice_number" "text", "p_invoice_date" "date") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."update_invoice_date_audited"("p_invoice_number" "text", "p_invoice_date" "date") TO "authenticated", "service_role";

-- Remove blanket UPDATE on invoices from authenticated so PostgREST can no
-- longer be used to write total_amount / subtotal / tax_total / status /
-- balance_amount / cancelled_at directly, bypassing finalize_invoice_write*,
-- record_invoice_payment, and cancel_invoice_safe. All RPCs that legitimately
-- mutate invoices are SECURITY DEFINER and run as the function owner, so they
-- are unaffected by this revoke. Only the non-financial "notes" field (used
-- by the manual-invoice bill-to flow in CreateInvoice.tsx) keeps direct
-- column-level UPDATE access.
REVOKE UPDATE ON TABLE "public"."invoices" FROM "authenticated";
GRANT UPDATE ("notes") ON TABLE "public"."invoices" TO "authenticated";

-- ---------------------------------------------------------------------------
-- 4. Tighten anon grants on financial/business tables
-- ---------------------------------------------------------------------------
-- RLS already blocks anon from reading/writing any row on these tables
-- (every policy requires is_super_admin()/current_role() checks that
-- evaluate false with no authenticated session), but the tables were also
-- granted ALL at the table level to anon in the baseline migration. Revoking
-- this is pure defense-in-depth: it removes the PostgREST attack surface
-- entirely for the anon role instead of relying solely on RLS to reject it.

REVOKE ALL ON TABLE "public"."invoices" FROM "anon";
REVOKE ALL ON TABLE "public"."invoice_items" FROM "anon";
REVOKE ALL ON TABLE "public"."packages" FROM "anon";
REVOKE ALL ON TABLE "public"."payments" FROM "anon";
REVOKE ALL ON TABLE "public"."renewals" FROM "anon";
REVOKE ALL ON TABLE "public"."students" FROM "anon";

-- ---------------------------------------------------------------------------
-- 5. Tighten anon grants on financial-year reset RPCs
-- ---------------------------------------------------------------------------
-- These functions are role-gated internally (super_admin / organization_admin
-- only) so an anon caller was already rejected by the function body, but the
-- anon EXECUTE grant is unnecessary attack surface and inconsistent with the
-- REVOKE ... FROM anon pattern already used for finalize_invoice_write* and
-- record_invoice_payment. No change to the functions' logic or scope here —
-- that is tracked separately (REMEDIATION_PLAN.md item A2) and requires a
-- product decision before the delete-scope bug itself is touched.

REVOKE ALL ON FUNCTION "public"."admin_reset_financial_year"("uuid", "text", "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."get_financial_year_reset_preview"("uuid") FROM "anon";
