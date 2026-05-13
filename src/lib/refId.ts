/**
 * Utilities for human-readable reference IDs.
 *
 * All ref IDs follow the pattern  PREFIX-[QUALIFIER-]NUMBER
 * Examples:
 *   ORG-0001
 *   BR-0001
 *   STU-000001
 *   PKG-0001
 *   USR-000001
 *   INV-BR0001-2026-000001
 *   PAY-2026-000001
 *   REN-2026-000001
 */

const PREFIX_LABELS: Record<string, string> = {
  ORG: 'Organisation',
  BR:  'Branch',
  STU: 'Student',
  PKG: 'Package',
  USR: 'User',
  INV: 'Invoice',
  PAY: 'Payment',
  REN: 'Renewal',
};

/** Returns the prefix portion of a ref ID, e.g. "STU" from "STU-000042". */
export function refIdPrefix(refId: string): string {
  return refId.split('-')[0] ?? '';
}

/**
 * Returns a human-readable label for the entity type encoded in the ref ID.
 * Falls back to the raw prefix if unknown.
 */
export function refIdLabel(refId: string): string {
  const prefix = refIdPrefix(refId);
  return PREFIX_LABELS[prefix] ?? prefix;
}

/**
 * Returns true when the ref ID looks structurally valid (non-empty, has a
 * recognised prefix and at least one numeric segment).
 */
export function isValidRefId(refId: string | null | undefined): refId is string {
  if (!refId) return false;
  const parts = refId.split('-');
  if (parts.length < 2) return false;
  const prefix = parts[0];
  if (!PREFIX_LABELS[prefix]) return false;
  return true;
}

/**
 * Formats a ref ID for display.  If the ref ID is missing or blank (i.e. an
 * existing row that was not yet backfilled) it returns the placeholder.
 */
export function displayRefId(
  refId: string | null | undefined,
  placeholder = '—'
): string {
  return refId && refId.trim() !== '' ? refId : placeholder;
}

/**
 * Strips the dash separator out of a branch ref ID so it can be embedded
 * inside an invoice number.
 *   BR-0001  →  BR0001
 */
export function branchCodeFromRefId(branchRefId: string): string {
  return branchRefId.replace('-', '');
}
