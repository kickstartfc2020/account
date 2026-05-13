import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Trophy, 
  CreditCard, 
  Users, 
  RefreshCcw, 
  Receipt, 
  BarChart3, 
  Settings, 
  LogOut,
  User
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/AuthProvider';

const superAdminItems = [
  { icon: LayoutDashboard, label: 'Accounts Dashboard', path: '/super-admin' },
  { icon: Users, label: 'User Management', path: '/super-admin/users' },
  { icon: Building2, label: 'Club Details', path: '/super-admin/club' },
];

const branchAdminItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
  { icon: Trophy, label: 'Sports', path: '/sports' },
  { icon: CreditCard, label: 'Packages', path: '/packages' },
  { icon: Users, label: 'Students', path: '/students' },
  { icon: RefreshCcw, label: 'Renewals', path: '/renewals' },
  { icon: Receipt, label: 'Invoices', path: '/invoices' },
  { icon: BarChart3, label: 'Reports', path: '/reports' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

import { Building2 } from 'lucide-react';

export function Sidebar() {
  const { role, signOut } = useAuth();
  const location = useLocation();
  const isSuperAdmin = role === 'super_admin';
  const navItems = isSuperAdmin ? superAdminItems : branchAdminItems;
  const roleLabel = isSuperAdmin ? 'super admin' : 'branch admin';

  return (
    <div className="w-64 h-screen border-r bg-white flex flex-col sticky top-0 shrink-0">
      <div className="p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold text-xl">
            K
          </div>
          <div>
            <span className="font-display font-bold text-lg tracking-tight block leading-tight text-gray-900">Kickstart</span>
            <span className="text-[10px] uppercase font-bold text-indigo-600 tracking-widest">
              {roleLabel}
            </span>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-6 py-3 text-sm font-medium transition-all group rounded-lg",
                isActive 
                  ? "sidebar-item-active" 
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )
            }
          >
            <item.icon className={cn("w-5 h-5 transition-opacity", "opacity-60 group-hover:opacity-100")} />
            <span className="whitespace-nowrap">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t space-y-2">
        <Button variant="ghost" className="w-full justify-start gap-3 text-slate-500 font-medium">
          <User className="w-5 h-5" />
          Profile
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-red-500 hover:text-red-600 hover:bg-red-50 font-medium"
          onClick={() => void signOut()}
        >
          <LogOut className="w-5 h-5" />
          Logout
        </Button>
      </div>
    </div>
  );
}
