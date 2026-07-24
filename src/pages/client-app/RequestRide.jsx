import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, MapPin, ArrowRight } from 'lucide-react';

export default function RequestRide() {
  const navigate = useNavigate();
  const location = useLocation();
  const [pickup, setPickup] = useState('Mi ubicación');
  const [dropoff, setDropoff] = useState('');

  const handleContinue = (e) => {
    e.preventDefault();
    if (pickup.trim() && dropoff.trim()) {
      navigate('/app-cliente/fare', { state: { pickup: pickup.trim(), dropoff: dropoff.trim() } });
    }
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
            <div className="w-3.5 h-3.5 rounded-full bg-slate-900 ring-4 ring-white shadow-sm shrink-0"></div>
            <input 
              type="text" 
              value={pickup} 
              onChange={(e) => setPickup(e.target.value)}
              placeholder="Punto de partida"
              className="w-full bg-slate-50 p-4 rounded-2xl text-slate-900 font-semibold border border-slate-100 outline-none focus:border-slate-300 focus:bg-white transition-colors" 
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="w-3.5 h-3.5 rounded-sm bg-blue-600 ring-4 ring-white shadow-sm shrink-0"></div>
            <input 
              type="text" 
              placeholder="¿Hacia dónde vas?" 
              autoFocus 
              value={dropoff}
              onChange={(e) => setDropoff(e.target.value)}
              className="w-full bg-white p-4 rounded-2xl text-slate-900 font-semibold shadow-[0_0_0_2px_rgba(37,99,235,0.2)] border-blue-500 outline-none" 
            />
          </div>
          
          <button 
            type="submit" 
            disabled={!pickup.trim() || !dropoff.trim()}
            className="w-full mt-4 h-14 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:active:scale-100 text-white rounded-2xl font-bold text-lg shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
          >
            Continuar <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </form>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="p-4 flex items-center gap-4 active:bg-slate-50 rounded-3xl cursor-pointer transition-colors" onClick={() => navigate('/app-cliente/fare', { state: { pickup: '9 de Julio 1250', dropoff: 'Hospital Justo José de Urquiza' } })}>
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center shrink-0"><MapPin className="w-6 h-6 text-slate-600" /></div>
          <div className="flex-1 border-b border-slate-100 pb-4 pt-2">
            <p className="font-bold text-slate-900 text-lg">Hospital Justo José de Urquiza</p>
            <p className="text-sm text-slate-500">Uncal y 14 de Julio</p>
          </div>
        </div>
        <div className="p-4 flex items-center gap-4 active:bg-slate-50 rounded-3xl cursor-pointer transition-colors" onClick={() => navigate('/app-cliente/fare', { state: { pickup: '9 de Julio 1250', dropoff: 'Termas Concepción' } })}>
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center shrink-0"><MapPin className="w-6 h-6 text-slate-600" /></div>
          <div className="flex-1 border-b border-slate-100 pb-4 pt-2">
            <p className="font-bold text-slate-900 text-lg">Termas Concepción</p>
            <p className="text-sm text-slate-500">Ruta Nac. 14, Km 129</p>
          </div>
        </div>
      </div>
    </div>
  );
}