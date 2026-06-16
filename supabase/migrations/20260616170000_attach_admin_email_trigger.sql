-- public.sync_admin_profile_for_email() is defined in the baseline but was
-- never actually wired up to auth.users -- pg_dump excludes the
-- Supabase-managed auth schema by default, so the trigger that's supposed
-- to call it on signup was silently dropped when migrations were
-- consolidated (same root cause as the missing storage.* setup fixed in
-- 20260616140000). Without this, signing up with
-- admin@kickstartaccounts.com on a fresh environment does not grant
-- super_admin at all -- the documented bootstrap path is currently dead.

DROP TRIGGER IF EXISTS "sync_admin_profile_for_email_trigger" ON "auth"."users";

CREATE TRIGGER "sync_admin_profile_for_email_trigger"
    AFTER INSERT OR UPDATE OF "email" ON "auth"."users"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."sync_admin_profile_for_email"();
