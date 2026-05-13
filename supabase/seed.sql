-- Seed data migrated from current frontend mock dataset
-- Safe to run on local Supabase for MVP testing

insert into public.organizations (id, name, code, status)
values
  ('11111111-1111-1111-1111-111111111111', 'Kickstart Academy', 'KICKSTART', 'active')
on conflict (id) do update set
  name = excluded.name,
  code = excluded.code,
  status = excluded.status,
  updated_at = now();

insert into public.branches (id, organization_id, name, address, phone, email, status)
values
  ('22222222-2222-2222-2222-222222222221', '11111111-1111-1111-1111-111111111111', 'Mysore Main', '123 Sport Street, Mysore', '9876543210', 'main@kickstart.com', 'active'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'South City', '456 Stadium Road, Mysore', '9876543211', 'south@kickstart.com', 'active'),
  ('22222222-2222-2222-2222-222222222223', '11111111-1111-1111-1111-111111111111', 'East End', '789 Academy Ave, Mysore', '9876543212', 'east@kickstart.com', 'active')
on conflict (id) do update set
  organization_id = excluded.organization_id,
  name = excluded.name,
  address = excluded.address,
  phone = excluded.phone,
  email = excluded.email,
  status = excluded.status,
  updated_at = now();

insert into public.sports (id, organization_id, name, status)
values
  ('33333333-3333-3333-3333-333333333331', '11111111-1111-1111-1111-111111111111', 'Football', 'active'),
  ('33333333-3333-3333-3333-333333333332', '11111111-1111-1111-1111-111111111111', 'Badminton', 'active'),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Cricket', 'active'),
  ('33333333-3333-3333-3333-333333333334', '11111111-1111-1111-1111-111111111111', 'Tennis', 'active')
on conflict (id) do update set
  organization_id = excluded.organization_id,
  name = excluded.name,
  status = excluded.status,
  updated_at = now();

