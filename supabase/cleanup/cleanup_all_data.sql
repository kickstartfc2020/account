-- Cleanup all business data from production
-- Truncates all data tables while preserving schema and super_admin capability
-- Run this manually from Supabase SQL editor when a full reset is needed.

-- Disable foreign key constraints temporarily
set session_replication_role = replica;

-- Truncate business data tables in reverse order of dependencies
truncate public.audit_logs cascade;
truncate public.invoice_write_requests cascade;
truncate public.payments cascade;
truncate public.renewals cascade;
truncate public.invoice_items cascade;
truncate public.invoices cascade;
truncate public.students cascade;
truncate public.packages cascade;
truncate public.sports cascade;
truncate public.branches cascade;
truncate public.gst_rates cascade;

-- Delete all profiles (users will remain in auth.users for manual cleanup)
delete from public.profiles;

-- Delete organizations (but can recreate after new super_admin login)
delete from public.organizations;

-- Reset ref counters
truncate public.ref_counters cascade;

-- Reset sequences to start fresh
alter sequence public.seq_org restart with 1;
alter sequence public.seq_branch restart with 1;
alter sequence public.seq_student restart with 1;
alter sequence public.seq_package restart with 1;
alter sequence public.seq_profile restart with 1;

-- Re-enable foreign key constraints
set session_replication_role = default;
