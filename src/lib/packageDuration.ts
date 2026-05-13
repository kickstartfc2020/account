export type RecurringInterval = 'week' | 'month' | 'year';

export function normalizePackageDuration(
  billingType: 'one-time' | 'recurring',
  durationMonths: number,
  recurringInterval: RecurringInterval = 'month',
  recurringCount = 1,
) {
  if (billingType !== 'recurring') {
    return Number(Math.max(1, durationMonths).toFixed(2));
  }

  const intervalMultiplier = recurringInterval === 'week' ? 0.25 : recurringInterval === 'month' ? 1 : 12;
  const normalizedCount = Number.isFinite(recurringCount) ? recurringCount : 1;

  return Number(Math.max(0.25, normalizedCount * intervalMultiplier).toFixed(2));
}