import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Radio, User } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export default function Messages() {
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [targetDriverId, setTargetDriverId] = useState("todos");
  const bottomRef = useRef(null);

  const { data: messages = [] } = useQuery({
    queryKey: ["messages"],
    queryFn: () => base44.entities.Message.list("created_date", 200),
    refetchInterval: 3000,
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => base44.entities.Driver.list(),
    refetchInterval: 10000,
  });

  const sendMutation = useMutation({
    mutationFn: () => base44.entities.Message.create({
      from_type: "operador",
      from_name: "Operador",
      to_driver_id: targetDriverId === "todos" ? "" : targetDriverId,
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
  }, [messages.length]);

  const targetName = targetDriverId === "todos"
    ? "Todos los móviles"
    : drivers.find(d => d.id === targetDriverId)?.name || "Móvil";

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
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
          return (
            <div key={msg.id} className={`flex ${isOperator ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 space-y-1 ${
                isOperator
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-white border border-border rounded-bl-sm"
              }`}>
                <div className="flex items-center gap-2 text-xs opacity-75">
                  <User className="w-3 h-3" />
                  <span className="font-semibold">{msg.from_name}</span>
                  {isOperator && !msg.to_driver_id && <span>→ Todos</span>}
                  {isOperator && msg.to_driver_id && (
                    <span>→ {drivers.find(d => d.id === msg.to_driver_id)?.name || msg.to_driver_id}</span>
                  )}
                </div>
                <p className="text-sm">{msg.content}</p>
                <p className={`text-xs ${isOperator ? "text-primary-foreground/60" : "text-muted-foreground"} text-right`}>
                  {format(new Date(msg.created_date), "HH:mm")}
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
          <Select value={targetDriverId} onValueChange={setTargetDriverId}>
            <SelectTrigger className="w-44 h-9 rounded-xl text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">📡 Todos los móviles</SelectItem>
              {drivers.map(d => (
                <SelectItem key={d.id} value={d.id}>
                  🚗 {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground self-center">→ {targetName}</span>
        </div>
        <div className="flex gap-2">
          <Input
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