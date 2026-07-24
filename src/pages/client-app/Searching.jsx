import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import RideMap from '@/components/map/RideMap';

export default function Searching() {
  const navigate = useNavigate();
  
  useEffect(() => {
    // Simular búsqueda y transición automática a conductor asignado
    const t = setTimeout(() => navigate('/app-cliente/assigned'), 3500);
    return () => clearTimeout(t);
  }, [navigate]);

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
        
        <button onClick={() => navigate(-1)} className="pt-4 text-slate-400 font-bold hover:text-slate-600">
          Cancelar búsqueda
        </button>
      </div>
    </div>
  );
}