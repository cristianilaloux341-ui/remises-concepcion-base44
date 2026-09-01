import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ShieldAlert, Share2, MessageCircle, X, Send, CheckCircle2 } from 'lucide-react';
import RideMap from '@/components/map/RideMap';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function ActiveRide() {
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const queryOrderId = searchParams.get('orderId');
  const queryClientAction = searchParams.get('clientAction');
  const orderId = location.state?.orderId || queryOrderId || localStorage.getItem('client_active_order_id');
  const [showChat,setShowChat]=useState(false), [showPanic,setShowPanic]=useState(false), [ackLoading,setAckLoading]=useState(false);
  const [order,setOrder]=useState(null), [driver,setDriver]=useState(null), [chatMessage,setChatMessage]=useState(''), [messages,setMessages]=useState([]);

  useEffect(()=>{
    if(!orderId){ navigate('/app-cliente/home',{replace:true}); return; }
    localStorage.setItem('client_active_order_id',orderId);
    let mounted=true;
    const applyOrder=(o)=>{ if(!mounted)return; setOrder(o); if(o.status==='completado'){localStorage.removeItem('client_active_order_id');navigate('/app-cliente/rating',{state:{orderId},replace:true});} else if(o.status==='cancelado'||o.status==='rechazado'){localStorage.removeItem('client_active_order_id');toast.error('El viaje fue cancelado');navigate('/app-cliente/home',{replace:true});} if(o.driver_id&&!driver)base44.entities.Driver.get(o.driver_id).then(d=>mounted&&setDriver(d)).catch(()=>{}); };
    base44.entities.RideOrder.get(orderId).then(applyOrder).catch(()=>navigate('/app-cliente/home',{replace:true}));
    const interval=setInterval(()=>base44.entities.RideOrder.get(orderId).then(applyOrder).catch(()=>{}),5000);
    const unsubscribe=base44.entities.RideOrder.subscribe(ev=>{if(ev.data?.id===orderId)applyOrder(ev.data);});
    const clientId=localStorage.getItem('client_id'); let unsubMsgs=()=>{};
    if(clientId){base44.entities.Message.filter({$or:[{driver_id:clientId},{to_driver_id:clientId}]}).then(setMessages).catch(()=>{});unsubMsgs=base44.entities.Message.subscribe(ev=>{if(ev.type==='create'&&(ev.data.driver_id===clientId||ev.data.to_driver_id===clientId))setMessages(p=>[...p,ev.data]);});}
    return()=>{mounted=false;clearInterval(interval);unsubscribe();unsubMsgs();};
  },[orderId,navigate]);

  const handleYaVoy=async()=>{
    if(!orderId||order?.client_arrival_acknowledged||ackLoading)return;
    const clientId=localStorage.getItem('client_id'); const sessionToken=localStorage.getItem('client_session_token');
    if(!clientId||!sessionToken){toast.error('Tu sesión venció. Ingresá nuevamente.');navigate('/app-cliente/login',{replace:true});return;}
    setAckLoading(true);
    try{const r=await base44.functions.invoke('clientArrivalAcknowledge',{orderId,clientId,sessionToken});const data=r?.data||r;if(!data?.success)throw new Error(data?.reason||'ack_failed');setOrder(prev=>prev?{...prev,client_arrival_acknowledged:true,client_arrival_acknowledged_at:data.acknowledgedAt||prev.client_arrival_acknowledged_at}:prev);toast.success('Listo, el chofer ya sabe que salís.');}
    catch(e){console.error(e);toast.error('No pudimos avisarle al chofer. Intentá nuevamente.');}
    finally{setAckLoading(false);}
  };

  useEffect(()=>{
    if(queryClientAction!=='YA_VOY'||!orderId||!order||order.status!=='en_camino'||Number(order.client_arrival_notice_count||0)<1||order.client_arrival_acknowledged===true)return;
    handleYaVoy().finally(()=>{
      const cleanUrl=`/app-cliente/active-ride?orderId=${encodeURIComponent(orderId)}`;
      window.history.replaceState({},'',cleanUrl);
    });
  },[queryClientAction,orderId,order?.status,order?.client_arrival_notice_count,order?.client_arrival_acknowledged]);

  const handleShare=()=>{const text=`Viajo en un remis. Chofer: ${driver?.name||order?.driver_name||'No definido'}, Patente: ${driver?.vehicle_plate||''}. Destino: ${order?.dropoff_address||'No definido'} - Sigue mi viaje: ${window.location.href}`;window.open(`https://wa.me/?text=${encodeURIComponent(text)}`,'_blank');};
  const handleSendPanic=async()=>{try{navigator.geolocation.getCurrentPosition(async pos=>{await base44.entities.PanicAlert.create({driver_id:localStorage.getItem('client_id')||'cliente-desconocido',driver_name:`CLIENTE: ${order?.client_name||'Desconocido'}`,vehicle_plate:driver?.vehicle_plate||'N/A',current_lat:pos.coords.latitude,current_lng:pos.coords.longitude,notes:`ALERTA DE CLIENTE EN VIAJE (Orden: ${orderId})`});setShowPanic(false);toast.success('Alerta enviada a la central con tu ubicación actual');},async err=>{await base44.entities.PanicAlert.create({driver_id:localStorage.getItem('client_id')||'cliente-desconocido',driver_name:`CLIENTE: ${order?.client_name||'Desconocido'}`,vehicle_plate:driver?.vehicle_plate||'N/A',current_lat:order?.pickup_lat||0,current_lng:order?.pickup_lng||0,notes:`ALERTA DE CLIENTE EN VIAJE (Orden: ${orderId}) - SIN GPS: ${err.message}`});setShowPanic(false);toast.success('Alerta enviada a la central');},{enableHighAccuracy:true,timeout:5000});}catch(e){toast.error('Error al enviar la alerta');}};
  const handleSendMessage=async()=>{if(!chatMessage.trim())return;try{await base44.entities.Message.create({from_type:'cliente',from_name:`Cliente: ${order?.client_name||'Desconocido'}`,driver_id:localStorage.getItem('client_id')||'cliente-desconocido',content:chatMessage});setChatMessage('');}catch(e){toast.error('Error al enviar mensaje');}};

  const arrivalNotified=order?.status==='en_camino'&&Number(order?.client_arrival_notice_count||0)>0;
  const acknowledged=order?.client_arrival_acknowledged===true;

  return <div className="h-[100dvh] flex flex-col relative bg-slate-100" style={{paddingBottom:'env(safe-area-bottom)'}}>
    <div className="absolute inset-0 z-0"><RideMap className="border-none rounded-none w-full h-full" autoFit={true} orders={order?[order]:[]} drivers={driver?[driver]:[]} zoom={16}/></div>
    <div className="absolute top-14 inset-x-0 flex justify-center z-10"><div className="bg-white px-6 py-4 rounded-3xl shadow-xl flex items-center gap-4"><div className="text-center"><p className="text-slate-500 font-semibold text-xs uppercase">Estado</p><p className="text-lg font-black text-blue-600">{order?.status==='en_camino'?'En la puerta':'En viaje'}</p></div><div className="w-px h-10 bg-slate-200"></div><div className="space-y-1"><p className="text-xs font-bold text-slate-400">DESTINO</p><p className="font-bold text-slate-800 text-sm w-40 truncate">{order?.dropoff_address||'Sin destino'}</p></div></div></div>
    <div className="absolute bottom-40 right-4 z-10 flex flex-col gap-3"><button onClick={handleShare} className="w-14 h-14 bg-white rounded-full shadow-lg flex items-center justify-center text-slate-700 border"><Share2 className="w-6 h-6"/></button><button onClick={()=>setShowChat(true)} className="w-14 h-14 bg-blue-50 rounded-full shadow-lg flex items-center justify-center text-blue-600 border"><MessageCircle className="w-6 h-6"/></button><button onClick={()=>setShowPanic(true)} className="w-14 h-14 bg-red-50 rounded-full shadow-lg flex items-center justify-center text-red-600 border"><ShieldAlert className="w-6 h-6"/></button></div>
    <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-[2.5rem] shadow-[0_-20px_40px_rgba(0,0,0,0.1)] p-6 z-10 flex flex-col gap-4"><div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto -mt-2"></div><div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border"><img src={driver?.photo_url||'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=100&h=100&q=80'} alt="Chofer" className="w-12 h-12 rounded-full object-cover"/><div className="flex-1 min-w-0"><p className="font-bold text-slate-900 truncate">Chofer: {driver?.name||order?.driver_name||'Asignado'}</p><p className="text-sm text-slate-500 truncate">Móvil {driver?.vehicle_model||''} · {driver?.vehicle_plate||''}</p></div></div>
      {arrivalNotified&&(acknowledged?<div className="w-full h-14 rounded-2xl bg-green-50 text-green-700 font-black flex items-center justify-center gap-2 border border-green-200"><CheckCircle2 className="w-6 h-6"/> YA AVISASTE QUE SALÍS</div>:<button onClick={handleYaVoy} disabled={ackLoading} className="w-full h-14 rounded-2xl bg-green-600 text-white font-black text-lg shadow-lg disabled:opacity-60">{ackLoading?'AVISANDO...':'YA VOY'}</button>)}
    </div>
    {showChat&&<div className="fixed inset-0 z-50 bg-slate-900/40 flex flex-col justify-end"><div className="bg-white rounded-t-[2rem] h-[75vh] flex flex-col"><div className="p-5 border-b flex justify-between"><div><h3 className="font-bold text-lg">Soporte</h3><p className="text-xs text-slate-500">Hablando con un Operador</p></div><button onClick={()=>setShowChat(false)}><X/></button></div><div className="flex-1 p-5 overflow-y-auto space-y-4">{messages.map((msg,i)=><div key={i} className={`p-3 rounded-2xl text-sm max-w-[80%] ${msg.from_type==='operador'?'bg-slate-200 self-start':'bg-blue-600 text-white ml-auto'}`}>{msg.content}</div>)}</div><div className="p-5 border-t flex gap-3"><input className="flex-1 bg-slate-100 rounded-full px-5" value={chatMessage} onChange={e=>setChatMessage(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSendMessage()}/><button onClick={handleSendMessage} className="w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center"><Send/></button></div></div></div>}
    {showPanic&&<div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-6"><div className="bg-white rounded-[2rem] p-6 text-center w-full max-w-sm"><ShieldAlert className="w-12 h-12 text-red-600 mx-auto mb-4"/><h3 className="font-black text-2xl mb-2">¿Estás en peligro?</h3><p className="text-slate-500 mb-6 text-sm">Esto enviará una alerta inmediata a la central.</p><button onClick={handleSendPanic} className="w-full py-4 rounded-2xl bg-red-600 text-white font-bold mb-3">SÍ, ENVIAR ALERTA</button><button onClick={()=>setShowPanic(false)} className="w-full py-4 rounded-2xl bg-slate-100 font-bold">Cancelar</button></div></div>}
  </div>;
}
