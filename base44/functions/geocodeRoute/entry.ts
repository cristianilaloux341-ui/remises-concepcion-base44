import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  try {
    const GOOGLE_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY");
    const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN");
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { action, sessionToken } = body;

    // Configuración territorial única: permite reutilizar la Central en otra ciudad
    // sin recompilar geocodificación/mapas. Si todavía no existe, conserva los
    // valores históricos de Concepción del Uruguay como fallback seguro.
    const cityRows = await base44.asServiceRole.entities.CityConfig.filter({ active: true }).catch(() => []);
    const cityConfig = cityRows[0] || {
      city_name: "Concepción del Uruguay", province: "Entre Ríos", country: "Argentina",
      country_code: "ar", center_lat: -32.4853, center_lng: -58.2375,
      search_radius_m: 15000, search_viewbox: "-58.35,-32.35,-58.10,-32.60"
    };
    const centerLat = Number(cityConfig.center_lat);
    const centerLng = Number(cityConfig.center_lng);
    const radiusM = Number(cityConfig.search_radius_m) || 15000;
    const cityLabel = [cityConfig.city_name, cityConfig.province, cityConfig.country].filter(Boolean).join(", ");

    let isAppRequest = false;
    let validDriver = null;
    
    if (await verifyRequestAuth(base44.asServiceRole, body, { allowOperator: true })) {
      isAppRequest = true;
    } else if (sessionToken) {
      const choferes = await base44.asServiceRole.entities.Driver.filter({ current_session_token: sessionToken });
      if (choferes.length > 0) {
        isAppRequest = true;
        validDriver = choferes[0];
      }
    } else {
       isAppRequest = await base44.auth.isAuthenticated();
    }

    if (!isAppRequest) {
      return Response.json({ error: "Unauthorized. Se requiere sessionToken válido." }, { status: 401 });
    }
    
    // Bypass prevention: Drivers can only consume routing APIs if they are in an active ride
    if (validDriver && action === "route") {
       if (!validDriver.active_ride_id) {
          return Response.json({ error: "Consumo de API denegado: No tienes un viaje activo." }, { status: 403 });
       }
    }

    // ── 0. Configuración de mapa visual Geoapify ────────────────────────────
    // La clave se entrega sólo a solicitudes autenticadas de la app.
    // Geoapify requiere apiKey en la URL de tiles del navegador.
    if (action === "mapconfig") {
      const GEOAPIFY_API_KEY = Deno.env.get("GEOAPIFY_API_KEY");
      if (!GEOAPIFY_API_KEY) {
        return Response.json({ error: "GEOAPIFY_API_KEY no configurada" }, { status: 500 });
      }
      return Response.json({
        tileUrl: `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${GEOAPIFY_API_KEY}`,
        attribution: "© OpenStreetMap contributors © Geoapify",
        city: cityConfig.city_name,
        province: cityConfig.province,
        country: cityConfig.country,
        center: [centerLat, centerLng],
        searchRadiusM: radiusM,
        viewbox: cityConfig.search_viewbox || null
      });
    }

    // ── 1. Autocomplete (Geoapify) ─────────────────────────────────────────
    if (action === "autocomplete") {
      const { input } = body;
      if (!input || input.length < 3) return Response.json({ predictions: [] });

      const GEOAPIFY_API_KEY = Deno.env.get("GEOAPIFY_API_KEY");
      if (!GEOAPIFY_API_KEY) {
        return Response.json({ error: "GEOAPIFY_API_KEY no configurada" }, { status: 500 });
      }

      const filter = `circle:${centerLng},${centerLat},${radiusM}`;
      const bias = `proximity:${centerLng},${centerLat}`;
      const url = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(input)}&format=json&lang=es&filter=${encodeURIComponent(filter)}&bias=${encodeURIComponent(bias)}&limit=8&apiKey=${GEOAPIFY_API_KEY}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) {
        console.error("Geoapify autocomplete HTTP:", r.status);
        return Response.json({ error: "Geoapify autocomplete no disponible" }, { status: 502 });
      }
      const data = await r.json();

      const predictions = (data.results || [])
        // Para calles con altura, no ofrecer primero un centroide de calle/barrio.
        // Esos puntos aproximados eran capaces de caer en otro polígono y cambiar
        // la zona aunque el texto de la dirección pareciera correcto.
        .map((p, i) => {
          const resultType = String(p.result_type || "");
          const rank = resultType === "building" || p.housenumber ? 0
            : resultType === "amenity" ? 1
            : resultType === "street" ? 3
            : 2;
          return {
            place_id: `geoapify_${p.lat}_${p.lon}_${i}`,
            description: p.formatted || [p.address_line1, p.address_line2].filter(Boolean).join(", "),
            structured_formatting: {
              main_text: p.address_line1 || p.street || p.formatted || "",
              secondary_text: p.address_line2 || "",
            },
            _lat: p.lat,
            _lng: p.lon,
            _rank: rank,
            _result_type: resultType,
          };
        })
        .sort((a, b) => a._rank - b._rank);

      return Response.json({ predictions });
    }

    // ── 2. Place Details → lat/lng ─────────────────────────────────────────
    if (action === "placedetails") {
      const { place_id, description } = body;
      if (!place_id) return Response.json({ error: "place_id required" }, { status: 400 });

      if (place_id.startsWith("geoapify_") || place_id.startsWith("photon_") || place_id.startsWith("osm_")) {
        const parts = place_id.replace("geoapify_", "").replace("photon_", "").replace("osm_", "").split("_");
        return Response.json({ lat: parseFloat(parts[0]), lng: parseFloat(parts[1]), formatted_address: description || "" });
      }

      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&fields=geometry,formatted_address&key=${GOOGLE_API_KEY}&language=es`;
      const r = await fetch(url);
      const data = await r.json();
      if (data.status !== "OK") {
        return Response.json({ error: data.status, message: data.error_message }, { status: 400 });
      }
      const loc = data.result.geometry.location;
      return Response.json({ lat: loc.lat, lng: loc.lng, formatted_address: data.result.formatted_address });
    }

    // ── 2.5 Búsqueda de Coordenadas Directas (Geocode) ──────────────────────
    if (action === "geocode") {
      const { address, lat, lng } = body;
      
      // Reverse Geocoding (Lat/Lng -> Dirección)
      if (lat && lng) {
        try {
          const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_API_KEY}&language=es`;
          const r = await fetch(url);
          const data = await r.json();
          if (data.status === "OK" && data.results.length > 0) {
            const result = data.results[0];
            const route = result.address_components.find(c => c.types.includes("route"))?.short_name || "";
            const num = result.address_components.find(c => c.types.includes("street_number"))?.short_name || "";
            const shortAddress = route ? `${route} ${num}`.trim() : result.formatted_address.split(',')[0];
            return Response.json({ lat, lng, address: shortAddress, full_address: result.formatted_address });
          }
        } catch(e) { console.error("Reverse geocoding error:", e); }
      }
      
      // Forward Geocoding: reutiliza el mismo resultado Geoapify del autocomplete.
      if (address) {
        try {
          const key = Deno.env.get("GEOAPIFY_API_KEY");
          const normalizedAddress = address.toLowerCase();
          const normalizedCity = String(cityConfig.city_name || "").toLowerCase();
          const query = normalizedCity && normalizedAddress.includes(normalizedCity)
            ? address
            : address + ", " + cityLabel;
          const params = new URLSearchParams();
          params.set("text", query);
          params.set("format", "json");
          params.set("lang", "es");
          params.set("filter", `circle:${centerLng},${centerLat},${radiusM}`);
          params.set("bias", `proximity:${centerLng},${centerLat}`);
          params.set("limit", "8");
          params.set("apiKey", key || "");
          const r = await fetch("https://api.geoapify.com/v1/geocode/search?" + params.toString(), { signal: AbortSignal.timeout(8000) });
          const data = await r.json();
          const requestedNumber = String(address).match(/\b(\d+[a-zA-Z]?)\b/)?.[1]?.toLowerCase() || "";
          const candidates = (data.results || []).filter(h => Number.isFinite(Number(h.lat)) && Number.isFinite(Number(h.lon)));
          // Si se pidió una altura, priorizar coincidencia de número de puerta.
          // Si Geoapify no conoce esa altura, preferir building/amenity antes que
          // un centroide genérico de calle.
          const hit = candidates
            .map(h => {
              const house = String(h.housenumber || "").toLowerCase();
              const type = String(h.result_type || "");
              const exactHouse = requestedNumber && house === requestedNumber;
              const rank = exactHouse ? 0
                : type === "building" || house ? 1
                : type === "amenity" ? 2
                : type === "street" ? 4
                : 3;
              return { h, rank };
            })
            .sort((x, y) => x.rank - y.rank)[0]?.h;
          if (hit) {
            return Response.json({
              lat: Number(hit.lat), lng: Number(hit.lon),
              full_address: hit.formatted || query, source: "geoapify",
              result_type: hit.result_type || null,
              housenumber: hit.housenumber || null,
              exact_housenumber: !!requestedNumber && String(hit.housenumber || "").toLowerCase() === requestedNumber
            });
          }
        } catch(e) { console.error("Forward geocoding error:", e); }
      }
      return Response.json({ error: "No se pudo geocodificar", lat: null, lng: null }, { status: 400 });
    }

    // ── 3. Calcular ruta real por calles ───────────────────────────────────
    // Módulo 2: Google Directions API (principal)
    // Módulo 4: Haversine × 1.3 (fallback de emergencia)
    if (action === "route") {
      const { originLat, originLng, destLat, destLng } = body;
      if (!originLat || !originLng || !destLat || !destLng) {
        return Response.json({ error: "Se requieren coordenadas de origen y destino" }, { status: 400 });
      }

      // — Intento 1: Google Directions API —
      try {
        const googleUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLng}&destination=${destLat},${destLng}&key=${GOOGLE_API_KEY}&language=es&mode=driving`;
        const r = await fetch(googleUrl, { signal: AbortSignal.timeout(8000) });
        const data = await r.json();

        if (data.status === "OK" && data.routes?.[0]?.legs?.[0]?.distance?.value) {
          const metros = data.routes[0].legs[0].distance.value;
          console.log(`Google Directions: ${metros}m`);
          return Response.json({ distance: metros, source: "google_directions" });
        }
        console.warn("Google Directions status:", data.status, data.error_message);
      } catch (e) {
        console.warn("Google Directions falló:", e.message);
      }

      // — Intento 2: Mapbox Directions API —
      if (MAPBOX_TOKEN) {
        try {
          const mapboxUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${originLng},${originLat};${destLng},${destLat}?access_token=${MAPBOX_TOKEN}&geometries=geojson&language=es`;
          const r = await fetch(mapboxUrl, { signal: AbortSignal.timeout(8000) });
          const data = await r.json();

          if (data.routes?.[0]?.distance) {
            const metros = Math.round(data.routes[0].distance);
            console.log(`Mapbox Directions: ${metros}m`);
            return Response.json({ distance: metros, source: "mapbox" });
          }
          console.warn("Mapbox sin rutas:", JSON.stringify(data).slice(0, 200));
        } catch (e) {
          console.warn("Mapbox falló:", e.message);
        }
      }

      // — Fallback de emergencia: Haversine × 1.3 —
      console.warn("FALLBACK: Usando Haversine × 1.3 (sin ruteador real disponible)");
      const R = 6371000;
      const dLat = (destLat - originLat) * Math.PI / 180;
      const dLng = (destLng - originLng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(originLat * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      const linea_recta = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const metros = Math.round(linea_recta * 1.3);
      return Response.json({ distance: metros, source: "haversine_fallback", fallback: true });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("geocodeRoute error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});