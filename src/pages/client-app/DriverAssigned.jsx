import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Shield, MessageCircle, Phone, Star, X } from 'lucide-react';
import RideMap from '@/components/map/RideMap';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function DriverAssigned() {
  const navigate = useNavigate();
  const location = useLocation();
  const orderId = location.state?.orderId;
  const [order, setOrder] = useState(null);
  const [driver, setDriver] = useState(null);

  useEffect(() => {
    if (!orderId) {
      navigate('/app-cliente/home');
      return;
    }

    let isMounted = true;
    
    const loadData = async () => {
      try {
        const o = await base44.entities.RideOrder.get(orderId);
        if (isMounted) setOrder(o);
        if (o.driver_id) {
          const d = await base44.entities.Driver.get(o.driver_id);
          if (isMounted) setDriver(d);
        }
      } catch (err) {
        console.error(err);
      }
    };
    
    loadData();

    const checkStatus = async () => {
      try {
        const o = await base44.entities.RideOrder.get(orderId);
        if (!isMounted) return;
        setOrder(o);
        
        if (o.status === 'en_viaje') {
          navigate('/app-cliente/active-ride', { state: { orderId }, replace: true });
        } else if (o.status === 'completado') {
          navigate('/app-cliente/rating', { state: { orderId }, replace: true });
        } else if (o.status === 'cancelado' || o.status === 'rechazado') {
          toast.error('El viaje fue cancelado');
          navigate('/app-cliente/home', { replace: true });
        }
      } catch (e) {}
    };

    const interval = setInterval(checkStatus, 5000);

    const unsubscribe = base44.entities.RideOrder.subscribe(async (event) => {
      if (event.data?.id === orderId) {
        const o = event.data;
        setOrder(o);
        
        if (o.status === 'en_viaje') {
          navigate('/app-cliente/active-ride', { state: { orderId }, replace: true });
        } else if (o.status === 'completado') {
          navigate('/app-cliente/rating', { state: { orderId }, replace: true });
        } else if (o.status === 'cancelado' || o.status === 'rechazado') {
          toast.error('El viaje fue cancelado');
          navigate('/app-cliente/home', { replace: true });
        } else if (o.driver_id && (!driver || driver.id !== o.driver_id)) {
          try {
            const d = await base44.entities.Driver.get(o.driver_id);
            setDriver(d);
          } catch(e) {}
        }
      }
    });

    return () => {
      isMounted = false;
      clearInterval(interval);
      unsubscribe();
    };
  }, [orderId, navigate, driver]);

  useEffect(() => {
    if (order?.status === 'en_camino') {
      try {
        // Sonido de bocina para avisar que el auto está afuera
        const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
        audio.play().catch(() => {});
        toast.success("¡Tu chofer ya está en la puerta!", {
          duration: 6000,
          position: 'top-center'
        });
        if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 500]);
      } catch(e) {}
    }
  }, [order?.status]);

  const handleCancel = async () => {
    if (!orderId) return;
    try {
      await base44.entities.RideOrder.update(orderId, { status: 'cancelado' });
      toast.info('Viaje cancelado correctamente');
      navigate('/app-cliente/home', { replace: true });
    } catch (error) {
      toast.error('Error al cancelar el viaje');
    }
  };

  return (
    <div className="h-[100dvh] flex flex-col relative bg-slate-100" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="absolute inset-0 z-0">
        <RideMap 
          className="border-none rounded-none w-full h-full" 
          autoFit={true} 
          zoom={15} 
          orders={order ? [order] : []}
          drivers={driver ? [driver] : []}
          centerOn={driver?.current_lat ? [driver.current_lat, driver.current_lng] : null}
        />
      </div>
      
      {/* Etiqueta Superior */}
      <div className="absolute top-14 inset-x-0 flex justify-center z-10">
        <div className="bg-slate-900 text-white px-6 py-3 rounded-full shadow-xl font-bold flex items-center gap-2">
          <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
          Llega en 4 minutos
        </div>
      </div>

      {/* Bottom Sheet con info del conductor */}
      <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-[2.5rem] shadow-[0_-20px_40px_rgba(0,0,0,0.1)] p-6 z-10 flex flex-col gap-6 animate-in slide-in-from-bottom-full duration-500">
        <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto -mt-2"></div>
        
        {/* Info Coche y Chofer */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-3xl font-black text-slate-900">{driver?.vehicle_plate || '...'}</h2>
            <p className="text-slate-500 font-medium text-lg">
              {driver?.vehicle_color || ''} {driver?.vehicle_model || 'Móvil asignado'} 
              {order?.driver_name && ` · ${order.driver_name}`}
            </p>
          </div>
          <div className="relative">
            <img src={driver?.photo_url || "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150&h=150&q=80"} alt="Conductor" className="w-20 h-20 rounded-full object-cover shadow-md border-4 border-white" />
            <div className="absolute -bottom-2 -left-2 bg-white px-2 py-1 rounded-full shadow border border-slate-100 flex items-center gap-1 text-xs font-bold text-slate-700">
              <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" /> 4.9
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 p-4 bg-slate-50 rounded-2xl border border-slate-100">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center shrink-0 mt-0.5">
              <div className="w-2.5 h-2.5 bg-green-500 rounded-full"></div>
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Origen</p>
              <p className="font-bold text-slate-800 text-sm leading-tight">{order?.pickup_address || '...'}</p>
            </div>
          </div>
          <div className="w-0.5 h-4 bg-slate-200 ml-[11px]"></div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
              <div className="w-2.5 h-2.5 bg-red-500 rounded-full"></div>
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Destino</p>
              <p className="font-bold text-slate-800 text-sm leading-tight">{order?.dropoff_address || '...'}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-green-500 shrink-0" />
          <p className="text-sm font-semibold text-slate-700">
            {order?.driver_name?.split(' ')[0] || 'El conductor'} cumple con los estándares de seguridad.
          </p>
        </div>

        {/* Acciones */}
        <div className="flex gap-4">
          <a href="tel:3442667570" className="flex-1 bg-slate-100 hover:bg-slate-200 h-14 rounded-2xl flex items-center justify-center gap-2 font-bold text-slate-700 transition-colors">
            <Phone className="w-5 h-5" /> Llamar
          </a>
          <button onClick={handleCancel} className="flex-1 bg-red-50 hover:bg-red-100 text-red-600 h-14 rounded-2xl flex items-center justify-center gap-2 font-bold transition-colors">
            <X className="w-5 h-5" /> Rechazar
          </button>
        </div>
      </div>
    </div>
  );
}