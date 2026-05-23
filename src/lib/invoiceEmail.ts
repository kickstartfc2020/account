import { supabase, isSupabaseConfigured } from '@/lib/supabase';

type SendInvoiceEmailInput = {
  toEmail: string;
  toName?: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number;
  branchName?: string;
  academyName?: string;
  paymentMode?: string;
  status?: string;
  attachmentBlob?: Blob;
  attachmentFileName?: string;
};

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function sendInvoiceEmail(input: SendInvoiceEmailInput) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const payload: Record<string, unknown> = {
    toEmail: input.toEmail,
    toName: input.toName,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    totalAmount: input.totalAmount,
    branchName: input.branchName,
    academyName: input.academyName,
    paymentMode: input.paymentMode,
    status: input.status,
  };

  if (input.attachmentBlob && input.attachmentFileName) {
    payload.attachmentBase64 = await blobToBase64(input.attachmentBlob);
    payload.attachmentFileName = input.attachmentFileName;
  }

  const { data, error } = await supabase.functions.invoke('send-invoice-email', {
    body: payload,
  });

  if (error) {
    throw new Error(error.message || 'Failed to trigger invoice email.');
  }

  const response = (data ?? {}) as { message?: string };
  if (response.message && response.message.toLowerCase().includes('failed')) {
    throw new Error(response.message);
  }

  return response;
}
