import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Share2, MapPin } from 'lucide-react';
import StaticMap from './components/StaticMap';

export default function ActiveRide() {
  const navigate = useNavigate();

  return (
    <div className="h-[100dvh] flex flex-col relative bg-slate-100" style={{ paddingBottom: 'env(safe-area-bottom)' }}>
      <StaticMap showRoute={true} showCar={true} />
      
      {/* Etiqueta Superior */}
      <div className="absolute top-14 inset-x-0 flex justify-center z-10">
        <div className="bg-white px-6 py-4 rounded-3xl shadow-xl flex items-center gap-4">
          <div className="text-center">
            <p className="text-3xl font-black text-slate-900">12<span className="text-lg">min</span></p>
            <p className="text-slate-500 font-semibold text-xs">Llegada est. 14:30</p>
          </div>
          <div className="w-px h-10 bg-slate-200"></div>
          <div className="space-y-1">
            <p className="text-xs font-bold text-slate-400">DESTINO</p>
            <p className="font-bold text-slate-800 text-sm w-40 truncate">Alto Palermo Shopping</p>
          </div>
        </div>
      </div>

      {/* Botones Flotantes Laterales */}
      <div className="absolute bottom-40 right-4 z-10 flex flex-col gap-3">
        <button className="w-14 h-14 bg-white rounded-full shadow-lg flex items-center justify-center text-slate-700 active:scale-95 border border-slate-100">
          <Share2 className="w-6 h-6" />
        </button>
        <button className="w-14 h-14 bg-red-50 rounded-full shadow-lg flex items-center justify-center text-red-600 active:scale-95 border border-red-100">
          <ShieldAlert className="w-6 h-6" />
        </button>
      </div>

      {/* Bottom Sheet */}
      <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-[2.5rem] shadow-[0_-20px_40px_rgba(0,0,0,0.1)] p-6 z-10 flex flex-col gap-4 animate-in slide-in-from-bottom-full duration-500">
        <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto -mt-2"></div>
        
        <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
          <img src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=100&h=100&q=80" alt="Chofer" className="w-12 h-12 rounded-full object-cover shadow-sm" />
          <div className="flex-1">
            <p className="font-bold text-slate-900">Viajando con Carlos</p>
            <p className="text-sm text-slate-500">Toyota Corolla · AB 123 CD</p>
          </div>
        </div>

        <button 
          onClick={() => navigate('/app-cliente/finished')}
          className="w-full h-16 bg-slate-900 text-white rounded-2xl font-bold text-lg shadow-lg active:scale-95 transition-transform mt-2"
        >
          [DEMO] Simular Fin de Viaje
        </button>
      </div>
    </div>
  );
}