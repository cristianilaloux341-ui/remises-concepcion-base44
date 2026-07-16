import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Share2, MessageCircle, X, Send } from 'lucide-react';
import StaticMap from './components/StaticMap';

export default function ActiveRide() {
  const navigate = useNavigate();
  const [showChat, setShowChat] = useState(false);
  const [showPanic, setShowPanic] = useState(false);

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
        <button onClick={() => setShowChat(true)} className="w-14 h-14 bg-blue-50 rounded-full shadow-lg flex items-center justify-center text-blue-600 active:scale-95 border border-blue-100">
          <MessageCircle className="w-6 h-6" />
        </button>
        <button onClick={() => setShowPanic(true)} className="w-14 h-14 bg-red-50 rounded-full shadow-lg flex items-center justify-center text-red-600 active:scale-95 border border-red-100">
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

      {/* Chat Modal */}
      {showChat && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex flex-col justify-end backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-t-[2rem] h-[75vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom-full duration-300">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-lg text-slate-900">Soporte</h3>
                <p className="text-xs text-slate-500 font-medium">Hablando con un Operador</p>
              </div>
              <button onClick={() => setShowChat(false)} className="p-2 bg-slate-100 rounded-full active:scale-95"><X className="w-5 h-5 text-slate-600"/></button>
            </div>
            <div className="flex-1 p-5 overflow-y-auto space-y-4 bg-slate-50/50">
              <div className="bg-slate-200 p-3 rounded-2xl rounded-tl-sm w-[80%] text-slate-800 text-sm shadow-sm">
                Hola, soy el operador de turno. ¿En qué te puedo ayudar?
              </div>
            </div>
            <div className="p-5 border-t border-slate-100 flex gap-3 bg-white">
              <input type="text" placeholder="Escribe un mensaje..." className="flex-1 bg-slate-100 border-none rounded-full px-5 py-3 outline-none text-sm placeholder:text-slate-400" />
              <button className="w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center shrink-0 active:scale-95 shadow-md shadow-blue-600/20">
                <Send className="w-5 h-5 -ml-1 mt-1" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Panic Modal */}
      {showPanic && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-6 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-[2rem] p-6 text-center w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-red-50">
              <ShieldAlert className="w-10 h-10 text-red-600" />
            </div>
            <h3 className="font-black text-2xl mb-2 text-slate-900">¿Estás en peligro?</h3>
            <p className="text-slate-500 mb-6 text-sm">Esto enviará una alerta inmediata a la central y compartirá tu ubicación en tiempo real con las autoridades.</p>
            <div className="space-y-3">
              <button onClick={() => setShowPanic(false)} className="w-full py-4 rounded-2xl bg-red-600 text-white font-bold text-lg active:scale-95 shadow-lg shadow-red-600/30 transition-transform">
                SÍ, ENVIAR ALERTA
              </button>
              <button onClick={() => setShowPanic(false)} className="w-full py-4 rounded-2xl bg-slate-100 text-slate-600 font-bold active:scale-95 transition-transform">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}