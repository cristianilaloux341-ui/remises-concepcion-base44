import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, MapPin, ArrowRight, Calculator } from 'lucide-react';
import PickupAutocomplete from '@/components/orders/PickupAutocomplete';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function RequestRide() {
  const navigate = useNavigate();
  const location = useLocation();
  const [pickup, setPickup] = useState('Mi ubicación');
  const [pickupCoords, setPickupCoords] = useState(null);
  const [dropoff, setDropoff] = useState('');
  const [dropoffCoords, setDropoffCoords] = useState(null);
  const clientId = localStorage.getItem('client_id') || 'unregistered';

  useEffect(() => {
    if (pickup === 'Mi ubicación') {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setPickupCoords({ lat, lng });
        try {
          // Usamos el backend de Google Reverse Geocoding más rápido y exacto en lugar de Nominatim
          const sessionToken = localStorage.getItem('client_token') || 'client_demo_token';
          const res = await base44.functions.invoke("geocodeRoute", {
            action: "geocode",
            lat: lat,
            lng: lng,
            sessionToken
          });
          if (res.data?.address) {
            setPickup(res.data.address);
          }
        } catch (e) {
          console.error('Error reverse geocoding con backend:', e);
        }
      }, (err) => console.log('Location error:', err), { enableHighAccuracy: true });
    }
  }, []);

  useEffect(() => {
    // Si ya tenemos ambas coordenadas y el destino está escrito, auto-navegamos a calcular tarifa
    if (pickupCoords && dropoffCoords && dropoff.trim().length > 0) {
      const timer = setTimeout(() => {
        navigate('/app-cliente/fare', { 
          state: { 
            pickup: pickup.trim(), 
            pickupCoords,
            dropoff: dropoff.trim(),
            dropoffCoords
          } 
        });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [dropoffCoords, pickupCoords, navigate]);

  const handleContinue = (e) => {
    e.preventDefault();
    if (pickup === 'Mi ubicación') {
      toast.error('Obteniendo tu ubicación actual, por favor espera...');
      return;
    }
    if (pickup.trim()) {
      navigate('/app-cliente/fare', { 
        state: { 
          pickup: pickup.trim(), 
          pickupCoords,
          dropoff: dropoff.trim() || 'A convenir',
          dropoffCoords
        } 
      });
    }
  };

  const handleCalculate = (e) => {
    e.preventDefault();
    if (!dropoff.trim()) {
      toast.error('Ingresá un destino para poder calcular la tarifa');
      return;
    }
    handleContinue(e);
  };

  return (
    <div className="h-[100dvh] bg-white flex flex-col">
      <div className="p-4 pt-14 flex items-center gap-4 relative z-10 bg-white border-b border-slate-100">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-full hover:bg-slate-50"><ArrowLeft className="w-6 h-6 text-slate-800" /></button>
        <h1 className="text-xl font-bold text-slate-900">Tu ruta</h1>
      </div>
      
      <form onSubmit={handleContinue} className="p-6 bg-white border-b border-slate-100 relative shadow-sm z-10">
        <div className="absolute left-9 top-12 bottom-28 w-[3px] bg-slate-200 rounded-full"></div>
        <div className="space-y-4 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-3.5 h-3.5 rounded-full bg-slate-900 ring-4 ring-white shadow-sm shrink-0 relative z-20"></div>
            <div className="flex-1">
              <PickupAutocomplete 
                value={pickup} 
                onChange={(val, coords) => { setPickup(val); if (coords) setPickupCoords(coords); }}
                restrictToClient={clientId}
                placeholder="Punto de partida"
                className="w-full bg-slate-50 py-4 pr-4 pl-10 rounded-2xl text-slate-900 font-semibold border border-slate-100 focus:border-slate-300 focus:bg-white transition-colors h-auto shadow-none outline-none" 
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-3.5 h-3.5 rounded-sm bg-blue-600 ring-4 ring-white shadow-sm shrink-0 relative z-20"></div>
            <div className="flex-1">
              <PickupAutocomplete 
                placeholder="¿Hacia dónde vas?" 
                value={dropoff}
                onChange={(val, coords) => { setDropoff(val); if (coords) setDropoffCoords(coords); }}
                restrictToClient={clientId}
                className="w-full bg-white py-4 pr-4 pl-10 rounded-2xl text-slate-900 font-semibold border-blue-500 shadow-[0_0_0_2px_rgba(37,99,235,0.2)] h-auto outline-none" 
              />
            </div>
          </div>
          
          <button 
            type="button" 
            onClick={handleContinue}
            disabled={!pickup.trim() || pickup === 'Mi ubicación'}
            className="w-full mt-4 h-14 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:active:scale-100 text-white rounded-2xl font-bold text-lg shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
          >
            Continuar <ArrowRight className="w-5 h-5" />
          </button>
          
          <button 
            type="button" 
            onClick={handleCalculate}
            className="w-full mt-3 h-14 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-2xl font-bold text-lg active:scale-95 transition-all flex items-center justify-center gap-2 border border-blue-100"
          >
            <Calculator className="w-5 h-5" /> Calcular Tarifa
          </button>
        </div>
      </form>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="p-4 flex items-center gap-4 active:bg-slate-50 rounded-3xl cursor-pointer transition-colors" onClick={() => navigate('/app-cliente/fare', { state: { pickup: pickup || 'Mi ubicación', pickupCoords, dropoff: 'Hospital Urquiza (Víctor Rodríguez)', dropoffCoords: { lat: -32.482701, lng: -58.262529 } } })}>
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center shrink-0"><MapPin className="w-6 h-6 text-slate-600" /></div>
          <div className="flex-1 border-b border-slate-100 pb-4 pt-2 min-w-0">
            <p className="font-bold text-slate-900 text-lg truncate">Hospital (V. Rodríguez)</p>
            <p className="text-sm text-slate-500 truncate">Ingreso por Víctor Rodríguez</p>
          </div>
        </div>
        
        <div className="p-4 flex items-center gap-4 active:bg-slate-50 rounded-3xl cursor-pointer transition-colors" onClick={() => navigate('/app-cliente/fare', { state: { pickup: pickup || 'Mi ubicación', pickupCoords, dropoff: 'Hospital Urquiza (Sartorio)', dropoffCoords: { lat: -32.484251, lng: -58.261622 } } })}>
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center shrink-0"><MapPin className="w-6 h-6 text-slate-600" /></div>
          <div className="flex-1 border-b border-slate-100 pb-4 pt-2 min-w-0">
            <p className="font-bold text-slate-900 text-lg truncate">Hospital (L. Sartorio)</p>
            <p className="text-sm text-slate-500 truncate">Ingreso por L. Sartorio</p>
          </div>
        </div>

        <div className="p-4 flex items-center gap-4 active:bg-slate-50 rounded-3xl cursor-pointer transition-colors" onClick={() => navigate('/app-cliente/fare', { state: { pickup: pickup || 'Mi ubicación', pickupCoords, dropoff: 'Terminal de Ómnibus', dropoffCoords: { lat: -32.481155, lng: -58.237248 } } })}>
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center shrink-0"><MapPin className="w-6 h-6 text-slate-600" /></div>
          <div className="flex-1 border-b border-slate-100 pb-4 pt-2 min-w-0">
            <p className="font-bold text-slate-900 text-lg truncate">Terminal de Ómnibus</p>
            <p className="text-sm text-slate-500 truncate">Bv. Los Constituyentes 240</p>
          </div>
        </div>
      </div>
    </div>
  );
}