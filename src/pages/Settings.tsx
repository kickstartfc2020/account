import React from 'react';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Building2, 
  User, 
  Bell, 
  ShieldCheck, 
  CreditCard,
  Image as ImageIcon,
  Plus
} from 'lucide-react';
import { useLocations, usePackages } from '@/hooks/useData';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { getOrganizationDetails } from '@/lib/adminManagement';

export default function Settings() {
  const [activeTab, setActiveTab] = React.useState('Organization');
  const { data: packages = [] } = usePackages();
  const { data: locations = [] } = useLocations();
  const [organization, setOrganization] = React.useState({
    name: 'Kickstart Sports Academy',
    code: 'KA/MYS/2024/0942',
    gstNumber: 'Not available',
    phone: 'Not available',
    address: 'Not available',
  });

  React.useEffect(() => {
    let isMounted = true;
    getOrganizationDetails()
      .then((org) => {
        if (!isMounted || !org) return;
        setOrganization({
          name: org.name,
          code: org.code,
          gstNumber: (org as { gst_number?: string; gstNumber?: string }).gst_number || (org as { gstNumber?: string }).gstNumber || 'Not available',
          phone: (org as { phone?: string }).phone || 'Not available',
          address: (org as { address?: string }).address || 'Not available',
        });
      })
      .catch(() => {
        // Keep fallback values for unauthenticated/dev states.
      });
    return () => {
      isMounted = false;
    };
  }, []);

  React.useEffect(() => {
    const primaryLocation = locations[0];
    if (!primaryLocation) return;

    setOrganization((prev) => ({
      ...prev,
      phone: prev.phone !== 'Not available' ? prev.phone : (primaryLocation.phone || 'Not available'),
      address: prev.address !== 'Not available' ? prev.address : (primaryLocation.address || 'Not available'),
    }));
  }, [locations]);

  const gstRates = React.useMemo(() => {
    const unique: number[] = Array.from(
      new Set<number>(packages.map((p) => Number(p.taxPercent)))
    ).sort((a: number, b: number) => a - b);
    return unique.map((percent, idx) => ({
      id: String(percent),
      name: idx === 0 ? 'Standard GST' : `GST Slab ${idx + 1}`,
      percentage: percent,
      isDefault: idx === 0,
    }));
  }, [packages]);

  return (
    <div className="space-y-8 pb-10">
      <div>
        <h1 className="text-2xl font-display font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500">Manage your organization profile, billing, and staff users.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <aside className="space-y-1">
          {[
            { label: 'Organization', icon: Building2 },
            { label: 'User Profile', icon: User },
            { label: 'Notifications', icon: Bell },
            { label: 'Billing & GST', icon: CreditCard },
            { label: 'Security', icon: ShieldCheck },
          ].map((item) => (
            <Button
              key={item.label}
              variant={activeTab === item.label ? 'secondary' : 'ghost'}
              onClick={() => setActiveTab(item.label)}
              className={`w-full justify-start gap-3 rounded-xl h-11 ${activeTab === item.label ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-500'}`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Button>
          ))}
        </aside>

        <div className="lg:col-span-3 space-y-8">
          {activeTab === 'Organization' && (
            <>
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-lg font-display font-bold">Organization Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-8">
                  <div className="flex items-center gap-6">
                    <div className="w-24 h-24 rounded-2xl bg-indigo-600 flex items-center justify-center text-white text-4xl font-bold shadow-lg shadow-indigo-100">
                      K
                    </div>
                    <div className="space-y-2">
                      <Button variant="outline" className="gap-2 h-9 text-xs">
                        <ImageIcon className="w-4 h-4" />
                        Change Logo
                      </Button>
                      <p className="text-[10px] text-slate-400">Recommended: Square image, minimum 400x400px.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Academy Name</label>
                      <Input value={organization.name} readOnly />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Registration ID</label>
                      <Input value={organization.code} readOnly />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">GST Number</label>
                      <Input value={organization.gstNumber} readOnly />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Phone</label>
                      <Input value={organization.phone} readOnly />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Headquarters Address</label>
                    <Input value={organization.address} readOnly />
                  </div>

                  <div className="pt-4 border-t">
                    <p className="text-xs text-slate-500">
                      Organization profile values are synced from your configured database records.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-card border-red-100">
                <CardHeader>
                  <CardTitle className="text-lg font-display font-bold text-slate-900">Danger Zone</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="p-4 bg-red-50 rounded-xl border border-red-100 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-red-700">Deactivate Academy</p>
                      <p className="text-sm text-red-600/80">Temporarily suspend all branch operations and billing.</p>
                    </div>
                    <Button variant="destructive" className="bg-red-600 hover:bg-red-700">Deactivate</Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {activeTab === 'Billing & GST' && (
            <Card className="glass-card">
              <CardHeader className="flex flex-row justify-between items-center">
                <CardTitle className="text-lg font-display font-bold">GST Configuration</CardTitle>
                <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 gap-2" onClick={() => toast.info('GST slabs are derived from package tax configuration.') }>
                  <Plus className="w-4 h-4" />
                  Manage via Packages
                </Button>
              </CardHeader>
              <CardContent className="space-y-6">
                <p className="text-sm text-slate-500">Define the GST percentages used across your academy packages. Default rate is automatically applied to new packages.</p>
                
                <div className="space-y-3">
                  {gstRates.map((rate) => (
                    <div key={rate.id} className="group p-4 bg-white border border-slate-100 rounded-2xl flex items-center justify-between hover:border-indigo-200 hover:shadow-sm transition-all">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-sm">
                          {rate.percentage}%
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 flex items-center gap-2">
                            {rate.name}
                            {rate.isDefault && (
                              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-none text-[10px] uppercase font-black px-2">Default</Badge>
                            )}
                          </p>
                          <p className="text-xs text-slate-400">Apply {rate.percentage}% tax to invoices</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Badge variant="outline" className="text-[10px] uppercase">Synced from packages</Badge>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-6 border-t">
                  <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-3">
                    <Bell className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700 leading-relaxed">
                      <strong>Important:</strong> Changing global GST rates will only affect new invoices. Existing invoices and receipts will maintain their original tax calculations at the time of issuance for compliance.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {(activeTab === 'User Profile' || activeTab === 'Notifications' || activeTab === 'Security') && (
            <div className="h-64 flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 text-slate-400">
               <p className="font-medium">{activeTab} settings coming soon</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

