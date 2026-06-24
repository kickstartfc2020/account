  -- Re-apply financial year reset functions with global (super-admin, null org) support.
  -- Safe to run multiple times: CREATE OR REPLACE replaces any existing version.

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
    v_org_id := COALESCE(p_organization_id, public.current_organization_id());

    -- Super admin calling with no org_id = global preview across all orgs.
    IF v_org_id IS NULL THEN
      IF v_role = 'super_admin' THEN
        v_global := true;
      ELSE
        RAISE EXCEPTION 'Organization context is required.';
      END IF;
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
    v_role          public.app_role;
    v_org_id        uuid;
    v_global        boolean := false;
    v_del_invoices  integer := 0;
    v_del_items     integer := 0;
    v_del_payments  integer := 0;
    v_del_renewals  integer := 0;
    v_today         date := CURRENT_DATE;
    v_fy_year       int;
    v_fy_label      text;
  BEGIN
    v_role := public.current_role();

    IF v_role NOT IN ('super_admin', 'organization_admin') THEN
      RAISE EXCEPTION 'Only organization administrators can reset invoices.';
    END IF;

    IF p_confirmation_text <> 'RESET' THEN
      RAISE EXCEPTION 'Confirmation text must be exactly RESET.';
    END IF;

    v_org_id := COALESCE(p_organization_id, public.current_organization_id());

    -- Super admin with no org_id = global reset across all orgs.
    IF v_org_id IS NULL THEN
      IF v_role = 'super_admin' THEN
        v_global := true;
      ELSE
        RAISE EXCEPTION 'Organization context is required for invoice reset.';
      END IF;
    END IF;

    IF NOT v_global AND v_role = 'organization_admin'
      AND public.current_organization_id() IS DISTINCT FROM v_org_id THEN
      RAISE EXCEPTION 'You can only reset invoices for your active organization.';
    END IF;

    -- India FY label, e.g. "2025-26"
    IF EXTRACT(MONTH FROM v_today) >= 4 THEN
      v_fy_year := EXTRACT(YEAR FROM v_today)::int;
    ELSE
      v_fy_year := EXTRACT(YEAR FROM v_today)::int - 1;
    END IF;
    v_fy_label := v_fy_year::text || '-' || LPAD(((v_fy_year + 1) % 100)::text, 2, '0');

    -- Bypass prevent_hard_delete triggers for this transaction
    PERFORM set_config('app.allow_hard_delete', 'on', true);
    -- Advisory lock: global lock for global reset, per-org lock otherwise
    PERFORM pg_advisory_xact_lock(
      hashtextextended(COALESCE(v_org_id::text, 'global') || ':invoice_reset', 0)
    );

    IF v_global THEN
      -- Global reset: operate across all organizations
      UPDATE public.renewals
      SET source_invoice_id    = NULL,
          generated_invoice_id = NULL
      WHERE source_invoice_id IS NOT NULL OR generated_invoice_id IS NOT NULL;
      GET DIAGNOSTICS v_del_renewals = ROW_COUNT;

      DELETE FROM public.invoice_write_requests WHERE true;

      DELETE FROM public.payments WHERE true;
      GET DIAGNOSTICS v_del_payments = ROW_COUNT;

      DELETE FROM public.invoice_items WHERE true;
      GET DIAGNOSTICS v_del_items = ROW_COUNT;

      DELETE FROM public.invoices WHERE true;
      GET DIAGNOSTICS v_del_invoices = ROW_COUNT;

      DELETE FROM public.ref_counters
      WHERE counter_key LIKE 'invoice:%';

      DELETE FROM public.organization_invoice_counters WHERE true;

    ELSE
      -- Org-scoped reset
      UPDATE public.renewals
      SET source_invoice_id    = NULL,
          generated_invoice_id = NULL
      WHERE organization_id = v_org_id
        AND (source_invoice_id IS NOT NULL OR generated_invoice_id IS NOT NULL);
      GET DIAGNOSTICS v_del_renewals = ROW_COUNT;

      DELETE FROM public.invoice_write_requests
      WHERE organization_id = v_org_id;

      DELETE FROM public.payments
      WHERE organization_id = v_org_id;
      GET DIAGNOSTICS v_del_payments = ROW_COUNT;

      DELETE FROM public.invoice_items
      WHERE organization_id = v_org_id;
      GET DIAGNOSTICS v_del_items = ROW_COUNT;

      DELETE FROM public.invoices
      WHERE organization_id = v_org_id;
      GET DIAGNOSTICS v_del_invoices = ROW_COUNT;

      DELETE FROM public.ref_counters
      WHERE counter_key = 'invoice:' || v_org_id::text
        OR counter_key LIKE 'invoice:' || v_org_id::text || ':%';

      DELETE FROM public.organization_invoice_counters
      WHERE organization_id = v_org_id;
    END IF;

    RETURN QUERY SELECT
      v_fy_label,
      v_del_invoices,
      v_del_items,
      v_del_payments,
      v_del_renewals,
      0::bigint,
      0::bigint;
  END;
  $$;

  ALTER FUNCTION public.admin_reset_financial_year(uuid, text, text) OWNER TO postgres;
  GRANT EXECUTE ON FUNCTION public.admin_reset_financial_year(uuid, text, text) TO anon, authenticated, service_role;
