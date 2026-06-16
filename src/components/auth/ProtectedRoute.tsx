import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth, type AppRole } from '@/auth/AuthProvider';

type ProtectedRouteProps = {
  allowedRoles?: AppRole[];
};

export default function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { user, role, loading, isConfigured, signOut } = useAuth();

  React.useEffect(() => {
    // loading is false means role resolution has already finished -- if
    // role is still null here, there is genuinely no profile for this
    // session (e.g. the account was deleted while the browser still held
    // a valid token), not "still loading". Sign out instead of trapping
    // the user on a spinner with no way out.
    if (!loading && allowedRoles && user && role === null) {
      void signOut();
    }
  }, [loading, allowedRoles, user, role, signOut]);

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
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && role && !allowedRoles.includes(role)) {
    return <Navigate to={role === 'super_admin' ? '/super-admin' : '/'} replace />;
  }

  return <Outlet />;
}
