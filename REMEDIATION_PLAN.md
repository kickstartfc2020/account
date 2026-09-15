# Kickstart Accounting — Master Remediation Plan

Status: **planning only** — no code, schema, or data changed. Based on direct inspection of the repository (branch `Test-And-Push`, HEAD `88b878a`) via the code-review-graph MCP and targeted file reads on 2026-09-15.

Naming note: the UI's "Batches" concept maps directly onto the `packages` table — there is no separate `batches` table in the schema. All "batch architecture" items below refer to `packages`.

---

## How to read this document

Each change has: Problem, Root Cause, Proposed Solution, Database Changes, Backend/RPC Changes, Frontend Changes, Migration Risk, Regression Risk, Tests Required, Implementation Order (relative to other items in this doc).

Changes are grouped into:
- **A. Immediate safety/security fixes**
- **B. Batch (package) architecture changes**
- **C. Financial integrity changes**
- **D. Reliability improvements**
- **E. Testing/CI**
- **F. Performance/cleanup**

Priority tags (P0/P1/P2/P3) are carried over from the audit brief.

---

## A. Immediate safety/security fixes

### A1. [P0] Unauthenticated monthly renewal generator (`generate_monthly_renewals`)

**Problem.** `generate_monthly_renewals(p_run_date date)` (`supabase/migrations/20260616000000_baseline.sql:1180-1227`) is `SECURITY DEFINER`, has **no `auth.uid()` or role check**, and is granted `EXECUTE` to `anon` (`baseline.sql:3063`, never revoked). It scans `students`/`packages` across **all organizations** unconditionally.

**Root cause.** The function was written as an internal cron target and grant hygiene was never tightened to match the pattern used for other financial RPCs (`finalize_invoice_write`, `record_invoice_payment` both explicitly `REVOKE ... FROM anon`).

**Proposed solution.** Two layers:
1. Revoke `anon`/`authenticated` execute access; grant only to `service_role`.
2. Move the actual trigger to a trusted, non-client-invokable path: either (a) a Supabase scheduled Edge Function invoked via the platform's pg_cron → Edge Function pattern using the service-role key server-side, or (b) `pg_cron` calling the SQL function directly inside Postgres (no HTTP surface at all). Prefer (b) — it removes the function from the PostgREST RPC surface reachable by API keys entirely, if pg_cron is available on the project's Supabase plan; otherwise (a) with the Edge Function checking a shared secret header set only in the cron trigger config.
3. Add idempotency/observability: log each run (`organization_id`, rows inserted, run timestamp) to a small audit table so accidental double-runs are visible.

**Database changes.** Migration to:
```sql
REVOKE ALL ON FUNCTION public.generate_monthly_renewals(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_monthly_renewals(date) TO service_role;
```
Optionally add a `renewal_generation_runs` audit table (org_id, run_date, rows_inserted, executed_at, executed_by) — additive, non-destructive.

**Backend/RPC changes.** If using pg_cron: `SELECT cron.schedule('generate-monthly-renewals', '0 2 1 * *', $$SELECT public.generate_monthly_renewals(current_date)$$);` — no new Edge Function needed. If Edge Function path is required (e.g., pg_cron unavailable on plan), add `supabase/functions/generate-monthly-renewals-cron` that validates a `CRON_SECRET` header before calling the RPC via the service-role client.

**Frontend changes.** None — this RPC is not called from the client anywhere today (confirmed via grep).

**Migration risk.** Low — purely additive/revocation, does not touch existing data. Must confirm nothing in the client bundle currently depends on calling this RPC directly (confirmed: it doesn't).

**Regression risk.** Low. Verify the org's actual renewal-generation cron/schedule (currently unclear if one exists in production — **flag for product/business confirmation**: is this function currently being invoked by anything in production, and how often?).

**Tests required.** 1) RPC call from an `anon`/`authenticated` client without service-role key must fail with permission error. 2) `pg_cron`/scheduled invocation still produces correct renewal rows for a seeded org. 3) Duplicate-run safety (`on conflict ... do nothing` already exists — verify it still holds).

**Implementation order.** First — this is the single highest-severity, lowest-effort fix (grant change + scheduling relocation, no data model change).

---

### A2. [P0] Financial-year reset deletes wrong scope

**Problem.** `admin_reset_financial_year` (`supabase/migrations/20260624000000_fix_financial_year_reset_global.sql:77-217`) computes an FY window (`v_fy_start`/`v_fy_end`) for display/labeling only, then deletes with no date filter at all:
```sql
DELETE FROM public.payments WHERE organization_id = v_org_id;      -- all years
DELETE FROM public.invoices WHERE organization_id = v_org_id;      -- all years
-- p_organization_id IS NULL path:
DELETE FROM public.payments WHERE true;   -- every org
DELETE FROM public.invoices WHERE true;   -- every org
```
A function named/labeled as a "financial year reset" actually performs a full historical wipe (org-scoped, or global when called with `NULL`).

