import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type RecordStatus = 'active' | 'inactive' | 'archived';

function notifyStudentsChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('app:students:changed'));
  try {
    window.localStorage.setItem('app:students:changed', String(Date.now()));
  } catch {
    // Ignore storage errors (private mode / disabled storage) because
    // same-tab event dispatch above is still sufficient.
  }
}

async function resolveOrganizationId() {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase.rpc('current_organization_id');
  if (error || !data) {
    throw error ?? new Error('Unable to resolve organization context.');
  }

  return data as string;
}

async function resolveRole() {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase.rpc('current_role');
  if (error || !data) {
    throw error ?? new Error('Unable to resolve role context.');
  }

  return data as 'super_admin' | 'organization_admin' | 'branch_manager';
}

async function resolveBranchId(preferredBranchId?: string | null) {
  if (!supabase) throw new Error('Supabase is not configured.');

  if (preferredBranchId) return preferredBranchId;

  const { data, error } = await supabase.rpc('current_branch_id');
  if (error || !data) {
    throw error ?? new Error('Unable to resolve branch context.');
  }

  return data as string;
}

export async function createSport(input: { name: string }) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');

  const organizationId = await resolveOrganizationId();
  const role = await resolveRole();
  const branchId = role === 'branch_manager' ? await resolveBranchId() : null;
  const sportsTable = supabase.from('sports') as any;
  const { data, error } = await sportsTable
    .insert({
      organization_id: organizationId,
      branch_id: branchId,
      name: input.name.trim(),
      status: 'active',
    })
    .select('*')
    .single();

  if (error || !data) throw error ?? new Error('Failed to create sport.');
  return data as { id: string; name: string; status: RecordStatus };
}

export async function updateSportStatus(sportId: string, status: Exclude<RecordStatus, 'archived'>) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');

  const organizationId = await resolveOrganizationId();
  const sportsTable = supabase.from('sports') as any;
  const { error } = await sportsTable.update({ status }).eq('id', sportId).eq('organization_id', organizationId);
  if (error) throw error;
}

export async function createPackage(input: {
  sportId: string;
  name: string;
  billingType: 'one-time' | 'recurring';
  durationMonths: number;
  amount: number;
  gstPercent: number;
}) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');

  const organizationId = await resolveOrganizationId();
  const role = await resolveRole();
  const branchId = role === 'branch_manager' ? await resolveBranchId() : null;
  const billingType = input.billingType === 'recurring' ? 'recurring_monthly' : 'one_time';
  const packagesTable = supabase.from('packages') as any;
  const { data, error } = await packagesTable
    .insert({
      organization_id: organizationId,
      branch_id: branchId,
      sport_id: input.sportId,
      name: input.name.trim(),
      billing_type: billingType,
      duration_months: input.durationMonths,
      amount: input.amount,
      gst_percent: input.gstPercent,
      status: 'active',
    })
    .select('*')
    .single();

  if (error || !data) throw error ?? new Error('Failed to create package.');
  return data as { id: string };
}

export async function updatePackage(input: {
  id: string;
  sportId: string;
  name: string;
  billingType: 'one-time' | 'recurring';
  durationMonths: number;
  amount: number;
  gstPercent: number;
  status: Exclude<RecordStatus, 'archived'>;
}) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');

  const organizationId = await resolveOrganizationId();
  const billingType = input.billingType === 'recurring' ? 'recurring_monthly' : 'one_time';
  const packagesTable = supabase.from('packages') as any;
  const { error } = await packagesTable
    .update({
      sport_id: input.sportId,
      name: input.name.trim(),
      billing_type: billingType,
      duration_months: input.durationMonths,
      amount: input.amount,
      gst_percent: input.gstPercent,
      status: input.status,
    })
    .eq('id', input.id)
    .eq('organization_id', organizationId);

  if (error) throw error;
}

export async function archivePackage(packageId: string) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');

  const organizationId = await resolveOrganizationId();
  const packagesTable = supabase.from('packages') as any;
  const { error } = await packagesTable
    .update({ status: 'archived', archived_at: new Date().toISOString() })
    .eq('id', packageId)
    .eq('organization_id', organizationId);

  if (error) throw error;
}

