import { supabase, isSupabaseConfigured } from '@/lib/supabase';

type PaymentMethod = 'cash' | 'card' | 'upi' | 'online' | 'bank_transfer';

type FinalizeInvoiceInput = {
  studentId: string;
  packageId: string;
  sportId: string;
  packageName: string;
  sportName: string;
  subtotal: number;
  discountTotal: number;
  taxableAmount: number;
  taxTotal: number;
  totalAmount: number;
  gstPercent: number;
  paymentMethod: PaymentMethod;
  paymentModeLabel: string;
  preferredBranchId?: string | null;
  invoiceDate?: string;
};

async function resolveTenantContext(studentId: string, preferredBranchId?: string | null) {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const studentsTable = supabase.from('students') as any;
  const { data: student, error: studentError } = await studentsTable
    .select('organization_id, branch_id')
    .eq('id', studentId)
    .single();

  if (studentError || !student) {
    throw studentError ?? new Error('Unable to resolve student context.');
  }

  const { data: organizationId, error: organizationError } = await supabase.rpc('current_organization_id');
  if (organizationError) {
    throw organizationError;
  }

  const { data: branchIdFromRpc, error: branchError } = await supabase.rpc('current_branch_id');
  if (branchError) {
    throw branchError;
  }

  const resolvedOrganizationId = (organizationId as string | null) ?? (student.organization_id as string | null);
  if (!resolvedOrganizationId) {
    throw new Error('Missing organization context for invoice write.');
  }

  if (organizationId && student.organization_id && organizationId !== student.organization_id) {
    throw new Error('Student does not belong to the active organization.');
  }

  const resolvedBranchId = preferredBranchId ?? (branchIdFromRpc as string | null) ?? (student.branch_id as string | null);
  if (!resolvedBranchId) {
    throw new Error('Missing branch context for invoice write.');
  }

  const branchesTable = supabase.from('branches') as any;
  const { data: branch, error: branchLookupError } = await branchesTable
    .select('id')
    .eq('id', resolvedBranchId)
    .eq('organization_id', resolvedOrganizationId)
    .single();

  if (branchLookupError || !branch) {
    throw branchLookupError ?? new Error('Branch does not belong to the active organization.');
  }

  return { organizationId: resolvedOrganizationId, branchId: resolvedBranchId };
}

export async function finalizeInvoiceWrite(input: FinalizeInvoiceInput) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { branchId } = await resolveTenantContext(
    input.studentId,
    input.preferredBranchId ?? null
  );

  const { data, error } = await (supabase as any).rpc('finalize_invoice_write', {
    p_student_id: input.studentId,
    p_package_id: input.packageId,
    p_sport_id: input.sportId,
    p_package_name: input.packageName,
    p_sport_name: input.sportName,
    p_subtotal: input.subtotal,
    p_discount_total: input.discountTotal,
    p_taxable_amount: input.taxableAmount,
    p_tax_total: input.taxTotal,
    p_total_amount: input.totalAmount,
    p_gst_percent: input.gstPercent,
    p_payment_method: input.paymentMethod,
    p_payment_mode_label: input.paymentModeLabel,
    p_preferred_branch_id: branchId,
    p_invoice_date: input.invoiceDate ?? new Date().toISOString().slice(0, 10),
  });

  if (error || !data) {
    throw error ?? new Error('Failed to create invoice.');
  }

  return {
    invoiceId: (data as any).invoice_id as string,
    invoiceNumber: (data as any).invoice_number as string,
  };
}
