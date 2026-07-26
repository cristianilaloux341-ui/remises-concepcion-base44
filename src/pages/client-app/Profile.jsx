import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, History } from 'lucide-react';

export default function Profile() {
  const navigate = useNavigate();

  const clientName = localStorage.getItem('client_name') || 'Cliente';

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col pb-10">
      <div className="bg-blue-600 text-white p-6 pt-16 pb-10 rounded-b-[3rem] shadow-xl relative overflow-hidden">
        {/* Logo de la empresa como marca de agua de fondo */}
        <div className="absolute top-4 right-[-20px] opacity-10 pointer-events-none transform -rotate-12">
          <svg width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinelinejoin="round">
            <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/>
            <circle cx="7" cy="17" r="2"/>
            <path d="M9 17h6"/>
            <circle cx="17" cy="17" r="2"/>
          </svg>
        </div>

        <button onClick={() => navigate(-1)} className="absolute top-12 left-4 p-2 rounded-full bg-white/20 hover:bg-white/30 z-10">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-5 mt-6 relative z-10">
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
        </div>

        <button 
          onClick={() => {
            localStorage.clear();
            navigate('/app-cliente/login');
          }}
          className="w-full p-4 text-center font-bold text-red-500 bg-white rounded-2xl shadow-sm border border-slate-100 mt-6 active:scale-95 transition-transform"
        >
          Cerrar Sesión
        </button>

      </div>
    </div>
  );
}