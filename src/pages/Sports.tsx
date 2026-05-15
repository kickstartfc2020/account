import React from 'react';
import { 
  Trophy, 
  Users, 
  CreditCard, 
  TrendingUp, 
  MoreVertical, 
  Plus, 
  ChevronRight,
  Zap,
  Target,
  Dribbble,
  Power,
  PowerOff,
  AlertCircle,
  Activity,
  Timer,
  Flag,
  Award
} from 'lucide-react';
import { useSports } from '@/hooks/useData';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Sport } from '@/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createSport, updateSportStatus } from '@/lib/dataMutations';
import { reportOperationalError } from '@/lib/observability';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

import { useNavigate } from 'react-router-dom';
import { useStudents, usePackages, useInvoices } from '@/hooks/useData';

const icons: Record<string, any> = {
  Trophy,
  Zap,
  Target,
  Dribbble,
  Activity,
  Timer,
  Flag,
  Award
};

export default function Sports() {
  const navigate = useNavigate();
  const { data: dbSports } = useSports();
  const { data: students } = useStudents();
  const { data: packages } = usePackages();
  const { data: invoices } = useInvoices();
  const [sports, setSports] = React.useState<Sport[]>(() =>
    dbSports.map(s => ({ ...s, status: s.status ?? 'active' }))
  );

  React.useEffect(() => {
    setSports(dbSports.map(s => ({ ...s, status: s.status ?? 'active' })));
  }, [dbSports]);
  const [confirmDialogOpen, setConfirmDialogOpen] = React.useState(false);
  const [addDialogOpen, setAddDialogOpen] = React.useState(false);
  const [sportToToggle, setSportToToggle] = React.useState<Sport | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isToggling, setIsToggling] = React.useState(false);
  
  const [newSportName, setNewSportName] = React.useState('');
  const [selectedIcon, setSelectedIcon] = React.useState('Trophy');

  const sportsWithStats = React.useMemo(() => {
    const studentSportById = new Map(students.map((student) => [student.id, student.sportId]));

    return sports.map((sport) => {
      const studentsCount = students.filter((student) => student.sportId === sport.id).length;
      const packagesCount = packages.filter((pkg) => pkg.sportId === sport.id).length;
      const revenue = invoices
        .filter((invoice) => invoice.status !== 'cancelled' && studentSportById.get(invoice.studentId) === sport.id)
        .reduce((sum, invoice) => sum + (invoice.total ?? 0), 0);

      return {
        ...sport,
        studentsCount,
        packagesCount,
        revenue,
      };
    });
  }, [sports, students, packages, invoices]);

  const handleAddSport = async () => {
    if (!newSportName.trim()) {
      toast.error('Please enter a sport name');
      return;
    }

    setIsSaving(true);
    try {
      const created = await createSport({ name: newSportName.trim() });
      const newSport: Sport = {
        id: created.id,
        name: created.name,
        icon: selectedIcon,
        studentsCount: 0,
        packagesCount: 0,
        revenue: 0,
        status: 'active'
      };

      setSports((prev) => [newSport, ...prev]);
      toast.success(`${newSportName} added to academy!`);
      setAddDialogOpen(false);
      setNewSportName('');
      setSelectedIcon('Trophy');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create sport.';
      reportOperationalError('sport.create', 'Failed to create sport.', error, { name: newSportName });
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleClick = (sport: Sport) => {
    if (sport.status !== 'inactive') {
      setSportToToggle(sport);
      setConfirmDialogOpen(true);
    } else {
      toggleSportStatus(sport.id);
    }
  };

  const toggleSportStatus = async (id: string) => {
    const nextSport = sports.find((sport) => sport.id === id);
    if (!nextSport) return;

    const nextStatus = nextSport.status === 'inactive' ? 'active' : 'inactive';
    setIsToggling(true);
    try {
      await updateSportStatus(id, nextStatus === 'active' ? 'active' : 'inactive');
      setSports((prev) => prev.map((sport) => {
        if (sport.id === id) {
          return { ...sport, status: nextStatus };
        }
        return sport;
      }));
      toast.info(`${nextSport.name} ${nextStatus === 'inactive' ? 'disabled' : 'enabled'} successfully`);
      setConfirmDialogOpen(false);
      setSportToToggle(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update sport status.';
      reportOperationalError('sport.status', 'Failed to update sport status.', error, {
        sportId: id,
        nextStatus,
      });
      toast.error(message);
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900">Sports</h1>
          <p className="text-slate-500 font-medium">Manage sports coaching, fees, and active memberships.</p>
        </div>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2 h-11 px-6 rounded-xl shadow-lg shadow-indigo-100 transition-all active:scale-95">
              <Plus className="w-5 h-5" />
              Add New Sport
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-xl font-display font-bold">Add New Sport</DialogTitle>
              <DialogDescription>
                Define a new athletic discipline for your academy.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-6 py-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name" className="text-xs font-bold uppercase text-slate-500">Sport Name</Label>
                <Input 
                  id="name" 
                  placeholder="e.g. Swimming, Karate, Tennis" 
                  value={newSportName}
                  onChange={(e) => setNewSportName(e.target.value)}
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="flex flex-col gap-3">
                <Label className="text-xs font-bold uppercase text-slate-500">Select Symbol</Label>
                <div className="grid grid-cols-4 gap-3">
                  {Object.entries(icons).map(([name, Icon]) => (
                    <button
                      key={name}
                      onClick={() => setSelectedIcon(name)}
                      className={cn(
                        "h-14 rounded-xl flex items-center justify-center transition-all border-2",
                        selectedIcon === name 
                          ? "border-indigo-600 bg-indigo-50 text-indigo-600 shadow-sm" 
                          : "border-slate-100 bg-slate-50 text-slate-400 hover:border-slate-200"
                      )}
                    >
                      <Icon className="w-6 h-6" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddDialogOpen(false)} className="h-11 rounded-xl font-bold text-slate-500">Cancel</Button>
              <Button onClick={handleAddSport} className="h-11 px-8 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200" disabled={isSaving}>{isSaving ? 'Creating...' : 'Create Sport'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {sportsWithStats.map((sport, i) => {
          const Icon = icons[sport.icon] || Trophy;
          const isInactive = sport.status === 'inactive';

          return (
            <motion.div
              key={sport.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className={cn(
                "glass-card hover-card overflow-hidden group border transition-all duration-300",
                isInactive ? "opacity-75 bg-slate-50 grayscale border-slate-200" : "bg-white border-transparent"
              )}>
                <CardContent className="p-6 space-y-6">
                  <div className="flex justify-between items-start">
                    <div className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300",
                      isInactive 
                        ? "bg-slate-200 text-slate-500" 
                        : "bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white"
                    )}>
                      {isInactive ? <PowerOff className="w-6 h-6" /> : <Icon className="w-6 h-6" />}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {isInactive && (
                        <Badge variant="outline" className="bg-slate-100 text-slate-500 border-slate-200 text-[10px] font-bold uppercase tracking-tight h-5">
                          Disabled
                        </Badge>
                      )}
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => handleToggleClick(sport)}
                        className={cn(
                          "h-9 w-9 rounded-full transition-all duration-200",
                          isInactive 
                            ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white" 
                            : "bg-slate-50 text-slate-400 hover:bg-amber-50 hover:text-amber-600"
                        )}
                        title={isInactive ? "Enable Sport" : "Disable Sport"}
                      >
                        {isInactive ? <Power className="w-4.5 h-4.5" /> : <PowerOff className="w-4.5 h-4.5" />}
                      </Button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className={cn(
                        "text-xl font-display font-bold transition-colors",
                        isInactive ? "text-slate-500" : "text-slate-900"
                      )}>
                        {sport.name}
                      </h3>
                    </div>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1 opacity-70">Academy Discipline</p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-slate-500">
                        <Users className="w-4 h-4" />
                        <span className="text-sm font-medium">Students</span>
                      </div>
                      <span className={cn("font-bold", isInactive ? "text-slate-400" : "text-slate-900")}>{sport.studentsCount}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-slate-500">
                        <CreditCard className="w-4 h-4" />
                        <span className="text-sm font-medium">Packages</span>
                      </div>
                      <span className={cn("font-bold", isInactive ? "text-slate-400" : "text-slate-900")}>{sport.packagesCount}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-slate-500">
                        <TrendingUp className={cn("w-4 h-4", isInactive ? "text-slate-400" : "text-emerald-500")} />
                        <span className="text-sm font-medium">Revenue</span>
                      </div>
                      <span className={cn("font-bold", isInactive ? "text-slate-400" : "text-slate-900")}>₹{sport.revenue.toLocaleString()}</span>
                    </div>
                  </div>

                  {isInactive ? (
                    <div className="space-y-4">
                      <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex items-start gap-2.5">
                        <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-[10px] text-amber-700 font-bold leading-tight">
                          Sport is currently disabled. Active students can still finish their packages, but new registrations are blocked.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          onClick={() => navigate('/packages')}
                          className="flex-1 text-xs font-bold h-9 border-slate-200 text-slate-500 hover:bg-slate-100 rounded-lg"
                        >
                          Packages
                        </Button>
                        <Button 
                          variant="outline" 
                          onClick={() => navigate('/students')}
                          className="flex-1 text-xs font-bold h-9 border-slate-200 text-slate-500 hover:bg-slate-100 rounded-lg"
                        >
                          Students
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-4 flex gap-2">
                      <Button 
                        variant="outline" 
                        onClick={() => navigate('/packages')}
                        className="flex-1 text-xs font-bold h-9 border-indigo-100 text-indigo-600 bg-indigo-50/30 hover:bg-indigo-600 hover:text-white transition-all rounded-lg"
                      >
                        Packages
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => navigate('/students')}
                        className="flex-1 text-xs font-bold h-9 bg-white hover:bg-slate-50 rounded-lg"
                      >
                        Students
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent className="sm:max-w-[425px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-display font-bold text-slate-900">Disable Sport?</DialogTitle>
            <DialogDescription className="text-slate-500 pt-2">
              Are you sure you want to disable <span className="font-bold text-slate-900">{sportToToggle?.name}</span>? 
              New registrations will be blocked, though current active students can continue their journey.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3 mt-4">
            <Button 
              variant="outline" 
              onClick={() => setConfirmDialogOpen(false)}
              className="h-11 px-6 rounded-xl font-bold text-slate-500 border-slate-200"
            >
              No, Keep Enabled
            </Button>
              <Button 
                onClick={() => sportToToggle && void toggleSportStatus(sportToToggle.id)}
                disabled={isToggling}
                className="h-11 px-8 rounded-xl font-bold bg-amber-600 hover:bg-amber-700 shadow-lg shadow-amber-100 transition-all active:scale-95"
              >
                {isToggling ? 'Updating...' : 'Yes, Disable Sport'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
