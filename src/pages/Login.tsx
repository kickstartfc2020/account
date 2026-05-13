import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';

export default function Login() {
  const navigate = useNavigate();
  const { user, role, isConfigured, loading } = useAuth();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!isConfigured) return <Navigate to="/" replace />;

  if (!loading && user) {
    return <Navigate to={role === 'super_admin' ? '/super-admin' : '/'} replace />;
  }

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setSubmitting(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50 px-6">
      <Card className="w-full max-w-md py-0 overflow-hidden">
        <CardHeader className="px-8 py-8 border-b bg-white">
          <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white flex items-center justify-center mb-4">
            <KeyRound className="w-5 h-5" />
          </div>
          <CardTitle className="text-2xl font-display font-bold text-gray-900">Sign in</CardTitle>
          <CardDescription className="text-slate-500">
            Enter your account credentials to continue.
          </CardDescription>
        </CardHeader>

        <CardContent className="px-8 py-8 bg-white">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Email</label>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Password</label>
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <Button type="submit" className="w-full btn-primary" disabled={submitting}>
              {submitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
