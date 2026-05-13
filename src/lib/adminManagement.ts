import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type BranchInsertInput = {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
};

type BranchManagerInput = {
  email: string;
  password: string;
  fullName?: string;
  branchId: string;
};

type OrganizationUpdateInput = {
  name: string;
  code: string;
};

async function resolveOrganizationId() {
  if (!supabase) throw new Error('Supabase is not configured.');

  try {
    const { data } = await supabase.rpc('current_organization_id');
    if (data) return data as string;
  } catch {
    // Fallback query below.
  }

  const organizationsTable = supabase.from('organizations') as any;
  const { data, error } = await organizationsTable
    .select('id')
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error || !data?.id) {
    throw error ?? new Error('Unable to resolve organization context.');
  }

  return data.id as string;
}

export async function createBranch(input: BranchInsertInput) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const organizationId = await resolveOrganizationId();
  const branchesTable = supabase.from('branches') as any;

  const { data, error } = await branchesTable
    .insert({
      organization_id: organizationId,
      name: input.name,
      address: input.address ?? '',
      phone: input.phone ?? '',
      email: input.email ?? '',
      status: 'active',
    })
    .select('*')
    .single();

  if (error || !data) {
    throw error ?? new Error('Failed to create branch.');
  }

  return data as { id: string; name: string; image?: string | null };
}

export async function createBranchManagerAccount(input: BranchManagerInput) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase.functions.invoke('admin-create-branch-manager', {
    body: {
      email: input.email.trim(),
      password: input.password,
      fullName: input.fullName ?? null,
      branchId: input.branchId,
    },
  });

  if (error || !data?.userId) {
    throw error ?? new Error('Unable to create branch manager account.');
  }

  const userId = String(data.userId);

  return { userId };
}

export async function uploadBranchImage(branchId: string, file: File) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const dotIndex = file.name.lastIndexOf('.');
  const extension = dotIndex > -1 ? file.name.slice(dotIndex + 1).toLowerCase() : 'jpg';
  const path = `${branchId}/${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from('branch-images')
    .upload(path, file, { upsert: true });

  if (uploadError) {
    throw uploadError;
  }

  const { data } = supabase.storage.from('branch-images').getPublicUrl(path);
  const imageUrl = data.publicUrl;

  const branchesTable = supabase.from('branches') as any;
  const { error: updateError } = await branchesTable
    .update({ image: imageUrl })
    .eq('id', branchId);

  if (updateError) {
    throw updateError;
  }

  return imageUrl;
}

export async function rollbackBranchCreation(branchId: string) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const branchesTable = supabase.from('branches') as any;
  const { error } = await branchesTable
    .update({ status: 'archived', archived_at: new Date().toISOString() })
    .eq('id', branchId);

  if (error) throw error;
}

export async function deleteAuthUser(userId: string) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { error } = await (supabase as any).rpc('admin_delete_auth_user', {
    p_user_id: userId,
  });

  if (error) throw error;
}

export async function setBranchStatus(branchId: string, status: 'active' | 'inactive') {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const branchesTable = supabase.from('branches') as any;
  const { error } = await branchesTable.update({ status }).eq('id', branchId);

  if (error) throw error;
}

export async function getOrganizationDetails() {
  if (!isSupabaseConfigured || !supabase) {
    return null;
  }

  const organizationId = await resolveOrganizationId();
  const organizationsTable = supabase.from('organizations') as any;
  const { data, error } = await organizationsTable
    .select('*')
    .eq('id', organizationId)
    .single();

  if (error || !data) {
    throw error ?? new Error('Failed to load organization.');
  }

  return data as { id: string; name: string; code: string };
}

export async function updateOrganizationDetails(input: OrganizationUpdateInput) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const organizationId = await resolveOrganizationId();
  const organizationsTable = supabase.from('organizations') as any;

  const { error } = await organizationsTable
    .update({
      name: input.name,
      code: input.code,
    })
    .eq('id', organizationId);

  if (error) throw error;
}