**Root cause.** The FY-window computation and the delete predicate were never connected — likely `WHERE ... AND invoice_date BETWEEN v_fy_start AND v_fy_end` was intended but dropped or never added across the function's several migration revisions.

**Proposed solution.** **This needs explicit product confirmation before any code change**: is "financial year reset" supposed to (a) delete only the just-closed FY's invoices/payments, or (b) wipe all history as a deliberate "start fresh" admin action (in which case the name/UI copy is the bug, not the SQL)? Given the existence of a manual "export backup" step immediately before it in the UI, intent (a) is more likely. Assuming (a):
1. Add `AND invoice_date >= v_fy_start AND invoice_date <= v_fy_end` (and matching filter on `payments`/`invoice_items` via their `invoice_id` join) to every DELETE.
2. Make the backup step mandatory and verified, not a separate unenforced UI action (see A3 / D2 below — same underlying "believed-guaranteed but not enforced" class of bug).
3. Add a `confirmation_text` that includes the computed FY range (e.g. `'RESET FY2025-26'`) so the admin's confirmation is bound to the scope they were shown, catching any future scope drift.

**Database changes.** New migration rewriting `admin_reset_financial_year` with scoped `DELETE ... WHERE organization_id = v_org_id AND invoice_date BETWEEN v_fy_start AND v_fy_end` (and equivalent join-based scoping for `payments`/`invoice_items`, since those don't carry `invoice_date` directly). Keep the existing role/confirmation checks unchanged. Also revoke the stray `anon` EXECUTE grant on both `admin_reset_financial_year` and `get_financial_year_reset_preview` (bring in line with A1's revoke pattern).

**Backend/RPC changes.** `get_financial_year_reset_preview` must be updated in lockstep to count only in-scope rows, so the preview the admin sees matches what will actually be deleted (today both are consistently "everything," which is at least internally non-misleading but doesn't match the function's name/intent).

**Frontend changes.** `src/pages/Settings.tsx` (`handleConfirmFinancialYearReset`) and `src/pages/super-admin/InvoicesOverview.tsx` (`handleBackupAndResetAllInvoices`) — update confirmation copy to state the exact FY range being deleted, and gate the reset button on a completed backup (see D2).

**Migration risk.** **High** — this changes destructive-delete semantics in production. Do NOT ship until: (1) product confirms intended scope, (2) a full data backup/export exists for any org that has ever run this function, (3) it's tested against a staging copy of real data shape.

**Regression risk.** High if scope assumption is wrong — could leave FY-scoped resets incomplete (rows that should be deleted aren't) or still delete too much if the date-range join for `payments`/`invoice_items` is mis-specified. Requires careful review of exactly which date column defines "belongs to FY" for each table.

**Tests required.** Seeded multi-FY dataset (invoices/payments spanning 3+ years) → run reset for one org/one FY → assert only that FY's rows are gone, all other years and all other orgs untouched. Also test the `p_organization_id IS NULL` global path the same way, scoped per-org per-FY.

**Implementation order.** After A1, before any other financial-integrity work — this is the most dangerous latent bug in the repo (irreversible mass data loss), but the fix itself requires a product decision first, so start that conversation immediately while other A-track items proceed in parallel.

---

### A3. [P0] Client-supplied invoice/renewal financial totals not recomputed server-side

**Problem.** `finalize_invoice_write`/`_v2` (`supabase/migrations/20260717000000_partial_payments_and_reminders.sql:267-320`, `20260813000000_gst_inclusive_manual_items.sql`) and `complete_renewal_with_invoice` (`20260625122623_diff5.sql:24-114`) insert `p_subtotal`/`p_tax_total`/`p_total_amount` exactly as sent by the client. Any authenticated staff role (including `branch_manager`) can submit an arbitrary total for an invoice or renewal, limited only by student/package/branch/org linkage checks — not by the package's actual catalog price.

**Root cause.** Billing math (`src/lib/billingMath.ts`, `useInvoiceCalculator.ts`) was implemented client-side for UI responsiveness and never mirrored server-side as a validation/recomputation step.

**Proposed solution.** Inside `finalize_invoice_write_v2` and `complete_renewal_with_invoice`, recompute expected totals server-side from `packages.amount`/`packages.gst_percent` (or `students.enrolled_price` when set — see B2) and either (a) reject if client-supplied totals deviate beyond a small rounding tolerance, or (b) ignore client totals entirely and always compute server-side, only accepting client-supplied *line-item* inputs (discounts, manual add-on items) that are individually bounded/validated. Prefer (b) for new/manual invoices where line items are legitimately free-form, and strict recomputation for auto-generated renewals where the package price is the sole source of truth.

**Database changes.** No schema change required. Add server-side validation logic inside the existing RPC bodies (new migration replacing the function definitions).

**Backend/RPC changes.** `finalize_invoice_write_v2`: add a computed "expected total from package + discounts" check before insert; raise exception on mismatch beyond tolerance (e.g., ₹1 for rounding). `complete_renewal_with_invoice`: always derive `p_total_amount` from `packages.amount`/`students.enrolled_price` server-side, ignore/require-match on client value.

**Frontend changes.** None functionally required (client still computes for UI preview) but error handling must surface a clear message when server-side recomputation rejects a submitted total (mismatch), so staff aren't confused by a generic RPC error.

**Migration risk.** Medium — must confirm all legitimate current use cases (manual discounts, custom line items, partial-package pricing) still pass validation; a too-strict tolerance will break valid manual invoices.

**Regression risk.** Medium — this is the area most likely to have legitimate edge cases (promotional pricing, manual overrides) that a naive recomputation would reject. Needs product/business sign-off on which fields are allowed to deviate from catalog price and by how much.

**Tests required.** 1) Standard invoice at exact package price succeeds. 2) Invoice with tampered/inflated `p_total_amount` (simulating a manipulated client request) is rejected. 3) Legitimate manual discount within allowed tolerance succeeds. 4) Renewal total always matches package/enrolled price regardless of client-supplied value.

