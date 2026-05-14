# Disaster Recovery and Data Durability Runbook

## Scope
This runbook covers backup validation, recovery procedures, rollback safety, and durability controls for accounting data.

## Systems and Owners
- Application owner: Engineering lead
- Database owner: Supabase project owner / DBA
- Deployment owner: DevOps / release manager
- Incident commander: On-call engineering lead

## Data Classification
- Tier 1 financial data: invoices, invoice_items, payments, renewals, audit_logs
- Tier 2 tenant metadata: organizations, branches, profiles, sports, packages, students
- Tier 3 assets: storage objects (branch images, logos, exported artifacts)

## Backup Audit Requirements
The repository cannot directly prove hosted backup configuration. Validate these in Supabase production dashboard before go-live.

### Required backup settings
- Automated backups: enabled
- Point-in-time recovery (PITR): enabled
- Backup frequency: daily minimum, hourly WAL/PITR stream
- Retention: minimum 30 days for financial workloads
- Restore drill cadence: at least monthly

### Evidence to capture
- Screenshot or export of backup settings
- PITR window duration
- Last successful backup timestamp
- Last restore-drill timestamp and duration

## Recovery Objectives
- Target RPO: <= 15 minutes (requires PITR)
- Target RTO: <= 60 minutes for database incident, <= 20 minutes for frontend rollback

## Migration Safety and Rollback Policy
- Always deploy database migrations before frontend code that depends on them.
- Never run destructive migrations without tested rollback scripts.
- For each migration release, pre-create:
  - forward SQL
  - compensating rollback SQL (where possible)
  - data validation query pack

### Migration deploy order
1. Apply SQL migrations to staging
2. Run smoke and accounting reconciliation checks
3. Snapshot production backup confirmation
4. Apply SQL to production
5. Deploy frontend
6. Run post-deploy reconciliation checks

### Failed migration procedure
1. Stop further deploy steps
2. Identify last successful migration version
3. If partial apply happened, run compensating SQL
4. If data corruption risk exists, restore via PITR to side database
5. Reconcile and replay safe changes

## Disaster Scenarios and Playbooks

### 1. Bad frontend deployment
- Action: rollback Vercel to previous known-good deployment
- Expected downtime: low, usually under 5 minutes
- Validation: login, invoice create, invoice view, cancellation, renewal

### 2. Failed SQL migration
- Action: stop release, run rollback SQL or restore from PITR clone
- Expected downtime: 15-60 minutes depending on data validation
- Validation: schema integrity, key RPC calls, accounting totals

### 3. Corrupted invoice write detected
- Action: pause invoice creation operations, identify affected window
- Action: query audit_logs and payments to reconstruct state
- Action: run targeted repair SQL under change control
- Expected downtime: feature-level partial downtime

### 4. Supabase outage
- Action: activate status page communication
- Action: stop financial mutation workflows
- Action: queue operator actions manually until recovery
- Expected downtime: provider dependent

### 5. Broken release with data mismatch
- Action: rollback frontend
- Action: compare computed vs stored totals
- Action: if persistent mismatch, execute PITR restore to side DB and reconcile

## Financial Reconciliation Queries (Post-Deploy)
Run and archive results after every production deploy.

1. Invoice balance consistency:
- total_amount >= balance_amount
- balance_amount >= 0

2. Payment overrun detection:
- SUM(completed payments) <= invoice total_amount

3. Cancellation consistency:
- cancelled invoices excluded from revenue rollups
- cancelled invoices have non-active payment statuses where required

4. Renewal linkage:
- completed renewals have generated_invoice_id
- generated invoices map to same tenant scope

## Environment Separation Controls
- Local uses only local .env.local values
- Staging and production secrets are managed in platform secret stores only
- No production credentials in local files
- No shared service role keys across environments

## Secret Management Controls
- Service role keys must never be exposed in client code or VITE variables
- Rotate keys immediately if exposure is suspected
- Disable verbose logging of secret-bearing payloads
- Restrict edge function secret access by environment

## Storage Durability Controls
- Use non-overwriting uploads for critical assets
- Keep path conventions tenant-scoped (organization or branch prefix)
- Track object URLs in DB with immutable history where needed

## Monitoring and Alerting Minimum Baseline
- Error monitoring: Sentry or equivalent for frontend and edge functions
- Uptime monitoring: API and frontend checks every 1 minute
- Financial anomaly alerts:
  - sudden spike in cancellations
  - negative balance detection attempts
  - payment overrun exceptions

## Release Checklist
- Backup settings verified in production dashboard
- Latest backup and PITR confirmed
- Staging migration and rollback tested
- Production migration applied
- Frontend deployed
- Reconciliation queries executed and archived
- Incident contacts on standby for 24 hours

## Rollback Checklist
- Freeze mutation endpoints if data risk is active
- Roll back frontend to prior deployment
- Decide SQL rollback vs PITR based on corruption scope
- Validate tenant access controls and core financial workflows
- Publish incident and resolution summary
