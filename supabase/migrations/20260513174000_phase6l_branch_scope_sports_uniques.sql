alter table public.sports
  drop constraint if exists sports_organization_id_name_key;

create unique index if not exists uq_sports_org_name_global
  on public.sports(organization_id, name)
  where branch_id is null;

create unique index if not exists uq_sports_org_branch_name
  on public.sports(organization_id, branch_id, name)
  where branch_id is not null;
