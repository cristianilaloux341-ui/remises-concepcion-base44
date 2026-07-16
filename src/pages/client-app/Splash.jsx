import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Splash() {
  const navigate = useNavigate();
  
  useEffect(() => {
    const t = setTimeout(() => navigate('/app-cliente/home'), 2500);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div className="h-[100dvh] bg-slate-950 flex flex-col items-center justify-center relative overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Acento Premium */}
      <div className="absolute inset-0 bg-blue-600/20 blur-[100px] rounded-full w-[500px] h-[500px] -top-20 -left-20 pointer-events-none"></div>
      
      <div className="z-10 text-center space-y-6 animate-in fade-in zoom-in duration-700">
        <div className="w-28 h-28 bg-white rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl">
          <span className="text-5xl font-black text-slate-950 tracking-tighter">EV</span>
        </div>
        <div>
          <h1 className="text-5xl font-black text-white tracking-tight mb-2">Evoloux</h1>
          <p className="text-blue-400 font-semibold tracking-[0.3em] text-sm">PREMIUM RIDES</p>
        </div>
      </div>
    </div>
  );
}