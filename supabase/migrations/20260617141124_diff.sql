set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.cancel_invoice_safe(p_invoice_number text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoice_id uuid;
  v_org_id     uuid;
  v_branch_id  uuid;
  v_role       public.app_role;
begin
  select id, organization_id, branch_id
    into v_invoice_id, v_org_id, v_branch_id
  from public.invoices
  where invoice_number = p_invoice_number
  for update;

  if not found then
    raise exception 'Invoice % not found.', p_invoice_number;
  end if;

  v_role := public.current_role();

  if v_role = 'super_admin' then
    null;
  elsif v_role = 'organization_admin' then
    if public.current_organization_id() is null or public.current_organization_id() <> v_org_id then
      raise exception 'You do not have access to this invoice.';
    end if;
  elsif v_role = 'branch_manager' then
    if public.current_organization_id() is null or public.current_organization_id() <> v_org_id then
      raise exception 'You do not have access to this invoice.';
    end if;
    if public.current_branch_id() is null or public.current_branch_id() <> v_branch_id then
      raise exception 'Branch managers can only cancel invoices in their own branch.';
    end if;
  else
    raise exception 'Insufficient permissions to cancel invoices.';
  end if;

  -- Payments FIRST (invoice still active — trigger passes)
  update public.payments
  set status = 'cancelled', updated_at = now()
  where invoice_id = v_invoice_id
    and status in ('completed', 'pending');

  -- Invoice second
  update public.invoices
  set status = 'cancelled', balance_amount = 0, updated_at = now()
  where id = v_invoice_id
    and status <> 'cancelled';

  return true;
end;
$function$
;


