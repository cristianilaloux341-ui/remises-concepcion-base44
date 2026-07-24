import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, CheckCircle2, Building2 } from 'lucide-react';
import RideTicket from "@/components/orders/RideTicket";

export default function Rating() {
  const mockOrder = {
     id: "V-" + Math.floor(Math.random() * 10000),
     created_date: new Date().toISOString(),
     driver_name: "Carlos",
     client_name: localStorage.getItem('client_name') || "Pasajero",
     pickup_address: "Dirección de origen",
     dropoff_address: "Destino final",
     importe_real_actual: 4500,
  };
  const navigate = useNavigate();
  const [driverRating, setDriverRating] = useState(0);
  const [companyRating, setCompanyRating] = useState(0);

  return (
    <div className="h-[100dvh] bg-white flex flex-col justify-between p-6 pt-20 text-center animate-in fade-in duration-500" style={{ paddingBottom: 'env(safe-area-bottom)' }}>
      
      <div className="space-y-6">
        <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-12 h-12 text-green-500" />
        </div>
        <h1 className="text-3xl font-black text-slate-900">¡Llegaste a tu destino!</h1>
        <p className="text-slate-500 font-medium text-lg">Monto abonado: <span className="font-bold text-slate-900">$4,500</span></p>

        <div className="flex justify-center -mt-2">
            <RideTicket order={mockOrder} />
        </div>

        <div className="pt-6 border-t border-slate-100 flex flex-col gap-6 overflow-y-auto">
          
          <div>
            <img src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150&h=150&q=80" alt="Chofer" className="w-16 h-16 rounded-full object-cover mx-auto mb-3 shadow-md border-2 border-white" />
            <h2 className="text-lg font-bold text-slate-800">¿Cómo estuvo tu chofer Carlos?</h2>
            <div className="flex justify-center gap-2 mt-3">
              {[1,2,3,4,5].map((star) => (
                <button key={`driver-${star}`} onClick={() => setDriverRating(star)} className="active:scale-90 transition-transform">
                  <Star className={`w-10 h-10 ${driverRating >= star ? 'text-yellow-400 fill-yellow-400 drop-shadow-md' : 'text-slate-200'}`} />
                </button>
              ))}
            </div>
          </div>

          <div className="pt-6 border-t border-slate-100">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm border-2 border-white">
              <Building2 className="w-8 h-8 text-slate-400" />
            </div>
            <h2 className="text-lg font-bold text-slate-800">¿Cómo calificarías a Evoloux?</h2>
            <div className="flex justify-center gap-2 mt-3">
              {[1,2,3,4,5].map((star) => (
                <button key={`company-${star}`} onClick={() => setCompanyRating(star)} className="active:scale-90 transition-transform">
                  <Star className={`w-10 h-10 ${companyRating >= star ? 'text-blue-500 fill-blue-500 drop-shadow-md' : 'text-slate-200'}`} />
                </button>
              ))}
            </div>
          </div>

        </div>

        {(driverRating > 0 || companyRating > 0) && (
          <div className="pt-4 animate-in slide-in-from-bottom-4">
            <textarea 
              placeholder="Deja un comentario para ayudarnos a mejorar (opcional)" 
              className="w-full bg-slate-50 border border-slate-100 p-4 rounded-2xl resize-none outline-none focus:border-blue-500 transition-colors text-sm"
              rows={2}
            ></textarea>
          </div>
        )}
      </div>

      <button 
        onClick={() => navigate('/app-cliente/home')}
        className={`w-full h-16 rounded-2xl font-bold text-lg shadow-lg active:scale-95 transition-all mt-4 shrink-0 ${driverRating > 0 || companyRating > 0 ? 'bg-blue-600 text-white shadow-blue-600/30' : 'bg-slate-100 text-slate-400'}`}
      >
        {driverRating > 0 || companyRating > 0 ? 'Enviar calificación' : 'Omitir'}
      </button>

    </div>
  );
}