**Implementation order.** After A2's product-confirmation conversation is underway (can proceed in parallel), before B2 (price/version) since B2 changes what "expected price" means — do the source-of-truth work (B2) first, then wire this validation to read from it. Sequence: A1 → A2 (decision) → B2 → A3.

---

### A4. [P1] SECURITY DEFINER grant hygiene (RLS/edge-function hardening)

**Problem.** No `USING (true)` RLS policies exist (verified clean across all 31 migrations), so RLS itself is sound. The real gap is inconsistent `EXECUTE` grants on `SECURITY DEFINER` functions, which bypass RLS entirely: `generate_monthly_renewals` (no anon revoke, no internal check — covered in A1), `admin_reset_financial_year` / `get_financial_year_reset_preview` (anon grant never revoked, though internally role-gated — covered in A2), `add_student_enrollment_atomic` (inherits baseline `GRANT ALL TO anon`, not explicitly revoked later — needs verification/closure).

**Root cause.** No standardized grant pattern was established early; `finalize_invoice_write*`/`record_invoice_payment` got it right (explicit `REVOKE ... FROM anon`) but the pattern wasn't applied retroactively to earlier or later functions.

**Proposed solution.** Single audit migration that explicitly sets, for every `SECURITY DEFINER` function touching financial/student/renewal/package data: `REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated, service_role;` (or `service_role`-only for admin/cron-style functions like A1). Also confirm `send-invoice-email` Edge Function validates that the invoice it's asked to email belongs to the caller's org (currently trusts client-supplied invoice data without a DB-side ownership check).

**Database changes.** One migration listing every affected function with explicit REVOKE/GRANT statements (idempotent, safe to re-run).

**Backend/RPC changes.** `supabase/functions/send-invoice-email/index.ts` — add a server-side lookup of the invoice by ID/number scoped to the caller's `organization_id` (via `can_access_organization`-style check) instead of trusting the client-supplied payload as the record of truth for what's being sent.

**Frontend changes.** None.

**Migration risk.** Low — revoking unnecessary grants doesn't change legitimate authenticated-user behavior; verify via staging that no currently-anon-reachable flow depends on any of these (none found in this audit).

**Regression risk.** Low.

**Tests required.** For each function: confirm `anon`-key RPC call now fails with permission-denied; confirm `authenticated`-key call still succeeds for the intended role.

**Implementation order.** Can run alongside A1/A2 — it's the same class of fix (grant hygiene), bundle into one migration PR after A1/A2 patterns are settled so the approach is consistent.

---

## B. Batch (package) architecture changes

*Preserving the existing `packages` table and flows — no redesign, only fixing the two concrete defects identified.*

### B1. [P0] Batch duration type mismatch

**Problem.** `normalizePackageDuration` (`src/lib/packageDuration.ts:3-17`) computes fractional month values (e.g. `0.25` for "1 week", `0.75` for "3 weeks") for recurring packages, but `packages.duration_months` is `integer` with `CHECK (duration_months > 0)`. A fractional value either fails the insert outright (`0.25` rounds to `0`, violates the check) or silently rounds to an incorrect integer (`0.75` → `1`), corrupting the intended billing cadence.

**Root cause.** The UI's duration model (week/month/year + count) was added after the `duration_months integer` column was fixed in the initial schema; no corresponding schema change accompanied the UI feature.

**Proposed solution.** Preserve the existing table — don't redesign package/batch architecture. Two options, in order of preference:
1. **Store duration as a structured pair** (`duration_unit` enum `week|month|year`, `duration_count` integer) alongside (not replacing, to avoid breaking existing reads) `duration_months`, and compute `duration_months` as a *derived, best-effort* integer (rounded, documented as approximate) purely for any legacy code path still reading it directly. New code reads `duration_unit`/`duration_count`.
2. Simpler, smaller-diff alternative: change `duration_months` to `numeric(6,2)` (drop the `integer` requirement), keep the `CHECK (duration_months > 0)` constraint, and accept fractional months as the actual stored unit. Less structurally correct but a one-line migration with no new columns.

