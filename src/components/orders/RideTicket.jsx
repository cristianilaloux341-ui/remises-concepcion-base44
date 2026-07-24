import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Receipt, Printer } from "lucide-react";
import { format } from "date-fns";

export default function RideTicket({ order }) {
  const handlePrint = () => {
    const content = document.getElementById('ticket-content').innerHTML;
    const printWindow = window.open('', '', 'height=600,width=400');
    printWindow.document.write('<html><head><title>Ticket</title>');
    printWindow.document.write('<style>body { font-family: monospace; font-size: 14px; padding: 20px; } .text-center { text-align: center; } .font-bold { font-weight: bold; } .border-b { border-bottom: 1px dashed #000; margin: 10px 0; } .flex { display: flex; justify-content: space-between; } .text-xl { font-size: 20px; }</style>');
    printWindow.document.write('</head><body>');
    printWindow.document.write(content);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 500);
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
            <div className="flex"><span className="font-bold">Fecha:</span> <span>{order.created_date ? format(new Date(order.created_date), "dd/MM/yyyy HH:mm") : "-"}</span></div>
            <div className="flex"><span className="font-bold">Viaje N°:</span> <span>{order.id?.slice(-6).toUpperCase() || "-"}</span></div>
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
          
          <div className="flex items-center justify-between py-2">
            <span className="font-bold text-slate-900 text-lg">TOTAL ABONADO</span>
            <span className="font-bold text-green-600 text-xl">${(order.importe_real_actual || order.fare || order.importe_estimado || 0).toLocaleString()}</span>
          </div>
          
          <div className="border-b" />
          
          <p className="text-center text-xs text-slate-500 mt-4">Gracias por viajar con nosotros</p>
        </div>
        <div className="p-4 bg-slate-50 flex justify-end">
          <Button onClick={handlePrint} className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold h-12 rounded-xl">
            <Printer className="w-5 h-5" /> Descargar / Imprimir
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}