-- Migration: Add financial year reset RPC functions
-- Called by the Settings page financial year reset button.

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
  v_org_id uuid;
  v_today date := CURRENT_DATE;
  v_fy_year int;
  v_fy_start date;
  v_fy_end date;
BEGIN
  v_org_id := COALESCE(p_organization_id, public.current_organization_id());
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization context is required.';
  END IF;

  -- India FY: April 1 – March 31
  IF EXTRACT(MONTH FROM v_today) >= 4 THEN
    v_fy_year := EXTRACT(YEAR FROM v_today)::int;
  ELSE
    v_fy_year := EXTRACT(YEAR FROM v_today)::int - 1;
  END IF;

  v_fy_start := make_date(v_fy_year, 4, 1);
  v_fy_end   := make_date(v_fy_year + 1, 3, 31);

  RETURN QUERY SELECT
    (v_fy_year::text || '-' || LPAD(((v_fy_year + 1) % 100)::text, 2, '0'))::text,
    v_fy_start,
    v_fy_end,
    (SELECT COUNT(*)::int FROM public.invoices       WHERE organization_id = v_org_id),
    (SELECT COUNT(*)::int FROM public.invoice_items  WHERE organization_id = v_org_id),
    (SELECT COUNT(*)::int FROM public.payments        WHERE organization_id = v_org_id),
    (SELECT COUNT(*)::int FROM public.renewals        WHERE organization_id = v_org_id);
END;
$$;

ALTER FUNCTION public.get_financial_year_reset_preview(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_financial_year_reset_preview(uuid) TO anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public.admin_reset_financial_year(
  p_organization_id uuid DEFAULT NULL,
  p_confirmation_text text DEFAULT 'RESET',
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
  v_role        public.app_role;
  v_org_id      uuid;
  v_del_invoices  integer := 0;
  v_del_items     integer := 0;
  v_del_payments  integer := 0;
  v_del_renewals  integer := 0;
  v_today       date := CURRENT_DATE;
  v_fy_year     int;
  v_fy_label    text;
BEGIN
  v_role := public.current_role();
  IF v_role NOT IN ('super_admin', 'organization_admin') THEN
    RAISE EXCEPTION 'Only organization administrators can reset invoices.';
  END IF;

  IF p_confirmation_text <> 'RESET' THEN
    RAISE EXCEPTION 'Confirmation text must be exactly RESET.';
  END IF;

  v_org_id := COALESCE(p_organization_id, public.current_organization_id());
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization context is required for invoice reset.';
  END IF;

  IF v_role = 'organization_admin' AND public.current_organization_id() IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'You can only reset invoices for your active organization.';
  END IF;

  -- India FY label, e.g. "2025-26"
  IF EXTRACT(MONTH FROM v_today) >= 4 THEN
    v_fy_year := EXTRACT(YEAR FROM v_today)::int;
  ELSE
    v_fy_year := EXTRACT(YEAR FROM v_today)::int - 1;
  END IF;
  v_fy_label := v_fy_year::text || '-' || LPAD(((v_fy_year + 1) % 100)::text, 2, '0');

  -- Allow hard deletes for the duration of this transaction
  PERFORM set_config('app.allow_hard_delete', 'on', true);
  -- Prevent concurrent resets for the same org
  PERFORM pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':invoice_reset', 0));

  -- Null out renewal FK references before deleting invoices
  UPDATE public.renewals
  SET source_invoice_id   = NULL,
      generated_invoice_id = NULL
  WHERE organization_id = v_org_id
    AND (source_invoice_id IS NOT NULL OR generated_invoice_id IS NOT NULL);
  GET DIAGNOSTICS v_del_renewals = ROW_COUNT;

  -- Clear any pending write requests
  DELETE FROM public.invoice_write_requests
  WHERE organization_id = v_org_id;

  -- Delete payments
  DELETE FROM public.payments
  WHERE organization_id = v_org_id;
  GET DIAGNOSTICS v_del_payments = ROW_COUNT;

  -- Delete invoice line items
  DELETE FROM public.invoice_items
  WHERE organization_id = v_org_id;
  GET DIAGNOSTICS v_del_items = ROW_COUNT;

  -- Delete invoices
  DELETE FROM public.invoices
  WHERE organization_id = v_org_id;
  GET DIAGNOSTICS v_del_invoices = ROW_COUNT;

  -- Reset invoice number counters so numbering restarts from 1
  DELETE FROM public.ref_counters
  WHERE counter_key = 'invoice:' || v_org_id::text
     OR counter_key LIKE 'invoice:' || v_org_id::text || ':%';

  DELETE FROM public.organization_invoice_counters
  WHERE organization_id = v_org_id;

  RETURN QUERY SELECT
    v_fy_label,
    v_del_invoices,
    v_del_items,
    v_del_payments,
    v_del_renewals,
    0::bigint,   -- backup_id (no dedicated backup table)
    0::bigint;   -- audit_log_id
END;
$$;

ALTER FUNCTION public.admin_reset_financial_year(uuid, text, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.admin_reset_financial_year(uuid, text, text) TO anon, authenticated, service_role;
