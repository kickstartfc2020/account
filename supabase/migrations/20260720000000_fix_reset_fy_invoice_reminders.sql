-- Fix: admin_reset_financial_year was not clearing invoice_reminders before
-- deleting invoices, so the reset failed with a foreign key violation on
-- invoice_reminders_invoice_id_fkey (ON DELETE RESTRICT). The invoice_reminders
-- table was added after this function was last redefined.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.admin_reset_financial_year(p_organization_id uuid DEFAULT NULL::uuid, p_confirmation_text text DEFAULT 'RESET'::text, p_ip_address text DEFAULT NULL::text)
 RETURNS TABLE(financial_year text, invoices_deleted integer, invoice_items_deleted integer, payments_deleted integer, renewals_deleted integer, backup_id bigint, audit_log_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

      DELETE FROM public.invoice_reminders WHERE true;

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

      DELETE FROM public.invoice_reminders
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
  $function$
;
