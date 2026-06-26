import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN");
  try {
    const base44 = createClientFromRequest(req);
    const authenticated = await base44.auth.isAuthenticated();
    if (!authenticated) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { action } = body;

    // ── 1. Autocomplete de direcciones (Nominatim - OpenStreetMap) ──────────
    if (action === "autocomplete") {
      const { input } = body;
      if (!input || input.length < 2) return Response.json({ predictions: [] });

      // Nominatim biased a Gualeguaychú, Entre Ríos, Argentina
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input + ", Gualeguaychú, Entre Ríos, Argentina")}&format=json&limit=8&countrycodes=ar&addressdetails=1`;
      const r = await fetch(url, { headers: { "User-Agent": "TaxiDispatchApp/1.0", "Accept-Language": "es" } });
      const data = await r.json();

      const predictions = data.map((item) => {
        const addr = item.address || {};
        const street = addr.road || addr.pedestrian || "";
        const number = addr.house_number || "";
        const mainText = number ? `${street} ${number}`.trim() : (street || item.name || item.display_name.split(",")[0]);
        const city = addr.city || addr.town || addr.village || "Gualeguaychú";
        return {
          place_id: `osm_${item.lat}_${item.lon}`,
          description: mainText + (city ? `, ${city}` : ""),
          structured_formatting: {
            main_text: mainText,
            secondary_text: city,
          },
          _lat: parseFloat(item.lat),
          _lng: parseFloat(item.lon),
        };
      });

      return Response.json({ predictions });
    }

    // ── 2. Obtener lat/lng de un place_id (coordenadas ya embedidas en el ID) ──
    if (action === "placedetails") {
      const { place_id, description } = body;
      if (!place_id) return Response.json({ error: "place_id required" }, { status: 400 });

      // Si el place_id tiene coords embebidas (photon_lat_lng), extraerlas directamente
      if (place_id.startsWith("photon_") || place_id.startsWith("osm_")) {
        const parts = place_id.replace("photon_", "").replace("osm_", "").split("_");
        const lat = parseFloat(parts[0]);
        const lng = parseFloat(parts[1]);
        return Response.json({ lat, lng, formatted_address: description || "" });
      }

      // Fallback: geocodificar la descripción con Nominatim
      if (description) {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(description)}&format=json&limit=1&countrycodes=ar`;
        const r = await fetch(url, { headers: { "User-Agent": "TaxiDispatchApp/1.0" } });
        const data = await r.json();
        if (data[0]) {
          return Response.json({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), formatted_address: data[0].display_name });
        }
      }

      return Response.json({ error: "No location found" }, { status: 404 });
    }

    // ── 3. Calcular distancia de ruta (OSRM - OpenStreetMap, sin API key) ────
    if (action === "route") {
      const { originLat, originLng, destLat, destLng } = body;
      if (!originLat || !originLng || !destLat || !destLng) {
        return Response.json({ error: "coords required" }, { status: 400 });
      }

      const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=false`;
      const r = await fetch(url, { headers: { "User-Agent": "TaxiDispatchApp/1.0" } });
      const data = await r.json();
      const route = data.routes?.[0];
      if (!route) {
        // Fallback Haversine si OSRM no responde
        const R = 6371000;
        const dLat = (destLat - originLat) * Math.PI / 180;
        const dLng = (destLng - originLng) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(originLat*Math.PI/180) * Math.cos(destLat*Math.PI/180) * Math.sin(dLng/2)**2;
        const distance = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) * 1.3);
        return Response.json({ distance, fallback: true });
      }
      return Response.json({ distance: Math.round(route.distance) });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});