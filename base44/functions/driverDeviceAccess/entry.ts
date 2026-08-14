import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

export const options = {
  requiresAuth: false,
};

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    let body: any = {};
    try {
      body = await req.json();
    } catch (e) {}

    // Registramos el intento de acceso en AuditLog para observar exactamente qué envía la app externa.
    await base44.asServiceRole.entities.AuditLog.create({
      action: "driverDeviceAccess",
      user_type: "sistema",
      user_name: body?.phone || body?.deviceId || "Dispositivo externo",
      details: "Validación de acceso desde APK externa",
      metadata: body || {}
    });

    const phone = body?.phone || body?.telefono;
    const deviceId = body?.deviceId || body?.device_id || body?.id || body?.uuid;

    if (!phone && !deviceId) {
      return Response.json({
        success: false,
        status: "dispositivo no registrado",
        message: "Faltan datos de identificación"
      });
    }

    const drivers = await base44.asServiceRole.entities.Driver.list();
    let driver = null;

    if (phone) {
      const normalized = String(phone).replace(/\s|-|\(|\)/g, "");
      driver = drivers.find(d => {
        const dp = (d.phone || "").replace(/\s|-|\(|\)/g, "");
        return dp === normalized || (normalized.length >= 6 && (dp.endsWith(normalized) || normalized.endsWith(dp)));
      });
    }

    if (!driver && deviceId) {
      driver = drivers.find(d => d.device_id === deviceId || d.fcm_token === deviceId);
      if (!driver) {
        return Response.json({
          success: false,
          status: "dispositivo no registrado",
          message: "El dispositivo no está asociado a ningún chofer"
        });
      }
    }

    if (!driver) {
      return Response.json({
        success: false,
        status: "chofer inexistente",
        message: "No existe un chofer con esos datos"
      });
    }

    // Vincular el dispositivo si vino por número de teléfono y el ID es nuevo
    if (deviceId && driver.device_id !== deviceId) {
      await base44.asServiceRole.entities.Driver.update(driver.id, { device_id: deviceId });
      driver.device_id = deviceId;
    }

    // Validar estado del chofer
    if (driver.buena_conducta === false) {
      return Response.json({
        success: false,
        status: "bloqueado",
        message: "Chofer bloqueado por conducta"
      });
    }

    // Validar estado del móvil
    let movil = null;
    if (driver.vehicle_model) {
      try {
        movil = await base44.asServiceRole.entities.Movil.get(driver.vehicle_model);
      } catch (e) {}
    }
    
    if (!movil) {
      const moviles = await base44.asServiceRole.entities.Movil.filter({ driver_id: driver.id });
      if (moviles.length > 0) movil = moviles[0];
    }

    if (movil) {
      if (movil.fuera_de_servicio) {
        return Response.json({
          success: false,
          status: "bloqueado",
          message: "Móvil fuera de servicio"
        });
      }
      if (movil.activo === false) {
        return Response.json({
          success: false,
          status: "rechazado",
          message: "Móvil inactivo o rechazado"
        });
      }
      if (movil.suspension_motivo) {
        return Response.json({
          success: false,
          status: "bloqueado",
          message: "Móvil suspendido"
        });
      }
    } else {
      // Si el chofer no tiene ningún móvil asignado y está en no disponible, puede ser un chofer nuevo "pendiente"
      if (driver.status === "no_disponible") {
        return Response.json({
          success: false,
          status: "pendiente",
          message: "Móvil no asignado o registro pendiente"
        });
      }
    }

    // Si todo está bien:
    return Response.json({
      success: true,
      status: "autorizado",
      authorized: true,
      estado: "autorizado",
      driver: driver,
      movil: movil
    });

  } catch (error: any) {
    return Response.json({
      success: false,
      status: "error",
      message: error.message || "Error interno del servidor"
    });
  }
}