export async function createStudent(input: {
  name: string;
  phone?: string;
  email: string;
  sportId: string;
  packageId: string;
  branchId?: string | null;
  enrolledPrice?: number;
  enrolledTaxPercent?: number;
}) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');

  const organizationId = await resolveOrganizationId();
  const role = await resolveRole();
  const branchId =
    role === 'branch_manager'
      ? await resolveBranchId()
      : await resolveBranchId(input.branchId ?? null);

  const studentsTable = supabase.from('students') as any;
  const { data, error } = await studentsTable
    .insert({
      organization_id: organizationId,
      branch_id: branchId,
      current_package_id: input.packageId,
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      email: input.email.trim() || null,
      status: 'active',
    })
    .select('*')
    .single();

  if (error || !data) throw error ?? new Error('Failed to create student.');

  const created = data as { id: string; branch_id: string; ref_id: string | null };

  // Best-effort: store enrolled price. Silently ignored if the migration hasn't run yet.
  if (input.enrolledPrice != null) {
    await studentsTable
      .update({
        enrolled_price: input.enrolledPrice,
        enrolled_tax_percent: input.enrolledTaxPercent ?? 0,
      })
      .eq('id', created.id)
      .then(() => {/* ignore */});
  }

  notifyStudentsChanged();
  return created;
}

export async function updateStudent(input: {
  id: string;
  name: string;
  phone?: string;
  email: string;
  packageId: string;
}) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');

  const organizationId = await resolveOrganizationId();
  const studentsTable = supabase.from('students') as any;
  const { error } = await studentsTable
    .update({
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      email: input.email.trim() || null,
      current_package_id: input.packageId,
    })
    .eq('id', input.id)
    .eq('organization_id', organizationId);

  if (error) throw error;
  notifyStudentsChanged();
}

export async function updateStudentPreviousReceivedAmount(studentId: string, previousReceivedAmount: number) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');

  const organizationId = await resolveOrganizationId();
  const studentsTable = supabase.from('students') as any;
  const { error } = await studentsTable
    .update({ previous_received_amount: Math.max(0, previousReceivedAmount) })
    .eq('id', studentId)
    .eq('organization_id', organizationId);

  if (error) throw error;
  notifyStudentsChanged();
}

export async function addStudentEnrollment(input: {
  studentId: string;
  packageId: string;
  branchId?: string | null;
  startDate?: string;
  enrolledPrice?: number;
  enrolledTaxPercent?: number;
}) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');

  const rpcStartDate = input.startDate ?? new Date().toISOString().slice(0, 10);
  const { data, error } = await (supabase as any).rpc('add_student_enrollment_atomic', {
    p_student_id: input.studentId,
    p_package_id: input.packageId,
    p_branch_id: input.branchId ?? null,
    p_start_date: rpcStartDate,
  });

  if (error) throw error;

  // Snapshot the enrolled price for the new package on the student record.
  if (input.enrolledPrice != null) {
    const studentsTable = supabase.from('students') as any;
    await studentsTable
      .update({
        enrolled_price: input.enrolledPrice,
        enrolled_tax_percent: input.enrolledTaxPercent ?? 0,
      })
      .eq('id', input.studentId);
  }

  const row = Array.isArray(data) ? data[0] : data;

  notifyStudentsChanged();
  return {
    packageId: ((row as { package_id?: string } | null)?.package_id ?? input.packageId),
  };
}

export async function archiveStudent(studentId: string) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');

  const organizationId = await resolveOrganizationId();
  const studentsTable = supabase.from('students') as any;
  const { error } = await studentsTable
    .update({ status: 'archived', archived_at: new Date().toISOString() })
    .eq('id', studentId)
    .eq('organization_id', organizationId);

  if (error) throw error;
  notifyStudentsChanged();
}

export async function rescheduleReminder(reminderId: string, remindAt: string) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');

  const { error } = await (supabase as any).rpc('reschedule_invoice_reminder', {
    p_reminder_id: reminderId,
    p_remind_at: remindAt,
  });

  if (error) throw error;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('app:invoices:changed'));
    try {
      window.localStorage.setItem('app:invoices:changed', String(Date.now()));
    } catch {
      // Ignore storage errors (private mode / disabled storage) because
      // same-tab event dispatch above is still sufficient.
    }
  }
}

export async function deleteStudent(studentId: string) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await (supabase as any).rpc('delete_student_safe', {
    p_student_id: studentId,
  });

  if (error) throw new Error(error.message || 'Failed to delete student.');
  if (!data) throw new Error('Student could not be deleted.');
  notifyStudentsChanged();
}
