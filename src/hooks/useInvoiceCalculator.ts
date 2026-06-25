import React from 'react';
import { computeBillingTotals, computeInclusiveBillingTotals } from '@/lib/billingMath';

type UseInvoiceCalculatorInput = {
  amount: string;
  discount: string;
  gstRate: string;
  academyCode: string;
  invoiceCount: number;
  isGstInclusive?: boolean;
};

export function useInvoiceCalculator({
  amount,
  discount,
  gstRate,
  academyCode,
  invoiceCount,
  isGstInclusive = false,
}: UseInvoiceCalculatorInput) {
  return React.useMemo(() => {
    const parsedAmount = Number.parseFloat(amount) || 0;
    const parsedDiscount = Number.parseFloat(discount) || 0;
    const parsedGst = Number.parseFloat(gstRate) || 0;

    const totals = isGstInclusive
      ? computeInclusiveBillingTotals(parsedAmount, parsedGst, parsedDiscount)
      : computeBillingTotals(parsedAmount, parsedGst, parsedDiscount);

    const sequenceNumber = (invoiceCount + 1).toString().padStart(3, '0');
    const compactCode = (academyCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const orgCodeTwo = (compactCode.slice(0, 2) || 'XX').padEnd(2, 'X');
    const invoiceNumber = `INC-${orgCodeTwo}-${sequenceNumber}`;

    return {
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      taxableAmount: totals.taxableAmount,
      taxAmount: totals.taxTotal,
      total: totals.totalAmount,
      invoiceNumber,
      isGstInclusive,
    };
  }, [academyCode, amount, discount, gstRate, invoiceCount, isGstInclusive]);
}
