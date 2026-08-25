import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Receipt, Download } from "lucide-react";
import { formatTimeBA } from "@/lib/utils";

export default function RideTicket({ order }) {
  const handleDownload = () => {
    const content = document.getElementById('ticket-content')?.innerHTML || '';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Comprobante de viaje</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111827}.text-center{text-align:center}.font-bold{font-weight:700}.border-b{border-bottom:1px dashed #94a3b8;margin:10px 0}.flex{display:flex;justify-content:space-between;gap:16px}.text-xl{font-size:20px}.space-y-2>div,.space-y-3>div{margin:8px 0}</style></head><body>${content}</body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `comprobante-viaje-${order.id?.slice(-8) || 'remises'}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!order) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 bg-white text-slate-800 border-slate-200 hover:bg-slate-50 font-bold h-11 rounded-xl">
          <Receipt className="w-4 h-4 text-blue-600" /> Ver Comprobante
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm p-0 overflow-hidden bg-white">
        <DialogHeader className="p-4 border-b bg-slate-50">
          <DialogTitle className="text-center text-slate-800">Comprobante de Viaje</DialogTitle>
        </DialogHeader>
        <div className="p-6 bg-white" id="ticket-content">
          <div className="text-center mb-4">
            <h2 className="text-xl font-bold text-slate-900 uppercase">REMISES CONCEPCIÓN</h2>
            <p className="text-slate-500 text-sm">Comprobante electrónico</p>
          </div>
          
          <div className="border-b" />
          
          <div className="space-y-2 text-sm text-slate-700 py-2">
            <div className="flex"><span className="font-bold">Fecha:</span> <span>{order.created_date ? formatTimeBA(order.created_date, "full") : "-"}</span></div>
            <div className="flex"><span className="font-bold">Viaje N°:</span> <span>{order.id?.slice(-6).toUpperCase() || "-"}</span></div>
            <div className="flex"><span className="font-bold">Móvil:</span> <span>{order.driver_mobile || "-"}</span></div>
            <div className="flex"><span className="font-bold">Patente:</span> <span>{order.driver_vehicle_plate || "-"}</span></div>
            <div className="flex"><span className="font-bold">Chofer:</span> <span>{order.driver_name || "-"}</span></div>
            <div className="flex"><span className="font-bold">Pasajero:</span> <span>{order.client_name || "-"}</span></div>
          </div>
          
          <div className="border-b" />
          
          <div className="space-y-3 text-sm text-slate-700 py-2">
            <div>
              <p className="font-bold">Origen:</p>
              <p className="truncate">{order.pickup_address}</p>
            </div>
            <div>
              <p className="font-bold">Destino:</p>
              <p className="truncate">{order.dropoff_address || "A indicar por pasajero"}</p>
            </div>
          </div>
          
          <div className="border-b" />

          <div className="space-y-2 text-sm text-slate-700 py-2">
            <div className="flex"><span className="font-bold">Inicio:</span> <span>{order.ride_started_at ? formatTimeBA(order.ride_started_at, "full") : "-"}</span></div>
            <div className="flex"><span className="font-bold">Finalización:</span> <span>{order.ride_finished_at ? formatTimeBA(order.ride_finished_at, "full") : "-"}</span></div>
            <div className="flex"><span className="font-bold">Duración:</span> <span>{Math.floor(Number(order.ride_duration_seconds || 0) / 60)} min {Math.floor(Number(order.ride_duration_seconds || 0) % 60)} s</span></div>
            <div className="flex"><span className="font-bold">Velocidad máxima:</span> <span>{Number(order.max_speed_kmh || 0).toFixed(1)} km/h</span></div>
          </div>

          <div className="border-b" />
          
          <div className="flex items-center justify-between py-2">
            <span className="font-bold text-slate-900 text-lg">TOTAL ABONADO</span>
            <span className="font-bold text-green-600 text-xl">${Math.max(0, Number(order.importe_real_actual ?? 0)).toLocaleString()}</span>
          </div>
          
          <div className="border-b" />
          
          <p className="text-center text-xs text-slate-500 mt-4">Gracias por viajar con nosotros</p>
        </div>
        <div className="p-4 bg-slate-50 flex justify-end">
          <Button onClick={handleDownload} className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold h-12 rounded-xl">
            <Download className="w-5 h-5" /> Descargar comprobante
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}