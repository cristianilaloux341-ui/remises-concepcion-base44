import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Play, Square, Activity, CheckCircle2, XCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function SimulacionDiaReal() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchStatus = async () => {
    try {
      const res = await base44.functions.invoke('runDaySimulation', { action: 'status', internalKey: import.meta.env.VITE_INTERNAL_SERVICE_KEY || "rc-internal-master-key-2024" });
      if (res.data?.success) {
        setStatus(res.data.state);
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

  const handleStart = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('runDaySimulation', { action: 'start', internalKey: import.meta.env.VITE_INTERNAL_SERVICE_KEY || "rc-internal-master-key-2024" });
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
      await base44.functions.invoke('runDaySimulation', { action: 'abort', internalKey: import.meta.env.VITE_INTERNAL_SERVICE_KEY || "rc-internal-master-key-2024" });
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

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-heading tracking-tight text-white mb-2">Simulación Día Real</h1>
        <p className="text-muted-foreground text-sm">
          Reproduce un día completo de despacho (1.000 pasajes, 50 móviles) con choques de concurrencia, alta demanda y reconexiones en un entorno aislado usando entidades de prueba.
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
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-slate-300">
                <span>Progreso: {notes.processedOrders} / 1000 pasajes creados</span>
                <span>{Math.round(progressValue)}%</span>
              </div>
              <Progress value={progressValue} className="h-2 bg-slate-800" />
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
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
                  <span className="text-slate-500 block">Pendientes/Duplicados</span>
                  <span className="text-yellow-400 text-xl font-bold">{notes.pendientes} / {notes.duplicados}</span>
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
    </div>
  );
}