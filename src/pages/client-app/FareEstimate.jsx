import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Clock, CreditCard, ShieldCheck, Loader2 } from 'lucide-react';
import RideMap from '@/components/map/RideMap';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function FareEstimate() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [isCreating, setIsCreating] = useState(false);
  const [tarifa, setTarifa] = useState(null);
  const [estimatedPrice, setEstimatedPrice] = useState(null);
  const [distance, setDistance] = useState(null);
  const [calculatingPrice, setCalculatingPrice] = useState(true);

  const pickup = state?.pickup || 'Mi ubicación';
  const pickupCoords = state?.pickupCoords;
  const dropoff = state?.dropoff || 'Destino seleccionado';
  const dropoffCoords = state?.dropoffCoords;

  useEffect(() => {
    const fetchEstimate = async () => {
      try {
        const res = await base44.entities.TarifaConfig.list();
        const currentTarifa = res.length > 0 ? res[0] : null;
        setTarifa(currentTarifa);

        let finalPickupCoords = pickupCoords;
        let finalDropoffCoords = dropoffCoords;

        // Intentar geolocalizar si dice "Mi ubicación" y no hay coordenadas
        if (!finalPickupCoords && pickup === 'Mi ubicación') {
          try {
            const pos = await new Promise((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000, enableHighAccuracy: true });
            });
            finalPickupCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          } catch (err) {
            console.log("No se pudo obtener GPS para Mi ubicación", err);
          }
        }

        // Si faltan coordenadas (ej. favoritos o atajos), intentamos geocodificarlas usando el backend
        const geocodeString = async (address) => {
          try {
            const autoRes = await base44.functions.invoke("geocodeRoute", { action: "autocomplete", input: address });
            const preds = autoRes.data?.predictions;
            if (preds && preds.length > 0) {
               const detRes = await base44.functions.invoke("geocodeRoute", { action: "placedetails", place_id: preds[0].place_id, description: preds[0].description });
               if (detRes.data?.lat && detRes.data?.lng) {
                 return { lat: detRes.data.lat, lng: detRes.data.lng };
               }
            }
          } catch(e) { console.error("Error geocoding", address, e); }
          return null;
        };

        if (!finalPickupCoords && pickup && pickup !== 'Mi ubicación') {
          finalPickupCoords = await geocodeString(pickup);
        }
        if (!finalDropoffCoords && dropoff) {
          finalDropoffCoords = await geocodeString(dropoff);
        }

        if (currentTarifa && finalPickupCoords && finalDropoffCoords) {
          const routeRes = await base44.functions.invoke("geocodeRoute", {
            action: "route",
            originLat: finalPickupCoords.lat,
            originLng: finalPickupCoords.lng,
            destLat: finalDropoffCoords.lat,
            destLng: finalDropoffCoords.lng
          });
          
          if (routeRes.data?.distance) {
            setDistance(routeRes.data.distance);
            // Calculo aproximado: bajada de bandera + (metros * precio_por_metro)
            const calculated = currentTarifa.bajada_bandera + (routeRes.data.distance * currentTarifa.precio_por_metro);
            // Redondear a múltiplo de 100 por prolijidad
            setEstimatedPrice(Math.ceil(calculated / 100) * 100);
          }
        }
      } catch (e) {
        console.error("Error al calcular tarifa:", e);
      } finally {
        setCalculatingPrice(false);
      }
    };
    
    fetchEstimate();
  }, [pickupCoords, dropoffCoords]);

  const [passengers, setPassengers] = useState(1);
  const [needsTrunk, setNeedsTrunk] = useState(false);
  const [needsHelp, setNeedsHelp] = useState(false);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Efectivo');

  const handleConfirm = async () => {
    setIsCreating(true);
    try {
      const clientId = localStorage.getItem('client_id') || "";
      const clientName = localStorage.getItem('client_name') || "Cliente App";
      const clientPhone = localStorage.getItem('client_phone') || "";

      let finalNotes = `Pasajeros: ${passengers} | Pago: ${paymentMethod}`;
      if (needsTrunk) finalNotes += ` | Con baúl`;
      if (needsHelp) finalNotes += ` | Ayuda para subir`;
      if (notes.trim()) finalNotes += ` | ${notes.trim()}`;

      const order = await base44.entities.RideOrder.create({
        client_name: clientName,
        client_id: clientId,
        client_phone: clientPhone,
        pickup_address: pickup,
        dropoff_address: dropoff,
        notes: finalNotes,
        status: "pendiente",
        source: "cliente"
      });
      
      navigate('/app-cliente/searching', { state: { orderId: order.id } });
    } catch (error) {
      console.error(error);
      toast.error('Ocurrió un error al pedir el móvil');
      setIsCreating(false);
    }
  };

  return (
    <div className="h-[100dvh] flex flex-col relative bg-slate-100" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="absolute inset-0 z-0">
        <RideMap className="border-none rounded-none w-full h-full" autoFit={false} zoom={15} />
      </div>
      
      <div className="absolute top-0 inset-x-0 p-4 pt-14 z-10 flex">
        <button onClick={() => navigate(-1)} className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center active:scale-95">
          <ArrowLeft className="w-6 h-6 text-slate-800" />
        </button>
      </div>

      {/* Bottom Sheet */}
      <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-[2.5rem] shadow-[0_-20px_40px_rgba(0,0,0,0.1)] p-6 z-10 flex flex-col gap-5 animate-in slide-in-from-bottom-full duration-500">
        <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto -mt-2 mb-2"></div>
        
        {/* Opciones de Vehículo */}
        <div className="space-y-3">
          <div className="p-4 rounded-3xl border-2 border-blue-600 bg-blue-50/50 flex items-center gap-4 transition-all">
            <div className="w-16 h-12 bg-white rounded-lg flex items-center justify-center text-2xl shrink-0 shadow-sm">🚘</div>
            <div className="flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-slate-900 text-lg">Remís Estándar</p>
                {calculatingPrice ? (
                   <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                ) : estimatedPrice ? (
                   <p className="font-bold text-green-600 text-xl">~${estimatedPrice}</p>
                ) : tarifa ? (
                   <p className="font-bold text-blue-600 text-lg">Desde ${tarifa.bajada_bandera}</p>
                ) : null}
              </div>
              <p className="text-sm text-slate-500">
                {estimatedPrice 
                  ? `Costo aproximado del viaje (${distance ? Math.round(distance/1000 * 10) / 10 : 0} km)` 
                  : tarifa ? 'Costo base (sin destino exacto)' : 'Viaje seguro y rápido'}
              </p>
            </div>
          </div>
        </div>

        {/* Detalles del viaje */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between gap-4">
            <label className="text-sm font-bold text-slate-700">Cantidad de pasajeros</label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4].map(num => (
                <button
                  key={num}
                  onClick={() => setPassengers(num)}
                  className={`w-10 h-10 rounded-full font-bold flex items-center justify-center transition-colors ${passengers === num ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-4">
            <label className="flex-1 flex items-center gap-2 p-3 border border-slate-200 rounded-xl cursor-pointer bg-slate-50">
              <input 
                type="checkbox" 
                checked={needsTrunk}
                onChange={(e) => setNeedsTrunk(e.target.checked)}
                className="w-5 h-5 accent-blue-600 rounded shrink-0" 
              />
              <span className="text-sm font-medium text-slate-700 leading-tight">Llevo cosas al baúl</span>
            </label>
            <label className="flex-1 flex items-center gap-2 p-3 border border-slate-200 rounded-xl cursor-pointer bg-slate-50">
              <input 
                type="checkbox" 
                checked={needsHelp}
                onChange={(e) => setNeedsHelp(e.target.checked)}
                className="w-5 h-5 accent-blue-600 rounded shrink-0" 
              />
              <span className="text-sm font-medium text-slate-700 leading-tight">Ayuda para subir</span>
            </label>
          </div>

          <div>
            <input 
              type="text" 
              placeholder="Ej: Llevo mascota, toca timbre, etc." 
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-slate-50 p-3 rounded-xl text-slate-900 text-sm border border-slate-200 outline-none focus:border-blue-500 focus:bg-white transition-colors"
            />
          </div>
        </div>

        {/* Pago y Confirmación */}
        <div 
          className="flex items-center justify-between border-y border-slate-100 py-4 cursor-pointer hover:bg-slate-50 transition-colors rounded-xl px-2 -mx-2"
          onClick={() => setPaymentMethod(prev => prev === 'Efectivo' ? 'Transferencia / MP' : 'Efectivo')}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="font-bold text-slate-900 text-sm">{paymentMethod}</p>
              <p className="text-blue-600 text-xs font-bold">Tocar para cambiar</p>
            </div>
          </div>
          <ShieldCheck className="w-6 h-6 text-green-500" />
        </div>

        <button 
          onClick={handleConfirm}
          disabled={isCreating}
          className="w-full h-16 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:active:scale-100 text-white rounded-2xl font-bold text-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
        >
          {isCreating ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Confirmar Viaje'}
        </button>
      </div>
    </div>
  );
}