import React from 'react';
import { 
  Building2, 
  Settings, 
  MapPin, 
  Globe, 
  Phone, 
  Mail,
  Camera,
  Save,
  Info
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getOrganizationDetails, updateOrganizationDetails } from '@/lib/adminManagement';
import { toast } from 'sonner';
import { reportOperationalError } from '@/lib/observability';

export default function ClubDetails() {
  const [academyName, setAcademyName] = React.useState('Kickstart Academy');
  const [registrationCode, setRegistrationCode] = React.useState('KICK-2024-8849');
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    let isMounted = true;
    getOrganizationDetails()
      .then((org) => {
        if (!isMounted || !org) return;
        setAcademyName(org.name);
        setRegistrationCode(org.code);
      })
      .catch((error) => {
        reportOperationalError('superadmin.club_details', 'Failed to load organization details.', error);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateOrganizationDetails({
        name: academyName.trim(),
        code: registrationCode.trim(),
      });
      toast.success('Organization details updated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save organization settings.';
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-display font-bold text-gray-900 tracking-tight">Club Details</h1>
          <p className="text-gray-500 mt-1">Global branding and organization settings for Kickstart Academy.</p>
        </div>
        <Button className="btn-primary gap-2 h-11 px-8 shadow-indigo-100" onClick={() => void handleSave()} disabled={isSaving}>
          <Save className="w-4 h-4" />
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-8">
          {/* General Information */}
          <Card className="glass-card">
            <CardHeader className="border-b border-gray-100">
              <CardTitle className="text-lg font-bold">General Information</CardTitle>
              <CardDescription>Core details visible across all branch invoices and reports.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6 grid gap-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">Academy Name</Label>
                  <Input value={academyName} onChange={(e) => setAcademyName(e.target.value)} className="h-11" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">Registration Number</Label>
                  <Input value={registrationCode} onChange={(e) => setRegistrationCode(e.target.value)} className="h-11" />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">Registered Address</Label>
                <Textarea 
                  placeholder="Enter complete club address..." 
                  className="min-h-[80px] resize-none" 
                  defaultValue="123 Sport Street, Mysore, Karnataka - 570001"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">GST Number</Label>
                  <Input defaultValue="29AAAAA0000A1Z5" className="h-11" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">PAN Card Number</Label>
                  <Input defaultValue="ABCDE1234F" className="h-11" />
                </div>
              </div>

              {/* UPI Payment Configuration */}
              <div className="pt-4 border-t border-gray-100 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-indigo-600">Payment Configuration</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">UPI ID for QR Code</Label>
                    <Input defaultValue="kickstart@upi" className="h-11 border-indigo-50 focus:ring-indigo-500" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">Merchant Name (Optional)</Label>
                    <Input defaultValue="Kickstart Academy Mysore" className="h-11 border-indigo-50 focus:ring-indigo-500" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">Global Support Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input defaultValue="admin@kickstart.com" className="h-11 pl-10" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">Primary Contact</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input defaultValue="+91 98765 43210" className="h-11 pl-10" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Social Presence */}
          <Card className="glass-card">
            <CardHeader className="border-b border-gray-100">
              <CardTitle className="text-lg font-bold">Social & Web</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 grid gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase text-gray-500 tracking-wider">Website URL</Label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input defaultValue="www.kickstartacademy.com" className="h-11 pl-10" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input placeholder="Instagram Handle" className="h-11" />
                <Input placeholder="Facebook Page" className="h-11" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Branding Card */}
          <Card className="glass-card">
            <CardHeader className="text-center">
              <CardTitle className="text-base font-bold">Global Logo</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-6">
              <div className="relative group">
                <div className="w-32 h-32 rounded-2xl bg-indigo-600 flex items-center justify-center text-white text-5xl font-bold shadow-xl shadow-indigo-100 transition-transform group-hover:scale-95 duration-300">
                  K
                </div>
                <button className="absolute -bottom-2 -right-2 p-3 bg-white rounded-xl shadow-lg border border-gray-200 text-gray-600 hover:text-indigo-600 transition-colors">
                  <Camera className="w-4 h-4" />
                </button>
              </div>
              <div className="text-center">
                <p className="text-xs font-bold text-gray-900">Kickstart Branding</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">Default for all branches</p>
              </div>
            </CardContent>
          </Card>

          {/* Tips Card */}
          <Card className="bg-amber-50 border-amber-200">
            <CardContent className="pt-6 flex gap-4">
              <div className="p-2 bg-amber-100 rounded-lg h-fit">
                <Info className="w-4 h-4 text-amber-700" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-amber-900">Branding Synergy</p>
                <p className="text-xs text-amber-800 leading-relaxed">
                  The colors and logos defined here will be applied as regional defaults for all new branches created in the dashboard.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
