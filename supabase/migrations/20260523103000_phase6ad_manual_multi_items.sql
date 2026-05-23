-- Phase 6ad: Manual invoice multi-line item support via RPC v2.

create or replace function public.finalize_invoice_write_v2(
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
  p_manual_items jsonb default null,
  p_preferred_branch_id uuid default null,
  p_invoice_date date default current_date,
  p_invoice_number text default null
)
returns table(invoice_id uuid, invoice_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result record;
  v_item jsonb;
  v_description text;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_subtotal numeric;
  v_line_tax numeric;
  v_line_total numeric;
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
    p_invoice_number
  );

  if p_manual_items is not null and jsonb_typeof(p_manual_items) = 'array' and jsonb_array_length(p_manual_items) > 0 then
    v_has_manual_items := true;
    delete from public.invoice_items where invoice_id = v_result.invoice_id;

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

      v_line_subtotal := round(v_quantity * v_unit_price, 2);
      v_line_tax := round(v_line_subtotal * greatest(p_gst_percent, 0) / 100, 2);
      v_line_total := round(v_line_subtotal + v_line_tax, 2);

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
    end loop;

    if not exists (select 1 from public.invoice_items where invoice_id = v_result.invoice_id) then
      v_has_manual_items := false;
    end if;
  end if;

  if not v_has_manual_items then
    -- Keep behavior stable when no valid manual items are provided.
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

revoke all on function public.finalize_invoice_write_v2(
  uuid,
  uuid,
  uuid,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  public.payment_method,
  text,
  jsonb,
  uuid,
  date,
  text
) from public;

revoke execute on function public.finalize_invoice_write_v2(
  uuid,
  uuid,
  uuid,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  public.payment_method,
  text,
  jsonb,
  uuid,
  date,
  text
) from anon;

grant execute on function public.finalize_invoice_write_v2(
  uuid,
  uuid,
  uuid,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  public.payment_method,
  text,
  jsonb,
  uuid,
  date,
  text
) to authenticated;
