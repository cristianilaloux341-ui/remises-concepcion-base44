import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, History, MapPin, User, Settings, HelpCircle, CreditCard } from 'lucide-react';

export default function Profile() {
  const navigate = useNavigate();

  const clientName = localStorage.getItem('client_name') || 'Cliente';

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col pb-10">
      <div className="bg-blue-600 text-white p-6 pt-16 pb-10 rounded-b-[3rem] shadow-xl relative">
        <button onClick={() => navigate(-1)} className="absolute top-12 left-4 p-2 rounded-full bg-white/20 hover:bg-white/30">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-5 mt-6">
          <div className="w-20 h-20 bg-blue-700 rounded-full flex items-center justify-center border-4 border-white/20 text-3xl shadow-inner">
            👤
          </div>
          <div>
            <h1 className="text-2xl font-black">{clientName}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="bg-red-500 text-white px-2 py-0.5 rounded text-xs font-bold tracking-wider shadow-sm">NUEVO MIEMBRO</span>
              <span className="text-blue-100 text-sm font-medium">★ 5.0</span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 -mt-6 relative z-10 space-y-4">
        {/* Menu Grid */}
        <div className="bg-white rounded-3xl p-2 shadow-sm border border-slate-100">
          
          <div className="flex items-center gap-4 p-4 active:bg-slate-50 rounded-2xl cursor-pointer">
            <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center"><History className="w-5 h-5 text-blue-600" /></div>
            <div className="flex-1 font-bold text-slate-800">Historial de Viajes</div>
          </div>
          
          <div className="flex items-center gap-4 p-4 active:bg-slate-50 rounded-2xl cursor-pointer">
            <div className="w-10 h-10 bg-indigo-50 rounded-full flex items-center justify-center"><CreditCard className="w-5 h-5 text-indigo-600" /></div>
            <div className="flex-1 font-bold text-slate-800">Métodos de Pago</div>
          </div>

          <div className="flex items-center gap-4 p-4 active:bg-slate-50 rounded-2xl cursor-pointer">
            <div className="w-10 h-10 bg-emerald-50 rounded-full flex items-center justify-center"><MapPin className="w-5 h-5 text-emerald-600" /></div>
            <div className="flex-1 font-bold text-slate-800">Direcciones Favoritas</div>
          </div>

        </div>

        <div className="bg-white rounded-3xl p-2 shadow-sm border border-slate-100">
          <div className="flex items-center gap-4 p-4 active:bg-slate-50 rounded-2xl cursor-pointer">
            <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center"><Settings className="w-5 h-5 text-slate-600" /></div>
            <div className="flex-1 font-bold text-slate-800">Configuración</div>
          </div>
          <div className="flex items-center gap-4 p-4 active:bg-slate-50 rounded-2xl cursor-pointer">
            <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center"><HelpCircle className="w-5 h-5 text-slate-600" /></div>
            <div className="flex-1 font-bold text-slate-800">Ayuda y Soporte</div>
          </div>
        </div>

        <button className="w-full p-4 text-center font-bold text-red-500 bg-white rounded-2xl shadow-sm border border-slate-100 mt-6 active:scale-95 transition-transform">
          Cerrar Sesión
        </button>

      </div>
    </div>
  );
}