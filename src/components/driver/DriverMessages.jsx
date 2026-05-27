import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Send, X, MessageCircle } from "lucide-react";
import { format } from "date-fns";

export default function DriverMessages({ driver, onClose }) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const bottomRef = useRef(null);

  const { data: messages = [] } = useQuery({
    queryKey: ["messages"],
    queryFn: () => base44.entities.Message.list("created_date", 100),
    refetchInterval: 3000,
  });

  // Filter: messages for this driver or broadcast
  const myMessages = messages.filter(m =>
    !m.to_driver_id || m.to_driver_id === driver.id || m.driver_id === driver.id
  );

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
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      setContent("");
    }
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [myMessages.length]);

  return (
    <div className="fixed inset-0 bg-white flex flex-col z-50">
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
      <div className="p-4 border-t bg-white flex gap-2">
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