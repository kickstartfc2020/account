import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const missingClientEnv: string[] = [];
if (!supabaseUrl) missingClientEnv.push('VITE_SUPABASE_URL');
if (!supabaseAnonKey) missingClientEnv.push('VITE_SUPABASE_ANON_KEY');

if (import.meta.env.PROD && missingClientEnv.length > 0) {
  throw new Error(
    `Missing required client environment variables: ${missingClientEnv.join(', ')}.`
  );
}

if (supabaseAnonKey?.toLowerCase().includes('service_role')) {
  throw new Error('Invalid VITE_SUPABASE_ANON_KEY detected. Service role keys must never be exposed to client code.');
}

if (import.meta.env.PROD && supabaseUrl?.includes('localhost')) {
  throw new Error('Invalid VITE_SUPABASE_URL for production. Localhost URLs are not allowed in production builds.');
}

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl!, supabaseAnonKey!)
  : null;