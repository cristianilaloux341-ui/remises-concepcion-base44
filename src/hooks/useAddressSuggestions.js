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

export function useAddressSuggestions(query) {
  const { data: addresses = [] } = useQuery({
    queryKey: ["address_history"],
    queryFn: () => base44.entities.AddressHistory.list("-usage_count"),
    staleTime: 30_000,
  });

  if (!query || query.trim().length < 2) return [];

  const norm = normalize(query);

  return addresses
    .filter(a => normalize(a.address).includes(norm))
    .sort((a, b) => (b.usage_count || 1) - (a.usage_count || 1))
    .slice(0, 8);
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