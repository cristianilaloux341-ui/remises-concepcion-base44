function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePlate(value) {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}

function mobileDriverIds(mobile) {
  const ids = Array.isArray(mobile?.driver_ids) ? mobile.driver_ids.filter(Boolean) : [];
  if (mobile?.driver_id && !ids.includes(mobile.driver_id)) ids.push(mobile.driver_id);
  return ids;
}

function linkedDrivers(mobile, drivers) {
  const ids = new Set(mobileDriverIds(mobile));
  const mobileId = String(mobile?.id || "");
  const mobileNumber = String(mobile?.numero_movil ?? "");
  const plate = normalizePlate(mobile?.dominio);

  return drivers.filter((driver) => {
    if (ids.has(driver.id)) return true;
    const model = String(driver.vehicle_model ?? "");
    if (model && (model === mobileId || model === mobileNumber)) return true;
    return plate && normalizePlate(driver.vehicle_plate) === plate;
  });
}

export function resolveActiveDriverForMobile(input, drivers = [], mobiles = []) {
  const raw = String(input ?? "").trim();
  const normalized = normalizeText(raw);
  if (!raw) return { driver: null, mobile: null, error: "Ingresá un número de móvil." };

  // La UI puede buscar por nombre humano, pero nunca por IDs internos.
  // Un ID de Driver/Movil no es un identificador operativo válido para el operador.
  const directMatches = drivers.filter((driver) =>
    normalizeText(driver.name) === normalized
  );
  if (directMatches.length === 1) {
    const driver = directMatches[0];
    if (driver.status !== "disponible") {
      return { driver: null, mobile: null, error: `${driver.name} no está disponible. El pasaje no fue enviado.` };
    }
    return { driver, mobile: null, error: null };
  }

  const numericInput = /^\d+$/.test(raw) ? Number(raw) : null;
  const plateInput = normalizePlate(raw);
  const mobileMatches = mobiles.filter((mobile) =>
    (numericInput !== null && Number(mobile.numero_movil) === numericInput) ||
    (plateInput && normalizePlate(mobile.dominio) === plateInput)
  );

  if (mobileMatches.length > 1) {
    return { driver: null, mobile: null, error: `Hay más de un móvil registrado como ${raw}. Corregí el duplicado antes de asignar.` };
  }

  if (mobileMatches.length === 1) {
    const mobile = mobileMatches[0];
    if (mobile.activo === false || mobile.fuera_de_servicio || mobile.suspension_motivo) {
      return { driver: null, mobile, error: `El móvil ${mobile.numero_movil} está inhabilitado o suspendido.` };
    }
    const linked = linkedDrivers(mobile, drivers);
    const available = linked.filter((driver) => driver.status === "disponible");

    if (available.length === 1) return { driver: available[0], mobile, error: null };
    if (available.length > 1) {
      return {
        driver: null,
        mobile,
        error: `El móvil ${mobile.numero_movil} tiene más de un chofer en servicio (${available.map(d => d.name).join(", ")}). Primero dejá solamente uno activo.`,
      };
    }
    if (linked.length > 0) {
      return { driver: null, mobile, error: `El móvil ${mobile.numero_movil} no tiene ningún chofer en servicio.` };
    }
    return { driver: null, mobile, error: `El móvil ${mobile.numero_movil} no tiene choferes vinculados.` };
  }

  const legacyMatches = drivers.filter((driver) => {
    const model = String(driver.vehicle_model ?? "");
    const name = normalizeText(driver.name);
    return model === raw || (numericInput !== null && (name.startsWith(`${numericInput} `) || name.includes(` ${numericInput} `)));
  });
  const legacyAvailable = legacyMatches.filter((driver) => driver.status === "disponible");
  if (legacyAvailable.length === 1) return { driver: legacyAvailable[0], mobile: null, error: null };
  if (legacyAvailable.length > 1) {
    return { driver: null, mobile: null, error: `Hay más de un chofer en servicio relacionado con el móvil ${raw}.` };
  }

  return { driver: null, mobile: null, error: `No existe un móvil o chofer registrado como "${raw}".` };
}

export function getLinkedDriversForMobile(mobile, drivers = []) {
  return linkedDrivers(mobile, drivers);
}
