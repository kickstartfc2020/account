import React from 'react';
import { computeBillingTotals } from '@/lib/billingMath';

type UseInvoiceCalculatorInput = {
  amount: string;
  discount: string;
  gstRate: string;
  academyName: string;
  invoiceCount: number;
};

export function useInvoiceCalculator({
  amount,
  discount,
  gstRate,
  academyName,
  invoiceCount,
}: UseInvoiceCalculatorInput) {
  return React.useMemo(() => {
    const parsedAmount = Number.parseFloat(amount) || 0;
    const parsedDiscount = Number.parseFloat(discount) || 0;
    const parsedGst = Number.parseFloat(gstRate) || 0;

    const totals = computeBillingTotals(parsedAmount, parsedGst, parsedDiscount);

    const academyPrefix = academyName.substring(0, 3).toUpperCase();
    const sequenceNumber = (invoiceCount + 1).toString().padStart(2, '0');
    const invoiceNumber = `INC${academyPrefix}${sequenceNumber}`;

    return {
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      taxableAmount: totals.taxableAmount,
      taxAmount: totals.taxTotal,
      total: totals.totalAmount,
      invoiceNumber,
    };
  }, [academyName, amount, discount, gstRate, invoiceCount]);
}
