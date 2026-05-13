alter table public.packages
alter column duration_months type numeric(10,2)
using duration_months::numeric(10,2);
