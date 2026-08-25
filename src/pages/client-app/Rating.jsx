import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Star, CheckCircle2, Building2 } from 'lucide-react';
import RideTicket from "@/components/orders/RideTicket";
import { base44 } from '@/api/base44Client';

export default function Rating() {
  const navigate = useNavigate();
  const location = useLocation();
  const orderId = location.state?.orderId;
  const [order, setOrder] = useState(null);
  const [driverRating, setDriverRating] = useState(0);
  const [companyRating, setCompanyRating] = useState(0);

  useEffect(() => {
    if (!orderId) return;
    base44.entities.RideOrder.get(orderId).then(setOrder).catch(console.error);
  }, [orderId]);

  const displayOrder = order || {
     id: "Cargando...",
     created_date: new Date().toISOString(),
     driver_name: "Cargando...",
     client_name: localStorage.getItem('client_name') || "Pasajero",
     pickup_address: "Cargando...",
     importe_real_actual: 0,
  };

  const finalAmount = order ? Math.max(0, Number(order.importe_real_actual ?? 0)) : 0;

  return (
    <div className="h-[100dvh] bg-white flex flex-col justify-between p-6 pt-20 text-center animate-in fade-in duration-500" style={{ paddingBottom: 'env(safe-area-bottom)' }}>
      
      <div className="space-y-6">
        <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-12 h-12 text-green-500" />
        </div>
        <h1 className="text-3xl font-black text-slate-900">¡Llegaste a tu destino!</h1>
        <p className="text-slate-500 font-medium text-lg">Monto abonado: <span className="font-bold text-slate-900">${finalAmount.toLocaleString()}</span></p>

        <div className="flex justify-center -mt-2">
            <RideTicket order={displayOrder} />
        </div>

        <div className="pt-6 border-t border-slate-100 flex flex-col gap-6 overflow-y-auto">
          <p className="text-slate-500">Gracias por elegir viajar con nosotros.</p>
        </div>
      </div>

      <button 
        onClick={() => navigate('/app-cliente/home')}
        className={`w-full h-16 rounded-2xl font-bold text-lg shadow-lg active:scale-95 transition-all mt-4 shrink-0 bg-blue-600 text-white shadow-blue-600/30`}
      >
        Volver al inicio
      </button>

    </div>
  );
}