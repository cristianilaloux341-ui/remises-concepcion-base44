import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Play, Square, Activity, CheckCircle2, XCircle, Search, Clock } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

export default function SimulacionDiaReal() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeOrders, setActiveOrders] = useState([]);
  const [counts, setCounts] = useState({});
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [traces, setTraces] = useState([]);
  const { toast } = useToast();

  const fetchStatus = async () => {
    try {
      const localOp = JSON.parse(sessionStorage.getItem('local_operator') || '{}');
      const res = await base44.functions.invoke('runDaySimulation', { 
        action: 'status', 
        internalKey: import.meta.env.VITE_INTERNAL_SERVICE_KEY || "rc-internal-master-key-2024",
        operatorId: localOp.id 
      });
      if (res.data?.success) {
        setStatus(res.data.state);
        
        if (res.data.state?.engineState === 'active') {
          const notes = JSON.parse(res.data.state.notes || '{}');
          if (Date.now() - (notes.last_tick_ms || 0) > 25000) {
             base44.functions.invoke('runDaySimulation', { 
               action: 'watchdog', 
               internalKey: import.meta.env.VITE_INTERNAL_SERVICE_KEY || "rc-internal-master-key-2024",
               operatorId: localOp.id 
             });
          }
        }
      }
      
      const ordersRes = await base44.functions.invoke('runDaySimulation', { 
        action: 'get_active_orders', 
        internalKey: import.meta.env.VITE_INTERNAL_SERVICE_KEY || "rc-internal-master-key-2024",
        operatorId: localOp.id 
      });
      if (ordersRes.data?.success) {
        setActiveOrders(ordersRes.data.orders || []);
        setCounts(ordersRes.data.counts || {});
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const iv = setInterval(fetchStatus, 3000);
    return () => clearInterval(iv);
  }, []);
  
  const fetchTraces = async (orderId) => {
    try {
      const localOp = JSON.parse(sessionStorage.getItem('local_operator') || '{}');
      const res = await base44.functions.invoke('runDaySimulation', {
        action: 'get_traces',
        order_id: orderId,
        internalKey: import.meta.env.VITE_INTERNAL_SERVICE_KEY || "rc-internal-master-key-2024",
        operatorId: localOp.id 
      });
      if (res.data?.success) {
        setTraces(res.data.traces || []);
      }
    } catch(e) {}
  };

  const handleOrderClick = (order) => {
    setSelectedOrder(order);
    fetchTraces(order.id);
  };

  const handleStart = async () => {
    setLoading(true);
    try {
      const localOp = JSON.parse(sessionStorage.getItem('local_operator') || '{}');
      const res = await base44.functions.invoke('runDaySimulation', { 
        action: 'start', 
        internalKey: import.meta.env.VITE_INTERNAL_SERVICE_KEY || "rc-internal-master-key-2024",
        operatorId: localOp.id 
      });
      if (res.data?.success) {
        toast({ title: 'Simulación iniciada', description: 'El día virtual comenzó.' });
        fetchStatus();
      } else {
        toast({ title: 'Error', description: res.data?.error || 'Falló al iniciar', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleAbort = async () => {
    if (!confirm('¿Seguro que deseas abortar la simulación en curso?')) return;
    setLoading(true);
    try {
      const localOp = JSON.parse(sessionStorage.getItem('local_operator') || '{}');
      await base44.functions.invoke('runDaySimulation', { 
        action: 'abort', 
        internalKey: import.meta.env.VITE_INTERNAL_SERVICE_KEY || "rc-internal-master-key-2024",
        operatorId: localOp.id 
      });
      toast({ title: 'Simulación abortada' });
      fetchStatus();
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  let isRunning = status?.engineState === 'active';
  let notes = null;
  try {
    if (status?.notes) notes = JSON.parse(status.notes);
  } catch (e) {}

  const progressValue = notes?.processedOrders ? (notes.processedOrders / 1000) * 100 : 0;
  const isFinished = status?.engineState === 'disabled' && notes?.resultado;
  
  const getStatusColor = (st) => {
    switch(st) {
      case 'pendiente': return 'bg-slate-500 text-white';
      case 'ofrecido': return 'bg-yellow-500 text-black';
      case 'aceptado': return 'bg-blue-500 text-white';
      case 'en_camino': return 'bg-indigo-500 text-white';
      case 'en_viaje': return 'bg-purple-500 text-white';
      case 'completado': return 'bg-green-500 text-white';
      default: return 'bg-slate-700 text-white';
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto pb-24">
      <div>
        <h1 className="text-3xl font-heading tracking-tight text-white mb-2">Simulación Día Real</h1>
        <p className="text-muted-foreground text-sm">
          Reproduce un día completo de despacho (1.000 pasajes, 50 móviles). Incluye auto-recuperación ante fallos y trazabilidad por pasaje.
        </p>
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Activity className="w-5 h-5 text-blue-500" />
            Estado de Simulación
          </CardTitle>
          <CardDescription>
            {isRunning ? 'La simulación está corriendo en el backend...' : 'Sistema en reposo.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isRunning && notes && (
            <div className="space-y-4">
              <div className="flex justify-between text-sm text-slate-300">
                <span>Progreso: {notes.processedOrders} / 1000 pasajes creados</span>
                <span>{Math.round(progressValue)}%</span>
              </div>
              <Progress value={progressValue} className="h-2 bg-slate-800" />
              
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-4 border-t border-slate-800">
                <div className="bg-slate-800/50 p-3 rounded-md text-center">
                   <div className="text-xs text-slate-400">Pendiente</div>
                   <div className="text-lg font-bold text-white">{counts.pendiente || 0}</div>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-md text-center">
                   <div className="text-xs text-slate-400">Ofrecido</div>
                   <div className="text-lg font-bold text-yellow-400">{counts.ofrecido || 0}</div>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-md text-center">
                   <div className="text-xs text-slate-400">Aceptado</div>
                   <div className="text-lg font-bold text-blue-400">{counts.aceptado || 0}</div>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-md text-center">
                   <div className="text-xs text-slate-400">En Camino</div>
                   <div className="text-lg font-bold text-indigo-400">{counts.en_camino || 0}</div>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-md text-center">
                   <div className="text-xs text-slate-400">En Viaje</div>
                   <div className="text-lg font-bold text-purple-400">{counts.en_viaje || 0}</div>
                </div>
              </div>
            </div>
          )}

          {isFinished && notes && (
            <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">Reporte Final</span>
                <Badge variant="outline" className={notes.resultado === 'OK' ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'}>
                  {notes.resultado === 'OK' ? <CheckCircle2 className="w-4 h-4 mr-1" /> : <XCircle className="w-4 h-4 mr-1" />}
                  {notes.resultado}
                </Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
                <div className="space-y-1">
                  <span className="text-slate-500 block">Total Creados</span>
                  <span className="text-white text-xl font-bold">{notes.total_creados}</span>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-500 block">Finalizados</span>
                  <span className="text-green-400 text-xl font-bold">{notes.finalizados}</span>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-500 block">Cancelados</span>
                  <span className="text-red-400 text-xl font-bold">{notes.cancelados}</span>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-500 block">Pendientes</span>
                  <span className="text-yellow-400 text-xl font-bold">{notes.pendientes}</span>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-500 block">Atascados</span>
                  <span className="text-orange-400 text-xl font-bold">{notes.atascados}</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="gap-3">
          <Button 
            onClick={handleStart} 
            disabled={loading || isRunning}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Play className="w-4 h-4 mr-2" />
            Lanzar Día Real
          </Button>
          <Button 
            onClick={handleAbort} 
            disabled={loading || !isRunning} 
            variant="destructive"
            className="bg-red-900/50 hover:bg-red-900/80 text-red-300 border-0"
          >
            <Square className="w-4 h-4 mr-2" />
            Abortar
          </Button>
        </CardFooter>
      </Card>
      
      {(isRunning || activeOrders.length > 0) && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-lg">Pasajes en curso (Auditoría en vivo)</CardTitle>
            <CardDescription>Clic en un pasaje para ver la traza de transiciones y detectar dónde está atascado.</CardDescription>
          </CardHeader>
          <CardContent>
             <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
               {activeOrders.length === 0 && <div className="text-slate-500 text-sm">No hay pasajes en proceso...</div>}
               {activeOrders.map(o => (
                  <div key={o.id} onClick={() => handleOrderClick(o)} className="flex items-center justify-between p-3 rounded-lg border border-slate-800 bg-slate-800/30 hover:bg-slate-800 cursor-pointer transition-colors">
                     <div className="flex flex-col">
                        <span className="text-white font-medium text-sm">{o.client_name}</span>
                        <span className="text-slate-400 text-xs">{o.pickup_address}</span>
                     </div>
                     <div className="flex items-center gap-3">
                       {o.driver_name && <span className="text-xs text-slate-500">Móvil: {o.driver_name}</span>}
                       <Badge className={`${getStatusColor(o.status)} border-0`}>{o.status}</Badge>
                     </div>
                  </div>
               ))}
             </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Trazas del Pasaje</DialogTitle>
            <DialogDescription className="text-slate-400">
              {selectedOrder?.client_name} - {selectedOrder?.pickup_address}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 max-h-[400px] overflow-y-auto p-1 custom-scrollbar">
            {traces.length === 0 ? (
               <div className="text-slate-500 text-sm text-center py-4">No hay trazas registradas todavía...</div>
            ) : (
               <div className="relative border-l border-slate-700 ml-3 pl-4 space-y-4">
                 {traces.map((tr, i) => (
                   <div key={tr.id} className="relative">
                      <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500"></div>
                      <div className="text-sm font-medium text-white">
                         {tr.old_status} <span className="text-slate-500">→</span> <span className="text-blue-400">{tr.new_status}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                         <Clock className="w-3 h-3" />
                         {new Date(tr.timestamp_ms).toLocaleTimeString()}
                         {tr.driver_id && <span className="ml-2 bg-slate-800 px-2 py-0.5 rounded text-slate-300">Driver: {tr.driver_id.substring(0,6)}...</span>}
                      </div>
                      {tr.reason && <div className="text-xs text-slate-500 mt-1">{tr.reason}</div>}
                   </div>
                 ))}
               </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}