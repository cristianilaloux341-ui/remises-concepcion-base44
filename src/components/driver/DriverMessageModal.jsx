import { Button } from "@/components/ui/button";
import { MessageCircle, Radio, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";

const formatTimeBA = (dateStr) => {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("es-AR", { timeZone: "America/Buenos_Aires", hour: "2-digit", minute: "2-digit" });
  } catch(e) {
    return format(new Date(dateStr), "HH:mm");
  }
};

// Bloqueante: el chofer DEBE tocar "Entendido" para cerrar
export default function DriverMessageModal({ message, onDismiss }) {
  if (!message) return null;

  const isBroadcast = !message.to_driver_id;

  return (
    <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-5 animate-in fade-in duration-200" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl">

        {/* Header */}
        <div className={`px-5 py-5 flex items-center gap-3 ${isBroadcast ? "bg-blue-600" : "bg-indigo-600"}`}>
          {isBroadcast
            ? <Radio className="w-7 h-7 text-white animate-pulse shrink-0" />
            : <MessageCircle className="w-7 h-7 text-white shrink-0" />
          }
          <div>
            <p className="font-bold text-white text-lg leading-tight">
              {isBroadcast ? "📡 Mensaje de la Base" : "💬 Mensaje Privado"}
            </p>
            <p className={`text-xs ${isBroadcast ? "text-blue-100" : "text-indigo-100"}`}>
              {isBroadcast ? "Difusión a todos los móviles" : `De: ${message.from_name}`}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Message bubble */}
          <div className={`rounded-2xl p-5 border-2 ${isBroadcast ? "bg-blue-50 border-blue-200" : "bg-indigo-50 border-indigo-200"}`}>
            <p className="text-gray-900 text-base leading-relaxed font-medium">{message.content}</p>
            <p className="text-xs text-gray-400 mt-3 text-right">
              {formatTimeBA(message.created_date)}
            </p>
          </div>

          {/* CTA — must be tapped to dismiss */}
          <Button
            size="lg"
            className={`w-full h-14 rounded-2xl text-base font-bold gap-2 shadow-lg ${
              isBroadcast
                ? "bg-blue-600 hover:bg-blue-700 shadow-blue-500/30"
                : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/30"
            }`}
            onClick={onDismiss}
          >
            <CheckCircle2 className="w-5 h-5" />
            Entendido
          </Button>
        </div>
      </div>
    </div>
  );
}