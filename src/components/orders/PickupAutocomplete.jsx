import { useState, useRef, useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { MapPin, User, Clock, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGooglePlaces } from "@/hooks/useGooglePlaces";
import { useAddressSuggestions } from "@/hooks/useAddressSuggestions";

const normalize = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

export default function PickupAutocomplete({ value, onChange, onClientSelect, placeholder, className, required, restrictToClient }) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || "");
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { setInputValue(value || ""); }, [value]);

  // Click outside
  useEffect(() => {
    const h = (e) => { if (!containerRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const { data: clientAddresses = [] } = useQuery({
    queryKey: ["client_addresses", restrictToClient],
    queryFn: () => restrictToClient 
      ? base44.entities.ClientAddress.filter({ client_id: restrictToClient }, "-usage_count", 500)
      : base44.entities.ClientAddress.list("-usage_count", 500),
    staleTime: 30_000,
  });

  const osmAndHistory = useAddressSuggestions(inputValue);
  const { predictions, getPlaceDetails } = useGooglePlaces(inputValue);

  const suggestions = useMemo(() => {
    if (!inputValue || inputValue.length < 3) return [];
    const norm = normalize(inputValue);

    const clientResults = clientAddresses
      .filter((ca) =>
        normalize(ca.full_address).includes(norm) ||
        normalize(ca.client_name).includes(norm)
      )
      .map((ca) => ({ ...ca, type: "client" }))
      .slice(0, 5);

    const clientAddressNorms = new Set(clientResults.map((r) => normalize(r.full_address)));
    
    const historyResults = osmAndHistory
      .filter(x => x.source === "history" && !clientAddressNorms.has(normalize(x.address)))
      .map(x => ({ ...x, type: "history", full_address: x.address }))
      .slice(0, 3);

    const localNorms = new Set([...clientResults, ...historyResults].map(r => normalize(r.full_address)));
    
    const osmResults = osmAndHistory
      .filter(x => x.source === "osm" && !localNorms.has(normalize(x.address)))
      .map(x => ({ ...x, type: "osm", full_address: x.address }))
      .slice(0, 4);

    const allLocalNorms = new Set([...clientResults, ...historyResults, ...osmResults].map(r => normalize(r.full_address)));
    
    const googleItems = predictions
      .filter(p => !allLocalNorms.has(normalize(p.description)))
      .slice(0, 4)
      .map((p) => ({
        id: p.place_id,
        full_address: p.description,
        place_id: p.place_id,
        type: "google",
        usage_count: 0,
      }));

    return [...clientResults, ...historyResults, ...osmResults, ...googleItems];
  }, [inputValue, clientAddresses, osmAndHistory, predictions]);

  const handleChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    onChange(val);
    setOpen(val.length >= 3);
  };

  const handleSelect = async (s) => {
    setInputValue(s.full_address);
    setOpen(false);

    let coords = s.lat && s.lng ? { lat: s.lat, lng: s.lng } : null;

    // Para resultados de Google, obtener coords exactas desde Place Details
    if (s.type === "google" && s.place_id) {
      try {
        const details = await getPlaceDetails(s.place_id);
        if (details?.lat && details?.lng) {
          coords = { lat: details.lat, lng: details.lng };
        }
      } catch (_) {}
    }

    onChange(s.full_address, coords);

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
        id="pickup-address-input"
        ref={inputRef}
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
              {s.type === "google" || s.type === "osm"
                ? <Globe className={cn("w-4 h-4 shrink-0", s.type === "osm" ? "text-green-500" : "text-blue-400")} />
                : <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{s.full_address}</p>
                {s.type === "client" && !restrictToClient && (
                  <p className="text-xs text-muted-foreground truncate">
                    <User className="w-3 h-3 inline mr-1" />
                    {s.client_name || "(sin nombre)"}
                    {s.client_phone ? ` · ${s.client_phone}` : ""}
                    {s.floor_apt ? ` · Piso ${s.floor_apt}` : ""}
                  </p>
                )}
                {s.type === "client" && restrictToClient && s.floor_apt && (
                  <p className="text-xs text-muted-foreground truncate">
                    Piso/Depto: {s.floor_apt}
                  </p>
                )}
              </div>
              {s.type === "google" && (
                <span className="text-xs text-blue-400 shrink-0">Google</span>
              )}
              {s.type === "osm" && (
                <span className="text-xs text-green-600 font-medium shrink-0">OSM</span>
              )}
              {s.type !== "google" && s.type !== "osm" && (s.usage_count || 0) > 1 && (!restrictToClient || s.type === "client") && (
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