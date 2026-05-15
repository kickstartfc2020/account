alter table public.organizations
  add column if not exists upi_id text,
  add column if not exists upi_qr_url text;
