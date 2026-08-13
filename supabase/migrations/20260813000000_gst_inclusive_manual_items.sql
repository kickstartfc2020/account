-- "Inclusive of GST" toggle on invoice creation.
--
-- Package invoices already pass fully pre-computed subtotal/taxable_amount/
-- tax_total/total_amount from the client (src/lib/billingMath.ts), so
-- finalize_invoice_write (v1) needs no change there — it just persists
-- whatever the client computed, inclusive or exclusive.
--
-- Manual invoices are different: finalize_invoice_write_v2 recomputes each
-- line item's tax breakdown server-side from quantity * unit_price, and it
-- always did that as GST-on-top (exclusive). Add p_gst_inclusive so manual
-- line items can also be back-calculated from a GST-inclusive unit price,
-- matching the header totals the client already computed.

DROP FUNCTION IF EXISTS public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text);

CREATE OR REPLACE FUNCTION public.finalize_invoice_write_v2(p_student_id uuid, p_package_id uuid, p_sport_id uuid, p_package_name text, p_sport_name text, p_subtotal numeric, p_discount_total numeric, p_taxable_amount numeric, p_tax_total numeric, p_total_amount numeric, p_gst_percent numeric, p_payment_method public.payment_method, p_payment_mode_label text, p_manual_items jsonb DEFAULT NULL::jsonb, p_preferred_branch_id uuid DEFAULT NULL::uuid, p_invoice_date date DEFAULT CURRENT_DATE, p_invoice_number text DEFAULT NULL::text, p_paid_amount numeric DEFAULT NULL::numeric, p_reminder_date date DEFAULT NULL::date, p_reminder_note text DEFAULT NULL::text, p_gst_inclusive boolean DEFAULT false)
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
begin
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
    p_taxable_amount,
    p_tax_total,
    p_total_amount,
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
      p_taxable_amount,
      p_tax_total,
      p_total_amount
    from public.invoices inv
    where inv.id = v_result.invoice_id
      and not exists (select 1 from public.invoice_items ii where ii.invoice_id = v_result.invoice_id);
  end if;

  invoice_id := v_result.invoice_id;
  invoice_number := v_result.invoice_number;
  return next;
end;
$$;

REVOKE ALL ON FUNCTION public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text, boolean) FROM anon;
GRANT ALL ON FUNCTION public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text, boolean) TO authenticated;
GRANT ALL ON FUNCTION public.finalize_invoice_write_v2(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, public.payment_method, text, jsonb, uuid, date, text, numeric, date, text, boolean) TO service_role;
