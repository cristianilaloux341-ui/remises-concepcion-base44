import { useState, useRef, useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { MapPin, User, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

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
    if (inputValue.length < 2) { setDebouncedQuery(""); return; }
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

  const suggestions = useMemo(() => {
    if (!debouncedQuery || debouncedQuery.length < 2) return [];
    const norm = normalize(debouncedQuery);

    // Client-linked addresses (priority)
    const clientResults = clientAddresses
      .filter((ca) => normalize(ca.full_address).includes(norm))
      .map((ca) => ({ ...ca, type: "client" }))
      .slice(0, 6);

    // General history (exclude duplicates)
    const used = new Set(clientResults.map((r) => normalize(r.full_address)));
    const historyResults = addressHistory
      .filter((a) => normalize(a.address).includes(norm) && !used.has(normalize(a.address)))
      .map((a) => ({ ...a, type: "history", full_address: a.address }))
      .slice(0, 4);

    return [...clientResults, ...historyResults];
  }, [debouncedQuery, clientAddresses, addressHistory]);

  const handleChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    onChange(val);
    setOpen(val.length >= 2);
  };

  const handleSelect = (s) => {
    setInputValue(s.full_address);
    onChange(s.full_address);
    setOpen(false);
    if (s.type === "client") {
      onClientSelect?.({
        client_id: s.client_id,
        client_name: s.client_name,
        client_phone: s.client_phone || "",
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
        placeholder={placeholder || "Escribí la dirección de recogida..."}
        value={inputValue}
        onChange={handleChange}
        onFocus={() => inputValue.length >= 2 && setOpen(true)}
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
              <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{s.full_address}</p>
                {s.type === "client" && s.client_name && (
                  <p className="text-xs text-muted-foreground truncate">
                    <User className="w-3 h-3 inline mr-1" />
                    {s.client_name}
                    {s.client_phone ? ` (${s.client_phone})` : ""}
                    {s.floor_apt ? ` · Piso ${s.floor_apt}` : ""}
                  </p>
                )}
              </div>
              {(s.usage_count || 0) > 1 && (
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