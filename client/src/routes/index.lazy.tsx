import { createLazyFileRoute } from '@tanstack/react-router';
import { useSystemStatus, useStats } from '@/api/hooks';
import { usePeople } from '@/api/hooks';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, GitBranch, Clock, Activity } from 'lucide-react';

export const Route = createLazyFileRoute('/')({
  component: Dashboard,
});

function Dashboard() {
  const { data: status, isLoading: statusLoading } = useSystemStatus();
  const { data: statsData, isLoading: statsLoading } = useStats();
  const { data: peopleData, isLoading: peopleLoading } = usePeople({ limit: 1 });

  const isLoading = statusLoading || statsLoading || peopleLoading;

  return (
    <div className="h-full overflow-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Overview of your family graph</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Users}
          label="Total People"
          value={isLoading ? undefined : String(peopleData?.totalCount ?? 0)}
        />
        <StatCard
          icon={GitBranch}
          label="Relationships"
          value={isLoading ? undefined : String(status?.edgeCount ?? 0)}
        />
        <StatCard
          icon={Clock}
          label="Last Modified"
          value={isLoading ? undefined : (statsData?.lastModified ? new Date(statsData.lastModified).toLocaleDateString() : '—')}
        />
        <StatCard
          icon={Activity}
          label="Engine Status"
          value={isLoading ? undefined : (status?.hydrationState ?? 'unknown')}
          accent={status?.hydrationState === 'ready' ? 'green' : status?.hydrationState === 'loading' ? 'amber' : 'red'}
        />
      </div>

      {/* Placeholder for force graph */}
      <div className="border border-border rounded-xl bg-card p-8 text-center text-muted-foreground min-h-[400px] flex items-center justify-center">
        <div className="space-y-2">
          <GitBranch className="h-12 w-12 mx-auto text-muted-foreground/50" />
          <p className="text-lg font-medium">Force Graph Visualization</p>
          <p className="text-sm">Interactive family tree graph will be rendered here (Phase 5)</p>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent }: { icon: typeof Users; label: string; value?: string; accent?: string }) {
  return (
    <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:bg-muted/20 transition-colors">
      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground font-medium">{label}</div>
        {value === undefined ? (
          <Skeleton className="h-5 w-16 mt-0.5" />
        ) : (
          <div className={`text-lg font-bold ${accent === 'green' ? 'text-emerald-500' : accent === 'amber' ? 'text-amber-500' : accent === 'red' ? 'text-red-500' : ''}`}>
            {value}
          </div>
        )}
      </div>
    </div>
  );
}
