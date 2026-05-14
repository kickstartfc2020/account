function toPaise(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

function toRupees(valueInPaise: number) {
  return valueInPaise / 100;
}

export function computeBillingTotals(amount: number, gstPercent: number, discount = 0) {
  const subtotalPaise = Math.max(0, toPaise(amount));
  const discountPaise = Math.max(0, toPaise(discount));
  const taxablePaise = Math.max(0, subtotalPaise - discountPaise);
  const taxPaise = Math.max(0, Math.round((taxablePaise * gstPercent) / 100));
  const totalPaise = taxablePaise + taxPaise;

  return {
    subtotal: toRupees(subtotalPaise),
    discountAmount: toRupees(discountPaise),
    taxableAmount: toRupees(taxablePaise),
    taxTotal: toRupees(taxPaise),
    totalAmount: toRupees(totalPaise),
  };
}
