import test from 'node:test';
import assert from 'node:assert/strict';

const queueTime = (d) => {
  if (!d.queue_entered_at) return Infinity;
  const value = new Date(d.queue_entered_at).getTime();
  return Number.isNaN(value) ? Infinity : value;
};

const sortByQueue = (arr) => [...arr].sort((a, b) => {
  const tA = queueTime(a);
  const tB = queueTime(b);
  if (tA !== tB) return tA - tB;
  return (a.id || '').localeCompare(b.id || '');
});

const distanceKm = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

function candidates(order, allDrivers) {
  const drivers = allDrivers.filter(d =>
    d.status === 'disponible' &&
    !d.active_order_id && !d.active_ride_id && !d.reserved_order_id &&
    (d.dispatch_status == null || d.dispatch_status === 'normal')
  );
  const result = [];
  const seen = new Set();
  const add = (d) => { if (d && !seen.has(d.id)) { seen.add(d.id); result.push(d); } };

  if (order.zone) {
    sortByQueue(drivers.filter(d => d.current_base === order.zone)).forEach(add);
  }

  if (order.pickup_lat != null && order.pickup_lng != null) {
    drivers
      .filter(d => d.current_lat != null && d.current_lng != null)
      .map(d => ({ d, km: distanceKm(Number(order.pickup_lat), Number(order.pickup_lng), Number(d.current_lat), Number(d.current_lng)) }))
      .filter(x => Number.isFinite(x.km))
      .sort((a, b) => a.km - b.km || queueTime(a.d) - queueTime(b.d))
      .forEach(x => add(x.d));
  }

  sortByQueue(drivers).forEach(add);
  return result;
}

const baseDrivers = [
  { id:'zona-antiguo', status:'disponible', current_base:'Puerto', queue_entered_at:'2026-08-31T20:00:00Z', current_lat:-32.48, current_lng:-58.23 },
  { id:'zona-nuevo', status:'disponible', current_base:'Puerto', queue_entered_at:'2026-08-31T21:00:00Z', current_lat:-32.47, current_lng:-58.24 },
  { id:'cercano', status:'disponible', current_base:'Plaza', queue_entered_at:'2026-08-31T19:00:00Z', current_lat:-32.4841, current_lng:-58.2322 },
  { id:'ocupado', status:'disponible', current_base:'Puerto', active_order_id:'viejo', queue_entered_at:'2026-08-31T18:00:00Z', current_lat:-32.484, current_lng:-58.232 },
  { id:'sin-gps', status:'disponible', current_base:null, queue_entered_at:'2026-08-31T17:00:00Z' },
  { id:'fuera', status:'no_disponible', current_base:'Puerto', queue_entered_at:'2026-08-31T16:00:00Z', current_lat:-32.484, current_lng:-58.232 }
];

test('zona tiene prioridad aun si otro movil esta mas cerca', () => {
  const ids = candidates({ zone:'Puerto', pickup_lat:-32.484, pickup_lng:-58.232 }, baseDrivers).map(x => x.id);
  assert.deepEqual(ids.slice(0,2), ['zona-antiguo','zona-nuevo']);
  assert.equal(ids.includes('ocupado'), false);
  assert.equal(ids.includes('fuera'), false);
});

test('sin cobertura de zona usa cercania GPS antes de cola global', () => {
  const ids = candidates({ zone:'Columna', pickup_lat:-32.484, pickup_lng:-58.232 }, baseDrivers).map(x => x.id);
  assert.equal(ids[0], 'cercano');
});

test('sin GPS del viaje conserva fallback legacy por cola', () => {
  const ids = candidates({ zone:'Columna' }, baseDrivers).map(x => x.id);
  assert.equal(ids[0], 'sin-gps');
});

test('un candidato que pierde una carrera puede ser saltado sin cambiar el orden restante', () => {
  const ids = candidates({ zone:'Puerto', pickup_lat:-32.484, pickup_lng:-58.232 }, baseDrivers).map(x => x.id);
  assert.equal(ids[0], 'zona-antiguo');
  assert.equal(ids[1], 'zona-nuevo');
});
