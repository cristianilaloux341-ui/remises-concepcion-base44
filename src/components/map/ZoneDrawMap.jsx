import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, FeatureGroup, Polygon, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import { EditControl } from 'react-leaflet-draw';

const CENTER = [-32.483, -58.233]; // Concepción del Uruguay, default center

export default function ZoneDrawMap({ polygons, onPolygonCreated, onPolygonEdited, onPolygonDeleted }) {
  const mapRef = useRef();

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
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        <FeatureGroup>
          <EditControl
            position="topright"
            onCreated={handleCreated}
            onEdited={handleEdited}
            onDeleted={handleDeleted}
            draw={{
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
            }}
          />
          
          {polygons.map(p => (
            <Polygon 
              key={p.id} 
              id={p.id}
              positions={p.coordinates}
              pathOptions={{ color: p.color || '#3b82f6', weight: 2, fillOpacity: 0.2 }}
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