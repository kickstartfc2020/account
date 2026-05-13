import React from 'react';

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
    const subtotal = parseFloat(amount) || 0;
    const discountAmount = parseFloat(discount) || 0;
    const taxableAmount = Math.max(0, subtotal - discountAmount);
    const currentTaxRate = parseInt(gstRate, 10) / 100;
    const taxAmount = taxableAmount * currentTaxRate;
    const total = taxableAmount + taxAmount;

    const academyPrefix = academyName.substring(0, 3).toUpperCase();
    const sequenceNumber = (invoiceCount + 1).toString().padStart(2, '0');
    const invoiceNumber = `INC${academyPrefix}${sequenceNumber}`;

    return {
      subtotal,
      discountAmount,
      taxableAmount,
      taxAmount,
      total,
      invoiceNumber,
    };
  }, [academyName, amount, discount, gstRate, invoiceCount]);
}
