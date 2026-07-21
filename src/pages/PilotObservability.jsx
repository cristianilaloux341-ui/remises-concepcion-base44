import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { ShieldAlert, Activity, RefreshCw, XCircle, CheckCircle, Clock } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default function PilotObservability() {
  const [data, setData] = useState({
    activeBases: [],
    processingOrders: [],
    pendingDrivers: [],
    recentReconciliations: [],
    criticalErrors: []
  });

  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [bases, orders, drivers, logs] = await Promise.all([
        base44.entities.Base.filter({ dispatch_status: { $in: ['procesando', 'esperando_manual'] } }),
        base44.entities.RideOrder.filter({ status: 'procesando_despacho' }),
        base44.entities.Driver.filter({ dispatch_status: { $in: ['manual_pending', 'automatic_pending'] } }),
        base44.entities.AuditLog.list('-created_date', 100)
      ]);

      setData({
        activeBases: bases,
        processingOrders: orders,
        pendingDrivers: drivers,
        recentReconciliations: logs.filter(l => l.action.startsWith('RECONCILIATION_')),
        criticalErrors: logs.filter(l => 
          ['DISPATCH_CRITICAL_ERROR', 'DISPATCH_ENGINE_MISMATCH', 'PERSISTENCE_ERROR', 'INCONSISTENT_STATE', 'TOKEN_DIVERGENCE'].includes(l.action)
        )
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 10000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-500" /> Monitoreo Piloto Backend
          </h1>
          <p className="text-gray-500 text-sm mt-1">Observabilidad en tiempo real del motor de despacho atómico.</p>
        </div>
        <button onClick={fetchData} className="p-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200">
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {data.criticalErrors.length > 0 && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg">
          <h3 className="text-red-800 font-bold flex items-center gap-2">
            <ShieldAlert className="w-5 h-5" /> {data.criticalErrors.length} Errores Críticos Recientes
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-red-700">
            {data.criticalErrors.slice(0, 5).map(e => (
              <li key={e.id}>[{new Date(e.created_date).toLocaleTimeString()}] {e.action}: {e.details}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader><CardTitle>Bases Bloqueadas ({data.activeBases.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.activeBases.map(b => (
              <div key={b.id} className="text-sm p-2 bg-gray-50 rounded border">
                <p className="font-bold">{b.name} - {b.dispatch_status}</p>
                <p className="text-xs text-gray-500">TTL: {b.lock_expires_at ? new Date(b.lock_expires_at).toLocaleTimeString() : 'N/A'}</p>
                <p className="text-xs text-gray-400 truncate">Token: {b.lock_token || b.manual_reservation_token}</p>
              </div>
            ))}
            {data.activeBases.length === 0 && <p className="text-sm text-gray-500">Ninguna base retenida.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Viajes en Proceso ({data.processingOrders.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.processingOrders.map(o => (
              <div key={o.id} className="text-sm p-2 bg-gray-50 rounded border">
                <p className="font-bold">{o.pickup_address}</p>
                <p className="text-xs text-gray-500">Motor: {o.dispatch_engine || 'Pendiente'}</p>
              </div>
            ))}
            {data.processingOrders.length === 0 && <p className="text-sm text-gray-500">Sin viajes procesando.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Choferes Reservados ({data.pendingDrivers.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.pendingDrivers.map(d => (
              <div key={d.id} className="text-sm p-2 bg-gray-50 rounded border">
                <p className="font-bold">{d.name} ({d.vehicle_plate})</p>
                <p className="text-xs text-gray-500">Estado: {d.dispatch_status}</p>
              </div>
            ))}
            {data.pendingDrivers.length === 0 && <p className="text-sm text-gray-500">Sin choferes bloqueados.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Auditoría de Reconciliación ({data.recentReconciliations.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {data.recentReconciliations.map(l => (
              <div key={l.id} className="text-sm flex gap-4 p-2 border-b">
                <span className="text-gray-400 whitespace-nowrap">{new Date(l.created_date).toLocaleTimeString()}</span>
                <span className={`font-bold ${l.action.includes('REPAIRED') ? 'text-green-600' : 'text-amber-600'}`}>
                  {l.action}
                </span>
                <span className="text-gray-700">{l.details}</span>
              </div>
            ))}
            {data.recentReconciliations.length === 0 && <p className="text-sm text-gray-500">Sin intervenciones del reconciliador.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}