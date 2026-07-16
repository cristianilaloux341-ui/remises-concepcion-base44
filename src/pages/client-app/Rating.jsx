import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, CheckCircle2 } from 'lucide-react';

export default function Rating() {
  const navigate = useNavigate();
  const [rating, setRating] = useState(0);

  return (
    <div className="h-[100dvh] bg-white flex flex-col justify-between p-6 pt-20 text-center animate-in fade-in duration-500" style={{ paddingBottom: 'env(safe-area-bottom)' }}>
      
      <div className="space-y-6">
        <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-12 h-12 text-green-500" />
        </div>
        <h1 className="text-3xl font-black text-slate-900">¡Llegaste a tu destino!</h1>
        <p className="text-slate-500 font-medium text-lg">Monto abonado: <span className="font-bold text-slate-900">$4,500</span></p>

        <div className="pt-8 border-t border-slate-100">
          <img src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150&h=150&q=80" alt="Chofer" className="w-20 h-20 rounded-full object-cover mx-auto mb-4 shadow-md" />
          <h2 className="text-xl font-bold text-slate-800">¿Cómo fue tu viaje con Carlos?</h2>
          
          <div className="flex justify-center gap-2 mt-6">
            {[1,2,3,4,5].map((star) => (
              <button key={star} onClick={() => setRating(star)} className="active:scale-90 transition-transform">
                <Star className={`w-12 h-12 ${rating >= star ? 'text-yellow-400 fill-yellow-400 drop-shadow-md' : 'text-slate-200'}`} />
              </button>
            ))}
          </div>
        </div>

        {rating > 0 && (
          <div className="pt-6 animate-in slide-in-from-bottom-4">
            <textarea 
              placeholder="Deja un comentario (opcional)" 
              className="w-full bg-slate-50 border border-slate-100 p-4 rounded-2xl resize-none outline-none focus:border-blue-500 transition-colors"
              rows={3}
            ></textarea>
          </div>
        )}
      </div>

      <button 
        onClick={() => navigate('/client/home')}
        className={`w-full h-16 rounded-2xl font-bold text-lg shadow-lg active:scale-95 transition-all ${rating > 0 ? 'bg-blue-600 text-white shadow-blue-600/30' : 'bg-slate-100 text-slate-400'}`}
      >
        {rating > 0 ? 'Enviar calificación' : 'Omitir'}
      </button>

    </div>
  );
}