insert into public.packages (
  id,
  organization_id,
  sport_id,
  name,
  billing_type,
  duration_months,
  amount,
  gst_percent,
  status
)
values
  ('44444444-4444-4444-4444-444444444441', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333331', 'Monthly Basic', 'recurring_monthly', 1, 2000, 18, 'active'),
  ('44444444-4444-4444-4444-444444444442', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333331', 'Quarterly Pro', 'one_time', 3, 5500, 18, 'active'),
  ('44444444-4444-4444-4444-444444444443', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333331', 'Annual Elite', 'one_time', 12, 20000, 18, 'active'),
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333332', 'Summer Camp', 'one_time', 1, 3000, 18, 'active')
on conflict (id) do update set
  organization_id = excluded.organization_id,
  sport_id = excluded.sport_id,
  name = excluded.name,
  billing_type = excluded.billing_type,
  duration_months = excluded.duration_months,
  amount = excluded.amount,
  gst_percent = excluded.gst_percent,
  status = excluded.status,
  updated_at = now();

insert into public.students (
  id,
  organization_id,
  branch_id,
  current_package_id,
  name,
  phone,
  email,
  joined_at,
  status
)
values
  ('55555555-5555-5555-5555-555555555551', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222221', '44444444-4444-4444-4444-444444444441', 'Rahul Sharma', '9988776655', 'rahul@example.com', '2025-01-10', 'active'),
  ('55555555-5555-5555-5555-555555555552', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222221', '44444444-4444-4444-4444-444444444444', 'Priya Singh', '9988776644', 'priya@example.com', '2025-03-01', 'active'),
  ('55555555-5555-5555-5555-555555555553', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444442', 'Anish Kumar', '9988776633', 'anish@example.com', '2024-11-15', 'inactive')
on conflict (id) do update set
  organization_id = excluded.organization_id,
  branch_id = excluded.branch_id,
  current_package_id = excluded.current_package_id,
  name = excluded.name,
  phone = excluded.phone,
  email = excluded.email,
  joined_at = excluded.joined_at,
  status = excluded.status,
  updated_at = now();

insert into public.invoices (
  id,
  organization_id,
  branch_id,
  student_id,
  invoice_number,
  invoice_date,
  status,
  currency,
  subtotal,
  tax_total,
  discount_total,
  total_amount,
  balance_amount,
  notes
)
values
  ('66666666-6666-6666-6666-666666666661', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222221', '55555555-5555-5555-5555-555555555551', 'INV-001', '2025-04-12', 'completed', 'INR', 2000, 360, 0, 2360, 0, 'Monthly package billing'),
  ('66666666-6666-6666-6666-666666666662', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222221', '55555555-5555-5555-5555-555555555552', 'INV-002', '2025-05-01', 'partial', 'INR', 3000, 540, 0, 3540, 1040, 'Summer camp billing')
on conflict (id) do update set
  organization_id = excluded.organization_id,
  branch_id = excluded.branch_id,
  student_id = excluded.student_id,
  invoice_number = excluded.invoice_number,
  invoice_date = excluded.invoice_date,
  status = excluded.status,
  currency = excluded.currency,
  subtotal = excluded.subtotal,
  tax_total = excluded.tax_total,
  discount_total = excluded.discount_total,
  total_amount = excluded.total_amount,
  balance_amount = excluded.balance_amount,
  notes = excluded.notes,
  updated_at = now();

insert into public.invoice_items (
  id,
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
values
  ('77777777-7777-7777-7777-777777777771', '11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666661', '44444444-4444-4444-4444-444444444441', '33333333-3333-3333-3333-333333333331', 'Monthly Basic', 1, 2000, 18, 2000, 360, 2360),
  ('77777777-7777-7777-7777-777777777772', '11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666662', '44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333332', 'Summer Camp', 1, 3000, 18, 3000, 540, 3540)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  invoice_id = excluded.invoice_id,
  package_id = excluded.package_id,
  sport_id = excluded.sport_id,
  description = excluded.description,
  quantity = excluded.quantity,
  unit_price = excluded.unit_price,
  gst_percent = excluded.gst_percent,
  line_subtotal = excluded.line_subtotal,
  line_tax = excluded.line_tax,
  line_total = excluded.line_total,
  updated_at = now();

insert into public.payments (
  id,
  organization_id,
  branch_id,
  invoice_id,
  amount,
  payment_date,
  method,
  status,
  reference_no,
  notes
)
values
  ('88888888-8888-8888-8888-888888888881', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222221', '66666666-6666-6666-6666-666666666661', 2360, '2025-04-12T10:00:00Z', 'upi', 'completed', 'UPI-INV-001', 'Full payment received'),
  ('88888888-8888-8888-8888-888888888882', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222221', '66666666-6666-6666-6666-666666666662', 2500, '2025-05-01T11:00:00Z', 'card', 'completed', 'CARD-INV-002', 'Partial payment received')
on conflict (id) do update set
  organization_id = excluded.organization_id,
  branch_id = excluded.branch_id,
  invoice_id = excluded.invoice_id,
  amount = excluded.amount,
  payment_date = excluded.payment_date,
  method = excluded.method,
  status = excluded.status,
  reference_no = excluded.reference_no,
  notes = excluded.notes,
  updated_at = now();

insert into public.renewals (
  id,
  organization_id,
  branch_id,
  student_id,
  package_id,
  source_invoice_id,
  cycle_start,
  cycle_end,
  due_date,
  status,
  balance_amount
)
values
  ('99999999-9999-9999-9999-999999999991', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222221', '55555555-5555-5555-5555-555555555551', '44444444-4444-4444-4444-444444444441', '66666666-6666-6666-6666-666666666661', '2025-05-01', '2025-05-31', '2025-05-31', 'pending', 2000)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  branch_id = excluded.branch_id,
  student_id = excluded.student_id,
  package_id = excluded.package_id,
  source_invoice_id = excluded.source_invoice_id,
  cycle_start = excluded.cycle_start,
  cycle_end = excluded.cycle_end,
  due_date = excluded.due_date,
  status = excluded.status,
  balance_amount = excluded.balance_amount,
  updated_at = now();
