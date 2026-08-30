-- get_financial_year_reset_preview(p_organization_id) is a SECURITY DEFINER
-- function granted to anon/authenticated. Its sibling admin_reset_financial_year
-- (the actual destructive reset) checks that a non-super-admin caller's
-- p_organization_id matches their own current_organization_id() before
-- scoping the query to it. This preview function never had that check: it
-- only required v_role to be non-null when v_org_id was null (the "global"
-- branch), but once a p_organization_id was supplied, execution skipped
-- straight to returning counts scoped to it with no verification the
-- caller belongs to that org -- and for an anon caller, v_role is simply
-- null the whole time, so the role gate never even applied. Net effect: any
-- authenticated user, or an anonymous caller, could pass any organization's
-- id and read that org's invoice/invoice_item/payment/renewal counts.
--
-- Fix: add the same two guards admin_reset_financial_year already has --
-- reject non-super-admin/organization_admin roles up front, and reject an
-- organization_admin whose own org doesn't match the requested org. The FY
-- date math and the SELECT/columns/aggregation logic are unchanged.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_financial_year_reset_preview(
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
  v_role    public.app_role;
  v_org_id  uuid;
  v_global  boolean := false;
  v_today   date := CURRENT_DATE;
  v_fy_year int;
  v_fy_start date;
  v_fy_end   date;
BEGIN
  v_role   := public.current_role();

  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'organization_admin') THEN
    RAISE EXCEPTION 'Only organization administrators can preview the financial year reset.';
  END IF;

  v_org_id := COALESCE(p_organization_id, public.current_organization_id());

  -- Super admin calling with no org_id = global preview across all orgs.
  IF v_org_id IS NULL THEN
    IF v_role = 'super_admin' THEN
      v_global := true;
    ELSE
      RAISE EXCEPTION 'Organization context is required.';
    END IF;
  END IF;

  IF NOT v_global AND v_role = 'organization_admin'
    AND public.current_organization_id() IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'You can only preview the financial year reset for your active organization.';
  END IF;

  -- India FY: April 1 – March 31
  IF EXTRACT(MONTH FROM v_today) >= 4 THEN
    v_fy_year := EXTRACT(YEAR FROM v_today)::int;
  ELSE
    v_fy_year := EXTRACT(YEAR FROM v_today)::int - 1;
  END IF;

  v_fy_start := make_date(v_fy_year, 4, 1);
  v_fy_end   := make_date(v_fy_year + 1, 3, 31);

  IF v_global THEN
    RETURN QUERY SELECT
      (v_fy_year::text || '-' || LPAD(((v_fy_year + 1) % 100)::text, 2, '0'))::text,
      v_fy_start,
      v_fy_end,
      (SELECT COUNT(*)::int FROM public.invoices),
      (SELECT COUNT(*)::int FROM public.invoice_items),
      (SELECT COUNT(*)::int FROM public.payments),
      (SELECT COUNT(*)::int FROM public.renewals);
  ELSE
    RETURN QUERY SELECT
      (v_fy_year::text || '-' || LPAD(((v_fy_year + 1) % 100)::text, 2, '0'))::text,
      v_fy_start,
      v_fy_end,
      (SELECT COUNT(*)::int FROM public.invoices      WHERE organization_id = v_org_id),
      (SELECT COUNT(*)::int FROM public.invoice_items WHERE organization_id = v_org_id),
      (SELECT COUNT(*)::int FROM public.payments       WHERE organization_id = v_org_id),
      (SELECT COUNT(*)::int FROM public.renewals       WHERE organization_id = v_org_id);
  END IF;
END;
$$;

ALTER FUNCTION public.get_financial_year_reset_preview(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_financial_year_reset_preview(uuid) TO anon, authenticated, service_role;
