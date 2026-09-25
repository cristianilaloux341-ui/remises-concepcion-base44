function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function linkedDrivers(mobile, drivers) {
  const mobileId = String(mobile?.id || "");
  if (!mobileId) return [];
  return drivers.filter((driver) => String(driver.vehicle_model || "") === mobileId);
}

export function resolveActiveDriverForMobile(input, drivers = [], mobiles = []) {
  const raw = String(input ?? "").trim();
  const normalized = normalizeText(raw);
  if (!raw) return { driver: null, mobile: null, error: "Ingresá un número de móvil." };

  // El operador puede escribir el nombre exacto del chofer, pero ese chofer sólo
  // es válido si su vehicle_model apunta a un Movil real y habilitado.
  const directMatches = drivers.filter((driver) => normalizeText(driver.name) === normalized);
  if (directMatches.length === 1) {
    const driver = directMatches[0];
    const mobile = mobiles.find((m) => String(m.id || "") === String(driver.vehicle_model || "")) || null;
    if (driver.status !== "disponible") {
      return { driver: null, mobile, error: `${driver.name} no está disponible. El pasaje no fue enviado.` };
    }
    if (!mobile || mobile.activo === false || mobile.fuera_de_servicio || mobile.suspension_motivo) {
      return { driver: null, mobile, error: `${driver.name} no tiene un móvil habilitado correctamente vinculado.` };
    }
    return { driver, mobile, error: null };
  }

  const numericInput = /^\d+$/.test(raw) ? Number(raw) : null;
  if (numericInput === null) {
    return { driver: null, mobile: null, error: `No existe un móvil o chofer registrado como "${raw}".` };
  }
  const mobileMatches = mobiles.filter((mobile) => Number(mobile.numero_movil) === numericInput);
  if (mobileMatches.length === 0) {
    return { driver: null, mobile: null, error: `No existe el móvil ${raw}.` };
  }

  // El número de móvil es la identidad operativa para Central. Puede haber
  // registros históricos/duplicados con el mismo número: gana únicamente el
  // que tenga UN chofer actualmente en servicio y el móvil habilitado.
  const candidates = [];
  for (const mobile of mobileMatches) {
    if (mobile.activo === false || mobile.fuera_de_servicio || mobile.suspension_motivo) continue;
    const linked = linkedDrivers(mobile, drivers);
    for (const driver of linked) {
      if (driver.status === "disponible" || driver.status === "en_viaje") {
        candidates.push({ driver, mobile });
      }
    }
  }

  if (candidates.length === 1) {
    return { ...candidates[0], error: null };
  }
  if (candidates.length > 1) {
    return {
      driver: null,
      mobile: null,
      error: `El móvil ${raw} tiene más de un chofer en servicio. No se puede decidir de forma segura cuál usar.`
    };
  }

  return {
    driver: null,
    mobile: mobileMatches[0] || null,
    error: `El móvil ${raw} no tiene ningún chofer en servicio.`
  };
}

export function getLinkedDriversForMobile(mobile, drivers = []) {
  return linkedDrivers(mobile, drivers);
}
