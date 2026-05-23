import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function StatCard({ title, value, icon: Icon, color }) {
  return (
    <Card className="p-5 relative overflow-hidden group hover:shadow-lg transition-shadow duration-300">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground font-medium">{title}</p>
          <p className="text-3xl font-bold tracking-tight">{value}</p>
        </div>
        <div className={cn("p-3 rounded-xl", color)}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
      <div className={cn("absolute bottom-0 left-0 h-1 w-full opacity-0 group-hover:opacity-100 transition-opacity", color)} />
    </Card>
  );
}