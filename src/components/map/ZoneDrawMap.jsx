import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, FeatureGroup, Polygon, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import { base44 } from "@/api/base44Client";

const CENTER = [-32.483, -58.233]; // Concepción del Uruguay, default center

function DrawControl({ onCreated, onEdited, onDeleted, featureGroup }) {
  const map = useMap();
  const controlRef = useRef(null);

  useEffect(() => {
    if (!featureGroup) return;

    controlRef.current = new L.Control.Draw({
      position: 'topright',
      draw: {
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: false,
        polyline: false,
        polygon: {
          allowIntersection: false,
          drawError: {
            color: '#e1e100',
            message: '<strong>Error:</strong> las líneas no se pueden cruzar!'
          },
          shapeOptions: {
            color: '#3b82f6'
          }
        }
      },
      edit: {
        featureGroup: featureGroup,
        remove: true
      }
    });

    map.addControl(controlRef.current);

    const handleCreated = (e) => {
      // Don't add to featureGroup automatically because we handle it via React state
      if (onCreated) onCreated(e);
    };

    map.on(L.Draw.Event.CREATED, handleCreated);
    map.on(L.Draw.Event.EDITED, onEdited);
    map.on(L.Draw.Event.DELETED, onDeleted);

    return () => {
      map.removeControl(controlRef.current);
      map.off(L.Draw.Event.CREATED, handleCreated);
      map.off(L.Draw.Event.EDITED, onEdited);
      map.off(L.Draw.Event.DELETED, onDeleted);
    };
  }, [map, onCreated, onEdited, onDeleted, featureGroup]);

  return null;
}

export default function ZoneDrawMap({ polygons, onPolygonCreated, onPolygonEdited, onPolygonDeleted }) {
  const [mapConfig, setMapConfig] = useState(null);

  useEffect(() => {
    let alive = true;
    const loadMapConfig = async () => {
      try {
        const sessionToken = sessionStorage.getItem("local_operator_token");
        const res = await base44.functions.invoke("geocodeRoute", { action: "mapconfig", sessionToken });
        if (alive && res.data?.tileUrl) setMapConfig(res.data);
      } catch (_) {}
    };
    loadMapConfig();
    return () => { alive = false; };
  }, []);
  const mapRef = useRef();
  const fgRef = useRef();
  const [fgReady, setFgReady] = useState(false);

  const handleCreated = (e) => {
    const layer = e.layer;
    const latlngs = layer.getLatLngs()[0]; // Array of LatLng objects
    const coordinates = latlngs.map(ll => [ll.lat, ll.lng]);
    onPolygonCreated(coordinates, layer);
  };

  const handleEdited = (e) => {
    const layers = e.layers;
    layers.eachLayer(layer => {
      const id = layer.options.id;
      if (id) {
        const latlngs = layer.getLatLngs()[0];
        const coordinates = latlngs.map(ll => [ll.lat, ll.lng]);
        onPolygonEdited(id, coordinates);
      }
    });
  };

  const handleDeleted = (e) => {
    const layers = e.layers;
    layers.eachLayer(layer => {
      const id = layer.options.id;
      if (id) {
        onPolygonDeleted(id);
      }
    });
  };

  return (
    <div className="h-[500px] w-full rounded-xl overflow-hidden border border-border/50 relative z-0">
      <MapContainer 
        center={CENTER} 
        zoom={14} 
        className="h-full w-full z-0" 
        ref={mapRef}
      >
        {mapConfig?.tileUrl && (
          <TileLayer
            attribution={mapConfig.attribution || "© OpenStreetMap contributors © Geoapify"}
            url={mapConfig.tileUrl}
          />
        )}
        
        <FeatureGroup 
          ref={(ref) => { 
            if (ref && !fgRef.current) {
              fgRef.current = ref;
              setFgReady(true);
            }
          }}
        >
          {fgReady && <DrawControl 
            featureGroup={fgRef.current}
            onCreated={handleCreated}
            onEdited={handleEdited}
            onDeleted={handleDeleted}
          />}
          
          {polygons.map(p => (
            <Polygon 
              key={p.id} 
              positions={p.coordinates}
              pathOptions={{ id: p.id, color: p.color || '#3b82f6', weight: 2, fillOpacity: 0.2 }}
            >
              <Tooltip sticky direction="center" className="bg-background text-foreground border-border text-xs font-bold px-2 py-1 rounded shadow-md">
                {p.zone}
              </Tooltip>
            </Polygon>
          ))}
        </FeatureGroup>
      </MapContainer>
    </div>
  );
}