Recommend option 2 given the "preserve existing system" constraint and small-diff preference — flag option 1 to the user as the more correct alternative if they want to invest more here (**needs product confirmation on which tradeoff they prefer**).

**Database changes.** Migration: `ALTER TABLE public.packages ALTER COLUMN duration_months TYPE numeric(6,2); ALTER TABLE public.packages ADD CONSTRAINT packages_duration_months_check CHECK (duration_months > 0);` (drop+recreate the check since column type changed). Additive, no data loss — existing integer values cast cleanly to numeric.

**Backend/RPC changes.** Any RPC or function reading/writing `duration_months` as integer (check `add_student_enrollment_atomic`, renewal cycle calculations) must be reviewed for integer-only assumptions (e.g. date-math using `duration_months * interval '1 month'` — numeric works fine with `interval` multiplication, low risk).

**Frontend changes.** None required beyond what already exists — `normalizePackageDuration` already produces the correct fractional value; the fix removes the DB-side truncation, not the client logic.

**Migration risk.** Low — widening `integer` → `numeric` is non-destructive; existing whole-month packages unaffected.

**Regression risk.** Medium — anywhere in the codebase or reports that assumes `duration_months` is a whole number (e.g. `for i in 1..duration_months loop` style logic, if any exists in renewal-cycle generation) needs a check. Search for all read-sites of `duration_months` before shipping.

**Tests required.** 1) Create a "1 week" recurring package end-to-end, verify it persists as `0.25` without constraint violation. 2) Existing whole-month packages round-trip unchanged. 3) Any renewal-cycle date math using `duration_months` produces correct cycle end dates for fractional values.

**Implementation order.** Independent of A-track; can proceed in parallel. Do before B2 if B2's "expected price" logic references duration for prorating (it currently doesn't, per audit — no coupling found).

---

### B2. [P0] Batch price/version problem — no source of truth for "price at time of enrollment"

**Problem.** `updatePackage` (`src/lib/dataMutations.ts:115-144`) does an in-place `UPDATE packages SET amount = ...`, with no history/versioning. The only mitigation is `students.enrolled_price`/`enrolled_tax_percent` (added in `20260625200000_student_enrolled_price.sql`), populated **client-side, best-effort, after the fact**, with its own write failure silently swallowed (see D1). If that snapshot write fails or was never run (pre-migration students), invoices/renewals fall back to the *current live* package price — meaning a price change retroactively changes what already-enrolled students are billed, silently.

**Root cause.** Price snapshotting was bolted on as a client-side secondary write rather than being enforced as part of the atomic enrollment transaction, and no RPC-level source of truth decides "package price" vs. "student's locked-in price" consistently across invoice and renewal code paths.

**Proposed solution.** Move price-snapshotting into the existing atomic enrollment RPC (`add_student_enrollment_atomic`) so it's guaranteed transactional, not a secondary client call:
1. `add_student_enrollment_atomic` sets `students.enrolled_price`/`enrolled_tax_percent` from `packages.amount`/`gst_percent` **inside its own transaction**, removing the need for the separate client-side update entirely.
2. `createStudent` (manual/non-enrollment path) — same: accept an explicit `enrolled_price` parameter into whatever RPC backs student creation, set atomically, not via a follow-up `.update()`.
3. `finalize_invoice_write_v2` and `complete_renewal_with_invoice` both read `COALESCE(students.enrolled_price, packages.amount)` server-side as the authoritative price (ties into A3's recomputation logic — implement together).
4. Do **not** add full package price-history versioning (e.g., a `package_price_history` table) unless the product owner confirms it's needed beyond the per-student snapshot — that would be a larger redesign than "preserve existing system" calls for. Flag as optional future work only.

**Database changes.** No new tables. Modify `add_student_enrollment_atomic` and the student-creation RPC to set `enrolled_price`/`enrolled_tax_percent` inline. If no dedicated "create student" RPC currently exists (creation is a direct client insert per the audit — `dataMutations.ts:169-219`), this is a new small RPC (`create_student_atomic` or extend an existing one) — **this is the one place a genuinely new RPC is warranted**, since student creation currently isn't atomic with its price snapshot at all.

**Backend/RPC changes.** New/modified: `add_student_enrollment_atomic` (add enrolled_price assignment inline), new `create_student_with_price` RPC (or extend existing student creation to be RPC-backed instead of direct `.insert()` + secondary `.update()`). `finalize_invoice_write_v2`/`complete_renewal_with_invoice` updated per A3.

**Frontend changes.** `src/lib/dataMutations.ts` (`createStudent`, `addStudentEnrollment`) — remove the secondary `.update()` calls, pass `enrolledPrice` as an RPC parameter instead.

**Migration risk.** Medium — changes student-creation code path from direct insert to RPC; must preserve exact same validation behavior (org/branch/role checks) that currently lives partly client-side, partly in RLS.

**Regression risk.** Medium — student creation is a high-traffic path; thorough regression testing needed for all three roles (super_admin, organization_admin, branch_manager).

**Tests required.** 1) New student created via new RPC has `enrolled_price` set atomically, no follow-up write. 2) Package price changed after enrollment; existing student's invoice still uses `enrolled_price`, not new package price. 3) RPC failure (e.g. invalid package) leaves no partial student row (all-or-nothing).

