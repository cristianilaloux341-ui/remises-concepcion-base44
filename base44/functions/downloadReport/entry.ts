import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;

  const start = new Date('2026-08-21T09:00:00Z'); 
  const end = new Date('2026-08-21T16:00:00Z');   

  const rides = await b44.entities.RideOrder.list('-created_date', 1000);
  const filtered = rides.filter(r => {
    const d = new Date(r.created_date);
    return d >= start && d <= end && r.driver_name;
  });

  filtered.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));

  let csv = "\uFEFFHora,Cliente,Origen,Destino,Chofer,Estado,Importe\n"; 
  let totalImporte = 0;
  let asignados = 0;

  filtered.forEach(r => {
    const d = new Date(r.created_date);
    d.setHours(d.getHours() - 3); 
    const timeStr = d.toISOString().substr(11, 5);
    
    const cliente = (r.client_name || '-').replace(/,/g, '');
    const origen = (r.pickup_address || '-').replace(/,/g, '');
    const destino = (r.dropoff_address || '-').replace(/,/g, '');
    const chofer = (r.driver_name || '-').replace(/,/g, '');
    const estado = r.status;
    const importe = r.importe_real_actual || r.fare || 0;
    
    if(estado !== 'cancelado' && estado !== 'rechazado') {
        totalImporte += Number(importe) || 0;
        asignados++;
    }

    csv += `${timeStr},${cliente},${origen},${destino},${chofer},${estado},$${importe}\n`;
  });

  csv += `\nRESUMEN,,,,,\n`;
  csv += `Viajes asignados (sin cancelar): ${asignados},,,,,\n`;
  csv += `Recaudacion aprox: $${totalImporte},,,,,\n`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="reporte-viajes.csv"'
    }
  });
});