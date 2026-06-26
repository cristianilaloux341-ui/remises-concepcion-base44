import { useState, useRef, useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { MapPin, User, Clock, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const CITY = "Concepción del Uruguay";
const PROVINCE = "Entre Ríos";
const COUNTRY = "Argentina";
const VIEWBOX = "-58.35,-33.15,-58.15,-32.95";
const nominatimCache = new Map();

async function fetchNominatim(query) {
  if (nominatimCache.has(query)) return nominatimCache.get(query);
  const q = `${query}, ${CITY}, ${PROVINCE}, ${COUNTRY}`;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=8&countrycodes=ar&accept-language=es&viewbox=${VIEWBOX}&bounded=1&addressdetails=1`;
  const res = await fetch(url, { headers: { "Accept-Language": "es" } });
  const data = await res.json();
  const results = data
    .filter(d => {
      const city = (d.address?.city || d.address?.town || d.address?.village || "").toLowerCase();
      return city.includes("concepci") || city === "";
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

  const seen = new Set();
  const unique = results.filter(r => { if (seen.has(r.address)) return false; seen.add(r.address); return true; });

  nominatimCache.set(query, unique);
  if (nominatimCache.size > 100) nominatimCache.delete(nominatimCache.keys().next().value);
  return unique;
}

const normalize = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

export default function PickupAutocomplete({ value, onChange, onClientSelect, placeholder, className, required }) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || "");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const containerRef = useRef(null);

  useEffect(() => { setInputValue(value || ""); }, [value]);

  // Debounce 300ms
  useEffect(() => {
    if (inputValue.length < 3) { setDebouncedQuery(""); return; }
    const t = setTimeout(() => setDebouncedQuery(inputValue), 300);
    return () => clearTimeout(t);
  }, [inputValue]);

  // Click outside
  useEffect(() => {
    const h = (e) => { if (!containerRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const { data: clientAddresses = [] } = useQuery({
    queryKey: ["client_addresses"],
    queryFn: () => base44.entities.ClientAddress.list("-usage_count", 500),
    staleTime: 30_000,
  });

  const { data: addressHistory = [] } = useQuery({
    queryKey: ["address_history"],
    queryFn: () => base44.entities.AddressHistory.list("-usage_count"),
    staleTime: 30_000,
  });

  const { data: osmResults = [] } = useQuery({
    queryKey: ["nominatim", debouncedQuery],
    queryFn: () => fetchNominatim(debouncedQuery),
    enabled: !!debouncedQuery && debouncedQuery.length >= 3,
    staleTime: 60_000,
    retry: false,
  });

  const suggestions = useMemo(() => {
    if (!debouncedQuery || debouncedQuery.length < 3) return [];
    const norm = normalize(debouncedQuery);

    // Search by address OR client name
    const clientResults = clientAddresses
      .filter((ca) =>
        normalize(ca.full_address).includes(norm) ||
        normalize(ca.client_name).includes(norm)
      )
      .map((ca) => ({ ...ca, type: "client" }))
      .slice(0, 5);

    // General address history
    const clientAddressNorms = new Set(clientResults.map((r) => normalize(r.full_address)));
    const historyResults = addressHistory
      .filter((a) => normalize(a.address).includes(norm) && !clientAddressNorms.has(normalize(a.address)))
      .map((a) => ({ ...a, type: "history", full_address: a.address }))
      .slice(0, 3);

    // OSM results — deduplicate (osmResults ahora son { address, lat, lng })
    const localNorms = new Set([...clientResults, ...historyResults].map(r => normalize(r.full_address)));
    const osmItems = osmResults
      .filter(item => !localNorms.has(normalize(item.address)))
      .slice(0, 4)
      .map((item, i) => ({ id: `osm_${i}`, full_address: item.address, lat: item.lat, lng: item.lng, type: "osm", usage_count: 0 }));

    return [...clientResults, ...historyResults, ...osmItems];
  }, [debouncedQuery, clientAddresses, addressHistory, osmResults]);

  const handleChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    onChange(val);
    setOpen(val.length >= 3);
  };

  const handleSelect = (s) => {
    setInputValue(s.full_address);
    const coords = s.lat && s.lng ? { lat: s.lat, lng: s.lng } : null;
    onChange(s.full_address, coords);
    setOpen(false);
    if (s.type === "client") {
      onClientSelect?.({
        addressId: s.id,
        client_id: s.client_id,
        client_name: s.client_name ?? "",
        client_phone: s.client_phone ?? "",
        floor_apt: s.floor_apt ?? "",
      });
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10">
        <div className="w-3 h-3 rounded-full bg-green-500" />
      </div>
      <Input
        className={cn("pl-8", className)}
        placeholder={placeholder || "Dirección o nombre del cliente..."}
        value={inputValue}
        onChange={handleChange}
        onFocus={() => inputValue.length >= 3 && setOpen(true)}
        required={required}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-popover border rounded-xl shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {suggestions.map((s) => (
            <button
              key={`${s.type}-${s.id}`}
              type="button"
              className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-3 transition-colors border-b last:border-0 border-border/50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(s)}
            >
              {s.type === "osm"
                ? <Globe className="w-4 h-4 text-blue-400 shrink-0" />
                : <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{s.full_address}</p>
                {s.type === "client" && (
                  <p className="text-xs text-muted-foreground truncate">
                    <User className="w-3 h-3 inline mr-1" />
                    {s.client_name || "(sin nombre)"}
                    {s.client_phone ? ` · ${s.client_phone}` : ""}
                    {s.floor_apt ? ` · Piso ${s.floor_apt}` : ""}
                  </p>
                )}
              </div>
              {s.type === "osm" && (
                <span className="text-xs text-blue-400 shrink-0">Maps</span>
              )}
              {s.type !== "osm" && (s.usage_count || 0) > 1 && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <Clock className="w-3 h-3" />
                  {s.usage_count}x
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}