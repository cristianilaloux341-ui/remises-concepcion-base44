import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Splash() {
  const navigate = useNavigate();
  
  useEffect(() => {
    const t = setTimeout(() => {
      const clientId = localStorage.getItem('client_id');
      if (clientId) {
        navigate('/app-cliente/home');
      } else {
        navigate('/app-cliente/login');
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div className="h-[100dvh] bg-blue-600 flex flex-col items-center justify-center relative overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Acento Premium */}
      <div className="absolute inset-0 bg-red-500/30 blur-[100px] rounded-full w-[500px] h-[500px] -bottom-20 -right-20 pointer-events-none"></div>
      
      <div className="z-10 text-center space-y-6 animate-in fade-in zoom-in duration-700">
        <div className="w-32 h-32 bg-white rounded-3xl p-1 mx-auto shadow-2xl">
          <img 
            src="https://base44.app/api/apps/6a2195daf5c708d8398b3ca1/files/mp/public/6a2195daf5c708d8398b3ca1/a9e61fb71_9aaf2aa1d_whatsapp_image_2212741042823763.jpg" 
            alt="Remises Concepción" 
            className="w-full h-full rounded-[1.25rem] object-cover"
          />
        </div>
        <div>
          <h1 className="text-4xl font-black text-white tracking-tight mb-2">Remises Concepción</h1>
          <p className="text-green-300 font-bold tracking-[0.2em] text-sm">APP CLIENTES</p>
        </div>
      </div>
    </div>
  );
}