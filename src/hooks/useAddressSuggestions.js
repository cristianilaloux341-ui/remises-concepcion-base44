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

// Cache simple para no repetir llamadas idénticas
const nominatimCache = new Map();

async function getCityConfig() {
  const rows = await base44.entities.CityConfig.filter({ active: true }).catch(() => []);
  return rows[0] || {
    city_name: "Concepción del Uruguay", province: "Entre Ríos", country: "Argentina",
    country_code: "ar", search_viewbox: "-58.35,-32.35,-58.10,-32.60"
  };
}

async function fetchNominatim(query) {
  if (nominatimCache.has(query)) return nominatimCache.get(query);
  const cfg = await getCityConfig();
  const q = [query, cfg.city_name, cfg.province, cfg.country].filter(Boolean).join(", ");
  const countryCode = String(cfg.country_code || "ar").toLowerCase();
  const viewbox = cfg.search_viewbox ? `&viewbox=${encodeURIComponent(cfg.search_viewbox)}&bounded=1` : "";
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=8&countrycodes=${encodeURIComponent(countryCode)}&accept-language=es${viewbox}&addressdetails=1`;
  const res = await fetch(url, { headers: { "Accept-Language": "es" } });
  const data = await res.json();
  const results = data
    .filter(d => {
      const city = normalize(d.address?.city || d.address?.town || d.address?.village || "");
      const expected = normalize(cfg.city_name);
      return !city || !expected || city === expected || city.includes(expected) || expected.includes(city);
    })
    .map(d => {
      const a = d.address || {};
      const road = a.road || a.pedestrian || a.footway || "";
      const number = a.house_number || "";
      let label;
      if (road) label = number ? `${road} ${number}` : road;
      else {
        const parts = d.display_name.split(",").map(p => p.trim());
        label = parts.slice(0, 2).join(", ");
      }
      return label ? { address: label, lat: parseFloat(d.lat), lng: parseFloat(d.lon) } : null;
    })
    .filter(Boolean);

  // Deduplicar por label
  const seen = new Set();
  const unique = results.filter(r => { if (seen.has(r.address)) return false; seen.add(r.address); return true; });

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
    .map(a => ({
      id: `h_${a.id}`,
      address: a.address,
      lat: a.zone_confirmed === true ? a.lat : null,
      lng: a.zone_confirmed === true ? a.lng : null,
      zone: a.zone_confirmed === true ? a.zone : null,
      zone_confirmed: a.zone_confirmed === true,
      usage_count: a.usage_count,
      source: "history"
    }));

  // Sugerencias OSM — deduplicar contra historial (osmSuggestions ahora son { address, lat, lng })
  const historialNorms = new Set(historial.map(h => normalize(h.address)));
  const osmItems = osmSuggestions
    .filter(item => !historialNorms.has(normalize(item.address)))
    .slice(0, 6)
    .map((item, i) => ({ id: `osm_${i}`, address: item.address, lat: item.lat, lng: item.lng, usage_count: 0, source: "osm" }));

  return [...historial, ...osmItems].slice(0, 8);
}

// Call this after a trip is saved with an address
export async function recordAddressUsage(address, queryClient, metadata = {}) {
  if (!address || address.trim().length < 3) return;

  const all = await base44.entities.AddressHistory.list();
  const norm = normalize(address);
  const existing = all.find(a => (a.normalized_address || normalize(a.address)) === norm);
  const parsed = address.trim().match(/^(.*?)[\\s,]+(\\d+[a-zA-Z]?)$/);
  const learned = {
    normalized_address: norm,
    street: metadata.street || parsed?.[1]?.trim() || address.trim(),
    height: metadata.height || parsed?.[2] || "",
    ...(Number.isFinite(Number(metadata.lat)) ? { lat: Number(metadata.lat) } : {}),
    ...(Number.isFinite(Number(metadata.lng)) ? { lng: Number(metadata.lng) } : {}),
    ...(metadata.zone ? { zone: metadata.zone, zone_confirmed: true, zone_source: metadata.zone_source || "polygon" } : {}),
  };

  if (existing) {
    await base44.entities.AddressHistory.update(existing.id, {
      ...learned,
      usage_count: (existing.usage_count || 1) + 1,
      last_used: new Date().toISOString(),
    });
  } else {
    await base44.entities.AddressHistory.create({
      address: address.trim(),
      ...learned,
      usage_count: 1,
      last_used: new Date().toISOString(),
    });
  }

  queryClient?.invalidateQueries(["address_history"]);
}