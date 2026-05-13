import { Navigate, Outlet } from 'react-router-dom';
import { useAuth, type AppRole } from '@/auth/AuthProvider';

type ProtectedRouteProps = {
  allowedRoles?: AppRole[];
};

export default function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { user, role, loading, isConfigured } = useAuth();

  if (!isConfigured) return <Outlet />;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-slate-500">Loading...</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (allowedRoles && (!role || !allowedRoles.includes(role))) {
    return <Navigate to={role === 'super_admin' ? '/super-admin' : '/'} replace />;
  }

  return <Outlet />;
}
