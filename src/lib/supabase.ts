import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const appUrl = import.meta.env.VITE_APP_URL as string | undefined;
const clientLogEndpoint = import.meta.env.VITE_CLIENT_LOG_ENDPOINT as string | undefined;

const missingClientEnv: string[] = [];
if (!supabaseUrl) missingClientEnv.push('VITE_SUPABASE_URL');
if (!supabaseAnonKey) missingClientEnv.push('VITE_SUPABASE_ANON_KEY');

let configurationError: string | null = null;

if (import.meta.env.PROD && missingClientEnv.length > 0) {
  configurationError = `Missing required client environment variables: ${missingClientEnv.join(', ')}.`;
}

if (!configurationError && supabaseAnonKey?.toLowerCase().includes('service_role')) {
  configurationError = 'Invalid VITE_SUPABASE_ANON_KEY detected. Service role keys must never be exposed to client code.';
}

if (!configurationError && import.meta.env.PROD && supabaseUrl?.includes('localhost')) {
  configurationError = 'Invalid VITE_SUPABASE_URL for production. Localhost URLs are not allowed in production builds.';
}

if (configurationError) {
  console.error(`[supabase-config] ${configurationError}`);
}

function extractHost(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

export const supabaseConfigurationError = configurationError;
export const isSupabaseConfigured = Boolean(!supabaseConfigurationError && supabaseUrl && supabaseAnonKey);

export const clientConfigurationHealth = {
  environment: import.meta.env.PROD ? 'production' : 'development',
  supabaseUrlConfigured: Boolean(supabaseUrl),
  supabaseUrlHost: extractHost(supabaseUrl),
  supabaseAnonKeyConfigured: Boolean(supabaseAnonKey),
  appUrlConfigured: Boolean(appUrl),
  appUrlHost: extractHost(appUrl),
  clientLogEndpointConfigured: Boolean(clientLogEndpoint),
  clientLogEndpointHost: extractHost(clientLogEndpoint),
  missingRequiredVariables: missingClientEnv,
  configurationError: supabaseConfigurationError,
};

export const supabase = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl!, supabaseAnonKey!)
  : null;