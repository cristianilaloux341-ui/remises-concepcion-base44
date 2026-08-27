import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { motion } from "framer-motion";
import { MessageCircle, X, User, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx || audioCtx.state === "closed") audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playAlert() {
  try { navigator.vibrate?.([200,100,200,100,400]); } catch (_) {}
  try {
    const ctx = getAudioCtx();
    const doPlay = () => [[0,520],[250,660],[500,800]].forEach(([delay,freq]) => {
      const o=ctx.createOscillator(), g=ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type="sine"; o.frequency.value=freq;
      const t=ctx.currentTime+delay/1000; g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(.6,t+.04); g.gain.exponentialRampToValueAtTime(.001,t+.4); o.start(t); o.stop(t+.4);
    });
    if (ctx.state === "suspended") ctx.resume().then(doPlay); else doPlay();
  } catch (_) {}
}

export default function ClientMessageAlert() {
  const [alerts,setAlerts]=useState([]);
  const [replyText,setReplyText]=useState({});
  const seenIds=useRef(new Set());

  useEffect(()=>{
    const unsubscribe=base44.entities.Message.subscribe(event=>{
      if(event.type!=="create") return;
      const msg=event.data;
      if(!msg || msg.from_type!=="cliente" || seenIds.current.has(msg.id)) return;
      seenIds.current.add(msg.id); setAlerts(prev=>[...prev,msg]); playAlert();
      if(typeof Notification!=="undefined" && Notification.permission==="granted") {
        try { new Notification(`📩 Mensaje de ${msg.from_name}`,{body:msg.content,icon:"/icon-192.png",requireInteraction:true}); } catch (_) {}
      }
    });
    return ()=>unsubscribe?.();
  },[]);

  const dismiss=id=>setAlerts(prev=>prev.filter(a=>a.id!==id));
  const handleReply=async msg=>{
    const text=replyText[msg.id]?.trim(); if(!text) return;
    const clientId=msg.client_id || msg.driver_id;
    if(!clientId){ console.error("Mensaje Cliente sin client_id"); return; }
    try {
      await base44.entities.Message.create({from_type:"operador",from_name:"Operador",to_client_id:clientId,content:text,read:false});
      dismiss(msg.id);
    } catch(e){console.error(e);}
  };

  if(!alerts.length) return null;
  return <>{alerts.map(msg=><motion.div drag dragMomentum={false} style={{touchAction:"none"}} key={msg.id} className="pointer-events-auto w-full bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-emerald-400 shrink-0">
    <div className="bg-emerald-600 px-5 py-4 flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center"><MessageCircle className="w-5 h-5 text-white"/></div><div><p className="font-black text-white text-lg">¡MENSAJE DE CLIENTE!</p><p className="text-emerald-100 text-xs">{msg.from_name}{msg.created_date?` — ${format(new Date(msg.created_date),"HH:mm")}hs`:""}</p></div></div><button onClick={()=>dismiss(msg.id)} className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center"><X className="w-4 h-4 text-white"/></button></div>
    <div className="p-5 space-y-4"><div className="flex items-start gap-3"><div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center"><User className="w-5 h-5 text-emerald-600"/></div><div><p className="text-xs font-bold text-emerald-700 mb-1">Cliente: {msg.from_name}</p><p className="text-gray-800 font-semibold">{msg.content}</p></div></div><div className="flex gap-2"><Input placeholder="Responder al cliente..." value={replyText[msg.id]||""} onChange={e=>setReplyText({...replyText,[msg.id]:e.target.value})} onKeyDown={e=>{if(e.key==="Enter")handleReply(msg)}}/><Button onClick={()=>handleReply(msg)} className="bg-emerald-600"><Send className="w-4 h-4"/></Button></div></div>
  </motion.div>)}</>;
}