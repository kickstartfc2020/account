-- Setup new super_admin user after database cleanup
-- This script must be run after the cleanup migration to restore admin access
-- Prerequisites:
-- 1. Auth user must already exist in auth.users (created via Supabase dashboard)
-- 2. Replace YOUR_AUTH_USER_ID and YOUR_NAME below

-- Step 1: Insert the super_admin profile
-- ⚠️  CRITICAL: Replace YOUR_AUTH_USER_ID with the actual auth.users.id
-- You can find the user ID in Supabase dashboard > Authentication > Users

INSERT INTO public.profiles (
  id,
  role,
  full_name,
  status,
  created_at,
  updated_at
) VALUES (
  'YOUR_AUTH_USER_ID',  -- Replace this with actual UUID from auth.users
  'super_admin',
  'Admin User',         -- Replace with desired name
  'active',
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE
SET role = 'super_admin', updated_at = now();

-- Verify the profile was created
SELECT id, role, full_name, status FROM public.profiles WHERE role = 'super_admin';
