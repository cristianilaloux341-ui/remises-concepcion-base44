export const phoneDigits = value => String(value || "").replace(/\D/g, "");
export const addressKey = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export function uniqueClient(rows) {
  const byId = new Map();
  for (const row of rows) {
    const id = row.client_id || row.id;
    if (id && !byId.has(id)) byId.set(id, {client_id:id, client_name:row.client_name || row.name || "", client_phone:row.client_phone || row.phone || ""});
  }
  return byId.size === 1 ? [...byId.values()][0] : null;
}
export function matchClientByPhone(phone, clients, addresses = []) {
  const digits = phoneDigits(phone);
  if (digits.length < 7) return null;
  return uniqueClient([...clients.filter(c => phoneDigits(c.phone).endsWith(digits)), ...addresses.filter(c => phoneDigits(c.client_phone).endsWith(digits))]);
}
export function matchClientByAddress(address, clients, addresses) {
  const key = addressKey(address);
  if (!key || !/\d/.test(key)) return null;
  return uniqueClient([...addresses.filter(c => addressKey(c.full_address) === key), ...clients.filter(c => addressKey(c.pickup_address) === key)]);
}
