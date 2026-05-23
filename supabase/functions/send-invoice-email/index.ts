// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type SendInvoiceEmailPayload = {
  toEmail?: string;
  toName?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  totalAmount?: number;
  branchName?: string;
  academyName?: string;
  paymentMode?: string;
  status?: string;
  attachmentBase64?: string;
  attachmentFileName?: string;
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json(405, { message: 'Method not allowed.' });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('INVOICE_FROM_EMAIL');
    const authHeader = req.headers.get('Authorization');

    if (!supabaseUrl || !anonKey) {
      return json(500, { message: 'Supabase environment is not configured.' });
    }

    if (!resendApiKey || !fromEmail) {
      return json(500, { message: 'Resend is not configured. Missing RESEND_API_KEY or INVOICE_FROM_EMAIL.' });
    }

    if (!authHeader) {
      return json(401, { message: 'Missing authorization header.' });
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser();

    if (userError || !user) {
      return json(401, { message: userError?.message ?? 'Unauthorized.' });
    }

    const payload = (await req.json()) as SendInvoiceEmailPayload;
    const toEmail = payload.toEmail?.trim().toLowerCase();
    const toName = payload.toName?.trim() || 'Customer';
    const invoiceNumber = payload.invoiceNumber?.trim();

    if (!toEmail || !isValidEmail(toEmail)) {
      return json(400, { message: 'A valid recipient email is required.' });
    }

    if (!invoiceNumber) {
      return json(400, { message: 'Invoice number is required.' });
    }

    const totalAmount = Number(payload.totalAmount ?? 0);
    const subject = `Invoice ${invoiceNumber} from ${payload.academyName?.trim() || 'Kickstart FC'}`;
    const amountLabel = Number.isFinite(totalAmount)
      ? `INR ${Math.round(totalAmount).toLocaleString('en-IN')}`
      : 'INR 0';

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:640px;margin:0 auto;">
        <h2 style="margin:0 0 8px 0;color:#111827;">Invoice ${invoiceNumber}</h2>
        <p style="margin:0 0 14px 0;">Hello ${toName},</p>
        <p style="margin:0 0 14px 0;">Please find your invoice attached.</p>
        <table style="border-collapse:collapse;width:100%;margin:8px 0 16px 0;">
          <tr><td style="padding:6px 0;color:#64748b;">Invoice Number</td><td style="padding:6px 0;font-weight:700;">${invoiceNumber}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Date</td><td style="padding:6px 0;">${payload.invoiceDate || '-'}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Amount</td><td style="padding:6px 0;">${amountLabel}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Status</td><td style="padding:6px 0;">${payload.status || '-'}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Payment Mode</td><td style="padding:6px 0;">${payload.paymentMode || '-'}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Branch</td><td style="padding:6px 0;">${payload.branchName || '-'}</td></tr>
        </table>
        <p style="margin:0;color:#64748b;font-size:12px;">This is an automated email from ${payload.academyName?.trim() || 'Kickstart FC'}.</p>
      </div>
    `;

    const resendBody: Record<string, unknown> = {
      from: fromEmail,
      to: [toEmail],
      subject,
      html,
    };

    if (payload.attachmentBase64 && payload.attachmentFileName) {
      resendBody.attachments = [
        {
          filename: payload.attachmentFileName,
          content: payload.attachmentBase64,
        },
      ];
    }

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resendBody),
    });

    const resendResult = await resendResponse.json();

    if (!resendResponse.ok) {
      const message =
        (typeof resendResult?.message === 'string' && resendResult.message) ||
        (typeof resendResult?.error?.message === 'string' && resendResult.error.message) ||
        'Failed to send email via Resend.';
      return json(500, { message, resend: resendResult });
    }

    return json(200, {
      message: 'Invoice email sent successfully.',
      emailId: resendResult?.id ?? null,
    });
  } catch (error) {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message ?? 'Unexpected error.')
        : 'Unexpected error.';
    return json(500, { message });
  }
});
