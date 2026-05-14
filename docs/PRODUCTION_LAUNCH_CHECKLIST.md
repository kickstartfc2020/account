# Production Launch Checklist

## 1. Environment Verification
- Confirm production uses only production Supabase project URL and anon key.
- Confirm no service role key exists in any VITE_* variable.
- Confirm VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in platform environment.
- Confirm VITE_APP_URL matches production domain.
- Confirm no test credentials are configured in production environment.

## 2. Build and Static Verification
- Run npm run lint.
- Run npx tsc --noEmit.
- Run npm run build.
- Confirm build output has no unresolved import failures.
- Confirm startup fails fast if required env variables are missing.

## 3. Backup Verification
- Confirm automated backups are enabled in Supabase production.
- Confirm PITR is enabled and retention meets policy.
- Record latest successful backup timestamp.
- Confirm latest restore drill passed and document RTO/RPO.

## 4. Deployment Order and Safety
- Apply DB migrations first.
- Deploy backend/edge function changes second.
- Deploy frontend last.
- Validate post-migration schema and RPC permissions before frontend rollout.
- Confirm failed frontend deployment does not require DB rollback.

## 5. Rollback Plan
- Frontend rollback: revert to previous Vercel deployment.
- Migration rollback: execute compensating SQL where available.
- Data incident rollback: restore to side database using PITR, reconcile, then cut over.
- Freeze mutation endpoints during severe integrity incidents.

## 6. Monitoring Verification
- Confirm VITE_CLIENT_LOG_ENDPOINT is configured (if using centralized client logging).
- Confirm frontend unhandled error and rejection events appear in logs.
- Confirm alerting exists for invoice, payment, renewal, and auth failures.
- Confirm uptime monitoring checks frontend and API endpoints.

## 7. Reconciliation Verification
- Run invoice balance consistency checks.
- Run payment overrun checks.
- Run cancellation consistency checks.
- Run renewal-to-invoice linkage checks.
- Archive reconciliation output with deployment record.

## 8. Post-Launch Smoke Tests
- Login with each supported role.
- Create invoice end-to-end and verify record integrity.
- Cancel invoice and verify reporting exclusion.
- Complete renewal and verify generated invoice link.
- Verify settings update, GST management, and logo upload.
- Verify super-admin branch actions.
- Verify print and PDF export flows.

## 9. Operational Readiness Sign-Off
- Engineering sign-off
- Database owner sign-off
- Operations sign-off
- Incident commander on-call confirmed
