import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, MessageCircle, Phone, Star } from 'lucide-react';
import StaticMap from './components/StaticMap';

export default function DriverAssigned() {
  const navigate = useNavigate();

  return (
    <div className="h-[100dvh] flex flex-col relative bg-slate-100" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <StaticMap showRoute={true} showCar={true} />
      
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
            <h2 className="text-3xl font-black text-slate-900">AB 123 CD</h2>
            <p className="text-slate-500 font-medium text-lg">Toyota Corolla gris · Móvil #42</p>
          </div>
          <div className="relative">
            <img src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150&h=150&q=80" alt="Conductor" className="w-20 h-20 rounded-full object-cover shadow-md border-4 border-white" />
            <div className="absolute -bottom-2 -left-2 bg-white px-2 py-1 rounded-full shadow border border-slate-100 flex items-center gap-1 text-xs font-bold text-slate-700">
              <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" /> 4.9
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-green-500" />
          <p className="text-sm font-semibold text-slate-700">Carlos cumple con los estándares de seguridad Evoloux.</p>
        </div>

        {/* Acciones */}
        <div className="flex gap-4">
          <button className="flex-1 bg-slate-100 hover:bg-slate-200 h-14 rounded-2xl flex items-center justify-center gap-2 font-bold text-slate-700 transition-colors">
            <MessageCircle className="w-5 h-5" /> Mensaje
          </button>
          <button className="flex-1 bg-slate-100 hover:bg-slate-200 h-14 rounded-2xl flex items-center justify-center gap-2 font-bold text-slate-700 transition-colors">
            <Phone className="w-5 h-5" /> Llamar
          </button>
        </div>

        {/* Navegación al siguiente paso (para la demo) */}
        <button 
          onClick={() => navigate('/client/active-ride')}
          className="w-full h-16 bg-blue-600 text-white rounded-2xl font-bold text-lg shadow-lg shadow-blue-600/30 active:scale-95 transition-transform"
        >
          [DEMO] Simular Inicio de Viaje
        </button>
      </div>
    </div>
  );
}