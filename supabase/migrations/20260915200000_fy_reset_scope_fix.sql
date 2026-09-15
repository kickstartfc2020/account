-- A2 fix (latest read-only audit): admin_reset_financial_year computed a FY
-- window (v_fy_start/v_fy_end from *today's* date) purely for the label in
-- its return row, then deleted with NO date filter at all -- every DELETE
-- was `WHERE organization_id = v_org_id` (or `WHERE true` for the global
-- path), i.e. a full historical wipe, not a "financial year" reset.
-- get_financial_year_reset_preview had the same disconnect: it computed
-- fy_start/fy_end correctly but counted `COUNT(*) FROM invoices` etc with no
-- date filter, so the preview a super/org admin sees before confirming
-- always shows "everything", matching what the (also unscoped) reset then
-- actually deletes -- internally consistent, but neither one respects the
-- business rule that a reset may only touch the explicitly selected FY.
--
-- Fix: both functions now take a mandatory p_financial_year ('YYYY-YY'),
-- derive fy_start/fy_end from it (not from CURRENT_DATE), and scope every
-- count/delete to invoices.invoice_date BETWEEN fy_start AND fy_end. All
-- other tables (invoice_items, payments, invoice_reminders,
-- invoice_write_requests, renewals) are scoped transitively through the set
-- of invoice ids that fall in that window -- never independently by
-- organization_id/date alone -- so nothing outside the selected FY (or,
-- for an org-scoped reset, outside that organization) is ever touched.
--
-- ref_counters and organization_invoice_counters are no longer touched by
-- this function at all (previously deleted unconditionally): resetting
-- invoice numbering is out of scope for "delete this FY's records" and the
-- task this migration implements explicitly forbids it.
--
-- Adding a new required leading parameter changes the function's call
-- signature, so (matching the pattern already established by
-- 20260717000000_partial_payments_and_reminders.sql for
-- finalize_invoice_write) the old signatures are dropped first to avoid
-- leaving an ambiguous overload behind. Supabase's PostgREST client always
-- calls RPCs with named arguments, so existing callers are updated in the
-- same change (src/lib/invoiceReset.ts, Settings.tsx, InvoicesOverview.tsx)
-- rather than relying on positional-argument compatibility.
--
-- Unchanged: the FY-scoped delete logic, the FY-bound confirmation, the
-- set_config('app.allow_hard_delete', 'on', true) bypass for the
-- prevent_hard_delete triggers, the overall delete ordering (renewals
-- unlinked -> write_requests/reminders/payments/invoice_items deleted ->
-- invoices deleted, respecting the ON DELETE RESTRICT foreign keys from
-- invoice_items/payments/invoice_reminders/renewals to invoices), counter
-- preservation (ref_counters/organization_invoice_counters untouched), the
-- legacy admin_reset_invoices grant restriction, and the shape of both
-- functions' return rows.
--
-- Hardening pass (same migration, not yet applied): the confirmed product
-- rule is that the financial-year reset -- and its preview -- is a
-- super-admin-only operation. Both functions previously also accepted
-- 'organization_admin' and were EXECUTE-granted to anon. Both are now:
--   * role-gated to v_role = 'super_admin' only (organization_admin's
--     former own-org-scoped path, and its now-dead org-membership check,
--     are removed accordingly);
--   * EXECUTE-revoked from PUBLIC and anon, granted only to authenticated
--     and service_role.
-- p_organization_id is unchanged in meaning: a super_admin passing an
-- explicit org id scopes the reset/preview to that org; NULL means global.
--
-- This migration only replaces function definitions and grants. It does
-- not execute any reset and does not touch, delete, or backfill any
-- existing row.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. get_financial_year_reset_preview: FY-scoped counts, matching the reset.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_financial_year_reset_preview(uuid);

CREATE OR REPLACE FUNCTION public.get_financial_year_reset_preview(
  p_financial_year text,
  p_organization_id uuid DEFAULT NULL
)
RETURNS TABLE (
  financial_year text,
  fy_start date,
  fy_end date,
  invoices_count integer,
  invoice_items_count integer,
  payments_count integer,
  renewals_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role          public.app_role;
  v_org_id        uuid;
  v_global        boolean := false;
  v_fy_start_year int;
  v_fy_start      date;
  v_fy_end        date;
BEGIN
  v_role := public.current_role();

  -- Confirmed product rule: the financial-year reset (and its preview) is a
  -- super-admin-only operation. organization_admin previously passed this
  -- check too; that authority is removed here.
  IF v_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super administrators can preview the financial year reset.';
  END IF;

  IF p_financial_year IS NULL OR p_financial_year !~ '^[0-9]{4}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'A valid financial year in YYYY-YY format is required (e.g. 2025-26).';
  END IF;

  v_fy_start_year := substring(p_financial_year from 1 for 4)::int;

  IF substring(p_financial_year from 6 for 2) <> lpad(((v_fy_start_year + 1) % 100)::text, 2, '0') THEN
    RAISE EXCEPTION 'Financial year % is not a valid sequential year range (expected %-%).',
      p_financial_year, v_fy_start_year, lpad(((v_fy_start_year + 1) % 100)::text, 2, '0');
  END IF;

  v_fy_start := make_date(v_fy_start_year, 4, 1);
  v_fy_end   := make_date(v_fy_start_year + 1, 3, 31);

  -- Only super_admin reaches this point, so no own-organization membership
  -- check is needed: an explicit p_organization_id previews that org, NULL
  -- previews globally across all orgs.
  v_org_id := p_organization_id;
  v_global := v_org_id IS NULL;

  RETURN QUERY SELECT
    p_financial_year,
    v_fy_start,
    v_fy_end,
    (SELECT COUNT(*)::int
       FROM public.invoices i
       WHERE i.invoice_date BETWEEN v_fy_start AND v_fy_end
         AND (v_global OR i.organization_id = v_org_id)),
    (SELECT COUNT(*)::int
       FROM public.invoice_items ii
       WHERE ii.invoice_id IN (
         SELECT i.id FROM public.invoices i
         WHERE i.invoice_date BETWEEN v_fy_start AND v_fy_end
           AND (v_global OR i.organization_id = v_org_id)
       )),
    (SELECT COUNT(*)::int
       FROM public.payments p
       WHERE p.invoice_id IN (
         SELECT i.id FROM public.invoices i
         WHERE i.invoice_date BETWEEN v_fy_start AND v_fy_end
           AND (v_global OR i.organization_id = v_org_id)
       )),
    (SELECT COUNT(*)::int
       FROM public.renewals r
       WHERE r.source_invoice_id IN (
               SELECT i.id FROM public.invoices i
               WHERE i.invoice_date BETWEEN v_fy_start AND v_fy_end
                 AND (v_global OR i.organization_id = v_org_id)
             )
          OR r.generated_invoice_id IN (
               SELECT i.id FROM public.invoices i
               WHERE i.invoice_date BETWEEN v_fy_start AND v_fy_end
                 AND (v_global OR i.organization_id = v_org_id)
             ));
END;
$$;

ALTER FUNCTION public.get_financial_year_reset_preview(text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_financial_year_reset_preview(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_financial_year_reset_preview(text, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. admin_reset_financial_year: FY-scoped, FY-bound-confirmation reset.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_reset_financial_year(uuid, text, text);

CREATE OR REPLACE FUNCTION public.admin_reset_financial_year(
  p_financial_year text,
  p_organization_id uuid DEFAULT NULL,
  p_confirmation_text text DEFAULT NULL,
  p_ip_address text DEFAULT NULL
)
RETURNS TABLE (
  financial_year text,
  invoices_deleted integer,
  invoice_items_deleted integer,
  payments_deleted integer,
  renewals_deleted integer,
  backup_id bigint,
  audit_log_id bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role          public.app_role;
  v_org_id        uuid;
  v_global        boolean := false;
  v_del_invoices  integer := 0;
  v_del_items     integer := 0;
  v_del_payments  integer := 0;
  v_del_renewals  integer := 0;
  v_fy_start_year int;
  v_fy_start      date;
  v_fy_end        date;
BEGIN
  v_role := public.current_role();

  -- Confirmed product rule: the financial-year reset is a super-admin-only
  -- operation. organization_admin previously passed this check too; that
  -- authority is removed here.
  IF v_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only super administrators can reset invoices.';
  END IF;

  IF p_financial_year IS NULL OR p_financial_year !~ '^[0-9]{4}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'A valid financial year in YYYY-YY format is required (e.g. 2025-26).';
  END IF;

  v_fy_start_year := substring(p_financial_year from 1 for 4)::int;

  IF substring(p_financial_year from 6 for 2) <> lpad(((v_fy_start_year + 1) % 100)::text, 2, '0') THEN
    RAISE EXCEPTION 'Financial year % is not a valid sequential year range (expected %-%).',
      p_financial_year, v_fy_start_year, lpad(((v_fy_start_year + 1) % 100)::text, 2, '0');
  END IF;

  -- Confirmation is bound to the exact FY being reset -- typing "RESET" (or
  -- the RESET for a different FY) is never sufficient.
  IF p_confirmation_text IS DISTINCT FROM ('RESET ' || p_financial_year) THEN
    RAISE EXCEPTION 'Confirmation text must be exactly "RESET %".', p_financial_year;
  END IF;

  -- Only super_admin reaches this point, so no own-organization membership
  -- check is needed: an explicit p_organization_id resets that org, NULL
  -- resets globally across all orgs.
  v_org_id := p_organization_id;
  v_global := v_org_id IS NULL;

  v_fy_start := make_date(v_fy_start_year, 4, 1);
  v_fy_end   := make_date(v_fy_start_year + 1, 3, 31);

  -- Bypass prevent_hard_delete triggers for this transaction.
  PERFORM set_config('app.allow_hard_delete', 'on', true);

  -- Single shared advisory-lock key for every reset call, global or
  -- org-scoped: a global reset and any organization's reset can never run
  -- concurrently and race each other's deletes (previously, a global reset
  -- used a lock key derived from the literal 'global' while an org-scoped
  -- reset used a key derived from that org's id, so the two could interleave).
  PERFORM pg_advisory_xact_lock(hashtextextended('financial_year_reset', 0));

  -- Every child table is scoped through the exact set of invoice ids whose
  -- invoice_date falls inside [v_fy_start, v_fy_end] (and, for an org-scoped
  -- reset, that belong to v_org_id) -- never independently by organization_id
  -- or an unconditional `true`, so nothing outside the selected FY is
  -- touched, in either the global or the org-scoped path.

  UPDATE public.renewals r
  SET
    source_invoice_id = NULL,
    generated_invoice_id = NULL
  WHERE r.source_invoice_id IN (
          SELECT i.id FROM public.invoices i
          WHERE i.invoice_date BETWEEN v_fy_start AND v_fy_end
            AND (v_global OR i.organization_id = v_org_id)
        )
     OR r.generated_invoice_id IN (
          SELECT i.id FROM public.invoices i
          WHERE i.invoice_date BETWEEN v_fy_start AND v_fy_end
            AND (v_global OR i.organization_id = v_org_id)
        );
  GET DIAGNOSTICS v_del_renewals = ROW_COUNT;

  DELETE FROM public.invoice_write_requests
  WHERE invoice_id IN (
    SELECT i.id FROM public.invoices i
    WHERE i.invoice_date BETWEEN v_fy_start AND v_fy_end
      AND (v_global OR i.organization_id = v_org_id)
  );

  DELETE FROM public.invoice_reminders
  WHERE invoice_id IN (
    SELECT i.id FROM public.invoices i
    WHERE i.invoice_date BETWEEN v_fy_start AND v_fy_end
      AND (v_global OR i.organization_id = v_org_id)
  );

  DELETE FROM public.payments
  WHERE invoice_id IN (
    SELECT i.id FROM public.invoices i
    WHERE i.invoice_date BETWEEN v_fy_start AND v_fy_end
      AND (v_global OR i.organization_id = v_org_id)
  );
  GET DIAGNOSTICS v_del_payments = ROW_COUNT;

  DELETE FROM public.invoice_items
  WHERE invoice_id IN (
    SELECT i.id FROM public.invoices i
    WHERE i.invoice_date BETWEEN v_fy_start AND v_fy_end
      AND (v_global OR i.organization_id = v_org_id)
  );
  GET DIAGNOSTICS v_del_items = ROW_COUNT;

  DELETE FROM public.invoices i
  WHERE i.invoice_date BETWEEN v_fy_start AND v_fy_end
    AND (v_global OR i.organization_id = v_org_id);
  GET DIAGNOSTICS v_del_invoices = ROW_COUNT;

  -- ref_counters / organization_invoice_counters are intentionally left
  -- untouched -- invoice numbering must survive a financial-year reset.

  RETURN QUERY SELECT
    p_financial_year,
    v_del_invoices,
    v_del_items,
    v_del_payments,
    v_del_renewals,
    0::bigint,
    0::bigint;
END;
$$;

ALTER FUNCTION public.admin_reset_financial_year(text, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_reset_financial_year(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_financial_year(text, uuid, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Legacy admin_reset_invoices: unscoped (whole-org, no FY filter at all)
--    destructive path with no remaining callers (confirmed: no reference in
--    src/**/*.ts(x)). Revoke authenticated/anon access; leave the function
--    itself in place (dropping it is a separate, larger decision) so any
--    service-role-only internal tooling that might depend on it is
--    unaffected.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.admin_reset_invoices(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_invoices(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Reload PostgREST's schema cache so both changed RPC signatures (and the
--    revoked admin_reset_invoices grant) are picked up immediately.
-- ---------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';
