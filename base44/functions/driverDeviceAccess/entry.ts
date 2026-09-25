import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";

export const options = { requiresAuth: false };

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
      const [activeOrder, reservedOrder, nextOrder] = await Promise.all([
        loadOrder(driver.active_ride_id),
        loadOrder(driver.reserved_order_id),
        loadOrder(driver.next_order_id),
      ]);
      return json({
        valid,
        server_time: new Date().toISOString(),
        driver: {
          ...safeDriver(driver),
          dispatch_status: driver.dispatch_status || "normal",
          queue_authoritative_base: driver.queue_authoritative_base || null,
          queue_position: driver.queue_position ?? null,
        },
        active_order: activeOrder,
        reserved_order: reservedOrder,
        next_order: nextOrder,
      });
    }
    return json({ valid });
  }

  if (action !== "login") return json({ error: "Acción desconocida." }, 400);

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

    if (body?.action) return await handleNewApp(base44, body.action, body.payload || {});
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
