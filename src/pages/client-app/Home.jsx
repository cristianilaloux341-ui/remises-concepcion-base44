import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Search, Star, Clock } from 'lucide-react';
import StaticMap from './components/StaticMap';

export default function Home() {
  const navigate = useNavigate();
  
  return (
    <div className="h-[100dvh] flex flex-col relative bg-slate-100" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <StaticMap />
      
      {/* Top Bar */}
      <div className="absolute top-0 inset-x-0 p-5 z-10 flex justify-between items-center bg-gradient-to-b from-white/90 to-transparent pt-14">
        <button onClick={() => navigate('/app-cliente/profile')} className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform border border-slate-100">
          <Menu className="w-6 h-6 text-slate-800" />
        </button>
        <div className="bg-white px-5 py-2.5 rounded-full shadow-lg flex items-center gap-2 border border-slate-100">
          <span className="font-black text-slate-900 tracking-tight text-lg">Evoloux</span>
        </div>
      </div>

      {/* Bottom Sheet */}
      <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-[2.5rem] shadow-[0_-20px_40px_rgba(0,0,0,0.08)] p-6 z-10 flex flex-col gap-6 animate-in slide-in-from-bottom-full duration-500">
        <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto -mt-2"></div>
        
        <h2 className="text-2xl font-bold text-slate-900 mt-2">¿A dónde vamos?</h2>
        
        <button onClick={() => navigate('/app-cliente/request')} className="w-full bg-slate-50 p-5 rounded-2xl flex items-center gap-4 text-left active:bg-slate-100 transition-colors border border-slate-100 shadow-sm">
          <Search className="w-6 h-6 text-slate-500" />
          <span className="text-lg text-slate-500 font-medium">Buscar destino...</span>
        </button>

        <div className="flex gap-4 overflow-x-auto pb-4 pt-2 hide-scrollbar -mx-6 px-6">
          <div className="shrink-0 bg-white border border-slate-100 shadow-sm p-4 rounded-3xl flex items-center gap-4 w-56 active:scale-95 transition-transform" onClick={() => navigate('/app-cliente/request')}>
            <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center">
              <Star className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="font-bold text-slate-800">Casa</p>
              <p className="text-sm text-slate-500 truncate">9 de Julio 1250</p>
            </div>
          </div>
          <div className="shrink-0 bg-white border border-slate-100 shadow-sm p-4 rounded-3xl flex items-center gap-4 w-56 active:scale-95 transition-transform" onClick={() => navigate('/app-cliente/request')}>
            <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center">
              <Clock className="w-6 h-6 text-slate-600" />
            </div>
            <div>
              <p className="font-bold text-slate-800">Trabajo</p>
              <p className="text-sm text-slate-500 truncate">Leguizamón 350</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}