-- Phase 6r: Security hardening for RPC grants, invoice write authorization,
-- and tenant-safe storage object policies.

-- Remove legacy finalize_invoice_write overload that accepted an explicit invoice number.
drop function if exists public.finalize_invoice_write(
  uuid,
  uuid,
  uuid,
  text,
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
  uuid,
  date
);

create or replace function public.finalize_invoice_write(
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
  v_student         record;
  v_organization_id uuid;
  v_branch_id       uuid;
  v_invoice_number  text;
  v_role            public.app_role;
  v_caller_branch   uuid;
  v_package         record;
  v_sport           record;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  v_role := public.current_role();
  if v_role is null then
    raise exception 'Unable to resolve role context.';
  end if;

  if v_role not in ('super_admin', 'organization_admin', 'branch_manager') then
    raise exception 'Insufficient role to finalize invoice write.';
  end if;

  select organization_id, branch_id
    into v_student
  from public.students
  where id = p_student_id;

  if not found then
    raise exception 'Student not found.';
  end if;

  v_organization_id := public.current_organization_id();
  if v_organization_id is null then
    v_organization_id := v_student.organization_id;
  elsif v_organization_id <> v_student.organization_id then
    raise exception 'Student does not belong to the active organization.';
  end if;

  if v_organization_id is null then
    raise exception 'Unable to resolve organization context.';
  end if;

  v_caller_branch := public.current_branch_id();

  if v_role = 'branch_manager' then
    if v_caller_branch is null then
      raise exception 'Unable to resolve branch manager branch context.';
    end if;

    if v_student.branch_id is distinct from v_caller_branch then
      raise exception 'Branch managers can only invoice students in their own branch.';
    end if;
  end if;

  v_branch_id := coalesce(p_preferred_branch_id, v_caller_branch, v_student.branch_id);
  if v_branch_id is null then
    raise exception 'Unable to resolve branch context.';
  end if;

  if v_role = 'branch_manager' and v_branch_id is distinct from v_caller_branch then
    raise exception 'Branch managers cannot write invoices for a different branch.';
  end if;

  perform 1
  from public.branches
  where id = v_branch_id
    and organization_id = v_organization_id;

  if not found then
    raise exception 'Branch does not belong to the active organization.';
  end if;

  select organization_id, branch_id, sport_id, status
    into v_package
  from public.packages
  where id = p_package_id;

  if not found then
    raise exception 'Package not found.';
  end if;

  if v_package.status <> 'active' then
    raise exception 'Package is not active.';
  end if;

  if v_package.organization_id <> v_organization_id then
    raise exception 'Package does not belong to the active organization.';
  end if;

  if v_package.branch_id is not null and v_package.branch_id <> v_branch_id then
    raise exception 'Package does not belong to the selected branch.';
  end if;

  if v_package.sport_id <> p_sport_id then
    raise exception 'Package and sport mismatch.';
  end if;

  select organization_id, branch_id, status
    into v_sport
  from public.sports
  where id = p_sport_id;

  if not found then
    raise exception 'Sport not found.';
  end if;

  if v_sport.status <> 'active' then
    raise exception 'Sport is not active.';
  end if;

  if v_sport.organization_id <> v_organization_id then
    raise exception 'Sport does not belong to the active organization.';
  end if;

  if v_sport.branch_id is not null and v_sport.branch_id <> v_branch_id then
    raise exception 'Sport does not belong to the selected branch.';
  end if;

  -- Invoice number is always generated server-side.
  v_invoice_number := public.generate_invoice_number(v_branch_id, p_invoice_date);

  insert into public.invoices (
    organization_id,
    branch_id,
    student_id,
    invoice_number,
    invoice_date,
    status,
    subtotal,
    tax_total,
    discount_total,
    total_amount,
    balance_amount,
    notes
  ) values (
    v_organization_id,
    v_branch_id,
    p_student_id,
    v_invoice_number,
    p_invoice_date,
    'completed',
    p_subtotal,
    p_tax_total,
    p_discount_total,
    p_total_amount,
    0,
    p_sport_name || ' fee invoice'
  )
  returning id, invoices.invoice_number into invoice_id, invoice_number;

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
  ) values (
    v_organization_id,
    invoice_id,
    p_package_id,
    p_sport_id,
    p_package_name,
    1,
    p_subtotal,
    p_gst_percent,
    p_taxable_amount,
    p_tax_total,
    p_total_amount
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
    invoice_id,
    p_total_amount,
    now(),
    p_payment_method,
    'completed',
    'Payment received via ' || p_payment_mode_label
  );

  return next;
end;
$$;

-- Explicit grant surface for finalize_invoice_write.
revoke all on function public.finalize_invoice_write(
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
  uuid,
  date,
  text
) from public;
revoke execute on function public.finalize_invoice_write(
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
  uuid,
  date,
  text
) from anon;
grant execute on function public.finalize_invoice_write(
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
  uuid,
  date,
  text
) to authenticated;

-- Prevent direct RPC access to internal security-definer helpers.
revoke execute on function public.next_ref_counter(text) from public;
revoke execute on function public.generate_org_ref_id() from public;
revoke execute on function public.generate_branch_ref_id() from public;
revoke execute on function public.generate_student_ref_id() from public;
revoke execute on function public.generate_student_ref_id(uuid) from public;
revoke execute on function public.generate_package_ref_id() from public;
revoke execute on function public.generate_profile_ref_id() from public;
revoke execute on function public.generate_invoice_number(uuid, date) from public;
revoke execute on function public.generate_payment_ref_id(timestamptz) from public;
revoke execute on function public.generate_renewal_ref_id(timestamptz) from public;
revoke execute on function public.generate_monthly_renewals(date) from public;
revoke execute on function public.sync_invoice_payment_status(uuid) from public;
revoke execute on function public.insert_audit_log(text, uuid, uuid, uuid, public.audit_action, jsonb, jsonb) from public;

create or replace function public.can_manage_branch_image_object(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_org_id uuid;
  v_branch_id uuid;
begin
  v_role := public.current_role();

  if v_role = 'super_admin' then
    return true;
  end if;

  v_org_id := public.current_organization_id();
  v_branch_id := public.current_branch_id();

  if v_role = 'organization_admin' and v_org_id is not null then
    if p_object_name like ('organization/' || v_org_id::text || '/%') then
      return true;
    end if;

    if exists (
      select 1
      from public.branches b
      where b.organization_id = v_org_id
        and p_object_name like (b.id::text || '/%')
    ) then
      return true;
    end if;
  end if;

  if v_role = 'branch_manager' and v_branch_id is not null then
    return p_object_name like (v_branch_id::text || '/%');
  end if;

  return false;
end;
$$;

drop policy if exists branch_images_manage_insert on storage.objects;
drop policy if exists branch_images_manage_update on storage.objects;
drop policy if exists branch_images_manage_delete on storage.objects;
drop policy if exists branch_images_admin_insert on storage.objects;
drop policy if exists branch_images_admin_update on storage.objects;
drop policy if exists branch_images_admin_delete on storage.objects;

create policy branch_images_manage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'branch-images'
  and public.can_manage_branch_image_object(name)
);

create policy branch_images_manage_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'branch-images'
  and public.can_manage_branch_image_object(name)
)
with check (
  bucket_id = 'branch-images'
  and public.can_manage_branch_image_object(name)
);

create policy branch_images_manage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'branch-images'
  and public.can_manage_branch_image_object(name)
);
