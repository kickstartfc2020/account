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
import Login from '@/pages/Login';
import { useAuth } from '@/auth/AuthProvider';

// Lazy load pages
import Dashboard from './pages/Dashboard';
import Locations from './pages/Locations';
import Sports from './pages/Sports';
import Packages from './pages/Packages';
import Students from './pages/Students';
import Renewals from './pages/Renewals';
import Invoices from './pages/Invoices';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import AccountsDashboard from './pages/super-admin/AccountsDashboard';
import UserManagement from './pages/super-admin/UserManagement';
import ClubDetails from './pages/super-admin/ClubDetails';
import BranchDetails from './pages/super-admin/BranchDetails';
import CreateInvoice from './pages/CreateInvoice';
import ViewInvoice from './pages/ViewInvoice';

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
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route path="*" element={<AppLayout />} />
          </Route>
        </Routes>
      </Router>
    </TooltipProvider>
  );
}
