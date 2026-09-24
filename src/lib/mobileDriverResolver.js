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
  if (mobileMatches.length > 1) {
    return { driver: null, mobile: null, error: `Hay más de un móvil registrado como ${raw}. Corregí el duplicado antes de asignar.` };
  }
  if (mobileMatches.length !== 1) {
    return { driver: null, mobile: null, error: `No existe el móvil ${raw}.` };
  }

  const mobile = mobileMatches[0];
  if (mobile.activo === false || mobile.fuera_de_servicio || mobile.suspension_motivo) {
    return { driver: null, mobile, error: `El móvil ${mobile.numero_movil} está inhabilitado o suspendido.` };
  }
  const linked = linkedDrivers(mobile, drivers);
  const available = linked.filter((driver) => driver.status === "disponible");
  if (available.length === 1) return { driver: available[0], mobile, error: null };
  if (available.length > 1) {
    return { driver: null, mobile, error: `El móvil ${mobile.numero_movil} tiene más de un chofer en servicio. Corregí el vínculo antes de asignar.` };
  }
  if (linked.length > 0) return { driver: null, mobile, error: `El móvil ${mobile.numero_movil} no tiene ningún chofer en servicio.` };
  return { driver: null, mobile, error: `El móvil ${mobile.numero_movil} no tiene chofer vinculado por ID.` };
}

export function getLinkedDriversForMobile(mobile, drivers = []) {
  return linkedDrivers(mobile, drivers);
}
