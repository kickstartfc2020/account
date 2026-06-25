-- Add CGST and SGST columns to invoices and invoice_items.
-- For Indian intra-state GST: CGST = SGST = tax_total / 2 always.
-- Backfill existing rows from stored tax values.

-- invoices table
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS cgst_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount numeric(12,2) NOT NULL DEFAULT 0;

UPDATE public.invoices
SET
  cgst_amount = ROUND(tax_total / 2, 2),
  sgst_amount = ROUND(tax_total / 2, 2);

-- invoice_items table
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS cgst_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount numeric(12,2) NOT NULL DEFAULT 0;

UPDATE public.invoice_items
SET
  cgst_amount = ROUND(line_tax / 2, 2),
  sgst_amount = ROUND(line_tax / 2, 2);

-- Update finalize_invoice_write to populate CGST/SGST.
-- DROP is required because CREATE OR REPLACE cannot remove DEFAULT values
-- that existed in the original baseline signature.
DROP FUNCTION IF EXISTS public.finalize_invoice_write(
  uuid, uuid, uuid, text, text,
  numeric, numeric, numeric, numeric, numeric, numeric,
  public.payment_method, text,
  uuid, date, text
);

CREATE OR REPLACE FUNCTION public.finalize_invoice_write(
  p_student_id uuid,
  p_package_id uuid,
  p_sport_id uuid,
  p_package_name text,
  p_sport_name text,
  p_subtotal numeric,
  p_discount_total numeric,
  p_taxable_amount numeric,
  p_tax_total numeric,
  p_total_amount numeric,
  p_gst_percent numeric,
  p_payment_method public.payment_method,
  p_payment_mode_label text,
  p_preferred_branch_id uuid DEFAULT NULL::uuid,
  p_invoice_date date DEFAULT CURRENT_DATE,
  p_invoice_number text DEFAULT NULL::text
)
RETURNS TABLE (
  invoice_id uuid,
  invoice_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_organization_id   uuid;
  v_branch_id         uuid;
  v_created_invoice_id uuid;
  v_created_invoice_number text;
  v_request_key       text;
  v_line_subtotal     numeric;
  v_line_tax          numeric;
  v_line_total        numeric;
  v_cgst              numeric;
  v_sgst              numeric;
  v_role              public.app_role;
BEGIN
  v_role := public.current_role();
  IF v_role NOT IN ('super_admin', 'organization_admin', 'branch_manager') THEN
    RAISE EXCEPTION 'Permission denied.';
  END IF;

  v_organization_id := public.current_organization_id();
  IF v_organization_id IS NULL THEN
    RAISE EXCEPTION 'No active organization context.';
  END IF;

  v_branch_id := COALESCE(
    p_preferred_branch_id,
    public.current_branch_id(),
    (SELECT id FROM public.branches WHERE organization_id = v_organization_id LIMIT 1)
  );

  -- Idempotency key
  v_request_key := 'finalize:' || p_student_id::text || ':' || p_invoice_date::text || ':' || p_invoice_number;

  IF EXISTS (
    SELECT 1 FROM public.invoice_write_requests iwr
    WHERE iwr.organization_id = v_organization_id
      AND iwr.request_key = v_request_key
      AND iwr.invoice_id IS NOT NULL
  ) THEN
    SELECT iwr.invoice_id INTO v_created_invoice_id
    FROM public.invoice_write_requests iwr
    WHERE iwr.organization_id = v_organization_id
      AND iwr.request_key = v_request_key
    LIMIT 1;

    RETURN QUERY
      SELECT i.id, i.invoice_number
      FROM public.invoices i
      WHERE i.id = v_created_invoice_id;
    RETURN;
  END IF;

  insert into public.invoice_write_requests (organization_id, request_key)
  values (v_organization_id, v_request_key)
  on conflict (organization_id, request_key) do nothing;

  v_cgst := ROUND(p_tax_total / 2, 2);
  v_sgst := p_tax_total - v_cgst;

  insert into public.invoices (
    organization_id,
    branch_id,
    student_id,
    invoice_number,
    invoice_date,
    status,
    subtotal,
    tax_total,
    cgst_amount,
    sgst_amount,
    discount_total,
    total_amount,
    balance_amount,
    notes
  ) values (
    v_organization_id,
    v_branch_id,
    p_student_id,
    p_invoice_number,
    p_invoice_date,
    'completed',
    p_subtotal,
    p_tax_total,
    v_cgst,
    v_sgst,
    p_discount_total,
    p_total_amount,
    0,
    p_sport_name || ' fee invoice'
  )
  returning id, invoices.invoice_number into v_created_invoice_id, v_created_invoice_number;

  v_line_subtotal := p_taxable_amount;
  v_line_tax      := p_tax_total;
  v_line_total    := p_total_amount;

  insert into public.invoice_items (
    organization_id,
    invoice_id,
    package_id,
    sport_id,
    description,
    quantity,
    unit_price,
    gst_percent,
    line_subtotal,
    line_tax,
    cgst_amount,
    sgst_amount,
    line_total
  ) values (
    v_organization_id,
    v_created_invoice_id,
    p_package_id,
    p_sport_id,
    p_package_name,
    1,
    p_subtotal,
    p_gst_percent,
    v_line_subtotal,
    v_line_tax,
    v_cgst,
    v_sgst,
    v_line_total
  );

  insert into public.payments (
    organization_id,
    branch_id,
    invoice_id,
    amount,
    payment_date,
    method,
    status,
    notes
  ) values (
    v_organization_id,
    v_branch_id,
    v_created_invoice_id,
    p_total_amount,
    now(),
    p_payment_method,
    'completed',
    p_payment_mode_label
  );

  UPDATE public.invoice_write_requests
  SET invoice_id = v_created_invoice_id
  WHERE organization_id = v_organization_id
    AND request_key = v_request_key;

  RETURN QUERY SELECT v_created_invoice_id, v_created_invoice_number;
END;
$$;

-- Update complete_renewal_with_invoice to populate CGST/SGST.
-- DROP is required because CREATE OR REPLACE cannot remove DEFAULT values
-- that existed in the original baseline signature.
DROP FUNCTION IF EXISTS public.complete_renewal_with_invoice(
  uuid, uuid, uuid, uuid, text, text,
  numeric, numeric, numeric, numeric, numeric, numeric,
  public.payment_method, text,
  uuid, date
);

CREATE OR REPLACE FUNCTION public.complete_renewal_with_invoice(
  p_renewal_id uuid,
  p_student_id uuid,
  p_package_id uuid,
  p_sport_id uuid,
  p_package_name text,
  p_sport_name text,
  p_subtotal numeric,
  p_discount_total numeric,
  p_taxable_amount numeric,
  p_tax_total numeric,
  p_total_amount numeric,
  p_gst_percent numeric,
  p_payment_method public.payment_method,
  p_payment_mode_label text,
  p_preferred_branch_id uuid DEFAULT NULL::uuid,
  p_start_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  invoice_id uuid,
  invoice_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_organization_id    uuid;
  v_branch_id          uuid;
  v_created_invoice_id uuid;
  v_invoice_number     text;
  v_cgst               numeric;
  v_sgst               numeric;
  v_role               public.app_role;
BEGIN
  v_role := public.current_role();
  IF v_role NOT IN ('super_admin', 'organization_admin', 'branch_manager') THEN
    RAISE EXCEPTION 'Permission denied.';
  END IF;

  v_organization_id := public.current_organization_id();
  IF v_organization_id IS NULL THEN
    RAISE EXCEPTION 'No active organization context.';
  END IF;

  v_branch_id := COALESCE(
    p_preferred_branch_id,
    public.current_branch_id(),
    (SELECT id FROM public.branches WHERE organization_id = v_organization_id LIMIT 1)
  );

  v_cgst := ROUND(p_tax_total / 2, 2);
  v_sgst := p_tax_total - v_cgst;

  v_invoice_number := public.generate_invoice_number(v_branch_id, p_start_date);

  INSERT INTO public.invoices (
    organization_id,
    branch_id,
    student_id,
    invoice_number,
    invoice_date,
    status,
    subtotal,
    tax_total,
    cgst_amount,
    sgst_amount,
    discount_total,
    total_amount,
    balance_amount,
    notes
  ) VALUES (
    v_organization_id,
    v_branch_id,
    p_student_id,
    v_invoice_number,
    p_start_date,
    'completed',
    p_subtotal,
    p_tax_total,
    v_cgst,
    v_sgst,
    p_discount_total,
    p_total_amount,
    0,
    p_sport_name || ' renewal invoice'
  )
  RETURNING id, invoices.invoice_number INTO v_created_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_items (
    organization_id,
    invoice_id,
    package_id,
    sport_id,
    description,
    quantity,
    unit_price,
    gst_percent,
    line_subtotal,
    line_tax,
    cgst_amount,
    sgst_amount,
    line_total
  ) VALUES (
    v_organization_id,
    v_created_invoice_id,
    p_package_id,
    p_sport_id,
    p_package_name,
    1,
    p_subtotal,
    p_gst_percent,
    p_taxable_amount,
    p_tax_total,
    v_cgst,
    v_sgst,
    p_total_amount
  );

  INSERT INTO public.payments (
    organization_id,
    branch_id,
    invoice_id,
    amount,
    payment_date,
    method,
    status,
    notes
  ) VALUES (
    v_organization_id,
    v_branch_id,
    v_created_invoice_id,
    p_total_amount,
    now(),
    p_payment_method,
    'completed',
    p_payment_mode_label
  );

  UPDATE public.renewals
  SET
    status = 'active',
    start_date = p_start_date,
    generated_invoice_id = v_created_invoice_id
  WHERE id = p_renewal_id;

  RETURN QUERY SELECT v_created_invoice_id, v_invoice_number;
END;
$$;
