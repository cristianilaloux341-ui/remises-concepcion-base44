import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAddressSuggestions } from "@/hooks/useAddressSuggestions";
import { MapPin, Clock, Globe } from "lucide-react";

export default function AddressAutocomplete({ value, onChange, placeholder, className, icon, required }) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || "");
  const containerRef = useRef(null);
  const suggestions = useAddressSuggestions(inputValue);

  // Sync external value changes (e.g. client auto-fill)
  useEffect(() => {
    setInputValue(value || "");
  }, [value]);

  useEffect(() => {
    const handler = (e) => {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    onChange(val);
    setOpen(val.length >= 3);
  };

  const handleSelect = (s) => {
    setInputValue(s.address);
    onChange(s.address, s.lat && s.lng ? { lat: s.lat, lng: s.lng } : null);
    setOpen(false);
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
                {s.source === "osm"
                  ? <Globe className="w-4 h-4 text-blue-400 shrink-0" />
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
                <span className="text-xs text-blue-400 shrink-0">Maps</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}