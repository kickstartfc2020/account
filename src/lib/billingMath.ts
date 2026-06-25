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

// Used when the entered amount already includes GST (sport/package mode).
// Back-calculates the taxable base and embedded GST from the gross price.
export function computeInclusiveBillingTotals(grossAmount: number, gstPercent: number, discountFromGross = 0) {
  const grossPaise = Math.max(0, toPaise(grossAmount));
  const discountPaise = Math.max(0, toPaise(discountFromGross));
  const totalPaise = Math.max(0, grossPaise - discountPaise);
  const taxablePaise = gstPercent > 0
    ? Math.round(totalPaise / (1 + gstPercent / 100))
    : totalPaise;
  const taxPaise = totalPaise - taxablePaise;

  return {
    subtotal: toRupees(grossPaise),
    discountAmount: toRupees(discountPaise),
    taxableAmount: toRupees(taxablePaise),
    taxTotal: toRupees(taxPaise),
    totalAmount: toRupees(totalPaise),
  };
}
