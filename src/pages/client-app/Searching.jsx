import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import RideMap from '@/components/map/RideMap';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function Searching() {
  const navigate = useNavigate();
  const location = useLocation();
  const orderId = location.state?.orderId || localStorage.getItem('client_active_order_id');
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!orderId) {
      navigate('/app-cliente/home');
      return;
    }
    localStorage.setItem('client_active_order_id', orderId);

    let isMounted = true;
    const closeLocalRide = () => localStorage.removeItem('client_active_order_id');
    const checkOrder = async () => {
      try {
        const order = await base44.entities.RideOrder.get(orderId);
        if (order.status === 'aceptado' || order.status === 'en_camino') {
          if (isMounted) navigate('/app-cliente/assigned', { state: { orderId }, replace: true });
        } else if (order.status === 'en_viaje') {
          if (isMounted) navigate('/app-cliente/active-ride', { state: { orderId }, replace: true });
        } else if (order.status === 'completado') {
          closeLocalRide();
          if (isMounted) navigate('/app-cliente/rating', { state: { orderId }, replace: true });
        } else if (order.status === 'rechazado' || order.status === 'cancelado') {
          closeLocalRide();
          if (isMounted) {
            toast.error('Viaje cancelado o no hay móviles disponibles');
            navigate('/app-cliente/home', { replace: true });
          }
        }
      } catch (err) {
        console.error(err);
      }
    };

    checkOrder();

    const unsubscribe = base44.entities.RideOrder.subscribe((event) => {
      if (event.data?.id === orderId) {
        const status = event.data.status;
        if (status === 'aceptado' || status === 'en_camino') {
          navigate('/app-cliente/assigned', { state: { orderId }, replace: true });
        } else if (status === 'en_viaje') {
          navigate('/app-cliente/active-ride', { state: { orderId }, replace: true });
        } else if (status === 'completado') {
          closeLocalRide();
          navigate('/app-cliente/rating', { state: { orderId }, replace: true });
        } else if (status === 'rechazado' || status === 'cancelado') {
          closeLocalRide();
          toast.error('Viaje cancelado o no hay móviles disponibles');
          navigate('/app-cliente/home', { replace: true });
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [navigate, orderId]);

  const handleCancel = async () => {
    if (!orderId || cancelling) return;
    const clientId = localStorage.getItem('client_id');
    const sessionToken = localStorage.getItem('client_session_token');
    if (!clientId || !sessionToken) {
      toast.error('No se pudo validar tu sesión. Volvé a ingresar.');
      return;
    }
    setCancelling(true);
    try {
      const response = await base44.functions.invoke('clientCancelRide', { orderId, clientId, sessionToken });
      const result = response?.data || response;
      if (result?.success !== true) throw new Error(result?.reason || 'cancel_failed');
      localStorage.removeItem('client_active_order_id');
      toast.info('Búsqueda cancelada');
      navigate('/app-cliente/home', { replace: true });
    } catch (e) {
      console.error(e);
      toast.error('No se pudo cancelar el viaje. Intentá nuevamente.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="h-[100dvh] flex flex-col relative bg-slate-100 overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="absolute inset-0 z-0"><RideMap className="border-none rounded-none w-full h-full" autoFit={false} zoom={15} /></div>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] z-10 flex items-center justify-center">
        <div className="relative flex items-center justify-center">
          <div className="absolute w-64 h-64 border-4 border-blue-500/30 rounded-full animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]"></div>
          <div className="absolute w-48 h-48 border-4 border-blue-500/40 rounded-full animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite] delay-300"></div>
          <div className="w-24 h-24 bg-white rounded-full shadow-2xl flex items-center justify-center relative z-20"><span className="text-3xl">🚖</span></div>
        </div>
      </div>
      <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-[2.5rem] p-8 z-20 text-center space-y-4 animate-in slide-in-from-bottom-full">
        <h2 className="text-2xl font-black text-slate-900">Conectando con el mejor móvil...</h2>
        <p className="text-slate-500 font-medium pb-4">Esto tomará solo unos segundos</p>
        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden"><div className="h-full bg-blue-600 w-1/2 rounded-full animate-[pulse_1s_ease-in-out_infinite]"></div></div>
        <button onClick={handleCancel} disabled={cancelling} className="pt-4 text-slate-400 font-bold hover:text-slate-600 disabled:opacity-50">{cancelling ? 'Cancelando...' : 'Cancelar búsqueda'}</button>
      </div>
    </div>
  );
}