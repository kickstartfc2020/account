-- F1: server-authoritative invoice header/item reconciliation.
--
-- Problem (REMEDIATION_PLAN.md, item A3): finalize_invoice_write_v2 persisted
-- whatever subtotal/taxable_amount/tax_total/total_amount the client sent,
-- with no server-side check that those numbers actually related to each
-- other correctly, or to the invoice_items rows being created in the same
-- call. Two independent gaps:
--   1. Manual invoices: each line item's own tax breakdown was already
--      recomputed server-side from quantity * unit_price (existing, since
--      20260813000000_gst_inclusive_manual_items.sql), but nothing checked
--      that the *sum* of those lines agreed with the header subtotal the
--      client submitted -- a client could submit manual items summing to
--      ₹100 while claiming a ₹10,000 subtotal, and the header would still be
--      written using the claimed ₹10,000.
--   2. Both manual and package invoices: taxable_amount/tax_total/total_amount
--      were accepted as-is from the client with no check that they were the
--      arithmetically correct result of (subtotal - discount_total) and
--      gst_percent -- a client could submit a correct subtotal but an
--      arbitrarily low total_amount.
--
-- Fix, entirely inside finalize_invoice_write_v2 (finalize_invoice_write /
-- v1 is unchanged -- it remains a pure "insert exactly what it's given"
-- helper; v2 now validates and, where necessary, substitutes the numbers
-- before calling it):
--   1. If manual items are present, sum round(quantity * unit_price, 2)
--      across the same valid-line filter already used for per-line
--      computation, and require it to match p_subtotal within ₹0.02.
--   2. Always (manual or package) independently recompute
--      taxable_amount/tax_total/total_amount from
--      (p_subtotal, p_discount_total, p_gst_percent, p_gst_inclusive) using
--      the exact same paise-rounded formula as
--      src/lib/billingMath.ts (computeBillingTotals /
--      computeInclusiveBillingTotals), and require the client-submitted
--      taxable_amount/tax_total/total_amount to match within ₹0.02 each.
--   3. The invoice header and, for package invoices, the single generated
--      line item are then written using the *server-computed* values (not
--      the client's), so the stored total_amount is always the true result
--      of the stored subtotal/discount/gst_percent rather than a
--      client-supplied passthrough. For manual invoices, each line item's
--      own values are still computed per-line exactly as before (unchanged
--      formula) -- only the header now derives from the reconciled totals.
--   4. Any mismatch beyond the ₹0.02 tolerance raises an exception before
--      any row is inserted, so a tampered/inconsistent submission never
--      reaches the invoices/invoice_items/payments tables.
--
-- Untouched: authorization/role checks, idempotency (invoice_write_requests,
-- still keyed the same way inside finalize_invoice_write), payment handling,
-- GST math itself, invoice-number generation, and the overall transaction
-- shape. No existing invoices/invoice_items row is read, modified, or
-- backfilled by this migration -- it only changes what a *new* invoice
-- creation call validates and writes.

CREATE OR REPLACE FUNCTION public.finalize_invoice_write_v2(
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
  p_manual_items jsonb DEFAULT NULL::jsonb,
  p_preferred_branch_id uuid DEFAULT NULL::uuid,
  p_invoice_date date DEFAULT CURRENT_DATE,
  p_invoice_number text DEFAULT NULL::text,
  p_paid_amount numeric DEFAULT NULL::numeric,
  p_reminder_date date DEFAULT NULL::date,
  p_reminder_note text DEFAULT NULL::text,
  p_gst_inclusive boolean DEFAULT false
)
 RETURNS TABLE(invoice_id uuid, invoice_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_result record;
  v_item jsonb;
  v_default_item_id uuid;
  v_default_item_updated boolean := false;
  v_description text;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_subtotal numeric;
  v_line_tax numeric;
  v_line_total numeric;
  v_line_gross numeric;
  v_has_manual_items boolean := false;
  -- Reconciliation working variables.
  v_tolerance constant numeric(12,2) := 0.02;
  v_items_gross_sum numeric(12,2) := 0;
  v_computed_taxable numeric(12,2);
  v_computed_tax numeric(12,2);
  v_computed_total numeric(12,2);
  v_computed_gross_total numeric(12,2);
begin
  -- ── 1. Manual items: validate that the declared subtotal actually equals
  --      the sum of the submitted line items (quantity * unit_price), using
  --      the identical valid-line filter the per-line insertion loop below
  --      uses, before any row is written. round(qty*price,2) is the "gross"
  --      per-line amount in both GST-inclusive and GST-exclusive modes (the
  --      inclusive/exclusive toggle only changes how that gross splits into
  --      base + tax, not the gross itself), so this check is mode-independent.
  if p_manual_items is not null and jsonb_typeof(p_manual_items) = 'array' and jsonb_array_length(p_manual_items) > 0 then
    for v_item in
      select value
      from jsonb_array_elements(p_manual_items)
    loop
      v_description := nullif(trim(coalesce(v_item ->> 'description', '')), '');
      v_quantity := greatest(coalesce((v_item ->> 'quantity')::numeric, 0), 0);
      v_unit_price := greatest(coalesce((v_item ->> 'unitPrice')::numeric, 0), 0);

      if v_description is null or v_quantity <= 0 then
        continue;
      end if;

      v_items_gross_sum := v_items_gross_sum + round(v_quantity * v_unit_price, 2);
    end loop;

    if abs(v_items_gross_sum - round(coalesce(p_subtotal, 0), 2)) > v_tolerance then
      raise exception 'Invoice subtotal (%) does not match the sum of the submitted line items (%).',
        round(coalesce(p_subtotal, 0), 2), v_items_gross_sum;
    end if;
  end if;

  -- ── 2. Independently recompute taxable_amount/tax_total/total_amount from
  --      (subtotal, discount_total, gst_percent, gst_inclusive), mirroring
  --      src/lib/billingMath.ts exactly (paise-rounded via round(x, 2)), and
  --      require the client-submitted values to agree within ₹0.02. This
  --      applies to both manual and package invoices: for a package invoice
  --      the "generated item" the header is derived from is simply
  --      (p_subtotal, p_gst_percent) via this same formula, since the
  --      package path's single line item is written from these same
  --      computed values below (see finalize_invoice_write call).
  if p_gst_inclusive then
    v_computed_gross_total := round(greatest(coalesce(p_subtotal, 0) - coalesce(p_discount_total, 0), 0), 2);
    v_computed_taxable := case
      when p_gst_percent > 0 then round(v_computed_gross_total / (1 + p_gst_percent / 100), 2)
      else v_computed_gross_total
    end;
    v_computed_tax := round(v_computed_gross_total - v_computed_taxable, 2);
    v_computed_total := v_computed_gross_total;
  else
    v_computed_taxable := round(greatest(coalesce(p_subtotal, 0) - coalesce(p_discount_total, 0), 0), 2);
    v_computed_tax := round(greatest(v_computed_taxable * greatest(p_gst_percent, 0) / 100, 0), 2);
    v_computed_total := round(v_computed_taxable + v_computed_tax, 2);
  end if;

  if abs(v_computed_taxable - round(coalesce(p_taxable_amount, 0), 2)) > v_tolerance
     or abs(v_computed_tax - round(coalesce(p_tax_total, 0), 2)) > v_tolerance
     or abs(v_computed_total - round(coalesce(p_total_amount, 0), 2)) > v_tolerance then
    raise exception
      'Invoice totals do not reconcile: expected taxable=%, tax=%, total=% but received taxable=%, tax=%, total=%.',
      v_computed_taxable, v_computed_tax, v_computed_total,
      round(coalesce(p_taxable_amount, 0), 2), round(coalesce(p_tax_total, 0), 2), round(coalesce(p_total_amount, 0), 2);
  end if;

  -- ── 3. Create the invoice header (and, for package invoices, its single
  --      default line item) using the server-computed totals, not the raw
  --      client values -- this is the "server-authoritative" part. Manual
  --      items are still inserted per-line below exactly as before; only the
  --      header/default-item totals now come from step 2's computation.
  select *
    into v_result
  from public.finalize_invoice_write(
    p_student_id,
    p_package_id,
    p_sport_id,
    p_package_name,
    p_sport_name,
    p_subtotal,
    p_discount_total,
    v_computed_taxable,
    v_computed_tax,
    v_computed_total,
    p_gst_percent,
    p_payment_method,
    p_payment_mode_label,
    p_preferred_branch_id,
    p_invoice_date,
    p_invoice_number,
    p_paid_amount,
    p_reminder_date,
    p_reminder_note
  );

  if p_manual_items is not null and jsonb_typeof(p_manual_items) = 'array' and jsonb_array_length(p_manual_items) > 0 then
    v_has_manual_items := true;

    select ii.id
      into v_default_item_id
    from public.invoice_items ii
    where ii.invoice_id = v_result.invoice_id
    order by ii.created_at asc
    limit 1;

    for v_item in
      select value
      from jsonb_array_elements(p_manual_items)
    loop
      v_description := nullif(trim(coalesce(v_item ->> 'description', '')), '');
      v_quantity := greatest(coalesce((v_item ->> 'quantity')::numeric, 0), 0);
      v_unit_price := greatest(coalesce((v_item ->> 'unitPrice')::numeric, 0), 0);

      if v_description is null or v_quantity <= 0 then
        continue;
      end if;

      if p_gst_inclusive then
        v_line_gross := round(v_quantity * v_unit_price, 2);
        v_line_subtotal := case
          when p_gst_percent > 0 then round(v_line_gross / (1 + p_gst_percent / 100), 2)
          else v_line_gross
        end;
        v_line_tax := v_line_gross - v_line_subtotal;
        v_line_total := v_line_gross;
      else
        v_line_subtotal := round(v_quantity * v_unit_price, 2);
        v_line_tax := round(v_line_subtotal * greatest(p_gst_percent, 0) / 100, 2);
        v_line_total := round(v_line_subtotal + v_line_tax, 2);
      end if;

      if v_default_item_id is not null and not v_default_item_updated then
        update public.invoice_items ii
        set
          package_id = p_package_id,
          sport_id = p_sport_id,
          description = v_description,
          quantity = v_quantity,
          unit_price = v_unit_price,
          gst_percent = p_gst_percent,
          line_subtotal = v_line_subtotal,
          line_tax = v_line_tax,
          line_total = v_line_total,
          updated_at = now()
        where ii.id = v_default_item_id;

        v_default_item_updated := true;
      else
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
          line_total
        )
        select
          inv.organization_id,
          v_result.invoice_id,
          p_package_id,
          p_sport_id,
          v_description,
          v_quantity,
          v_unit_price,
          p_gst_percent,
          v_line_subtotal,
          v_line_tax,
          v_line_total
        from public.invoices inv
        where inv.id = v_result.invoice_id;
      end if;
    end loop;

    if not exists (select 1 from public.invoice_items ii where ii.invoice_id = v_result.invoice_id) then
      v_has_manual_items := false;
    end if;
  end if;

  if not v_has_manual_items then
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
      line_total
    )
    select
      inv.organization_id,
      v_result.invoice_id,
      p_package_id,
      p_sport_id,
      p_package_name,
      1,
      p_subtotal,
      p_gst_percent,
      v_computed_taxable,
      v_computed_tax,
      v_computed_total
    from public.invoices inv
    where inv.id = v_result.invoice_id
      and not exists (select 1 from public.invoice_items ii where ii.invoice_id = v_result.invoice_id);
  end if;

  invoice_id := v_result.invoice_id;
  invoice_number := v_result.invoice_number;
  return next;
end;
$$;

-- Signature is unchanged (same 21 parameters as
-- 20260813000000_gst_inclusive_manual_items.sql), so existing grants remain
-- in effect; re-asserted here for a self-contained migration.
REVOKE ALL ON FUNCTION public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text, boolean) FROM anon;
GRANT ALL ON FUNCTION public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text, boolean) TO authenticated;
GRANT ALL ON FUNCTION public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text, boolean) TO service_role;
