import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, CreditCard, ShieldCheck, Loader2 } from 'lucide-react';
import RideMap from '@/components/map/RideMap';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { detectZoneFromCoords, detectZoneFromAddress } from '@/lib/dispatchLogic';
import { calcularImportePorFichas, normalizarTarifa } from '@/hooks/useTarifaConfig';

export default function FareEstimate() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [isCreating, setIsCreating] = useState(false);
  const [tarifa, setTarifa] = useState(null);
  const [estimatedPrice, setEstimatedPrice] = useState(null);
  const [distance, setDistance] = useState(null);
  const [calculatingPrice, setCalculatingPrice] = useState(true);
  const pickup = state?.pickup || 'Mi ubicación';
  const [resolvedPickupCoords, setResolvedPickupCoords] = useState(state?.pickupCoords || null);
  const dropoff = state?.dropoff || 'Destino seleccionado';
  const [resolvedDropoffCoords, setResolvedDropoffCoords] = useState(state?.dropoffCoords || null);
  const getSessionToken = () => localStorage.getItem('client_session_token');

  useEffect(() => {
    const fetchEstimate = async () => {
      try {
        const res = await base44.entities.TarifaConfig.list();
        const currentTarifa = res.length > 0 ? res[0] : null;
        setTarifa(currentTarifa);
        let finalPickupCoords = resolvedPickupCoords;
        let finalDropoffCoords = resolvedDropoffCoords;
        if (!finalPickupCoords && pickup === 'Mi ubicación') {
          try {
            const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000, enableHighAccuracy: true }));
            finalPickupCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          } catch (err) { console.log('No se pudo obtener GPS para Mi ubicación', err); }
        }
        const geocodeString = async (address) => {
          try {
            const sessionToken = getSessionToken();
            if (!sessionToken) return null;
            const autoRes = await base44.functions.invoke('geocodeRoute', { action:'autocomplete', input:address, sessionToken });
            const preds = autoRes.data?.predictions;
            if (preds?.length) {
              const detRes = await base44.functions.invoke('geocodeRoute', { action:'placedetails', place_id:preds[0].place_id, description:preds[0].description, sessionToken });
              if (detRes.data?.lat && detRes.data?.lng) return { lat:detRes.data.lat, lng:detRes.data.lng };
            }
          } catch(e) { console.error('Error geocoding', address, e); }
          return null;
        };
        if (!finalPickupCoords && pickup && pickup !== 'Mi ubicación') finalPickupCoords = await geocodeString(pickup);
        if (!finalDropoffCoords && dropoff) finalDropoffCoords = await geocodeString(dropoff);
        if (finalPickupCoords && !resolvedPickupCoords) setResolvedPickupCoords(finalPickupCoords);
        if (finalDropoffCoords && !resolvedDropoffCoords) setResolvedDropoffCoords(finalDropoffCoords);
        if (currentTarifa && finalPickupCoords && finalDropoffCoords) {
          let dist = null;
          try {
            const sessionToken = getSessionToken();
            if (sessionToken) {
              const routeRes = await base44.functions.invoke('geocodeRoute', { action:'route', originLat:finalPickupCoords.lat, originLng:finalPickupCoords.lng, destLat:finalDropoffCoords.lat, destLng:finalDropoffCoords.lng, sessionToken });
              if (routeRes.data?.distance) dist = routeRes.data.distance;
            }
          } catch(e) { console.error('Error en geocodeRoute:', e); }
          if (!dist) {
            const R=6371e3, dLat=(finalDropoffCoords.lat-finalPickupCoords.lat)*Math.PI/180, dLon=(finalDropoffCoords.lng-finalPickupCoords.lng)*Math.PI/180;
            const a=Math.sin(dLat/2)**2+Math.cos(finalPickupCoords.lat*Math.PI/180)*Math.cos(finalDropoffCoords.lat*Math.PI/180)*Math.sin(dLon/2)**2;
            dist=(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)))*1.3;
          }
          if (dist) { setDistance(dist); const tarifaVigente=normalizarTarifa(currentTarifa); setEstimatedPrice(calcularImportePorFichas(dist,0,tarifaVigente)); }
        }
      } catch(e) { console.error('Error al calcular tarifa:',e); }
      finally { setCalculatingPrice(false); }
    };
    fetchEstimate();
  }, [resolvedPickupCoords, resolvedDropoffCoords]);

  const [passengers,setPassengers]=useState(1), [needsTrunk,setNeedsTrunk]=useState(false), [needsHelp,setNeedsHelp]=useState(false), [notes,setNotes]=useState(''), [paymentMethod,setPaymentMethod]=useState('Efectivo');

  const handleConfirm = async () => {
    if (isCreating) return;
    const clientId=localStorage.getItem('client_id')||'';
    const sessionToken=getSessionToken();
    if (!clientId || !sessionToken) { toast.error('Tu sesión venció. Ingresá nuevamente.'); navigate('/app-cliente/login',{replace:true}); return; }
    setIsCreating(true);
    try {
      const clientName=localStorage.getItem('client_name')||'Cliente App', clientPhone=localStorage.getItem('client_phone')||'';
      let finalNotes=`Pasajeros: ${passengers}`; if(needsTrunk)finalNotes+=' | Con baúl'; if(needsHelp)finalNotes+=' | Ayuda para subir'; if(notes.trim())finalNotes+=` | ${notes.trim()}`;
      let orderZone=null; try { if(resolvedPickupCoords)orderZone=await detectZoneFromCoords(resolvedPickupCoords.lat,resolvedPickupCoords.lng); if(!orderZone)orderZone=await detectZoneFromAddress(pickup); } catch(e){}
      const orderData={client_name:clientName,client_id:clientId,client_phone:clientPhone,pickup_address:pickup,dropoff_address:dropoff,pickup_lat:resolvedPickupCoords?.lat||null,pickup_lng:resolvedPickupCoords?.lng||null,dropoff_lat:resolvedDropoffCoords?.lat||null,dropoff_lng:resolvedDropoffCoords?.lng||null,notes:finalNotes,payment_method:paymentMethod.includes('Transferencia')?'Transferencia':'Efectivo',zone:orderZone,status:'procesando_despacho',source:'cliente',fare:estimatedPrice,importe_estimado:estimatedPrice,importe_real_actual:0,distancia_teorica_metros:distance?Math.round(distance):0,segundos_espera_acumulados:0};
      const res=await base44.functions.invoke('clientCreateAndDispatchRide',{orderData,sessionToken});
      if(res.data?.success){ localStorage.setItem('client_active_order_id',res.data.orderId); navigate('/app-cliente/searching',{state:{orderId:res.data.orderId}}); }
      else throw new Error(res.data?.reason||'Failed to dispatch ride');
    } catch(error){console.error(error);toast.error('Ocurrió un error al pedir el móvil');setIsCreating(false);}
  };

  return <div className="h-[100dvh] flex flex-col relative bg-slate-100" style={{paddingBottom:'env(safe-area-inset-bottom)'}}>
    <div className="absolute inset-0 z-0"><RideMap className="border-none rounded-none w-full h-full" autoFit={false} zoom={15}/></div>
    <div className="absolute top-0 inset-x-0 p-4 pt-14 z-10 flex"><button onClick={()=>navigate(-1)} className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center active:scale-95"><ArrowLeft className="w-6 h-6 text-slate-800"/></button></div>
    <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-[2.5rem] shadow-[0_-20px_40px_rgba(0,0,0,0.1)] p-6 z-10 flex flex-col gap-5 animate-in slide-in-from-bottom-full duration-500">
      <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto -mt-2 mb-2"></div>
      <div className="space-y-3"><div className="p-4 rounded-3xl border-2 border-blue-600 bg-blue-50/50 flex items-center gap-4"><div className="w-16 h-12 bg-white rounded-lg flex items-center justify-center text-2xl shrink-0 shadow-sm">🚘</div><div className="flex-1"><div className="flex items-center justify-between gap-2"><p className="font-bold text-slate-900 text-lg">Remís Estándar</p>{calculatingPrice?<Loader2 className="w-5 h-5 text-blue-600 animate-spin"/>:estimatedPrice?<p className="font-bold text-green-600 text-xl">~${estimatedPrice}</p>:tarifa?<p className="font-bold text-blue-600 text-lg">Desde ${tarifa.bajada_bandera}</p>:null}</div><p className="text-sm text-slate-500">{estimatedPrice?`Costo aproximado del viaje (${distance?Math.round(distance/1000*10)/10:0} km)`:tarifa?'Costo base (sin destino exacto)':'Viaje seguro y rápido'}</p></div></div></div>
      <div className="space-y-3 pt-2"><div className="flex items-center justify-between gap-4"><label className="text-sm font-bold text-slate-700">Cantidad de pasajeros</label><div className="flex items-center gap-2">{[1,2,3,4].map(num=><button key={num} onClick={()=>setPassengers(num)} className={`w-10 h-10 rounded-full font-bold ${passengers===num?'bg-blue-600 text-white shadow-md':'bg-slate-100 text-slate-600'}`}>{num}</button>)}</div></div>
      <div className="flex gap-4"><label className="flex-1 flex items-center gap-2 p-3 border rounded-xl bg-slate-50"><input type="checkbox" checked={needsTrunk} onChange={e=>setNeedsTrunk(e.target.checked)} className="w-5 h-5 accent-blue-600"/><span className="text-sm font-medium text-slate-700">Llevo cosas al baúl</span></label><label className="flex-1 flex items-center gap-2 p-3 border rounded-xl bg-slate-50"><input type="checkbox" checked={needsHelp} onChange={e=>setNeedsHelp(e.target.checked)} className="w-5 h-5 accent-blue-600"/><span className="text-sm font-medium text-slate-700">Ayuda para subir</span></label></div><input type="text" placeholder="Ej: Llevo mascota, toca timbre, etc." value={notes} onChange={e=>setNotes(e.target.value)} className="w-full bg-slate-50 p-3 rounded-xl text-slate-900 text-sm border outline-none"/></div>
      <div className="flex items-center justify-between border-y border-slate-100 py-4 cursor-pointer rounded-xl px-2 -mx-2" onClick={()=>setPaymentMethod(p=>p==='Efectivo'?'Transferencia / MP':'Efectivo')}><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center"><CreditCard className="w-5 h-5 text-blue-600"/></div><div><p className="font-bold text-slate-900 text-sm">{paymentMethod}</p><p className="text-blue-600 text-xs font-bold">Tocar para cambiar</p></div></div><ShieldCheck className="w-6 h-6 text-green-500"/></div>
      <div className="flex gap-3 mt-2"><button onClick={()=>navigate(-1)} className="flex-1 h-14 bg-slate-100 text-slate-700 rounded-2xl font-bold text-lg">Cancelar</button><button onClick={handleConfirm} disabled={isCreating} className="flex-[2] h-14 bg-blue-600 disabled:opacity-50 text-white rounded-2xl font-bold text-lg shadow-lg flex items-center justify-center gap-2">{isCreating?<Loader2 className="w-6 h-6 animate-spin"/>:'Confirmar Viaje'}</button></div>
    </div>
  </div>;
}
