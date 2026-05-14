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
  gstNumber?: string;
  panNumber?: string;
  phone?: string;
  email?: string;
  address?: string;
};

type ProfileContext = {
  role: string | null;
  organizationId: string | null;
  branchId: string | null;
};

async function resolveProfileContext(): Promise<ProfileContext> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    return { role: null, organizationId: null, branchId: null };
  }

  const profilesTable = supabase.from('profiles') as any;
  const { data: profileRow } = await profilesTable
    .select('role, organization_id, branch_id')
    .eq('id', user.id)
    .maybeSingle();

  const profile = (profileRow ?? null) as {
    role?: string | null;
    organization_id?: string | null;
    branch_id?: string | null;
  } | null;

  return {
    role: profile?.role ?? null,
    organizationId: profile?.organization_id ?? null,
    branchId: profile?.branch_id ?? null,
  };
}

async function resolveOrganizationId() {
  if (!supabase) throw new Error('Supabase is not configured.');

  try {
    const { data } = await supabase.rpc('current_organization_id');
    if (data) return data as string;
  } catch {
    // Fallback query below.
  }

  const { role: profileRole, organizationId: profileOrganizationId, branchId: profileBranchId } = await resolveProfileContext();
  if (profileOrganizationId) {
    return profileOrganizationId;
  }

  if (profileBranchId) {
    const branchesTable = supabase.from('branches') as any;
    const { data: branchRow } = await branchesTable
      .select('organization_id')
      .eq('id', profileBranchId)
      .maybeSingle();

    const branchOrgId = ((branchRow as { organization_id?: string | null } | null)?.organization_id ?? null) as string | null;
    if (branchOrgId) {
      return branchOrgId;
    }
  }

  const organizationsTable = supabase.from('organizations') as any;
  const { data, error } = await organizationsTable
    .select('id')
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data?.id) {
    return data.id as string;
  }

  let currentRole: string | null = profileRole;
  if (!currentRole) {
    const { data: roleData } = await supabase.rpc('current_role');
    currentRole = (roleData ?? null) as string | null;
  }

  if (currentRole === 'super_admin') {
    const defaultCode = `ORG-${Date.now().toString(36).toUpperCase()}`;
    const { data: createdOrg, error: createOrgError } = await organizationsTable
      .insert({
        name: 'Kickstart Accounts',
        code: defaultCode,
        status: 'active',
      })
      .select('id')
      .single();

    if (createOrgError || !createdOrg?.id) {
      throw createOrgError ?? new Error('Unable to initialize organization context.');
    }

    return createdOrg.id as string;
  }

  throw new Error('Unable to resolve organization context.');
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

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('You must be signed in to create a branch manager.');
  }

  const { data, error } = await supabase.functions.invoke('admin-create-branch-manager', {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
    body: {
      email: input.email.trim(),
      password: input.password,
      fullName: input.fullName ?? null,
      branchId: input.branchId,
    },
  });

  if (error) {
    let message = error.message || 'Unable to create branch manager account.';

    const maybeContext = (error as { context?: { json?: () => Promise<unknown> } }).context;
    if (maybeContext?.json) {
      try {
        const payload = (await maybeContext.json()) as { message?: unknown };
        if (payload?.message) {
          message = String(payload.message);
        }
      } catch {
        // Fall back to the default error message when the payload is not JSON.
      }
    }

    throw new Error(message);
  }

  if (!data?.userId) {
    throw new Error('Unable to create branch manager account.');
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
    .upload(path, file, { upsert: false });

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
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return data as {
    id: string;
    name: string;
    code: string;
    logo_url: string | null;
    gst_number: string | null;
    pan_number: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
  };
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
      gst_number: input.gstNumber === undefined ? undefined : input.gstNumber || null,
      pan_number: input.panNumber === undefined ? undefined : input.panNumber || null,
      phone: input.phone === undefined ? undefined : input.phone || null,
      email: input.email === undefined ? undefined : input.email || null,
      address: input.address === undefined ? undefined : input.address || null,
    })
    .eq('id', organizationId);

  if (error) throw error;
}

export async function uploadOrganizationLogo(file: File) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const organizationId = await resolveOrganizationId();
  const dotIndex = file.name.lastIndexOf('.');
  const extension = dotIndex > -1 ? file.name.slice(dotIndex + 1).toLowerCase() : 'jpg';
  const path = `organization/${organizationId}/logo-${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from('branch-images')
    .upload(path, file, { upsert: false });

  if (uploadError) {
    throw uploadError;
  }

  const { data } = supabase.storage.from('branch-images').getPublicUrl(path);
  const logoUrl = data.publicUrl;

  const organizationsTable = supabase.from('organizations') as any;
  const { error: updateError } = await organizationsTable
    .update({ logo_url: logoUrl })
    .eq('id', organizationId);

  if (updateError) {
    throw updateError;
  }

  return logoUrl;
}
