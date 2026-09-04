import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import RideMap from '@/components/map/RideMap';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function Searching() {
  const navigate = useNavigate();
  
  const location = useLocation();
  const orderId = location.state?.orderId;

  useEffect(() => {
    if (!orderId) {
      navigate('/app-cliente/home');
      return;
    }

    let isMounted = true;
    const checkOrder = async () => {
      try {
        const order = await base44.entities.RideOrder.get(orderId);
        if (order.status === 'preasignado_proximo' || order.status === 'aceptado' || order.status === 'en_camino') {
          if (isMounted) navigate('/app-cliente/assigned', { state: { orderId }, replace: true });
        } else if (order.status === 'rechazado' || order.status === 'cancelado') {
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
        if (status === 'preasignado_proximo' || status === 'aceptado' || status === 'en_camino') {
          navigate('/app-cliente/assigned', { state: { orderId }, replace: true });
        } else if (status === 'rechazado' || status === 'cancelado') {
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
    if (orderId) {
      try {
        const currentOrder = await base44.entities.RideOrder.get(orderId);
        const linkedDrivers = [...new Set([currentOrder?.driver_id, currentOrder?.reserved_driver_id, currentOrder?.preassigned_driver_id].filter(Boolean))];
        await base44.entities.RideOrder.update(orderId, {
          status: 'cancelado',
          offerExpiresAt: null,
          processingAction: null,
          processingOperationKey: null,
          processingOwnerId: null,
          processingLeaseExpiresAt: null,
          processingPhase: null
        });
        if (currentOrder?.preassigned_driver_id) {
          await base44.entities.Driver.updateMany(
            { id: currentOrder.preassigned_driver_id, next_order_id: orderId },
            { $set: { next_order_id: null, next_order_token: null } }
          );
        }
        if (linkedDrivers.length > 0) {
          await base44.entities.Driver.updateMany(
            { id: { $in: linkedDrivers }, $or: [{ active_order_id: orderId }, { active_ride_id: orderId }, { reserved_order_id: orderId }] },
            { $set: {
              status: 'disponible', dispatch_status: 'normal', active_order_id: null, active_ride_id: null,
              reserved_order_id: null, reservation_token: null, manual_reservation_token: null, driver_reservation_key: null
            } }
          );
          base44.functions.invoke('sendPushNotification', {
            action: 'cancel_multiple', orderId, driversToCancel: linkedDrivers
          }).catch(console.error);
        }
        toast.info('Búsqueda cancelada');
      } catch (e) {
        console.error(e);
      }
    }
    navigate('/app-cliente/home', { replace: true });
  };

  return (
    <div className="h-[100dvh] flex flex-col relative bg-slate-100 overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="absolute inset-0 z-0">
        <RideMap className="border-none rounded-none w-full h-full" autoFit={false} zoom={15} />
      </div>
      
      {/* Radar Overlay */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] z-10 flex items-center justify-center">
        <div className="relative flex items-center justify-center">
          <div className="absolute w-64 h-64 border-4 border-blue-500/30 rounded-full animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]"></div>
          <div className="absolute w-48 h-48 border-4 border-blue-500/40 rounded-full animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite] delay-300"></div>
          <div className="w-24 h-24 bg-white rounded-full shadow-2xl flex items-center justify-center relative z-20">
            <span className="text-3xl">🚖</span>
          </div>
        </div>
      </div>

      {/* Bottom Sheet */}
      <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-[2.5rem] p-8 z-20 text-center space-y-4 animate-in slide-in-from-bottom-full">
        <h2 className="text-2xl font-black text-slate-900">Conectando con el mejor móvil...</h2>
        <p className="text-slate-500 font-medium pb-4">Esto tomará solo unos segundos</p>
        
        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600 w-1/2 rounded-full animate-[pulse_1s_ease-in-out_infinite]"></div>
        </div>
        
        <button onClick={handleCancel} className="pt-4 text-slate-400 font-bold hover:text-slate-600">
          Cancelar búsqueda
        </button>
      </div>
    </div>
  );
}