-- cancel_invoice_safe(p_invoice_number) looked up the target invoice by
-- invoice_number alone. invoice_number is only unique PER ORGANIZATION
-- (invoices_organization_id_invoice_number_key), not globally, so if two
-- orgs both happen to have e.g. 'INV-KS-123', an organization_admin or
-- branch_manager in Org A calling cancel_invoice_safe('INV-KS-123') could
-- have the lookup land on Org B's row instead. The authorization check
-- immediately after already catches this and rejects it (current_organization_id()
-- won't match Org B's row), so this was a correctness/availability bug --
-- Org A's own legitimate cancellation could fail with "you do not have
-- access" -- not a security hole (it fails safe, and no unauthorized data
-- is ever exposed or mutated).
--
-- Fix: for organization_admin and branch_manager (the two roles that are
-- inherently scoped to one org via current_organization_id()), scope the
-- lookup itself to that org, so it always finds -- or correctly fails to
-- find -- their own org's invoice, never a same-numbered invoice belonging
-- to someone else's org.
--
-- super_admin is intentionally left unscoped: super_admin has no single
-- "own organization" (current_organization_id() is null for that role), so
-- an unscoped lookup is required to preserve its existing cross-org
-- cancellation ability. The "insufficient permissions" path for any other
-- role also keeps its original unscoped lookup and error, unchanged.
--
-- All authorization checks, the cancellation logic, status checks, and
-- error handling are otherwise unchanged from the current definition.
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
  v_role := public.current_role();

  if v_role in ('organization_admin', 'branch_manager') then
    select id, organization_id, branch_id
      into v_invoice_id, v_org_id, v_branch_id
    from public.invoices
    where invoice_number = p_invoice_number
      and organization_id = public.current_organization_id()
    for update;
  else
    select id, organization_id, branch_id
      into v_invoice_id, v_org_id, v_branch_id
    from public.invoices
    where invoice_number = p_invoice_number
    for update;
  end if;

  if not found then
    raise exception 'Invoice % not found.', p_invoice_number;
  end if;

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
$function$;
