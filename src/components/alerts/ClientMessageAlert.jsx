import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { motion } from "framer-motion";
import { MessageCircle, X, User, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";

// ── Audio ──────────────────────────────────────────────────────────────────────
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playOnce() {
  try { navigator.vibrate?.([200, 100, 200, 100, 400]); } catch (_) {}
  try {
    const ctx = getAudioCtx();
    const doPlay = () => {
      [[0, 520], [250, 660], [500, 800]].forEach(([delay, freq]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = "sine";
        o.frequency.value = freq;
        const t = ctx.currentTime + delay / 1000;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.6, t + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        o.start(t); o.stop(t + 0.4);
      });
    };
    if (ctx.state === "suspended") ctx.resume().then(doPlay);
    else doPlay();
  } catch (_) {}
}

function playAlert() {
  playOnce();
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function ClientMessageAlert() {
  const [alerts, setAlerts] = useState([]);
  const [replyText, setReplyText] = useState({});
  const seenIds = useRef(new Set());
  const location = useLocation();

  useEffect(() => {
    let unsubscribe = null;

    const connect = () => {
      unsubscribe?.();
      unsubscribe = base44.entities.Message.subscribe((event) => {
        if (event.type !== "create") return;
        const msg = event.data;
        if (!msg) return;
        if (msg.from_type !== "cliente") return;
        if (seenIds.current.has(msg.id)) return;

        seenIds.current.add(msg.id);
        setAlerts(prev => [...prev, msg]);

        playAlert();

        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            new Notification(`📩 Mensaje de ${msg.from_name}`, {
              body: msg.content,
              icon: "/icon-192.png",
              requireInteraction: true,
            });
          } catch (_) {}
        }
      });
    };

    connect();

    return () => {
      unsubscribe?.();
    };
  }, []);

  const dismiss = (id) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  };
  const dismissAll = () => { setAlerts([]); };

  const handleReply = async (msg) => {
    const text = replyText[msg.id]?.trim();
    if (!text) return;
    
    try {
      await base44.entities.Message.create({
        from_type: "operador",
        from_name: "Operador",
        to_driver_id: msg.driver_id, // Usamos driver_id que tiene el client_id
        content: text,
        read: false,
      });
      dismiss(msg.id);
    } catch (e) {
      console.error(e);
    }
  };

  if (alerts.length === 0) return null;

  return (
    <>
        {alerts.map((msg) => (
          <motion.div drag dragMomentum={false} style={{ touchAction: "none" }} key={msg.id} className="pointer-events-auto w-full bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-emerald-400 animate-in slide-in-from-right-8 fade-in duration-200 shrink-0">
            {/* Header */}
            <div className="bg-emerald-600 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center animate-bounce">
                  <MessageCircle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="font-black text-white text-lg leading-tight">¡MENSAJE DE CLIENTE!</p>
                  <p className="text-emerald-100 text-xs font-medium">
                    {msg.from_name}
                    {msg.created_date
                      ? " — " + format(new Date(msg.created_date), "HH:mm") + "hs"
                      : ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  dismiss(msg.id);
                }}
                className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors relative z-10"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>

            {/* Cuerpo */}
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                  <User className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-gray-800 text-base font-semibold leading-snug">
                    {msg.content}
                  </p>
                </div>
              </div>

              <div className="flex gap-2 pt-2 items-center">
                <Input 
                  placeholder="Responder al cliente..." 
                  className="rounded-xl"
                  value={replyText[msg.id] || ''}
                  onChange={e => setReplyText({...replyText, [msg.id]: e.target.value})}
                  onKeyDown={e => { if (e.key === "Enter") handleReply(msg); }}
                />
                <Button
                  className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-bold shrink-0"
                  onClick={() => handleReply(msg)}
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </motion.div>
        ))}

        {alerts.length > 1 && (
          <button
            type="button"
            onClick={dismissAll}
            className="pointer-events-auto w-full py-2 bg-emerald-600/90 hover:bg-emerald-600 rounded-xl text-sm text-white font-bold text-center shadow-lg animate-in fade-in"
          >
            Cerrar {alerts.length} mensajes de clientes
          </button>
        )}
    </>
  );
}