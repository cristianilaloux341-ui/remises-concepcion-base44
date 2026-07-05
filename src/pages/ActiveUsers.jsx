import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Activity, Car, Users, ShieldAlert, Smartphone, Ban, Eye, EyeOff, CheckCircle2, Trash2, ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useNavigate } from "react-router-dom";

export default function ActiveUsers() {
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState("online");
  const [showPins, setShowPins] = useState(false);
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  const localOperator = (() => { try { return JSON.parse(localStorage.getItem("local_operator") || "null"); } catch { return null; } })();
  let effectiveRole = localOperator ? localOperator.role : user?.role;
  if (effectiveRole === "Administrador General") effectiveRole = "admin";
  if (effectiveRole === "Supervisor") effectiveRole = "supervisor";
  if (effectiveRole === "Operador") effectiveRole = "operador";
  const isAdmin = effectiveRole === "admin";

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  const { data: operators = [], isLoading: isLoadingOp } = useQuery({
    queryKey: ["operators_active"],
    queryFn: async () => {
      try {
        const admin_id = localOperator ? localOperator.id : null;
        const res = await base44.functions.invoke('authSystem', {
          action: 'manage_users',
          payload: { sub_action: 'list', admin_id }
        });
        return res.data?.success ? res.data.usuarios.map(u => ({
          ...u,
          name: u.nombre,
          phone: u.telefono,
          role: u.rol === "Administrador General" ? "admin" : (u.rol === "Supervisor" ? "supervisor" : "operador"),
          last_active: u.ultimo_acceso
        })) : [];
      } catch (e) {
        return [];
      }
    },
    refetchInterval: tab === "online" ? 15000 : false,
  });

  const { data: drivers = [], isLoading: isLoadingDr } = useQuery({
    queryKey: ["drivers_active"],
    queryFn: () => base44.entities.Driver.list(),
    refetchInterval: tab === "online" ? 15000 : false,
  });

  const revokeDriver = useMutation({
    mutationFn: (id) => base44.entities.Driver.update(id, { current_session_token: null, device_id: null, status: "no_disponible" }),
    onSuccess: (_, id) => {
      const d = drivers.find(x => x.id === id);
      base44.entities.AuditLog.create({
        action: "revocar_acceso",
        user_type: effectiveRole,
        user_name: localOperator?.name || "Admin",
        details: `Desvinculó el equipo del chofer ${d?.name}`
      }).catch(()=>{});
      qc.invalidateQueries({ queryKey: ["drivers_active"] });
    }
  });

  const toggleOperator = useMutation({
    mutationFn: async ({id, active}) => {
      const admin_id = localOperator ? localOperator.id : null;
      const op = operators.find(x => x.id === id);
      if (!op) throw new Error("Operador no encontrado");
      const res = await base44.functions.invoke('authSystem', {
        action: 'manage_users',
        payload: { 
          sub_action: 'update', 
          admin_id, 
          data: { id, nombre: op.nombre, telefono: op.telefono, rol: op.rol, activo: active } 
        }
      });
      if (!res.data?.success) throw new Error("Error al actualizar");
      return res.data;
    },
    onSuccess: (_, {id, active}) => {
      const op = operators.find(x => x.id === id);
      base44.entities.AuditLog.create({
        action: "modificar_acceso",
        user_type: effectiveRole,
        user_name: localOperator?.name || "Admin",
        details: `${active ? 'Activó' : 'Bloqueó'} el acceso al operador ${op?.name}`
      }).catch(()=>{});
      qc.invalidateQueries({ queryKey: ["operators_active"] });
    }
  });

  const testFCM = async (driver) => {
    toast({ title: "Enviando Push...", description: `Intentando despertar a ${driver.name}` });
    try {
      const res = await base44.functions.invoke('checkFirebasePush', { driverId: driver.id });
      if (res.data?.status === 200) {
        toast({ title: "✅ Push Enviado", description: `Notificación nativa enviada a ${driver.name}. Debería sonar.`, variant: "default" });
      } else {
        toast({ title: "❌ Error de Push", description: JSON.stringify(res.data?.response || res.data?.error).substring(0,100), variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "❌ Error", description: e.message, variant: "destructive" });
    }
  };

  const isOnline = (isoString) => {
    if (!isoString) return false;
    return (now - new Date(isoString).getTime()) < 180000;
  };

  const activeOperators = operators.filter(o => isOnline(o.last_active));
  const activeDrivers = drivers.filter(d => isOnline(d.last_active));

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <Button variant="ghost" className="gap-2 md:hidden -ml-3" onClick={() => navigate(-1)}>
        <ArrowLeft className="w-4 h-4" /> Volver
      </Button>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="w-6 h-6 text-indigo-600" />
            Monitoreo y Seguridad
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Supervisión de usuarios en línea y gestión de credenciales.
          </p>
        </div>
        {isAdmin && (
          <div className="flex bg-muted p-1 rounded-xl">
            <button
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${tab === "online" ? "bg-white shadow-sm text-indigo-600" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setTab("online")}
            >
              Conectados Ahora
            </button>
            <button
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-2 ${tab === "security" ? "bg-white shadow-sm text-red-600" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setTab("security")}
            >
              <ShieldAlert className="w-4 h-4" /> Carpeta Segura
            </button>
          </div>
        )}
      </div>

      {tab === "online" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in">
          {/* Operators card */}
          <Card>
            <CardHeader className="bg-muted/30 border-b py-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                Operadores y Admins ({activeOperators.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {activeOperators.map(op => (
                  <li key={op.id} className="p-4 flex items-center justify-between hover:bg-muted/20">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <div>
                        <p className="font-semibold text-sm">{op.name}</p>
                        <p className="text-xs text-muted-foreground uppercase">{op.role}</p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Activo hace {formatDistanceToNow(new Date(op.last_active), { locale: es })}
                    </span>
                  </li>
                ))}
                {activeOperators.length === 0 && !isLoadingOp && (
                  <li className="p-8 text-center text-muted-foreground text-sm">Ningún operador conectado.</li>
                )}
                {isLoadingOp && <li className="p-4 text-center text-xs text-muted-foreground">Cargando...</li>}
              </ul>
            </CardContent>
          </Card>

          {/* Drivers card */}
          <Card>
            <CardHeader className="bg-muted/30 border-b py-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Car className="w-5 h-5 text-amber-500" />
                Móviles / Choferes ({activeDrivers.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {activeDrivers.map(d => (
                  <li key={d.id} className="p-4 flex items-center justify-between hover:bg-muted/20">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <div>
                        <p className="font-semibold text-sm">{d.name}</p>
                        <p className="text-xs text-muted-foreground">{d.vehicle_plate} • {d.status.replace("_", " ")}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        Hace {formatDistanceToNow(new Date(d.last_active), { locale: es })}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => testFCM(d)} className="h-7 text-xs bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border-transparent">
                        Probar Push
                      </Button>
                    </div>
                  </li>
                ))}
                {activeDrivers.length === 0 && !isLoadingDr && (
                  <li className="p-8 text-center text-muted-foreground text-sm">Ningún chofer conectado.</li>
                )}
                {isLoadingDr && <li className="p-4 text-center text-xs text-muted-foreground">Cargando...</li>}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "security" && isAdmin && (
        <div className="space-y-6 animate-in fade-in">
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setShowPins(!showPins)} className="gap-2">
              {showPins ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showPins ? "Ocultar Pines" : "Revelar PINs"}
            </Button>
          </div>

          {/* Operators Security */}
          <Card className="border-red-100">
            <CardHeader className="bg-red-50/50 border-b border-red-100 py-4">
              <CardTitle className="text-base flex items-center gap-2 text-red-900">
                <ShieldAlert className="w-5 h-5" />
                Credenciales de Operadores y Cajeros
              </CardTitle>
              <CardDescription className="text-red-700/70">Visualizá los PINs y bloqueá accesos al sistema web (incluyendo ex-empleados).</CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b text-left text-muted-foreground whitespace-nowrap">
                    <th className="px-4 py-3 font-semibold">Operador</th>
                    <th className="px-4 py-3 font-semibold">Rol</th>
                    <th className="px-4 py-3 font-semibold">PIN</th>
                    <th className="px-4 py-3 font-semibold">Estado</th>
                    <th className="px-4 py-3 font-semibold text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {operators.map(op => (
                    <tr key={op.id} className="hover:bg-muted/10">
                      <td className="px-4 py-3 font-medium">
                        {op.name}
                        <div className="text-xs text-muted-foreground font-normal">{op.phone}</div>
                      </td>
                      <td className="px-4 py-3 uppercase text-xs font-semibold">{op.role}</td>
                      <td className="px-4 py-3 font-mono font-bold tracking-widest text-base">
                        {showPins ? (op.pin || <span className="text-gray-400 text-sm tracking-normal italic">No tiene</span>) : "••••"}
                      </td>
                      <td className="px-4 py-3">
                        {op.active ? (
                          <span className="flex items-center gap-1 text-green-600 text-xs font-bold"><CheckCircle2 className="w-3 h-3"/> Activo</span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-600 text-xs font-bold"><Ban className="w-3 h-3"/> Bloqueado</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {op.active ? (
                          <Button size="sm" variant="destructive" className="h-8" onClick={() => toggleOperator.mutate({id: op.id, active: false})} disabled={toggleOperator.isPending}>
                            <Ban className="w-3 h-3 mr-1" /> Bloquear Acceso
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className="h-8 text-green-600 border-green-200" onClick={() => toggleOperator.mutate({id: op.id, active: true})} disabled={toggleOperator.isPending}>
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Habilitar
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Drivers Security */}
          <Card className="border-amber-100">
            <CardHeader className="bg-amber-50/50 border-b border-amber-100 py-4">
              <CardTitle className="text-base flex items-center gap-2 text-amber-900">
                <Smartphone className="w-5 h-5" />
                Credenciales de Choferes
              </CardTitle>
              <CardDescription className="text-amber-700/70">Revelá PINs de acceso o desvinculá teléfonos en caso de robo o pérdida para cerrarles la sesión al instante.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b text-left text-muted-foreground whitespace-nowrap">
                    <th className="px-4 py-3 font-semibold">Chofer / Móvil</th>
                    <th className="px-4 py-3 font-semibold">PIN</th>
                    <th className="px-4 py-3 font-semibold">Equipo Enlazado</th>
                    <th className="px-4 py-3 font-semibold text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {drivers.map(d => (
                    <tr key={d.id} className="hover:bg-muted/10">
                      <td className="px-4 py-3 font-medium">
                        {d.name}
                        <div className="text-xs text-muted-foreground font-normal">{d.vehicle_plate}</div>
                      </td>
                      <td className="px-4 py-3 font-mono font-bold tracking-widest text-base">
                        {showPins ? (d.pin || <span className="text-gray-400 text-sm tracking-normal italic">No tiene</span>) : "••••"}
                      </td>
                      <td className="px-4 py-3">
                        {d.device_id ? (
                          <span className="flex items-center gap-1 text-indigo-600 text-xs font-bold"><Smartphone className="w-3 h-3"/> Sesión Activa</span>
                        ) : (
                          <span className="text-gray-400 text-xs">Sin equipo enlazado</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="outline" size="sm" onClick={() => testFCM(d)} className="h-8 mr-2 text-xs bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border-transparent">
                          Probar Push FCM
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                          onClick={() => revokeDriver.mutate(d.id)}
                          disabled={!d.device_id || revokeDriver.isPending}
                        >
                          <Trash2 className="w-3 h-3 mr-1" /> Forzar Cierre de Sesión
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

        </div>
      )}
    </div>
  );
}