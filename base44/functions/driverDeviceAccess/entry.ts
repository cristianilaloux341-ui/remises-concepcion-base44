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

  let movil = null;
  if (driver.vehicle_model) {
    try {
      movil = await base44.asServiceRole.entities.Movil.get(driver.vehicle_model);
    } catch (_) {}
  }
  if (!movil) {
    const moviles = await base44.asServiceRole.entities.Movil.list();
    movil = moviles.find((candidate: any) => {
      const ids = Array.isArray(candidate.driver_ids) ? candidate.driver_ids : [];
      if (ids.includes(driver.id) || candidate.driver_id === driver.id) return true;
      if (String(candidate.numero_movil ?? "") === String(driver.vehicle_model ?? "")) return true;
      const mobilePlate = String(candidate.dominio || "").replace(/\s+/g, "").toUpperCase();
      const driverPlate = String(driver.vehicle_plate || "").replace(/\s+/g, "").toUpperCase();
      return mobilePlate && mobilePlate === driverPlate;
    }) || null;
  }

  if (movil?.fuera_de_servicio) return { status: "blocked", message: "Móvil fuera de servicio." };
  if (movil?.activo === false) return { status: "rejected", message: "Móvil inactivo o rechazado." };
  if (movil?.suspension_motivo) return { status: "blocked", message: "Móvil suspendido." };
  if (!movil && driver.status === "no_disponible") {
    return { status: "pending", message: "Móvil no asignado o registro pendiente." };
  }
  return { movil };
}

async function handleNewApp(base44: any, action: string, payload: any) {
  if (action === "validate_session") {
    const driver = await base44.asServiceRole.entities.Driver
      .get(String(payload.driver_id || ""))
      .catch(() => null);
    const valid = Boolean(
      driver &&
      driver.device_id === String(payload.device_id || "") &&
      driver.current_session_token === String(payload.access_token || ""),
    );
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

async function handleLegacyApp(base44: any, body: any) {
  const phone = body?.phone || body?.telefono;
  const deviceId = body?.deviceId || body?.device_id || body?.id || body?.uuid;
  if (!phone && !deviceId) {
    return json({ success: false, status: "dispositivo no registrado", message: "Faltan datos de identificación" }, 400);
  }

  const drivers = await base44.asServiceRole.entities.Driver.list();
  let driver = phone ? await findDriverByPhone(base44, phone) : null;
  if (!driver && deviceId) {
    driver = drivers.find(
      (candidate: any) => candidate.device_id === deviceId || candidate.fcm_token === deviceId,
    );
  }
  if (!driver) {
    return json({ success: false, status: "chofer inexistente", message: "No existe un chofer con esos datos" }, 404);
  }

  // Compatibilidad con los clientes anteriores.
  if (deviceId && driver.device_id !== deviceId) {
    await base44.asServiceRole.entities.Driver.update(driver.id, { device_id: deviceId });
    driver.device_id = deviceId;
  }

  const operational = await validateDriverAndVehicle(base44, driver);
  if (operational.status) {
    const legacyStatus: Record<string, string> = {
      blocked: "bloqueado",
      rejected: "rechazado",
      pending: "pendiente",
    };
    return json({
      success: false,
      status: legacyStatus[operational.status] || operational.status,
      message: operational.message,
    });
  }

  return json({
    success: true,
    status: "autorizado",
    authorized: true,
    estado: "autorizado",
    driver,
    movil: operational.movil,
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
    return await handleLegacyApp(base44, body);
  } catch (error: any) {
    const message = error?.message || "Error interno.";
    return json({ success: false, status: "error", error: message, message }, 500);
  }
}
