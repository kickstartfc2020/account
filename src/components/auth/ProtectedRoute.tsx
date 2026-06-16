import { Navigate, Outlet } from 'react-router-dom';
import { useAuth, type AppRole } from '@/auth/AuthProvider';

type ProtectedRouteProps = {
  allowedRoles?: AppRole[];
};

export default function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { user, role, loading, isConfigured, signOut } = useAuth();

  if (!isConfigured) return <Outlet />;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-slate-500">Loading...</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (allowedRoles && role === null) {
    // Role resolution finished but came back empty. This can mean the
    // account genuinely has no profile (e.g. it was deleted), or it can
    // mean a transient network/RPC failure -- those look identical from
    // here, so don't silently force a sign-out (that caused a login/kick
    // loop on flaky connections). Give the user a way to retry or leave
    // instead of trapping them on an unrecoverable spinner.
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
        <div className="text-center space-y-4 max-w-sm">
          <p className="text-sm text-slate-600">
            We couldn't confirm your account access. This can happen after a network hiccup, or if your account no
            longer exists.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Retry
            </button>
            <button
              onClick={() => void signOut()}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              Log out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (allowedRoles && role && !allowedRoles.includes(role)) {
    return <Navigate to={role === 'super_admin' ? '/super-admin' : '/'} replace />;
  }

  return <Outlet />;
}
