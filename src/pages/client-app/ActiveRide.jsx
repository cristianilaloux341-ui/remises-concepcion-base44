import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ShieldAlert, Share2, MessageCircle, X, Send } from 'lucide-react';
import RideMap from '@/components/map/RideMap';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function ActiveRide() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showChat, setShowChat] = useState(false);
  const [showPanic, setShowPanic] = useState(false);
  
  const orderId = location.state?.orderId;
  const [order, setOrder] = useState(null);
  const [driver, setDriver] = useState(null);
  const [chatMessage, setChatMessage] = useState("");
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    if (!orderId) return;
    
    base44.entities.RideOrder.get(orderId).then(o => {
      setOrder(o);
      if (o.driver_id) {
        base44.entities.Driver.get(o.driver_id).then(setDriver).catch(console.error);
      }
    }).catch(console.error);

    const unsubscribe = base44.entities.RideOrder.subscribe((event) => {
      if (event.data?.id === orderId) {
        setOrder(event.data);
        if (event.data.status === 'completado') {
          navigate('/app-cliente/rating', { state: { orderId }, replace: true });
        } else if (event.data.status === 'cancelado') {
          toast.error('El viaje fue cancelado');
          navigate('/app-cliente/home', { replace: true });
        }
      }
    });

    const clientId = localStorage.getItem('client_id');
    let unsubMsgs = () => {};
    if (clientId) {
      base44.entities.Message.filter({ driver_id: clientId }).then(setMessages).catch(console.error);
      unsubMsgs = base44.entities.Message.subscribe(ev => {
        if (ev.type === 'create' && ev.data.driver_id === clientId) {
          setMessages(prev => [...prev, ev.data]);
        }
      });
    }

    return () => {
      unsubscribe();
      unsubMsgs();
    };
  }, [orderId, navigate]);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Sigue mi viaje',
          text: `Viajo en un remis. Chofer: ${driver?.name || order?.driver_name || 'No definido'}, Patente: ${driver?.vehicle_plate || ''}. Destino: ${order?.dropoff_address || 'No definido'}`,
          url: window.location.href
        });
      } catch (err) {
        console.error(err);
      }
    } else {
      toast.error('Compartir no está soportado en este dispositivo');
    }
  };

  const handleSendPanic = async () => {
    try {
      await base44.entities.PanicAlert.create({
        driver_id: localStorage.getItem('client_id') || 'cliente-desconocido',
        driver_name: `CLIENTE: ${order?.client_name || 'Desconocido'}`,
        vehicle_plate: driver?.vehicle_plate || 'N/A',
        current_lat: order?.pickup_lat || 0,
        current_lng: order?.pickup_lng || 0,
        notes: `ALERTA DE CLIENTE EN VIAJE (Orden: ${orderId})`
      });
      setShowPanic(false);
      toast.success('Alerta enviada a la central');
    } catch (e) {
      toast.error('Error al enviar la alerta');
    }
  };

  const handleSendMessage = async () => {
    if (!chatMessage.trim()) return;
    try {
      await base44.entities.Message.create({
        from_type: 'movil',
        from_name: order?.client_name || 'Cliente',
        driver_id: localStorage.getItem('client_id') || 'cliente-desconocido',
        content: chatMessage
      });
      setChatMessage('');
    } catch (e) {
      toast.error('Error al enviar mensaje');
    }
  };

  return (
    <div className="h-[100dvh] flex flex-col relative bg-slate-100" style={{ paddingBottom: 'env(safe-area-bottom)' }}>
      <div className="absolute inset-0 z-0">
        <RideMap className="border-none rounded-none w-full h-full" autoFit={false} zoom={16} />
      </div>
      
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
            <p className="font-bold text-slate-800 text-sm w-40 truncate">Hospital Urquiza</p>
          </div>
        </div>
      </div>

      {/* Botones Flotantes Laterales */}
      <div className="absolute bottom-40 right-4 z-10 flex flex-col gap-3">
        <button onClick={handleShare} className="w-14 h-14 bg-white rounded-full shadow-lg flex items-center justify-center text-slate-700 active:scale-95 border border-slate-100">
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
          <img src={driver?.photo_url || "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=100&h=100&q=80"} alt="Chofer" className="w-12 h-12 rounded-full object-cover shadow-sm" />
          <div className="flex-1">
            <p className="font-bold text-slate-900">Viajando con {order?.driver_name?.split(' ')[0] || 'tu chofer'}</p>
            <p className="text-sm text-slate-500">{driver?.vehicle_model || 'Móvil'} · {driver?.vehicle_plate || ''}</p>
          </div>
        </div>
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
            <div className="flex-1 p-5 overflow-y-auto space-y-4 bg-slate-50/50 flex flex-col">
              <div className="bg-slate-200 p-3 rounded-2xl rounded-tl-sm w-[80%] text-slate-800 text-sm shadow-sm self-start">
                Hola, soy el operador de turno. ¿En qué te puedo ayudar?
              </div>
              {messages.map((msg, i) => (
                <div key={i} className={`p-3 rounded-2xl text-sm shadow-sm max-w-[80%] ${
                  msg.from_type === 'operador' 
                    ? 'bg-slate-200 text-slate-800 rounded-tl-sm self-start' 
                    : 'bg-blue-600 text-white rounded-tr-sm self-end'
                }`}>
                  {msg.content}
                </div>
              ))}
            </div>
            <div className="p-5 border-t border-slate-100 flex gap-3 bg-white">
              <input 
                type="text" 
                placeholder="Escribe un mensaje..." 
                className="flex-1 bg-slate-100 border-none rounded-full px-5 py-3 outline-none text-sm placeholder:text-slate-400" 
                value={chatMessage}
                onChange={e => setChatMessage(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
              />
              <button onClick={handleSendMessage} className="w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center shrink-0 active:scale-95 shadow-md shadow-blue-600/20">
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
              <button onClick={handleSendPanic} className="w-full py-4 rounded-2xl bg-red-600 text-white font-bold text-lg active:scale-95 shadow-lg shadow-red-600/30 transition-transform">
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