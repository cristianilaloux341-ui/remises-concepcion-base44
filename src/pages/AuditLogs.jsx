import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, User, Zap, Settings, Ban, Car, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export default function AuditLogs() {
  const navigate = useNavigate();
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["audit_logs"],
    queryFn: () => base44.entities.AuditLog.list("-created_date", 200),
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <Button variant="ghost" className="gap-2 md:hidden -ml-3" onClick={() => navigate(-1)}>
        <ArrowLeft className="w-4 h-4" /> Volver
      </Button>
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-indigo-600" />
          Auditoría y Control
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">Registro histórico de acciones críticas del sistema.</p>
      </div>

      <Card>
        <CardContent className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b text-left">
                <th className="px-4 py-3 font-semibold text-muted-foreground">Fecha / Hora</th>
                <th className="px-4 py-3 font-semibold text-muted-foreground">Usuario</th>
                <th className="px-4 py-3 font-semibold text-muted-foreground">Rol</th>
                <th className="px-4 py-3 font-semibold text-muted-foreground">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground font-mono text-xs">
                    {format(new Date(log.created_date), "dd/MM/yyyy HH:mm:ss")}
                  </td>
                  <td className="px-4 py-3 font-medium">{log.user_name}</td>
                  <td className="px-4 py-3">
                    <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full text-xs uppercase font-semibold">
                      {log.user_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">{log.details}</td>
                </tr>
              ))}
              {logs.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No hay registros de auditoría aún.</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}