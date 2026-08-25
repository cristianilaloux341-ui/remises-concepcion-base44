import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { calcularImportePorFichas, haversineMetros } from '../../shared/TaximetroLogic.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const { orderId } = await req.json();

  const orders = await b44.entities.RideOrder.filter({ id: orderId });
  const order = orders[0];
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });

  // Un viaje iniciado se calcula únicamente con su snapshot congelado.
  // Central, chofer, cliente y auditoría deben compartir exactamente estos valores.
  const tarifa = {
    bajada_bandera: Number(order.tarifa_bajada_snapshot ?? 0),
    valor_ficha: Number(order.tarifa_valor_ficha_snapshot ?? 0),
    metros_por_ficha: Number(order.tarifa_metros_por_ficha_snapshot ?? 0),
    valor_ficha_espera: Number(order.tarifa_valor_ficha_espera_snapshot ?? 0),
    segundos_por_ficha_espera: Number(order.tarifa_segundos_por_ficha_espera_snapshot ?? 0),
    tolerancia_espera_segundos: Number(order.tarifa_tolerancia_espera_segundos_snapshot ?? 0)
  };

  if (!order.tarifa_snapshot_at) {
    return Response.json({ success: false, reason: 'tarifa_snapshot_missing' }, { status: 409 });
  }

  const traces = await b44.entities.RideGpsTrace.filter({ order_id: orderId }, 'timestamp');
  
  if (traces.length < 2) {
    return Response.json({ success: true, importe_servidor: order.importe_real_actual || 0, origen: 'telefono_sin_gps' });
  }

  let total_metros = 0;
  let segundos_movimiento = 0;
  let prev = traces[0];

  for (let i = 1; i < traces.length; i++) {
    const curr = traces[i];
    const dist = haversineMetros(prev.lat, prev.lng, curr.lat, curr.lng);
    const dt = (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;
    
    if (dist < 10000) {
      total_metros += dist;
      const vKmh = dt > 0 ? (dist / dt) * 3.6 : 0;
      if (vKmh >= 5) {
        segundos_movimiento += dt;
      }
    }
    prev = curr;
  }

  const durationSegundos = (new Date(traces[traces.length - 1].timestamp).getTime() - new Date(traces[0].timestamp).getTime()) / 1000;
  let segundosEspera = durationSegundos - segundos_movimiento;
  
  const tolerancia = Math.max(0, Number(tarifa.tolerancia_espera_segundos ?? 0));
  segundosEspera = Math.max(0, segundosEspera - tolerancia);

  const importe_servidor = calcularImportePorFichas(total_metros, segundosEspera, tarifa);

  return Response.json({ success: true, importe_servidor, origen: 'calculo_servidor', traces_count: traces.length });
});