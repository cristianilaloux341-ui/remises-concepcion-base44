import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function StatCard({ title, value, icon: Icon, color, children }) {
  return (
    <Card className="p-5 relative overflow-hidden group border-violet-500/30 bg-[#191238]/95 shadow-xl hover:border-fuchsia-400/50 hover:shadow-2xl transition-all duration-300">
      <div className="flex items-start justify-between">
        <div className="space-y-1 w-full min-w-0">
          <p className="text-sm text-violet-200 font-bold truncate">{title}</p>
          <p className="text-4xl font-black tracking-tight text-white">{value}</p>
        </div>
        <div className={cn("p-3 rounded-xl shrink-0 ml-2", color)}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
      {children && (
        <div className="mt-3 relative z-10">
          {children}
        </div>
      )}
      <div className={cn("absolute bottom-0 left-0 h-1 w-full opacity-0 group-hover:opacity-100 transition-opacity", color)} />
    </Card>
  );
}