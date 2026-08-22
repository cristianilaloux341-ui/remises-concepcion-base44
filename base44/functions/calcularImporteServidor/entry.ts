import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { calcularImportePorFichas, haversineMetros } from '../../shared/TaximetroLogic.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const { orderId } = await req.json();

  const orders = await b44.entities.RideOrder.filter({ id: orderId });
  const order = orders[0];
  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });

  let tarifa = {
    bajada_bandera: order.tarifa_bajada_bandera,
    valor_ficha: order.tarifa_valor_ficha,
    metros_por_ficha: order.tarifa_metros_por_ficha,
    valor_ficha_espera: order.tarifa_valor_ficha_espera,
    segundos_por_ficha_espera: order.tarifa_segundos_por_ficha_espera,
    tolerancia_espera_segundos: order.tarifa_tolerancia_espera_segundos
  };

  if (!tarifa.bajada_bandera) {
    const configs = await b44.entities.TarifaConfig.list();
    const raw = configs[0] || {};
    
    const TARIFA_DEFAULTS = { bajada_bandera: 1700, nocturna_bajada_bandera: 1900, valor_ficha: 100, metros_por_ficha: 82, valor_ficha_espera: 100, segundos_por_ficha_espera: 45, tolerancia_espera_segundos: 240, nocturna_hora_inicio: 22, nocturna_hora_fin: 6 };
    
    const horaInicio = Number(raw.nocturna_hora_inicio ?? TARIFA_DEFAULTS.nocturna_hora_inicio);
    const horaFin = Number(raw.nocturna_hora_fin ?? TARIFA_DEFAULTS.nocturna_hora_fin);
    const fecha = new Date(order.created_date || Date.now());
    const hora = fecha.getHours();
    let nocturna = false;
    if (horaInicio > horaFin) {
      nocturna = hora >= horaInicio || hora < horaFin;
    } else {
      nocturna = hora >= horaInicio && hora < horaFin;
    }

    tarifa = {
      bajada_bandera: Number(nocturna ? (raw.nocturna_bajada_bandera ?? TARIFA_DEFAULTS.nocturna_bajada_bandera) : (raw.bajada_bandera ?? TARIFA_DEFAULTS.bajada_bandera)),
      valor_ficha: Number(raw.valor_ficha ?? TARIFA_DEFAULTS.valor_ficha),
      metros_por_ficha: Number(raw.metros_por_ficha ?? TARIFA_DEFAULTS.metros_por_ficha),
      valor_ficha_espera: Number(raw.valor_ficha_espera ?? raw.valor_ficha ?? TARIFA_DEFAULTS.valor_ficha_espera),
      segundos_por_ficha_espera: Number(raw.segundos_por_ficha_espera ?? TARIFA_DEFAULTS.segundos_por_ficha_espera),
      tolerancia_espera_segundos: Number(raw.tolerancia_espera_segundos ?? TARIFA_DEFAULTS.tolerancia_espera_segundos)
    };
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
    
    if (dist < 500) {
      total_metros += dist;
      const vKmh = (dist / dt) * 3.6;
      if (vKmh >= 5) {
        segundos_movimiento += dt;
      }
    }
    prev = curr;
  }

  const durationSegundos = (new Date(traces[traces.length - 1].timestamp).getTime() - new Date(traces[0].timestamp).getTime()) / 1000;
  let segundosEspera = durationSegundos - segundos_movimiento;
  
  const tolerancia = Number(tarifa.tolerancia_espera_segundos || 240);
  segundosEspera = Math.max(0, segundosEspera - tolerancia);

  const importe_servidor = calcularImportePorFichas(total_metros, segundosEspera, tarifa);

  return Response.json({ success: true, importe_servidor, origen: 'calculo_servidor', traces_count: traces.length });
});