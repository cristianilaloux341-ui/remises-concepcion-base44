import { safeAuditLog } from './DispatchLogic.ts';

export type ReconciliationResult = {
  status: 'repaired' | 'no_action' | 'manual_review_required' | 'already_reconciled' | 'concurrent_change' | 'persistence_error';
  issueType: string;
  baseId?: string;
  orderId?: string;
  driverIds?: string[];
  tokens?: string[];
  actions: string[];
  correlationId: string;
  matchedCount?: number;
};

export const defaultFailureInjector = { hit: async (point: string) => {} };

export async function runReconciliation(b44: any, options: { graceMs?: number, now?: number, failureInjector?: any } = {}) {
  const graceMs = options.graceMs ?? 30000;
  const now = options.now ?? Date.now();
  const failureInjector = options.failureInjector ?? defaultFailureInjector;
  const correlationId = crypto.randomUUID();
  const results: ReconciliationResult[] = [];

  // Fetch active states
  const bases = await b44.entities.Base.list();
  const activeBases = bases.filter(b => b.dispatch_status !== 'libre');
  
  const orders = await b44.entities.RideOrder.list();
  const activeOrders = orders.filter(o => ['procesando_despacho', 'esperando_confirmacion_manual', 'ofrecido', 'aceptado'].includes(o.status));
  
  const drivers = await b44.entities.Driver.list();
  const activeDrivers = drivers.filter(d => d.dispatch_status !== 'normal');

  // Helper
  const getAge = (entity: any) => now - new Date(entity.updated_date || now).getTime();
  const pushResult = async (res: ReconciliationResult) => {
    results.push(res);
    if (res.status === 'repaired' || res.status === 'manual_review_required') {
      await safeAuditLog(b44, {
        action: `RECONCILIATION_${res.status.toUpperCase()}`,
        user_type: 'sistema',
        user_name: 'Reconciler',
        details: `${res.issueType}: ${res.actions.join(', ')}`,
        metadata: { correlationId, ...res }
      }, failureInjector);
    }
  };

  // Case 1: Base esperando_manual sin RideOrder válido
  for (const base of activeBases.filter(b => b.dispatch_status === 'esperando_manual')) {
    const order = activeOrders.find(o => o.id === base.active_order_id);
    if (!order || order.manual_reservation_token !== base.manual_reservation_token) {
      try {
        await failureInjector.hit('DURING_RECONCILIATION_UPDATE');
        const res = await b44.entities.Base.updateMany(
          { id: base.id, dispatch_status: 'esperando_manual', manual_reservation_token: base.manual_reservation_token },
          { $set: { dispatch_status: 'libre', active_order_id: null, manual_reservation_token: null } }
        );
        const matched = res.matchedCount ?? res.modifiedCount ?? 0;
        await pushResult({
          status: matched ? 'repaired' : 'concurrent_change',
          issueType: 'ORPHAN_MANUAL_BASE',
          baseId: base.id,
          tokens: [base.manual_reservation_token],
          actions: matched ? ['Base liberada'] : [],
          correlationId,
          matchedCount: matched
        });
      } catch (e) {
        await pushResult({ status: 'persistence_error', issueType: 'ORPHAN_MANUAL_BASE', baseId: base.id, actions: [], correlationId });
      }
    }
  }

  // Case 2: RideOrder manual sin Base
  for (const order of activeOrders.filter(o => o.status === 'esperando_confirmacion_manual')) {
    const base = activeBases.find(b => b.active_order_id === order.id && b.manual_reservation_token === order.manual_reservation_token);
    if (!base) {
      const linkedDrivers = activeDrivers.filter(d => d.reserved_order_id === order.id && d.manual_reservation_token === order.manual_reservation_token);
      if (linkedDrivers.length === 1) {
        try {
          const d = linkedDrivers[0];
          await failureInjector.hit('DURING_RECONCILIATION_UPDATE');
          const dRes = await b44.entities.Driver.updateMany({ id: d.id, manual_reservation_token: order.manual_reservation_token }, { $set: { dispatch_status: 'normal', reserved_order_id: null, manual_reservation_token: null } });
          const oRes = await b44.entities.RideOrder.updateMany({ id: order.id, status: 'esperando_confirmacion_manual' }, { $set: { status: 'pendiente', reserved_driver_id: null, manual_reservation_token: null } });
          
          const matched = (dRes.matchedCount ?? dRes.modifiedCount ?? 0) + (oRes.matchedCount ?? oRes.modifiedCount ?? 0);
          await pushResult({ status: matched === 2 ? 'repaired' : 'concurrent_change', issueType: 'ORPHAN_MANUAL_ORDER', orderId: order.id, driverIds: [d.id], actions: ['Driver liberado', 'Orden a pendiente'], correlationId, matchedCount: matched });
        } catch (e) {
          await pushResult({ status: 'persistence_error', issueType: 'ORPHAN_MANUAL_ORDER', orderId: order.id, actions: [], correlationId });
        }
      } else {
        await pushResult({ status: 'manual_review_required', issueType: 'ORPHAN_MANUAL_ORDER_MULTIPLE_DRIVERS', orderId: order.id, driverIds: linkedDrivers.map(d => d.id), actions: ['Requiere revisión manual'], correlationId });
      }
    }
  }

  // Case 3: Driver manual_pending sin RideOrder
  for (const d of activeDrivers.filter(d => d.dispatch_status === 'manual_pending')) {
    const order = activeOrders.find(o => o.id === d.reserved_order_id && o.manual_reservation_token === d.manual_reservation_token);
    if (!order) {
      try {
        const res = await b44.entities.Driver.updateMany({ id: d.id, dispatch_status: 'manual_pending', manual_reservation_token: d.manual_reservation_token }, { $set: { dispatch_status: 'normal', reserved_order_id: null, manual_reservation_token: null } });
        const matched = res.matchedCount ?? res.modifiedCount ?? 0;
        await pushResult({ status: matched ? 'repaired' : 'concurrent_change', issueType: 'ORPHAN_MANUAL_DRIVER', driverIds: [d.id], actions: ['Driver liberado'], correlationId, matchedCount: matched });
      } catch (e) {}
    }
  }

  // Case 4: Driver automatic_pending sin RideOrder
  for (const d of activeDrivers.filter(d => d.dispatch_status === 'automatic_pending')) {
    const order = activeOrders.find(o => o.id === d.reserved_order_id && o.reservation_token === d.reservation_token && ['ofrecido', 'procesando_despacho'].includes(o.status));
    if (!order) {
      try {
        const res = await b44.entities.Driver.updateMany({ id: d.id, dispatch_status: 'automatic_pending', reservation_token: d.reservation_token }, { $set: { dispatch_status: 'normal', reserved_order_id: null, reservation_token: null } });
        const matched = res.matchedCount ?? res.modifiedCount ?? 0;
        await pushResult({ status: matched ? 'repaired' : 'concurrent_change', issueType: 'ORPHAN_AUTOMATIC_DRIVER', driverIds: [d.id], actions: ['Driver liberado'], correlationId, matchedCount: matched });
      } catch (e) {}
    }
  }

  // Case 5: RideOrder aceptado con Base bloqueada
  for (const order of activeOrders.filter(o => o.status === 'aceptado')) {
    const base = activeBases.find(b => b.active_order_id === order.id);
    if (base) {
      try {
        const res = await b44.entities.Base.updateMany({ id: base.id, active_order_id: order.id }, { $set: { dispatch_status: 'libre', active_order_id: null, lock_token: null, manual_reservation_token: null } });
        const matched = res.matchedCount ?? res.modifiedCount ?? 0;
        await pushResult({ status: matched ? 'repaired' : 'concurrent_change', issueType: 'ACCEPTED_ORDER_WITH_STALE_BASE', baseId: base.id, orderId: order.id, actions: ['Base liberada'], correlationId, matchedCount: matched });
      } catch (e) {}
    }
  }

  // Case 6: Tokens diferentes (TOKEN_DIVERGENCE)
  for (const order of activeOrders.filter(o => ['procesando_despacho', 'esperando_confirmacion_manual', 'ofrecido'].includes(o.status))) {
    const base = activeBases.find(b => b.active_order_id === order.id);
    const driver = activeDrivers.find(d => d.reserved_order_id === order.id);
    
    if (base && driver) {
      const bT = base.lock_token || base.manual_reservation_token;
      const oT = order.reservation_token || order.manual_reservation_token;
      const dT = driver.reservation_token || driver.manual_reservation_token;
      if (bT && oT && dT && (bT !== oT || oT !== dT)) {
        await pushResult({ status: 'manual_review_required', issueType: 'TOKEN_DIVERGENCE', baseId: base.id, orderId: order.id, driverIds: [driver.id], tokens: [bT, oT, dT], actions: ['Revisión manual por tokens divergentes'], correlationId });
      }
    }
  }

  // Case 7: Dos Drivers vinculados al mismo RideOrder
  for (const order of activeOrders) {
    const linked = activeDrivers.filter(d => d.reserved_order_id === order.id);
    if (linked.length > 1) {
      if (order.status === 'aceptado' && order.driver_id) {
        const toFree = linked.filter(d => d.id !== order.driver_id);
        let mCount = 0;
        for (const d of toFree) {
          const r = await b44.entities.Driver.updateMany({ id: d.id, reserved_order_id: order.id }, { $set: { dispatch_status: 'normal', reserved_order_id: null, reservation_token: null, manual_reservation_token: null } });
          mCount += r.matchedCount ?? r.modifiedCount ?? 0;
        }
        await pushResult({ status: mCount ? 'repaired' : 'concurrent_change', issueType: 'MULTIPLE_DRIVERS_FOR_ORDER', orderId: order.id, driverIds: linked.map(d=>d.id), actions: [`Liberados ${toFree.length} drivers espurios`], correlationId, matchedCount: mCount });
      } else {
        await pushResult({ status: 'manual_review_required', issueType: 'MULTIPLE_DRIVERS_FOR_ORDER', orderId: order.id, driverIds: linked.map(d=>d.id), actions: ['Múltiples drivers sin ganador claro'], correlationId });
      }
    }
  }

  // Case 8: Un Driver vinculado a dos RideOrders (bidirectional)
  for (const d of activeDrivers) {
    const linkedOrders = activeOrders.filter(o => o.reserved_driver_id === d.id || o.driver_id === d.id);
    if (linkedOrders.length > 1) {
      const accepted = linkedOrders.find(o => o.status === 'aceptado' && o.driver_id === d.id);
      if (accepted) {
        const toReset = linkedOrders.filter(o => o.id !== accepted.id);
        let mCount = 0;
        for (const o of toReset) {
           const r = await b44.entities.RideOrder.updateMany({ id: o.id, status: { $ne: 'aceptado' } }, { $set: { status: 'pendiente', reserved_driver_id: null, reservation_token: null, manual_reservation_token: null } });
           mCount += r.matchedCount ?? r.modifiedCount ?? 0;
        }
        await pushResult({ status: mCount ? 'repaired' : 'concurrent_change', issueType: 'DRIVER_LINKED_TO_MULTIPLE_ORDERS', driverIds: [d.id], actions: ['Viajes extra devueltos a pendiente'], correlationId, matchedCount: mCount });
      } else {
        await pushResult({ status: 'manual_review_required', issueType: 'DRIVER_LINKED_TO_MULTIPLE_ORDERS', driverIds: [d.id], actions: ['Múltiples viajes sin ganador claro'], correlationId });
      }
    }
  }

  // Case 9: RideOrder procesando_despacho huérfano (Grace period)
  for (const order of activeOrders.filter(o => o.status === 'procesando_despacho')) {
    if (getAge(order) > graceMs) {
      const base = activeBases.find(b => b.active_order_id === order.id);
      const driver = activeDrivers.find(d => d.reserved_order_id === order.id);
      if (!base && !driver) {
        const res = await b44.entities.RideOrder.updateMany({ id: order.id, status: 'procesando_despacho', reservation_token: order.reservation_token }, { $set: { status: 'pendiente', reservation_token: null } });
        const matched = res.matchedCount ?? res.modifiedCount ?? 0;
        await pushResult({ status: matched ? 'repaired' : 'concurrent_change', issueType: 'ORPHAN_PROCESSING_ORDER', orderId: order.id, actions: ['Viaje devuelto a pendiente'], correlationId, matchedCount: matched });
      }
    }
  }

  // Case 10: Base procesando huérfana (Grace period)
  for (const base of activeBases.filter(b => b.dispatch_status === 'procesando')) {
    if (getAge(base) > graceMs) {
      const order = activeOrders.find(o => o.reservation_token === base.lock_token);
      if (!order) {
        const res = await b44.entities.Base.updateMany({ id: base.id, dispatch_status: 'procesando', lock_token: base.lock_token }, { $set: { dispatch_status: 'libre', lock_token: null, active_order_id: null } });
        const matched = res.matchedCount ?? res.modifiedCount ?? 0;
        await pushResult({ status: matched ? 'repaired' : 'concurrent_change', issueType: 'ORPHAN_PROCESSING_BASE', baseId: base.id, actions: ['Base liberada'], correlationId, matchedCount: matched });
      }
    }
  }

  return { correlationId, results };
}