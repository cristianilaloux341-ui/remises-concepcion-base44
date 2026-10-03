import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";

import {buildRideHistory,loadCompletedRides,periodBounds,reportDate,nonnegative} from "../../shared/rideReporting.ts";

export const options = { requiresAuth: false };
// Redeploy marker: authoritative clean-driver login contract 2026-09-28.

function normalizePhone(value = "") {
  let digits = String(value).replace(/\D/g, "");
  if (digits.startsWith("54")) digits = digits.slice(2);
  if (digits.startsWith("9") && digits.length > 10) digits = digits.slice(1);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

function safeDriver(driver: any) {
  return {
    id: driver.id,
    name: driver.name,
    phone: driver.phone,
    vehicle_model: driver.vehicle_model,
    vehicle_plate: driver.vehicle_plate,
    status: driver.status,
  };
}

function json(body: any, status = 200) {
  return Response.json(body, { status });
}

async function findDriverByPhone(base44: any, phone: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const drivers = await base44.asServiceRole.entities.Driver.list();
  const matches = drivers.filter(
    (driver: any) => normalizePhone(driver.phone) === normalized,
  );
  return matches.length === 1 ? matches[0] : null;
}

async function validateDriverAndVehicle(base44: any, driver: any) {
  if (driver.buena_conducta === false) {
    return { status: "blocked", message: "Chofer bloqueado por conducta." };
  }

  // La sesión nueva usa la misma identidad autoritativa que el despacho:
  // Driver.vehicle_model debe apuntar al ID exacto de Movil.
  const movil = driver.vehicle_model
    ? await base44.asServiceRole.entities.Movil.get(String(driver.vehicle_model)).catch(() => null)
    : null;

  if (movil?.fuera_de_servicio) return { status: "blocked", message: "Móvil fuera de servicio." };
  if (movil?.activo === false) return { status: "rejected", message: "Móvil inactivo o rechazado." };
  if (movil?.suspension_motivo) return { status: "blocked", message: "Móvil suspendido." };
  if (!movil) return { status: "pending", message: "Móvil no asignado o registro pendiente." };
  return { movil };
}

async function handleNewApp(base44: any, action: string, payload: any) {
  if (action === "validate_session" || action === "restore_state") {
    const driver = await base44.asServiceRole.entities.Driver
      .get(String(payload.driver_id || ""))
      .catch(() => null);
    const valid = Boolean(
      driver &&
      driver.device_id === String(payload.device_id || "") &&
      driver.current_session_token === String(payload.access_token || ""),
    );
    if (action === "restore_state" && valid) {
      const loadOrder = async (id: any) => id
        ? await base44.asServiceRole.entities.RideOrder.get(String(id)).catch(() => null)
        : null;
      const [activeOrderRaw, reservedOrderRaw, nextOrderRaw] = await Promise.all([
        loadOrder(driver.active_ride_id),
        loadOrder(driver.reserved_order_id),
        loadOrder(driver.next_order_id),
      ]);
      const belongsToDriver = (order: any) => order && String(order.driver_id || '') === String(driver.id);
      const activeOrder = belongsToDriver(activeOrderRaw) && ['aceptado','en_camino','en_viaje'].includes(String(activeOrderRaw.status || '')) ? activeOrderRaw : null;
      const reservedOrder = belongsToDriver(reservedOrderRaw) && ['ofrecido','aceptado'].includes(String(reservedOrderRaw.status || '')) ? reservedOrderRaw : null;
      const nextOrder = belongsToDriver(nextOrderRaw) && !['completado','cancelado'].includes(String(nextOrderRaw.status || '')) ? nextOrderRaw : null;

      // Reparación conservadora de referencias huérfanas: sólo limpiamos el ID
      // que ya no apunta a una orden vigente de este mismo chofer. No cambiamos
      // estado, base ni posición desde restore_state.
      // Nunca limpiar referencias con un update ciego: restore_state puede correr
      // al mismo tiempo que aceptar/asignar/finalizar. Cada reparación usa CAS sobre
      // la identidad exacta que leyó, para no borrar un viaje nuevo creado después.
      if (driver.active_ride_id && !activeOrder) {
        await base44.asServiceRole.entities.Driver.updateMany(
          { id:driver.id, active_ride_id:driver.active_ride_id },
          { $set:{ active_ride_id:null } }
        ).catch(()=>null);
      }
      if (driver.reserved_order_id && !reservedOrder) {
        await base44.asServiceRole.entities.Driver.updateMany(
          { id:driver.id, reserved_order_id:driver.reserved_order_id, reservation_token:driver.reservation_token ?? null },
          { $set:{ reserved_order_id:null, reservation_token:null, driver_reservation_key:null } }
        ).catch(()=>null);
      }
      if (driver.next_order_id && !nextOrder) {
        await base44.asServiceRole.entities.Driver.updateMany(
          { id:driver.id, next_order_id:driver.next_order_id, next_order_token:driver.next_order_token ?? null },
          { $set:{ next_order_id:null, next_order_token:null } }
        ).catch(()=>null);
      }
      const serverTimeMs = Date.now();
      // Resumen diario autoritativo para la APK: sólo viajes realmente completados
      // por este chofer. El teléfono no mantiene un contador propio.
      const dailyNow=new Date();const bounds=periodBounds("day",dailyNow);
      const completed=await loadCompletedRides(base44.asServiceRole.entities.RideOrder,driver.id,bounds.from);
      const daily=buildRideHistory(completed,"day",dailyNow);
      const dayKey=bounds.day,today=daily.orders,earnings=daily.summary.total;
      return json({
        valid,
        server_time: new Date(serverTimeMs).toISOString(),
        serverTimeMs,
        daily_summary: { earnings, trips: today.length, day: dayKey },
        driver: {
          ...safeDriver(driver),
          dispatch_status: driver.dispatch_status || "normal",
          queue_authoritative_base: driver.queue_authoritative_base || null,
          queue_position: driver.queue_position ?? null,
          bloqueo_post_aceptacion_hasta: driver.bloqueo_post_aceptacion_hasta ?? null,
        },
        active_order: activeOrder,
        reserved_order: reservedOrder,
        next_order: nextOrder,
      });
    }
    return json({ valid });
  }

  if (action === "current_tariff") {
    const driver = await base44.asServiceRole.entities.Driver
      .get(String(payload.driver_id || ""))
      .catch(() => null);
    const valid = Boolean(
      driver &&
      driver.device_id === String(payload.device_id || "") &&
      driver.current_session_token === String(payload.access_token || ""),
    );
    if (!valid) return json({ success: false, reason: "invalid_session" }, 401);

    const configs = await base44.asServiceRole.entities.TarifaConfig.list().catch(() => []);
    const t = configs?.[0] || {};
    return json({
      success: true,
      tariff: {
        bajada_bandera: Number(t.bajada_bandera ?? 0),
        nocturna_bajada_bandera: Number(t.nocturna_bajada_bandera ?? 0),
        valor_ficha: Number(t.valor_ficha ?? 0),
        metros_por_ficha: Number(t.metros_por_ficha ?? 0),
        valor_ficha_espera: Number(t.valor_ficha_espera ?? 0),
        segundos_por_ficha_espera: Number(t.segundos_por_ficha_espera ?? 0),
        tolerancia_espera_segundos: Number(t.tolerancia_espera_segundos ?? 0),
        nocturna_hora_inicio: Number(t.nocturna_hora_inicio ?? 0),
        nocturna_hora_fin: Number(t.nocturna_hora_fin ?? 0),
      },
    });
  }

  if (action === "save_occasional") {
    const driver = await base44.asServiceRole.entities.Driver.get(String(payload.driver_id || "")).catch(() => null);
    const valid = Boolean(driver && driver.device_id === String(payload.device_id || "") && driver.current_session_token === String(payload.access_token || ""));
    if (!valid) return json({ success:false, reason:"invalid_session" }, 401);
    const startedAt = String(payload.ride_started_at || "");
    const finishedAt = String(payload.ride_finished_at || new Date().toISOString());
    const movil = driver.vehicle_model ? await base44.asServiceRole.entities.Movil.get(String(driver.vehicle_model)).catch(()=>null) : null;
    const created = await base44.asServiceRole.entities.RideOrder.create({
      client_name:"Viaje Ocasional (Calle)", pickup_address:"Viaje en calle", status:"completado",
      driver_id:driver.id, driver_name:driver.name || "", driver_mobile:String(movil?.numero_movil || ""),
      fare:Math.round(Number(payload.importe || 0)), importe_real_actual:Math.round(Number(payload.importe || 0)), source:"operador",
      metros_taximetro:Math.max(0,Math.round(Number(payload.metros || 0))), segundos_espera_acumulados:Math.max(0,Math.round(Number(payload.segundosEspera || 0))),
      segundos_detenido_acumulados:payload.segundosDetenido==null?null:nonnegative(payload.segundosDetenido),
      segundos_tolerancia_espera_usados:nonnegative(payload.segundosTolerancia),
      tarifa_bajada_snapshot:payload.tarifa?.bajada_bandera??null,tarifa_valor_ficha_snapshot:payload.tarifa?.valor_ficha??null,tarifa_metros_por_ficha_snapshot:payload.tarifa?.metros_por_ficha??null,
      tarifa_valor_ficha_espera_snapshot:payload.tarifa?.valor_ficha_espera??null,tarifa_segundos_por_ficha_espera_snapshot:payload.tarifa?.segundos_por_ficha_espera??null,tarifa_tolerancia_espera_segundos_snapshot:payload.tarifa?.tolerancia_espera_segundos??null,
      taximetro_iniciado:false,ride_started_at:startedAt || finishedAt, ride_finished_at:finishedAt,
      ride_duration_seconds:Math.max(0,Math.floor(((reportDate(finishedAt)?.getTime()||0)-(reportDate(startedAt)?.getTime()||reportDate(finishedAt)?.getTime()||0))/1000)), driver_vehicle_plate:String(driver.vehicle_plate || "")
    });
    const saved = await base44.asServiceRole.entities.RideOrder.get(created.id);
    if (!saved?.ride_finished_at) return json({success:false, reason:"occasional_not_persisted"}, 500);
    return json({success:true,order:saved});
  }

  if (action === "history" || action === "messages" || action === "send_message") {
    const driver = await base44.asServiceRole.entities.Driver
      .get(String(payload.driver_id || ""))
      .catch(() => null);
    const valid = Boolean(
      driver &&
      driver.device_id === String(payload.device_id || "") &&
      driver.current_session_token === String(payload.access_token || ""),
    );
    if (!valid) return json({ success: false, reason: "invalid_session" }, 401);

    if (action === "history") {
      const period = ["day", "week", "month"].includes(String(payload.period || ""))
        ? String(payload.period) : "day";
      const now=new Date(),bounds=periodBounds(period,now);
      const orders=await loadCompletedRides(base44.asServiceRole.entities.RideOrder,driver.id,bounds.from);
      return json(buildRideHistory(orders,period,now));
    }

    if (action === "messages") {
      const all = await base44.asServiceRole.entities.Message.list().catch(() => []);
      const messages = all.filter((m:any) =>
        String(m.driver_id||"") === String(driver.id) ||
        String(m.to_driver_id||"") === String(driver.id) ||
        m.is_general === true
      ).sort((a:any,b:any)=>new Date(a.created_date||0).getTime()-new Date(b.created_date||0).getTime()).slice(-100);
      return json({ success:true, messages:messages.map((m:any)=>({ id:m.id, from:m.from_type === "movil" ? "Chofer" : (m.from_name||"Central"), message:m.content, created_at:m.created_date, read:Boolean(m.read) })) });
    }

    const content = String(payload.message || "").trim();
    if (!content) return json({ success:false, reason:"empty_message" },400);
    if (content.length > 1000) return json({ success:false, reason:"message_too_long" },400);
    const created = await base44.asServiceRole.entities.Message.create({
      from_type:"movil", from_name:driver.name || "Chofer", driver_id:String(driver.id),
      to_driver_id:String(driver.id), content, read:false, is_general:false
    });
    return json({ success:true, message:{ id:created?.id, from:"Chofer", message:content, created_at:created?.created_date } });
  }

  const hasLoginPayload = Boolean(payload?.phone && payload?.pin && payload?.device_id);
  if (action !== "login" && !hasLoginPayload) return json({ error: "Acción desconocida." }, 400);

  const phone = normalizePhone(payload.phone);
  const pin = String(payload.pin || "");
  const deviceId = String(payload.device_id || "");
  if (!phone || pin.length < 4 || !deviceId) {
    return json({ error: "Teléfono, PIN y dispositivo son obligatorios." }, 400);
  }

  const driver = await findDriverByPhone(base44, phone);
  if (!driver || !driver.pin || String(driver.pin) !== pin) {
    return json({ error: "Teléfono o PIN incorrecto." }, 401);
  }

  const operational = await validateDriverAndVehicle(base44, driver);
  if (operational.status) {
    return json({ status: operational.status, message: operational.message, driver_name: driver.name });
  }

  if (driver.device_id && driver.device_id !== deviceId) {
    return json({
      status: "waiting_reset",
      driver_name: driver.name,
      message: "Este chofer ya tiene otro teléfono vinculado.",
    });
  }

  const token = crypto.randomUUID() + crypto.randomUUID();
  const newlyLinked = !driver.device_id;
  await base44.asServiceRole.entities.Driver.update(driver.id, {
    device_id: deviceId,
    current_session_token: token,
    last_active: new Date().toISOString(),
  });
  return json({
    status: "authorized",
    newly_linked: newlyLinked,
    access_token: token,
    driver: safeDriver(driver),
  });
}

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    let body: any = {};
    try { body = await req.json(); } catch (_) {}

    // Nunca guardar el PIN ni el token de sesión en AuditLog.
    const auditMetadata = body?.action
      ? {
          action: body.action,
          phone: body.payload?.phone,
          device_id: body.payload?.device_id,
          driver_id: body.payload?.driver_id,
        }
      : {
          phone: body?.phone || body?.telefono,
          device_id: body?.deviceId || body?.device_id || body?.id || body?.uuid,
        };
    await base44.asServiceRole.entities.AuditLog.create({
      action: "driverDeviceAccess",
      user_type: "sistema",
      user_name: auditMetadata.phone || auditMetadata.device_id || "Dispositivo externo",
      details: "Validación de acceso desde APK externa",
      metadata: auditMetadata,
    });

    if (body?.action) {
      const requestedAction = String(body.action).trim();
      return await handleNewApp(base44, requestedAction, body.payload || {});
    }
    return json({
      success:false,
      status:"protocol_required",
      reason:"NEW_DEVICE_ACCESS_PROTOCOL_REQUIRED",
      message:"La aplicación debe usar el protocolo de acceso nuevo."
    }, 409);
  } catch (error: any) {
    const message = error?.message || "Error interno.";
    return json({ success: false, status: "error", error: message, message }, 500);
  }
}

