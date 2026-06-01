-- Phase 7e: Atomic student enrollment write.
-- Guarantees student.current_package_id update and renewals insert succeed/fail together.

create or replace function public.add_student_enrollment_atomic(
  p_student_id uuid,
  p_package_id uuid,
  p_branch_id uuid default null,
  p_start_date date default current_date
)
returns table(package_id uuid, renewal_id uuid, cycle_start date, cycle_end date)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_current_org uuid;
  v_current_branch uuid;
  v_student record;
  v_package record;
  v_target_branch uuid;
  v_start_date date;
  v_cycle_end_date date;
  v_new_renewal_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  v_role := public.current_role();
  if v_role not in ('super_admin', 'organization_admin', 'branch_manager') then
    raise exception 'Insufficient role to add student enrollment.';
  end if;

  v_current_org := public.current_organization_id();
  v_current_branch := public.current_branch_id();

  select id, organization_id, branch_id
    into v_student
  from public.students
  where id = p_student_id
  for update;

  if not found then
    raise exception 'Student not found.';
  end if;

  if v_role = 'organization_admin' then
    if v_current_org is null or v_student.organization_id <> v_current_org then
      raise exception 'You can only manage students in your active organization.';
    end if;
  elsif v_role = 'branch_manager' then
    if v_current_org is null or v_current_branch is null then
      raise exception 'Unable to resolve branch manager context.';
    end if;

    if v_student.organization_id <> v_current_org or v_student.branch_id <> v_current_branch then
      raise exception 'Branch managers can only enroll students in their own branch.';
    end if;
  end if;

  select id, organization_id, branch_id, duration_months, amount, status
    into v_package
  from public.packages
  where id = p_package_id;

  if not found then
    raise exception 'Package not found.';
  end if;

  if v_package.status <> 'active' then
    raise exception 'Package is not active.';
  end if;

  if v_package.organization_id <> v_student.organization_id then
    raise exception 'Package and student must belong to the same organization.';
  end if;

  v_target_branch := coalesce(p_branch_id, v_student.branch_id);
  if v_target_branch is null then
    raise exception 'Unable to resolve enrollment branch.';
  end if;

  perform 1
  from public.branches b
  where b.id = v_target_branch
    and b.organization_id = v_student.organization_id;

  if not found then
    raise exception 'Selected branch does not belong to student organization.';
  end if;

  if v_role = 'branch_manager' and v_target_branch <> v_current_branch then
    raise exception 'Branch managers cannot assign enrollments to a different branch.';
  end if;

  if v_package.branch_id is not null and v_package.branch_id <> v_target_branch then
    raise exception 'Package does not belong to the selected branch.';
  end if;

  v_start_date := coalesce(p_start_date, current_date);
  v_cycle_end_date := (
    v_start_date
    + make_interval(months => greatest(coalesce(v_package.duration_months, 1), 1))
    - interval '1 day'
  )::date;

  update public.students
  set
    current_package_id = p_package_id,
    updated_at = now()
  where id = p_student_id
    and organization_id = v_student.organization_id;

  insert into public.renewals (
    organization_id,
    branch_id,
    student_id,
    package_id,
    cycle_start,
    cycle_end,
    due_date,
    status,
    balance_amount
  )
  values (
    v_student.organization_id,
    v_target_branch,
    p_student_id,
    p_package_id,
    v_start_date,
    v_cycle_end_date,
    v_cycle_end_date,
    'pending',
    coalesce(v_package.amount, 0)
  )
  returning id into v_new_renewal_id;

  package_id := p_package_id;
  renewal_id := v_new_renewal_id;
  cycle_start := v_start_date;
  cycle_end := v_cycle_end_date;
  return next;
end;
$$;

revoke all on function public.add_student_enrollment_atomic(uuid, uuid, uuid, date) from public;
revoke execute on function public.add_student_enrollment_atomic(uuid, uuid, uuid, date) from anon;
grant execute on function public.add_student_enrollment_atomic(uuid, uuid, uuid, date) to authenticated;
