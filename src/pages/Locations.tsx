import React from 'react';
import { 
  Building2, 
  Users, 
  Trophy, 
  ChevronRight, 
  Plus, 
  MoreVertical,
  MapPin,
  TrendingUp
} from 'lucide-react';
import { useLocations } from '@/hooks/useData';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'motion/react';

export default function Locations() {
  const { data: locations } = useLocations();

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900">Locations</h1>
          <p className="text-slate-500">Manage your academy branches and their performance.</p>
        </div>
        <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2">
          <Plus className="w-4 h-4" />
          Add Location
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {locations.map((loc, i) => (
          <motion.div
            key={loc.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card className="glass-card group hover-card overflow-hidden">
              <CardContent className="p-0">
                <div className="p-6 space-y-4">
                  <div className="flex justify-between items-start">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                      <Building2 className="w-6 h-6" />
                    </div>
                    <Button variant="ghost" size="icon" className="text-slate-400">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  <div>
                    <h3 className="text-xl font-display font-bold text-slate-900">{loc.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex items-center gap-1 text-slate-500 text-sm">
                        <MapPin className="w-3 h-3" />
                        {loc.address}
                      </div>
                      {loc.refId && (
                        <span className="text-[10px] font-mono font-semibold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">
                          {loc.refId}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 py-4 border-y border-slate-100">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Students</p>
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-indigo-500" />
                        <span className="font-bold text-slate-700">{loc.studentsCount}</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Revenue</p>
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-emerald-500" />
                        <span className="font-bold text-slate-700">₹{loc.revenue.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Sports</p>
                    <div className="flex flex-wrap gap-2">
                      {loc.activeSports.map(sport => (
                        <Badge key={sport} variant="secondary" className="bg-slate-100 text-slate-600 border-none font-medium">
                          {sport}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
                
                <div className="px-6 py-4 bg-slate-50 flex items-center justify-between group-hover:bg-indigo-50 transition-colors">
                  <span className="text-sm font-semibold text-slate-600 group-hover:text-indigo-600">View performance</span>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
