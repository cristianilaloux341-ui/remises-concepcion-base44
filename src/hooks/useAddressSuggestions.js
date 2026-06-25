import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

// Normalize text for comparison: lowercase, remove accents, trim
function normalize(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// Ciudad y provincia para acotar la búsqueda en Nominatim
const CITY = "Concepción del Uruguay";
const PROVINCE = "Entre Ríos";
const COUNTRY = "Argentina";

// Cache simple para no repetir llamadas idénticas
const nominatimCache = new Map();

// Bounding box de Concepción del Uruguay (lat/lng aprox)
const VIEWBOX = "-58.35,-33.15,-58.15,-32.95";

async function fetchNominatim(query) {
  if (nominatimCache.has(query)) return nominatimCache.get(query);
  const q = `${query}, ${CITY}, ${PROVINCE}, ${COUNTRY}`;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=8&countrycodes=ar&accept-language=es&viewbox=${VIEWBOX}&bounded=1&addressdetails=1`;
  const res = await fetch(url, { headers: { "Accept-Language": "es" } });
  const data = await res.json();
  const results = data
    .filter(d => {
      // Solo resultados dentro de Concepción del Uruguay
      const city = (d.address?.city || d.address?.town || d.address?.village || "").toLowerCase();
      return city.includes("concepci") || city === "";
    })
    .map(d => {
      const a = d.address || {};
      // Armar "Calle Número" limpio
      const road = a.road || a.pedestrian || a.footway || "";
      const number = a.house_number || "";
      if (road) return number ? `${road} ${number}` : road;
      // Fallback: tomar los primeros 2 segmentos del display_name
      const parts = d.display_name.split(",").map(p => p.trim());
      return parts.slice(0, 2).join(", ");
    })
    .filter(Boolean);

  // Deduplicar
  const seen = new Set();
  const unique = results.filter(r => { if (seen.has(r)) return false; seen.add(r); return true; });

  nominatimCache.set(query, unique);
  if (nominatimCache.size > 100) nominatimCache.delete(nominatimCache.keys().next().value);
  return unique;
}

export function useAddressSuggestions(query) {
  const { data: addresses = [] } = useQuery({
    queryKey: ["address_history"],
    queryFn: () => base44.entities.AddressHistory.list("-usage_count"),
    staleTime: 30_000,
  });

  // Sugerencias de Nominatim (OSM) — se activan desde 3 letras
  const { data: osmSuggestions = [] } = useQuery({
    queryKey: ["nominatim", query],
    queryFn: () => fetchNominatim(query),
    enabled: !!query && query.trim().length >= 3,
    staleTime: 60_000,
    retry: false,
  });

  if (!query || query.trim().length < 2) return [];

  const norm = normalize(query);

  // Historial propio filtrado
  const historial = addresses
    .filter(a => normalize(a.address).includes(norm))
    .sort((a, b) => (b.usage_count || 1) - (a.usage_count || 1))
    .slice(0, 4)
    .map(a => ({ id: `h_${a.id}`, address: a.address, usage_count: a.usage_count, source: "history" }));

  // Sugerencias OSM — deduplicar contra historial
  const historialNorms = new Set(historial.map(h => normalize(h.address)));
  const osmItems = osmSuggestions
    .filter(addr => !historialNorms.has(normalize(addr)))
    .slice(0, 6)
    .map((addr, i) => ({ id: `osm_${i}`, address: addr, usage_count: 0, source: "osm" }));

  return [...historial, ...osmItems].slice(0, 8);
}

// Call this after a trip is saved with an address
export async function recordAddressUsage(address, queryClient) {
  if (!address || address.trim().length < 3) return;

  const all = await base44.entities.AddressHistory.list();
  const norm = normalize(address);
  const existing = all.find(a => normalize(a.address) === norm);

  if (existing) {
    await base44.entities.AddressHistory.update(existing.id, {
      usage_count: (existing.usage_count || 1) + 1,
      last_used: new Date().toISOString(),
    });
  } else {
    await base44.entities.AddressHistory.create({
      address: address.trim(),
      usage_count: 1,
      last_used: new Date().toISOString(),
    });
  }

  queryClient?.invalidateQueries(["address_history"]);
}