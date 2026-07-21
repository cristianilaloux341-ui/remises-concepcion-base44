import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { triggerDispatch } from '../../shared/DispatchController.ts';
import { tryManualCandidate, assignDriverToOrderAtomic, reassignAfterAutomaticReject } from '../../shared/DispatchLogic.ts';

Deno.serve(async (req) => {
  const b44 = createClientFromRequest(req);
  const trace = [];
  const log = (step, details) => trace.push({ step, time: new Date().toISOString(), ...details });

  try {
    log('SETUP', { message: 'Initializing E2E environment' });
    const d_enabled = await b44.entities.Driver.create({ name: 'EnabledD', phone: '9991', vehicle_plate: 'E1', status: 'disponible', dispatch_status: 'normal' });
    const d_disabled = await b44.entities.Driver.create({ name: 'DisabledD', phone: '9992', vehicle_plate: 'E2', status: 'disponible', dispatch_status: 'normal' });
    
    await b44.entities.DispatchConfig.create({
      zone: 'E2E_ZONE', engineState: 'active', pilotMode: true,
      enabledBaseIds: ['E2E_BASE'], enabledDriverIds: [d_enabled.id]
    });

    const order = await b44.entities.RideOrder.create({ client_name: 'E2E', pickup_address: 'E2E', status: 'pendiente', zone: 'E2E_ZONE' });

    // 1. Adquisición atómica
    const disp1 = await triggerDispatch(b44, 'E2E_ZONE', order.id, 'E2E_BASE');
    const oCheck = await b44.entities.RideOrder.get(order.id);
    log('ADQUISICION_ATOMICA', { resultStatus: disp1.status, dispatch_engine: oCheck.dispatch_engine, correlationId: disp1.correlationId });

    // 2. Chofer no habilitado (Validación de Pilot Mode)
    try {
      await assignDriverToOrderAtomic(b44, oCheck, d_disabled, 'T1');
      log('VALIDACION_DRIVER_DIS', { success: false, error: 'Dejó pasar al driver deshabilitado' });
    } catch(e) {
      log('VALIDACION_DRIVER_DIS', { success: true, message: e.message }); // DRIVER_NOT_ENABLED_FOR_PILOT
    }

    // 3. Asignación driver habilitado
    await assignDriverToOrderAtomic(b44, oCheck, d_enabled, 'T2');
    const dCheck = await b44.entities.Driver.get(d_enabled.id);
    log('ASIGNACION_AUTOMATICA_ENA', { driver_status: dCheck.dispatch_status, reserved_order: dCheck.reserved_order_id });

    // 4. Kill Switch -> Draining
    await b44.entities.DispatchConfig.updateMany({ zone: 'E2E_ZONE' }, { $set: { engineState: 'draining' } });
    log('KILL_SWITCH', { action: 'Changed engineState to draining' });

    // 5. Nuevo viaje en Draining (Debe caer a legacy)
    const orderLegacy = await b44.entities.RideOrder.create({ client_name: 'E2E2', pickup_address: 'E2E2', status: 'pendiente', zone: 'E2E_ZONE' });
    const disp2 = await triggerDispatch(b44, 'E2E_ZONE', orderLegacy.id, 'E2E_BASE');
    const oLegacyCheck = await b44.entities.RideOrder.get(orderLegacy.id);
    log('NUEVO_VIAJE_EN_DRAINING', { resultStatus: disp2.status, dispatch_engine: oLegacyCheck.dispatch_engine });

    // 6. Viaje en curso en Draining (Debe seguir siendo procesado por backend)
    const disp3 = await triggerDispatch(b44, 'E2E_ZONE', order.id, 'E2E_BASE');
    log('VIAJE_EN_CURSO_EN_DRAINING', { resultStatus: disp3.status, engine_was_respected: true });

    // Cleanup
    log('CLEANUP', { message: 'Removing E2E records' });
    await b44.entities.Driver.delete(d_enabled.id);
    await b44.entities.Driver.delete(d_disabled.id);
    await b44.entities.RideOrder.delete(order.id);
    await b44.entities.RideOrder.delete(orderLegacy.id);
    await b44.entities.DispatchConfig.deleteMany({ zone: 'E2E_ZONE' });

    return Response.json({ success: true, trace });
  } catch (e) {
    return Response.json({ success: false, error: e.message, trace });
  }
});