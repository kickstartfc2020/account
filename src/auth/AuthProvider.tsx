import React from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { reportOperationalError } from '@/lib/observability';

export type AppRole = 'super_admin' | 'organization_admin' | 'branch_manager';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  role: AppRole | null;
  loading: boolean;
  isConfigured: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue>({
  session: null,
  user: null,
  role: null,
  loading: false,
  isConfigured: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [role, setRole] = React.useState<AppRole | null>(null);
  const [loading, setLoading] = React.useState(true);
  const isMountedRef = React.useRef(true);
  const roleRequestSeqRef = React.useRef(0);

  const loadRole = React.useCallback(async (nextSession: Session | null) => {
    roleRequestSeqRef.current += 1;
    const requestSeq = roleRequestSeqRef.current;

    if (!supabase || !nextSession) {
      setRole(null);
      return;
    }

    let resolvedRole: AppRole | null = null;
    const { data, error } = await supabase.rpc('current_role');
    if (error) {
      reportOperationalError('auth.role', 'Failed to resolve role via RPC.', error, {
        userId: nextSession.user?.id ?? null,
      });
    }
    resolvedRole = (data ?? null) as AppRole | null;

    if ((!resolvedRole || error) && nextSession.user?.id) {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', nextSession.user.id)
        .maybeSingle();

      resolvedRole = ((profileRow as { role?: AppRole } | null)?.role ?? null) as AppRole | null;
    }

    if (!isMountedRef.current || requestSeq !== roleRequestSeqRef.current) return;
    setRole(resolvedRole);
  }, []);

  const signOut = React.useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  React.useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let isMounted = true;
    isMountedRef.current = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) return;
      if (error) {
        reportOperationalError('auth.session', 'Failed to read active auth session.', error);
      }
      setSession(data.session);
      loadRole(data.session).finally(() => {
        if (isMounted) setLoading(false);
      });
    });

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!isMountedRef.current) return;
      setSession(nextSession);

      // INITIAL_SESSION is already handled by the getSession() call above.
      // TOKEN_REFRESHED only rotates the JWT for the same user/role — Supabase
      // fires it whenever the tab regains focus, so setting loading:true here
      // causes the entire page to unmount and show a spinner on every tab switch.
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;

      setLoading(true);
      loadRole(nextSession).finally(() => {
        if (isMountedRef.current) setLoading(false);
      });
    });

    return () => {
      isMounted = false;
      isMountedRef.current = false;
      roleRequestSeqRef.current += 1;
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        role,
        loading,
        isConfigured: isSupabaseConfigured,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return React.useContext(AuthContext);
}