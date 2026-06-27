import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Send, X, MessageCircle } from "lucide-react";
import { format } from "date-fns";

function playBeep(type = "send") {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const resume = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
    resume.then(() => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = "sine";
      o.frequency.value = type === "send" ? 660 : 880;
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      o.start(ctx.currentTime);
      o.stop(ctx.currentTime + 0.25);
    });
  } catch (_) {}
}

export default function DriverMessages({ driver, onClose }) {
  const [content, setContent] = useState("");
  const [messages, setMessages] = useState([]);
  const bottomRef = useRef(null);
  const initializedRef = useRef(false);
  const seenIdsRef = useRef(new Set());

  // Load initial messages then subscribe to real-time updates
  useEffect(() => {
    base44.entities.Message.list("created_date", 200).then(data => {
      const msgs = (data || []).filter(m => {
        if (m.from_type === "operador") {
          // Broadcast (sin destinatario) o dirigido específicamente a este chofer
          return !m.to_driver_id || m.to_driver_id === driver.id;
        }
        // Solo mensajes enviados por este chofer
        return m.driver_id === driver.id;
      });
      msgs.forEach(m => seenIdsRef.current.add(m.id));
      setMessages(msgs);
      initializedRef.current = true;
    });

    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (!initializedRef.current) return;
      if (event.type === "create") {
        if (seenIdsRef.current.has(event.id)) return;
        seenIdsRef.current.add(event.id);
        const msg = event.data;
        // Solo mensajes relevantes: broadcast del operador, dirigidos a este chofer, o enviados por este chofer
        const isForMe = msg.from_type === "operador"
          ? (!msg.to_driver_id || msg.to_driver_id === driver.id)
          : msg.driver_id === driver.id;
        if (!isForMe) return;
        if (msg.from_type === "operador") {
          playBeep("receive");
          try { navigator.vibrate?.([200]); } catch (_) {}
        }
        setMessages(prev => [...prev, msg]);
      }
    });

    return () => unsubscribe();
  }, [driver.id]);

  // Filter: solo mensajes relevantes para este chofer:
  // 1. Broadcast del operador (from_type === "operador" y sin to_driver_id)
  // 2. Mensaje del operador dirigido a este chofer
  // 3. Mensaje enviado por este chofer
  const myMessages = messages.filter(m => {
    if (m.from_type === "operador") {
      // Broadcast (sin destinatario específico) o dirigido a este chofer
      return !m.to_driver_id || m.to_driver_id === driver.id;
    }
    // Mensajes de móviles: solo los enviados por este chofer
    return m.driver_id === driver.id;
  });

  const unread = myMessages.filter(m => !m.read && m.from_type === "operador").length;

  const sendMutation = useMutation({
    mutationFn: () => base44.entities.Message.create({
      from_type: "movil",
      from_name: driver.name,
      driver_id: driver.id,
      to_driver_id: "",
      content: content.trim(),
      read: false,
    }),
    onSuccess: () => {
      setContent("");
      playBeep("send");
    }
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="fixed inset-0 bg-white flex flex-col z-[9999]">
      {/* Header */}
      <div className="bg-gray-950 text-white px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-blue-400" />
          <p className="font-bold">Radio Base</p>
          {unread > 0 && (
            <Badge className="bg-blue-500 text-white border-0 text-xs">{unread} nuevo(s)</Badge>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50">
        {myMessages.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-8">Sin mensajes aún</p>
        )}
        {myMessages.map(msg => {
          const isFromMe = msg.from_type === "movil" && msg.driver_id === driver.id;
          return (
            <div key={msg.id} className={`flex ${isFromMe ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 ${
                isFromMe ? "bg-blue-600 text-white rounded-br-sm" : "bg-white border border-gray-200 rounded-bl-sm"
              }`}>
                {!isFromMe && (
                  <p className="text-xs font-semibold text-gray-500 mb-0.5">{msg.from_name}</p>
                )}
                <p className="text-sm">{msg.content}</p>
                <p className={`text-xs mt-1 ${isFromMe ? "text-blue-200" : "text-gray-400"} text-right`}>
                  {format(new Date(msg.created_date), "HH:mm")}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pt-4 pb-8 border-t bg-white flex gap-2" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
        <Input
          className="flex-1 rounded-xl"
          placeholder="Mensaje a la base..."
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && content.trim()) sendMutation.mutate(); }}
        />
        <Button
          className="rounded-xl px-4"
          onClick={() => sendMutation.mutate()}
          disabled={!content.trim() || sendMutation.isPending}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}