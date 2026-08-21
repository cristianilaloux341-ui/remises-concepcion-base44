import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Radio, User, MessageCircle, X } from "lucide-react";
import { formatTimeBA } from "@/lib/utils";

function playMsgSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const doPlay = () => {
      [[0, 520], [120, 780]].forEach(([delay, freq]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = "sine"; o.frequency.value = freq;
        const t = ctx.currentTime + delay / 1000;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.5, t + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        o.start(t); o.stop(t + 0.3);
      });
    };
    if (ctx.state === "suspended") ctx.resume().then(doPlay); else doPlay();
  } catch (_) {}
}

export default function Messages() {
  const [content, setContent] = useState("");
  const [targetDriverId, setTargetDriverId] = useState("todos");
  const [searchNum, setSearchNum] = useState("");
  const [messages, setMessages] = useState([]);
  const [toast, setToast] = useState(null); // { from_name, content, id }
  const toastTimerRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const seenIdsRef = useRef(new Set());

  // Carga inicial + suscripción en tiempo real
  useEffect(() => {
    base44.entities.Message.list("created_date", 200).then(data => {
      const msgs = data || [];
      msgs.forEach(m => seenIdsRef.current.add(m.id));
      setMessages(msgs);
    });

    let unsubscribe = null;
    let lastEvent = Date.now();
    let pollInterval = null;

    const connect = () => {
      unsubscribe?.();
      unsubscribe = base44.entities.Message.subscribe(async (event) => {
        lastEvent = Date.now();
        if (event.type === "create") {
          if (seenIdsRef.current.has(event.id)) return;
          seenIdsRef.current.add(event.id);
          setMessages(prev => [...prev, event.data]);
          // Toast + sonido solo para mensajes de móviles entrantes — UNA sola vez, sin loop
          if (event.data?.from_type === "movil") {
            playMsgSound();
            const isAudio = event.data.content?.startsWith("[AUDIO]");
            const audioUrl = isAudio ? event.data.content.replace("[AUDIO]", "") : null;
            setToast({ 
              from_name: event.data.from_name, 
              content: event.data.content, 
              id: event.id,
              isAudio,
              audioUrl
            });
            clearTimeout(toastTimerRef.current);
            toastTimerRef.current = setTimeout(() => setToast(null), 7000);
            // Enviar push real a todos los operadores (bloqueante para asegurar salida)
            const sessionToken = sessionStorage.getItem("local_operator_token");
            await base44.functions.invoke("sendPushNotification", {
              action: "send_to_operators",
              fromName: event.data.from_name,
              messageContent: event.data.content,
              sessionToken
            }).catch(e => console.error("Push Error (Operators):", e));
          }
        } else if (event.type === "update") {
          setMessages(prev => prev.map(m => m.id === event.id ? { ...m, ...event.data } : m));
        } else if (event.type === "delete") {
          setMessages(prev => prev.filter(m => m.id !== event.id));
        }
      });
    };

    connect();
    pollInterval = setInterval(() => {
      if (Date.now() - lastEvent > 15000) connect();
    }, 15000);

    return () => {
      unsubscribe?.();
      clearInterval(pollInterval);
    };
  }, []);

  // Drivers en tiempo real
  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => base44.entities.Driver.list(null, 500),
    refetchInterval: 15000,
  });

  const { data: moviles = [] } = useQuery({
    queryKey: ["moviles"],
    queryFn: () => base44.entities.Movil.list(null, 500),
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const newMsg = await base44.entities.Message.create({
        from_type: "operador",
        from_name: "Operador",
        to_driver_id: targetDriverId === "todos" ? "" : targetDriverId,
        content: content.trim(),
        read: false,
      });
      await base44.functions.invoke("sendPushNotification", {
        action: "send_message",
        targetDriverId: targetDriverId === "todos" ? "" : targetDriverId,
        messageContent: content.trim()
      }).catch(e => console.error("Push send_message error:", e));
      return newMsg;
    },
    onSuccess: () => setContent(""),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, targetDriverId]);

  const targetName = targetDriverId === "todos"
    ? "Todos los móviles"
    : drivers.find(d => d.id === targetDriverId)?.name || "Móvil";

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] relative">
      {/* Toast de mensaje entrante */}
      {toast && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-2 animate-in slide-in-from-top-3 fade-in duration-300">
          <div className="bg-gray-900 text-white rounded-2xl shadow-2xl overflow-hidden flex items-start gap-3 px-4 py-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shrink-0 mt-0.5">
              <MessageCircle className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-blue-300 mb-0.5">{toast.from_name}</p>
              {toast.isAudio ? (
                <div className="flex flex-col gap-1">
                  <p className="text-sm leading-snug font-medium text-blue-100">🎤 Mensaje de voz</p>
                  <audio controls src={toast.audioUrl} className="h-8 w-full max-w-[200px]" />
                </div>
              ) : (
                <p className="text-sm leading-snug truncate">{toast.content}</p>
              )}
            </div>
            <button
              className="text-gray-400 hover:text-white shrink-0 mt-0.5"
              onClick={() => { clearTimeout(toastTimerRef.current); setToast(null); }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mensajes</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Comunicación base ↔ móviles</p>
        </div>
        <Badge className="bg-green-100 text-green-700 border-0">
          <Radio className="w-3 h-3 mr-1" /> En línea
        </Badge>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto space-y-2 px-1 pb-4">
        {messages.filter(msg => {
          if (targetDriverId === "todos") {
            // Vista broadcast: solo mensajes enviados a todos (sin destinatario específico)
            // y mensajes de móviles sin destinatario (broadcasts de choferes)
            return !msg.to_driver_id && !msg.driver_id;
          }
          // Conversación privada con un chofer: mensajes del operador a ese chofer
          // + mensajes enviados por ese chofer
          if (msg.from_type === "operador") return msg.to_driver_id === targetDriverId;
          return msg.driver_id === targetDriverId;
        }).map(msg => {
          const isOperator = msg.from_type === "operador";
          const isAudio = msg.content?.startsWith("[AUDIO]");
          const audioUrl = isAudio ? msg.content.replace("[AUDIO]", "") : null;
          
          return (
            <div key={msg.id} className={`flex ${isOperator ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 space-y-1 ${
                isOperator
                  ? "bg-slate-900 text-white rounded-br-sm"
                  : "bg-white text-slate-900 border border-border rounded-bl-sm"
              }`}>
                <div className="flex items-center gap-2 text-xs opacity-75 mb-1">
                  <User className="w-3 h-3" />
                  <span className="font-semibold">{msg.from_name}</span>
                  {isOperator && !msg.to_driver_id && <span>→ Todos</span>}
                  {isOperator && msg.to_driver_id && (
                    <span>→ {drivers.find(d => d.id === msg.to_driver_id)?.name || msg.to_driver_id}</span>
                  )}
                </div>
                {isAudio ? (
                  <audio controls src={audioUrl} className="h-10 w-full max-w-[250px]" />
                ) : (
                  <p className="text-sm">{msg.content}</p>
                )}
                <p className={`text-xs mt-1 ${isOperator ? "text-slate-400" : "text-muted-foreground"} text-right`}>
                  {formatTimeBA(msg.created_date)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t pt-4 space-y-2 bg-background">
        <div className="flex gap-2">
          <Input 
            className="w-24 h-9 rounded-xl text-xs" 
            placeholder="Nº + Enter" 
            value={searchNum}
            onChange={e => setSearchNum(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                const val = searchNum.trim();
                if (!val) {
                  setTargetDriverId("todos");
                  setTimeout(() => inputRef.current?.focus(), 50);
                  return;
                }
                
                let targetId = null;

                // 1. Buscar coincidencia exacta por vehicle_model en Driver
                const foundDriverByModel = drivers.find(d => 
                  d.vehicle_model === val || 
                  d.vehicle_model?.trim() === val || 
                  d.vehicle_model?.toString() === val
                );
                
                if (foundDriverByModel) {
                   targetId = foundDriverByModel.id;
                } else {
                   // 2. Fallback a Moviles entity
                   const movil = moviles.find(m => m.numero_movil?.toString() === val);
                   if (movil) {
                      const dId = movil.driver_ids?.[0] || movil.driver_id;
                      if (dId && drivers.some(d => d.id === dId)) {
                        targetId = dId;
                      }
                   }
                   
                   // 3. Fallback a coincidencia parcial por nombre o patente
                   if (!targetId) {
                     const found = drivers.find(d => 
                       d.name?.toLowerCase().includes(val.toLowerCase()) || 
                       d.vehicle_plate?.toLowerCase().includes(val.toLowerCase())
                     );
                     if (found) targetId = found.id;
                   }
                }
                
                if (targetId) {
                  setTargetDriverId(targetId);
                  setSearchNum("");
                } else {
                  alert(`No se encontró un chofer activo para la búsqueda "${val}".`);
                }
                
                setTimeout(() => inputRef.current?.focus(), 50);
              }
            }}
          />
          <Select value={targetDriverId} onValueChange={setTargetDriverId}>
            <SelectTrigger className="w-56 h-9 rounded-xl text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">📡 Todos los móviles</SelectItem>
              {drivers.map(d => (
                <SelectItem key={d.id} value={d.id}>
                  🚗 {d.vehicle_model ? `Móvil ${d.vehicle_model} - ` : ''}{d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground self-center">→ {targetName}</span>
        </div>
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            className="flex-1 rounded-xl"
            placeholder="Escribir mensaje..."
            value={content}
            onChange={e => setContent(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && content.trim()) sendMutation.mutate(); }}
          />
          <Button
            className="rounded-xl px-5 gap-2"
            onClick={() => sendMutation.mutate()}
            disabled={!content.trim() || sendMutation.isPending}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}