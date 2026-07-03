import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MapPin, Clock, Globe } from "lucide-react";
import { useGooglePlaces } from "@/hooks/useGooglePlaces";
import { useAddressSuggestions } from "@/hooks/useAddressSuggestions";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";

const normalize = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

export default function AddressAutocomplete({ value, onChange, placeholder, className, icon, required }) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || "");
  const containerRef = useRef(null);

  useEffect(() => { setInputValue(value || ""); }, [value]);

  useEffect(() => {
    const handler = (e) => {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const osmAndHistory = useAddressSuggestions(inputValue);
  const { predictions, getPlaceDetails } = useGooglePlaces(inputValue);

  const suggestions = (() => {
    if (!inputValue || inputValue.length < 3) return [];
    
    const historyItems = osmAndHistory
      .filter(x => x.source === "history")
      .slice(0, 3);

    const historyNorms = new Set(historyItems.map(h => normalize(h.address)));
    
    const osmItems = osmAndHistory
      .filter(x => x.source === "osm" && !historyNorms.has(normalize(x.address)))
      .slice(0, 4);

    const localNorms = new Set([...historyItems, ...osmItems].map(h => normalize(h.address)));
    
    const googleItems = predictions
      .filter(p => !localNorms.has(normalize(p.description)))
      .slice(0, 4)
      .map((p) => ({ id: p.place_id, address: p.description, place_id: p.place_id, source: "google", usage_count: 0 }));

    return [...historyItems, ...osmItems, ...googleItems];
  })();

  const handleChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    onChange(val);
    setOpen(val.length >= 3);
  };

  const handleSelect = async (s) => {
    setInputValue(s.address);
    setOpen(false);

    let coords = s.lat && s.lng ? { lat: s.lat, lng: s.lng } : null;

    if (s.source === "google" && s.place_id) {
      try {
        const details = await getPlaceDetails(s.place_id);
        if (details?.lat && details?.lng) {
          coords = { lat: details.lat, lng: details.lng };
        }
      } catch (_) {}
    }

    onChange(s.address, coords);
  };

  const showDropdown = open && suggestions.length > 0;

  return (
    <div ref={containerRef} className="relative">
      {icon && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none z-10">
          {icon}
        </div>
      )}
      <Input
        className={cn(icon ? "pl-8" : "", className)}
        placeholder={placeholder}
        value={inputValue}
        onChange={handleChange}
        onFocus={() => inputValue.length >= 3 && setOpen(true)}
        required={required}
        autoComplete="off"
      />
      {showDropdown && (
        <div className="absolute z-50 top-full mt-1 w-full bg-popover border rounded-xl shadow-lg overflow-hidden">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-3 transition-colors"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(s)}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {s.source === "google" || s.source === "osm"
                  ? <Globe className={cn("w-4 h-4 shrink-0", s.source === "osm" ? "text-green-500" : "text-blue-400")} />
                  : <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                }
                <span className="text-sm truncate">{s.address}</span>
              </div>
              {s.source === "history" && s.usage_count > 1 && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <Clock className="w-3 h-3" />
                  {s.usage_count}x
                </span>
              )}
              {s.source === "osm" && (
                <span className="text-xs text-green-600 font-medium shrink-0">OSM</span>
              )}
              {s.source === "google" && (
                <span className="text-xs text-blue-400 shrink-0">Google</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}