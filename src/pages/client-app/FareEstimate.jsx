import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, CreditCard, ShieldCheck } from 'lucide-react';
import StaticMap from './components/StaticMap';

export default function FareEstimate() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState('x');

  return (
    <div className="h-[100dvh] flex flex-col relative bg-slate-100" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <StaticMap showRoute={true} />
      
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
          <div 
            onClick={() => setSelected('x')}
            className={`p-4 rounded-3xl border-2 flex items-center gap-4 transition-all ${selected === 'x' ? 'border-blue-600 bg-blue-50/50' : 'border-slate-100 bg-white'}`}
          >
            <div className="w-16 h-12 bg-slate-100 rounded-lg flex items-center justify-center text-2xl shrink-0">🚘</div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-bold text-slate-900 text-lg">Evoloux X</p>
                <div className="bg-slate-100 px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1"><Clock className="w-3 h-3"/> 4 min</div>
              </div>
              <p className="text-sm text-slate-500">Viajes rápidos y accesibles</p>
            </div>
            <div className="text-right">
              <p className="font-bold text-xl text-slate-900">$4,500</p>
            </div>
          </div>

          <div 
            onClick={() => setSelected('xl')}
            className={`p-4 rounded-3xl border-2 flex items-center gap-4 transition-all ${selected === 'xl' ? 'border-blue-600 bg-blue-50/50' : 'border-slate-100 bg-white'}`}
          >
            <div className="w-16 h-12 bg-slate-100 rounded-lg flex items-center justify-center text-2xl shrink-0">🚙</div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-bold text-slate-900 text-lg">Evoloux XL</p>
                <div className="bg-slate-100 px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1"><Clock className="w-3 h-3"/> 7 min</div>
              </div>
              <p className="text-sm text-slate-500">Más espacio y confort</p>
            </div>
            <div className="text-right">
              <p className="font-bold text-xl text-slate-900">$6,200</p>
            </div>
          </div>
        </div>

        {/* Pago y Confirmación */}
        <div className="flex items-center justify-between border-y border-slate-100 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-slate-700" />
            </div>
            <div>
              <p className="font-bold text-slate-900 text-sm">Tarjeta terminada en 4242</p>
              <p className="text-blue-600 text-xs font-bold">Cambiar pago</p>
            </div>
          </div>
          <ShieldCheck className="w-6 h-6 text-green-500" />
        </div>

        <button 
          onClick={() => navigate('/client/searching')}
          className="w-full h-16 bg-slate-900 text-white rounded-2xl font-bold text-xl shadow-lg active:scale-95 transition-transform"
        >
          Confirmar Evoloux {selected === 'x' ? 'X' : 'XL'}
        </button>
      </div>
    </div>
  );
}