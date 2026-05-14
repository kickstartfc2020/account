/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/auth/AuthProvider';

const Login = React.lazy(() => import('@/pages/Login'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Locations = React.lazy(() => import('./pages/Locations'));
const Sports = React.lazy(() => import('./pages/Sports'));
const Packages = React.lazy(() => import('./pages/Packages'));
const Students = React.lazy(() => import('./pages/Students'));
const Renewals = React.lazy(() => import('./pages/Renewals'));
const Invoices = React.lazy(() => import('./pages/Invoices'));
const Reports = React.lazy(() => import('./pages/Reports'));
const Settings = React.lazy(() => import('./pages/Settings'));
const AccountsDashboard = React.lazy(() => import('./pages/super-admin/AccountsDashboard'));
const UserManagement = React.lazy(() => import('./pages/super-admin/UserManagement'));
const ClubDetails = React.lazy(() => import('./pages/super-admin/ClubDetails'));
const BranchDetails = React.lazy(() => import('./pages/super-admin/BranchDetails'));
const CreateInvoice = React.lazy(() => import('./pages/CreateInvoice'));
const ViewInvoice = React.lazy(() => import('./pages/ViewInvoice'));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-sm text-slate-500">Loading...</p>
    </div>
  );
}

function AppLayout() {
  const location = useLocation();
  const isGeneratedInvoiceView =
    location.pathname.startsWith('/invoices/view/') &&
    new URLSearchParams(location.search).get('generated') === '1';

  return (
    <div className="flex min-h-screen bg-gray-50">
      {!isGeneratedInvoiceView && <Sidebar />}
      <div className="flex-1 flex flex-col min-w-0">
        {!isGeneratedInvoiceView && <Header />}
        <main className={isGeneratedInvoiceView ? 'flex-1 overflow-y-auto p-0' : 'flex-1 overflow-y-auto px-8 py-8'}>
          <Routes>
            <Route element={<ProtectedRoute allowedRoles={['organization_admin', 'branch_manager']} />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/locations" element={<Locations />} />
              <Route path="/sports" element={<Sports />} />
              <Route path="/packages" element={<Packages />} />
              <Route path="/students" element={<Students />} />
              <Route path="/renewals" element={<Renewals />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/invoices/create" element={<CreateInvoice />} />
              <Route path="/invoices/view/:id" element={<ViewInvoice />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<Settings />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['super_admin']} />}>
              <Route path="/super-admin" element={<AccountsDashboard />} />
              <Route path="/super-admin/users" element={<UserManagement />} />
              <Route path="/super-admin/club" element={<ClubDetails />} />
              <Route path="/super-admin/branch/:id" element={<BranchDetails />} />
            </Route>

            <Route path="*" element={<RoleHomeRedirect />} />
          </Routes>
        </main>
      </div>
      <Toaster position="top-right" closeButton richColors />
    </div>
  );
}

function RoleHomeRedirect() {
  const { role } = useAuth();
  return <Navigate to={role === 'super_admin' ? '/super-admin' : '/'} replace />;
}

export default function App() {
  return (
    <TooltipProvider>
      <Router>
        <React.Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route path="*" element={<AppLayout />} />
            </Route>
          </Routes>
        </React.Suspense>
      </Router>
    </TooltipProvider>
  );
}