**Implementation order.** After B1 (duration fix, unrelated but same table — bundle migrations to reduce deploy count if convenient), before A3 is *finished* (A3 depends on B2's `enrolled_price` being reliably set to do correct server-side recomputation) — but A3's grant/validation-scaffolding work can start in parallel and land once B2 ships.

---

### B3. [P1] Batch branch-scope: org-wide packages invisible to branch managers

**Problem.** `packages_select_policy`/`packages_write_policy` (`baseline.sql:2868-2877`) require `branch_id = current_branch_id()` exactly for `branch_manager` role — packages with `branch_id IS NULL` (intended as org-wide/available-to-all-branches) are invisible to branch managers. This looks like a functional bug, not a security leak (policy is stricter than intended, not looser).

**Root cause.** RLS policy was written assuming every package has a concrete branch, not accounting for the nullable `branch_id` "org-wide" convention used elsewhere (e.g. `adminManagement.ts` branch logic).

**Proposed solution. Needs product confirmation**: is `branch_id IS NULL` meant to represent "available to all branches in the org"? If yes, add `OR branch_id IS NULL` to the branch_manager clause in both policies.

**Database changes.** Migration updating `packages_select_policy`/`packages_write_policy` (or a `packages_write_policy` split into insert/update if write access to org-wide packages by branch managers should be restricted while read access is opened — **flag for confirmation**: should branch managers be able to *edit* org-wide packages, or only *see/use* them for invoicing?).

**Backend/RPC changes.** None beyond the policy.

**Frontend changes.** `src/pages/Packages.tsx` — verify the branch-manager package list/dropdown correctly displays org-wide packages once visible (may currently filter client-side too; check for redundant client-side branch filtering that would mask the RLS fix).

**Migration risk.** Low — RLS policy change, easily reversible.

**Regression risk.** Low-medium — verify no code relies on branch managers *not* seeing org-wide packages (e.g. a report that assumes branch-manager package lists are branch-exclusive).

**Tests required.** Branch manager can SELECT and use (for invoicing) both branch-specific and org-wide (`branch_id IS NULL`) packages; cannot see other branches' branch-specific packages.

**Implementation order.** Independent, low-risk — can ship any time after product confirms intent; not blocking for A/B0-level items.

---

## C. Financial integrity changes

### C1. [P0] Payment idempotency

**Problem.** `record_invoice_payment` (`supabase/migrations/20260717000000_partial_payments_and_reminders.sql:552-640`) has no idempotency key. The only relevant unique index (`uq_payments_invoice_reference_no` on `(invoice_id, reference_no) WHERE reference_no IS NOT NULL AND status = 'completed'`) never applies because `reference_no` is never populated by either payment-insert path. A network retry or double-click can insert two real payment rows for the same amount.

**Root cause.** Idempotency was implemented for `finalize_invoice_write` (via `invoice_write_requests` + `request_key` dedup) but never extended to the separate payment-recording RPC.

**Proposed solution.** Add a client-generated idempotency key (UUID, generated once per user action, stable across retries of the same logical request) to `record_invoice_payment`, following the same pattern already proven for `finalize_invoice_write`: a dedup table (`payment_write_requests(organization_id, request_key, payment_id, created_at)` with unique `(organization_id, request_key)`) checked via `on conflict do nothing` / early-return-existing-result inside the RPC, guarded by the same `pg_advisory_xact_lock` pattern already used elsewhere.

**Database changes.** New migration: `payment_write_requests` table (additive), plus `request_key` parameter added to `record_invoice_payment`.

**Backend/RPC changes.** `record_invoice_payment(p_invoice_id, p_amount, p_payment_method, ..., p_request_key uuid)` — check `payment_write_requests` first, return existing payment if `request_key` already processed, else insert both the payment and the dedup row in the same transaction.

**Frontend changes.** `src/lib/invoiceWrite.ts` (`recordInvoicePayment`) — generate a UUID once per "record payment" user action (e.g. on dialog open, stored in component state), reuse it across retries of that same submission, pass as `p_request_key`.

**Migration risk.** Low — additive table + new optional-with-default parameter, backward compatible with any caller not yet passing a key (though all current callers should be updated together).

**Regression risk.** Low.

**Tests required.** 1) Same `request_key` submitted twice → only one payment row created, second call returns the first result. 2) Different `request_key`s for legitimately separate payments both succeed. 3) Concurrent duplicate submissions (simulated race) still produce exactly one row.

