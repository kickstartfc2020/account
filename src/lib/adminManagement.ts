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

  function isRlsError(error: unknown) {
    return error instanceof Error && /row-level security|permission denied|violates row-level security/i.test(error.message);
  }

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Failed to read logo file.'));
      reader.readAsDataURL(file);
    });
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
  const normalizedName = input.name.trim();
  const branchesTable = supabase.from('branches') as any;

  const { data, error } = await branchesTable
    .insert({
      organization_id: organizationId,
      name: normalizedName,
      address: input.address ?? '',
      phone: input.phone ?? '',
      email: input.email ?? '',
      status: 'active',
    })
    .select('*')
    .single();

  // If a prior attempt already created this branch name, reuse it instead of failing.
  if (error?.code === '23505') {
    const { data: existingBranch, error: lookupError } = await branchesTable
      .select('*')
      .eq('organization_id', organizationId)
      .eq('name', normalizedName)
      .maybeSingle();

    if (!lookupError && existingBranch) {
      if (existingBranch.status !== 'active' || existingBranch.archived_at) {
        const { data: reactivatedBranch, error: reactivateError } = await branchesTable
          .update({ status: 'active', archived_at: null })
          .eq('id', existingBranch.id)
          .select('*')
          .single();

        if (!reactivateError && reactivatedBranch) {
          return reactivatedBranch as { id: string; name: string; image?: string | null };
        }
      }

      return existingBranch as { id: string; name: string; image?: string | null };
    }
  }

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

    // Fallback: some deployments may block Edge Function preflight. Try secure SQL RPC path.
    const { data: rpcUserId, error: rpcError } = await (supabase as any).rpc('admin_create_branch_manager', {
      p_email: input.email.trim(),
      p_password: input.password,
      p_full_name: input.fullName ?? null,
      p_branch_id: input.branchId,
    });

    if (!rpcError && rpcUserId) {
      return { userId: String(rpcUserId) };
    }

    if (rpcError?.code === '42883') {
      throw new Error(`${message} (Edge function unavailable and SQL fallback is not deployed.)`);
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

  let logoUrl: string;

  const { error: uploadError } = await supabase.storage
    .from('branch-images')
    .upload(path, file, { upsert: false });

  if (uploadError) {
    if (!isRlsError(uploadError)) {
      throw uploadError;
    }

    logoUrl = await fileToDataUrl(file);
  } else {
    const { data } = supabase.storage.from('branch-images').getPublicUrl(path);
    logoUrl = data.publicUrl;
  }

  const organizationsTable = supabase.from('organizations') as any;
  const { error: updateError } = await organizationsTable
    .update({ logo_url: logoUrl })
    .eq('id', organizationId);

  if (updateError) {
    throw updateError;
  }

  return logoUrl;
}
