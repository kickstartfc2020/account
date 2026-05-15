# Database Cleanup & Reset Guide

## Overview
This folder contains scripts to completely reset the production database and set up new super admin credentials.

## Files
- `cleanup_all_data.sql` - Migration that truncates all business data
- `create_super_admin.sql` - Setup script to create new super admin profile

## When to Use
- **Cleanup all data**: Run when you want a fresh database start (all orgs, branches, students, invoices removed)
- **Create super admin**: Run after cleanup to restore admin access

## Step-by-Step Process

### 1. Run the Cleanup Migration
```bash
# Option A: Via Supabase CLI (if set up)
supabase migration up

# Option B: Manual execution
# Copy contents of `supabase/migrations/20260515000000_cleanup_all_data.sql`
# Paste into Supabase SQL editor and execute
```

**What it does:**
- ✓ Deletes all organizations, branches, sports, packages
- ✓ Deletes all students, invoices, payments, renewals
- ✓ Clears audit logs and ref counters
- ✓ Resets ID sequences to 1
- ✓ **Preserves**: Database schema, storage buckets, auth.users table

**What it does NOT do:**
- ✗ Does not delete auth.users (Firebase auth records)
- ✗ Does not delete old organization logos from storage bucket

### 2. Delete Old Auth Users (Optional)
If you want to remove all old login credentials and start completely fresh:

```sql
-- Via Supabase dashboard > SQL editor
-- ⚠️  WARNING: This deletes all user accounts
-- DELETE FROM auth.users;
```

**Note**: You'll need to create a NEW super admin user after this step.

### 3. Create New Super Admin User

#### Option A: Via Supabase Dashboard
1. Go to **Authentication** → **Users**
2. Click **"Add user"**
3. Enter new email and password
4. Copy the new user's **ID** (UUID)
5. Proceed to Step 4

#### Option B: Via API (if programmatic access needed)
```javascript
// Using Supabase JS client
const { data, error } = await supabase.auth.signUp({
  email: 'admin@example.com',
  password: 'SecurePassword123'
});
// Copy data.user.id for next step
```

### 4. Create Super Admin Profile

1. **Edit** `supabase/cleanup/create_super_admin.sql`
2. Replace:
   - `YOUR_AUTH_USER_ID` → with the UUID from Step 3
   - `Admin User` → with desired admin name
3. Execute the SQL in Supabase SQL editor
4. You should see confirmation: "INSERT 0 1"

### 5. Verify & Login

```bash
# Test login
# Go to https://www.kickstartbill.com/login
# Use the new email/password from Step 3
# You should see the super admin dashboard
```

## Verification Checklist
- [ ] Cleanup migration executed successfully
- [ ] Old data is gone (check Supabase dashboard data browser)
- [ ] New auth user created
- [ ] Super admin profile inserted
- [ ] Can login with new credentials
- [ ] Dashboard loads without errors

## Rollback (if needed)

If something goes wrong, you can restore from Supabase backups:
1. Go to Supabase dashboard → **Settings** → **Backups**
2. Restore to a point before cleanup
3. Re-run steps if needed

## Security Notes
- 🔒 Store the new super admin credentials securely
- 🔒 Don't commit credentials to git
- 🔒 For production, use strong passwords or OAuth
- 🔒 Consider two-factor authentication

## Support
If you encounter issues:
1. Check Supabase status page
2. Review error logs in Supabase dashboard
3. Ensure all FK constraints are properly disabled during cleanup
4. Verify the auth user UUID is correct format (should be UUID, not email)