**Implementation order.** Independent of A/B tracks — can proceed in parallel, moderate priority within P0 given it's a correctness gap with real duplicate-billing risk on flaky networks.

---

### C2. [P1] Renewal validation completeness

**Problem.** `complete_renewal_with_invoice` validates renewal existence/state and org access, but (per A3) does not validate the financial totals against the package's actual price. Beyond that, `generate_monthly_renewals` (A1) has no validation at all — this is really the same underlying gap as A3/A1, listed separately per the audit brief's structure.

**Root cause.** See A1/A3.

**Proposed solution.** Covered by A1 (auth/grant) and A3 (amount validation) — no separate work needed beyond confirming, once A1/A3 ship, that renewal-specific edge cases (renewal already completed, renewal for an inactive/deleted student or package) are still correctly rejected. Add one additional check while touching this function: verify `packages.status = 'active'` at completion time (currently only checked at generation time in `generate_monthly_renewals`'s WHERE clause) — a package could be deactivated between renewal generation and completion.

**Database changes.** Small addition to `complete_renewal_with_invoice`: `if v_package.status != 'active' then raise exception ...`.

**Backend/RPC changes.** As above.

**Frontend changes.** Surface a clear error message in `src/pages/Renewals.tsx` if completion is rejected due to package deactivation.

**Migration risk.** Low.

**Regression risk.** Low — only adds a new rejection case for an already-invalid state.

**Tests required.** Completing a renewal whose package was deactivated after generation is rejected with a clear error.

**Implementation order.** Bundle with A3 (same function being modified).

---

### C3. [P1] Direct renewal/student/package writes review — CLOSED (superseded by F5)

**Status: done.** Audit found no direct client `.insert()` into `renewals` (all writes go through RPCs). The two remaining direct-write gaps named here — `updateInvoiceDate` (`invoiceMutations.ts`, direct `.update()` on `invoices`) and the manual-invoice `notes` secondary write in `CreateInvoice.tsx` — are resolved:
- `updateInvoiceDate` now calls the audited RPC `update_invoice_date_audited` (added in `20260915120000_phase1_security_hardening.sql`), which logs old/new date, actor, and org to `rpc_audit_log`.
- The `notes` write is intentionally left as a direct, non-financial column-level `UPDATE` — see F5, which formalizes this as the sole remaining direct-write exception at the grant layer rather than leaving it implicit in RLS alone.

No further action needed for this item; grant-layer enforcement of "RPC-only for financial fields" is now tracked under F5.

---

## D. Reliability improvements

### D1. [P1] Silent secondary-write failures

**Problem.** `createStudent` (`dataMutations.ts:206-215`) and `addStudentEnrollment` (`dataMutations.ts:280-289`) both swallow errors from the secondary `enrolled_price` update (`.then(() => {/* ignore */})` or no error handling at all). `CreateInvoice.tsx:645-671` similarly catches and only logs errors from secondary `previousReceivedAmount`/`notes` updates, still reporting full success to the user.

**Root cause.** These were implemented as "best-effort" secondary writes after the primary write/RPC already succeeded, with no design decision made about what should happen on partial failure.

**Proposed solution.** Superseded structurally by B2 (moving `enrolled_price` into the atomic RPC removes this class of bug for that specific case). For the remaining `CreateInvoice.tsx` secondary writes (`previousReceivedAmount`, manual `notes`): either (a) fold them into the primary RPC call as additional parameters (preferred — matches B2's approach), or (b) if they must remain separate calls, surface a distinct, non-blocking warning to the user ("Invoice created, but a note could not be saved — please retry") instead of full-success messaging, so the failure isn't invisible.

**Database changes.** None beyond what B2 already proposes, unless `notes`/`previousReceivedAmount` are folded into `finalize_invoice_write_v2`'s parameter list (small additive parameter change).

**Backend/RPC changes.** Extend `finalize_invoice_write_v2` to accept `p_notes`/`p_previous_received_amount` directly if folding in (preferred, removes the whole class of bug); otherwise no RPC change.

**Frontend changes.** `CreateInvoice.tsx` — either drop the separate calls (pass params to the RPC) or change the catch blocks to show a distinct partial-failure toast rather than the generic success toast.

**Migration risk.** Low.

**Regression risk.** Low-medium if folding params into the RPC — verify no caller relies on notes being optional/settable after the fact.

**Tests required.** Simulate secondary-write failure (mock/fault-inject) and confirm the user sees an accurate status, not a false "success."

**Implementation order.** After B2 ships (removes most of this surface); remaining `CreateInvoice.tsx` items can proceed independently and in parallel with B2.

---

### D2. [P1] Reset/backup concurrency — unenforced backup-before-reset

**Problem.** `handleBackupAndResetAllInvoices` (`InvoicesOverview.tsx:165-188`) does not itself perform any backup — `downloadInvoicesExcelBackup` is a fully independent action the admin must remember to trigger first. Nothing enforces or verifies a backup occurred before the destructive reset (A2) runs.

**Root cause.** Backup and reset were implemented as two separate UI actions without a state machine connecting them.

**Proposed solution.** Require the export/backup action to complete (or be explicitly acknowledged/skipped) as a gating step immediately before the reset confirmation dialog is enabled — e.g., reset confirmation button stays disabled until the export has been triggered in the same session, or the confirmation dialog embeds a "Download backup" button that must be clicked before the "RESET" text field becomes enterable.

**Database changes.** None.

**Backend/RPC changes.** None.

**Frontend changes.** `src/pages/super-admin/InvoicesOverview.tsx` and `src/pages/Settings.tsx` — add a local state flag (`backupCompleted`) set only after `downloadInvoicesExcelBackup`/`handleExportData` resolves successfully, gate the reset confirmation UI on it.

**Migration risk.** None (frontend-only).

**Regression risk.** Low — purely additive UI gate.

**Tests required.** Reset confirmation cannot be submitted without first completing the backup step in the same session.

**Implementation order.** Bundle with A2 (same reset flow) — ship together so the scope fix and the backup gate land in the same release.

---

## E. Testing/CI

### E1. [P2] Test coverage for RPCs touched above

**Problem.** No evidence of automated tests for the financial RPCs (`finalize_invoice_write*`, `record_invoice_payment`, `complete_renewal_with_invoice`, `admin_reset_financial_year`, `generate_monthly_renewals`, `add_student_enrollment_atomic`) — confirmed no test files reference these in the graph/FTS index.

**Root cause.** No CI/test infrastructure currently exercises database RPC logic.

**Proposed solution.** Add a minimal pgTAP or equivalent SQL-level test suite (or a lightweight Node/Deno script hitting a local Supabase instance) covering exactly the scenarios listed under "Tests required" in each item above — not a large general suite, scoped strictly to the RPCs modified by this plan.

**Database changes.** None (test-only additions, e.g. `supabase/tests/`).

**Backend/RPC changes.** None.

**Frontend changes.** None.

**Migration risk.** None.

**Regression risk.** None — tests only.

**Tests required.** N/A (this is the test-adding item).

**Implementation order.** Write tests alongside each A/B/C/D item as it's implemented, not as a separate deferred phase — each PR should include its own scoped test per the "Tests required" section above. E1 exists to flag that a CI runner needs to be wired up (GitHub Actions running `supabase db test` or equivalent) if one doesn't exist yet — **confirm current CI setup with the user**, none was found in this audit.

---

## F. Performance/cleanup

### F1. [P3] Indexes for new query patterns

**Problem.** No missing-index issues were surfaced directly by this audit (out of scope per the brief's read-only focus), but B2's server-side price lookups (`students.enrolled_price` fallback to `packages.amount`) and C1's new `payment_write_requests` dedup table will add query patterns worth indexing.

**Proposed solution.** `payment_write_requests` needs its unique `(organization_id, request_key)` index (created automatically by the `UNIQUE` constraint in C1 — no separate action needed). No other new indexes identified as necessary by this audit; defer further performance work until the above changes are live and real query patterns can be measured.

**Implementation order.** Last — revisit after A/B/C/D ship and production query patterns are observable.

### F2. [P3] Legacy/cleanup functions

**Problem.** `delete_package_safe` (`20260830050000_delete_package_safe.sql`) and other recently-added safety-wrapper functions should be reviewed once for grant consistency (fold into A4's audit migration) — no separate cleanup work identified beyond that.

**Implementation order.** Fold into A4.

### F5. [P0] Financial write-door: table-level INSERT/UPDATE lockdown — DONE

**Status: done** (`20260915154500_lock_financial_write_door.sql`). Numbered F5 to match the label used when this fix was requested/tracked outside this document; there is no F3/F4 in this plan — treat the gap as intentional, not a missing item.

**Problem.** `invoices`, `invoice_items`, `payments`, and `renewals` were all granted `ALL` at the table level to `authenticated` in the baseline migration. Every legitimate write already went through a `SECURITY DEFINER` RPC (verified exhaustively — see below), but the table grant itself remained a live PostgREST attack/misuse surface: any authenticated session could, in principle, `POST`/`PATCH` these tables directly, bypassing every RPC-level business-rule check (org/branch scoping, role checks, balance validation) even though RLS row-scoping would still apply. This is the same class of gap A3/C3 identified for `invoices` specifically; F5 closes it for all four core financial tables at once, at the grant layer rather than per-table/per-field.

**Root cause.** Baseline schema generation granted `ALL` on every table to `authenticated` by default; nothing ever narrowed it down once the RPC-only write pattern was established.

**Verification performed.** 1) Grepped every `src/**/*.ts(x)` call site of `.from('invoices'|'invoice_items'|'payments'|'renewals')` — confirmed every hit is a `.select()` except the one Phase-1 exception (`invoices.notes`, via `CreateInvoice.tsx`). 2) Grepped every `insert into public.<table>` / `update public.<table>` across `supabase/migrations/**` for these four tables — confirmed every occurrence is inside a `SECURITY DEFINER` function body (`add_student_enrollment_atomic`, `generate_monthly_renewals`, `complete_renewal_with_invoice`, `finalize_invoice_write`/`_v2`, `record_invoice_payment`, `cancel_invoice_safe`, `sync_invoice_payment_status`, `update_invoice_date_audited`). `SECURITY DEFINER` functions run as their owner (`postgres`), so none of them depend on `authenticated` holding table-level `INSERT`/`UPDATE` — confirmed safe to revoke.

**Proposed solution / what shipped.** `REVOKE INSERT, UPDATE ON TABLE <table> FROM authenticated` for all four tables; re-grant `UPDATE (notes)` on `invoices` only (preserves the Phase-1 exception). `SELECT` and `DELETE` left untouched (`DELETE` was out of scope for this change; all four tables already have `prevent_hard_delete` triggers).

**Database changes.** `supabase/migrations/20260915154500_lock_financial_write_door.sql` — grant changes only, no schema/data change.

**Backend/RPC changes.** None — all RPCs are `SECURITY DEFINER` and unaffected.

**Frontend changes.** None required (no legitimate code path used direct writes on these tables besides the already-migrated `invoices.notes`/`invoice_date` cases).

**Migration risk.** Low — grant-only change, exhaustively verified against every current caller before writing the migration.

**Regression risk.** Low, conditional on no out-of-repo script/tool (Zapier, admin SQL console habits, a future PR) relying on direct table writes with the `authenticated` role — flagged for deployment sign-off.

**Tests required.** Confirm each RPC (`finalize_invoice_write_v2`, `record_invoice_payment`, `complete_renewal_with_invoice`, `cancel_invoice_safe`, `add_student_enrollment_atomic`, `update_invoice_date_audited`) still succeeds end-to-end for an `authenticated` session after the grant change. Confirm a raw `PATCH`/`POST` against any of the four tables via PostgREST now fails with a permission error for `authenticated`.

**Implementation order.** Independent of B/C/D tracks; pairs naturally with A4's grant-hygiene work.

---

## Dependencies between changes

```
A1 (renewal generator auth) ─── independent, ship first
A2 (FY reset scope) ─── needs product decision ─── A2 code ─── D2 (backup gate, same release)
A3 (amount validation) ─── needs B2 (enrolled_price source of truth) landed first for full effect
                        └── grant/scaffolding can start in parallel with B2
A4 (grant hygiene) ─── independent, bundle with A1/A2 migrations; absorbs F2
B1 (duration type) ─── independent
B2 (price snapshot atomicity) ─── after B1 (same table, bundle migrations) ─── feeds A3, D1
B3 (branch-scope RLS) ─── independent, needs product confirmation on org-wide package semantics
C1 (payment idempotency) ─── independent
C2 (renewal validation) ─── bundle with A3 (same function)
C3 (minor direct writes) ─── independent, low priority
D1 (silent failures) ─── mostly resolved by B2; remaining CreateInvoice.tsx items independent
D2 (backup gate) ─── bundle with A2
E1 (tests) ─── per-item, alongside each implementation
F1/F2 ─── after everything else
```

---

## Recommended implementation sequence (minimizes production risk)

1. **A1** — revoke `generate_monthly_renewals` anon grant + relocate scheduling (fast, zero product-decision blocker, highest severity/effort ratio).
2. **A4** — grant-hygiene audit migration (bundle A1's grant fix into this same pass; low risk, mechanical).
3. **Open product conversation for A2** (FY reset scope) and **B3** (org-wide package branch visibility) — these need answers before code changes; start immediately, don't block other work on them.
4. **B1** — duration type widen (`integer` → `numeric`), independent, low risk, ship any time.
5. **C1** — payment idempotency (independent, moderate effort, real correctness gap).
6. **B2** — price/version fix, moves `enrolled_price` into atomic RPCs (moderate effort; unblocks A3 and D1).
7. **A3 + C2** — server-side amount recomputation for invoices/renewals, bundled with the package-deactivation check (depends on B2).
8. **D1** — remaining silent-failure cleanup in `CreateInvoice.tsx` (small, can trail A3/B2).
9. **A2 + D2** — FY reset scope fix + enforced backup gate, shipped together, only once product confirms intended scope and a verified backup/export of any org that has used this function exists.
10. **B3** — branch-scope RLS fix, once product confirms org-wide package semantics.
11. **C3** — optional invoice-date audit RPC, only if product wants it.
12. **E1** — CI/test wiring, ideally in parallel from step 1 onward rather than deferred to the end.
13. **F1/F2** — performance/cleanup, last.

Items 1–2 and 4–5 have no open product questions and can start immediately. Items 3, 9, and 10 are gated on explicit product/business confirmation before any code is written, per the instruction to flag decisions requiring business sign-off — **do not implement A2's fix or B3's fix until those confirmations are received.**
