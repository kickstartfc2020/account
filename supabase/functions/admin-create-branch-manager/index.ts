// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type CreateManagerPayload = {
  email?: string;
  password?: string;
  fullName?: string | null;
  branchId?: string;
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
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authHeader = req.headers.get('Authorization');

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json(500, { message: 'Supabase environment is not configured.' });
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

    const { data: role, error: roleError } = await callerClient.rpc('current_role');
    if (roleError) {
      return json(403, { message: roleError.message });
    }
    if (role !== 'super_admin') {
      return json(403, { message: 'Only super admins can create branch managers.' });
    }

    const payload = (await req.json()) as CreateManagerPayload;
    const email = payload.email?.trim().toLowerCase();
    const password = payload.password ?? '';
    const fullName = (payload.fullName ?? '').toString().trim();
    const branchId = payload.branchId?.trim();

    if (!email) {
      return json(400, { message: 'Email is required.' });
    }
    if (password.length < 6) {
      return json(400, { message: 'Password must be at least 6 characters.' });
    }
    if (!branchId) {
      return json(400, { message: 'Branch id is required.' });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: branch, error: branchError } = await adminClient
      .from('branches')
      .select('id, organization_id')
      .eq('id', branchId)
      .single();

    if (branchError || !branch) {
      return json(400, { message: branchError?.message ?? 'Branch not found.' });
    }

    const { data: createUserData, error: createUserError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : {},
    });

    if (createUserError || !createUserData.user?.id) {
      return json(400, { message: createUserError?.message ?? 'Unable to create auth user.' });
    }

    const userId = createUserData.user.id;

    const { error: profileError } = await adminClient.from('profiles').insert({
      id: userId,
      organization_id: branch.organization_id,
      branch_id: branch.id,
      role: 'branch_manager',
      full_name: fullName || null,
      status: 'active',
      email,
    });

    if (profileError) {
      await adminClient.auth.admin.deleteUser(userId);
      return json(400, { message: profileError.message });
    }

    return json(200, { userId });
  } catch (error) {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message ?? 'Unexpected error.')
        : 'Unexpected error.';
    return json(500, { message });
  }
});
