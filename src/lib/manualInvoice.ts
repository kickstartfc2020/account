export type ManualInvoiceBillTo = {
  name: string;
  email: string;
  phone?: string;
  gst?: string;
  pan?: string;
};

type ManualInvoiceNotesPayload = {
  kind: 'manual_invoice_v1';
  billTo: ManualInvoiceBillTo;
};

export function serializeManualInvoiceNotes(billTo: ManualInvoiceBillTo): string {
  const payload: ManualInvoiceNotesPayload = {
    kind: 'manual_invoice_v1',
    billTo,
  };
  return JSON.stringify(payload);
}

export function parseManualInvoiceNotes(notes: unknown): ManualInvoiceBillTo | null {
  if (!notes) return null;

  try {
    const parsed =
      typeof notes === 'string'
        ? (JSON.parse(notes) as Partial<ManualInvoiceNotesPayload>)
        : (notes as Partial<ManualInvoiceNotesPayload>);
    if (parsed.kind !== 'manual_invoice_v1' || !parsed.billTo) {
      return null;
    }

    const name = (parsed.billTo.name ?? '').trim();
    const email = (parsed.billTo.email ?? '').trim();
    const phone = (parsed.billTo.phone ?? '').trim();
    const gst = (parsed.billTo.gst ?? '').trim();
    const pan = (parsed.billTo.pan ?? '').trim();

    if (!name || !email) {
      return null;
    }

    return {
      name,
      email,
      phone: phone || undefined,
      gst,
      pan,
    };
  } catch {
    return null;
  }
}
