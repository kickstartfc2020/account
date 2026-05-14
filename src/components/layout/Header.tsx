import React from 'react';
import { Search, Bell, Plus, ChevronDown, ReceiptText } from 'lucide-react';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocations, useSports } from '@/hooks/useData';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function Header() {
  const { data: locations } = useLocations();
  const { data: sports } = useSports();
  const [currentBranchId, setCurrentBranchId] = React.useState<string | null>(null);
  const [isSportDialogOpen, setIsSportDialogOpen] = React.useState(false);
  const navigate = useNavigate();

  React.useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.rpc('current_branch_id').then(({ data }) => {
      setCurrentBranchId((data as string | null) ?? null);
    });
  }, []);

  const currentBranchName =
    locations.find((location) => location.id === currentBranchId)?.name ??
    locations[0]?.name ??
    '';

  const handleCreateInvoiceClick = () => {
    if (sports.length === 0) {
      toast.error('No sports available. Please create a sport first.');
      navigate('/sports');
      return;
    }

    if (sports.length === 1) {
      navigate(`/invoices/create?sportId=${sports[0].id}`);
    } else {
      setIsSportDialogOpen(true);
    }
  };

  const selectSport = (sportId: string) => {
    setIsSportDialogOpen(false);
    navigate(`/invoices/create?sportId=${sportId}`);
  };

  return (
    <header className="h-16 border-b bg-white/80 backdrop-blur-md sticky top-0 z-10 px-8 flex items-center justify-between">
      <div className="flex-1"></div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded-lg">
          <span className="text-indigo-400 text-[10px] font-bold uppercase tracking-widest">Branch:</span>
          <span className="text-sm font-bold text-indigo-700">{currentBranchName}</span>
        </div>

        <Button variant="ghost" size="icon" className="relative text-slate-500">
          <Bell className="w-5 h-5" />
          <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
        </Button>

        <Button className="btn-primary gap-2" onClick={handleCreateInvoiceClick}>
          <ReceiptText className="w-4 h-4" />
          Create Invoice
        </Button>

        <div className="w-8 h-8 rounded-full bg-slate-200 overflow-hidden border">
           <img 
            src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop" 
            alt="Profile"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>

      <Dialog open={isSportDialogOpen} onOpenChange={setIsSportDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold font-display">Select Sport</DialogTitle>
            <DialogDescription>
              Which sport is this invoice for?
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            {sports.map((sport) => (
              <Button 
                key={sport.id} 
                variant="outline" 
                className="h-14 justify-between px-6 hover:border-indigo-500 hover:bg-indigo-50/50 group transition-all"
                onClick={() => selectSport(sport.id)}
              >
                <span className="font-bold text-gray-700 group-hover:text-indigo-700">{sport.name}</span>
                <ChevronDown className="w-4 h-4 -rotate-90 text-gray-400 group-hover:text-indigo-500" />
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
