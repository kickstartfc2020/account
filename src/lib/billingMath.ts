export function computeBillingTotals(amount: number, gstPercent: number) {
  const subtotal = Number(amount.toFixed(2));
  const taxTotal = Number(((subtotal * gstPercent) / 100).toFixed(2));
  const totalAmount = Number((subtotal + taxTotal).toFixed(2));

  return {
    subtotal,
    taxTotal,
    totalAmount,
  };
}
