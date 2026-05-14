alter table public.sports
  add column if not exists branch_id uuid references public.branches(id) on delete restrict;

create index if not exists idx_sports_branch_id on public.sports(branch_id);

drop policy if exists sports_select_policy on public.sports;
create policy sports_select_policy
on public.sports
for select
using (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
  or (
    public.current_role() = 'branch_manager'
    and organization_id = public.current_organization_id()
    and branch_id = public.current_branch_id()
  )
);

drop policy if exists sports_write_policy on public.sports;
create policy sports_write_policy
on public.sports
for all
using (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
  or (
    public.current_role() = 'branch_manager'
    and organization_id = public.current_organization_id()
    and branch_id = public.current_branch_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_role() = 'organization_admin'
    and organization_id = public.current_organization_id()
  )
  or (
    public.current_role() = 'branch_manager'
    and organization_id = public.current_organization_id()
    and branch_id = public.current_branch_id()
  )
);
