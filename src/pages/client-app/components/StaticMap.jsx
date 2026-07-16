import React from 'react';
import { MapPin, Navigation } from 'lucide-react';

export default function StaticMap({ showRoute = false, showCar = false }) {
  return (
    <div className="absolute inset-0 z-0 bg-[#f8f9fa] overflow-hidden pointer-events-none">
      {/* Grid pattern simulando mapa */}
      <div className="absolute inset-0 opacity-[0.15]" style={{ backgroundImage: 'linear-gradient(#94a3b8 1px, transparent 1px), linear-gradient(90deg, #94a3b8 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
      
      {/* Elementos decorativos (Parques, Agua) */}
      <div className="absolute top-[10%] left-[20%] w-64 h-64 bg-green-200/50 rounded-full blur-3xl"></div>
      <div className="absolute bottom-[20%] right-[10%] w-80 h-40 bg-blue-200/40 rounded-[100px] blur-3xl rotate-12"></div>

      {showRoute && (
        <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
          <path d="M 120 400 Q 200 350 250 250 T 180 120" fill="none" stroke="#2563EB" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 12" />
        </svg>
      )}

      {/* Origin Marker */}
      <div className="absolute top-[400px] left-[120px] -translate-x-1/2 -translate-y-1/2">
        <div className="w-5 h-5 rounded-full bg-slate-900 border-[4px] border-white shadow-lg"></div>
      </div>

      {/* Destination Marker */}
      {showRoute && (
        <div className="absolute top-[120px] left-[180px] -translate-x-1/2 -translate-y-full">
          <MapPin className="w-10 h-10 text-red-500 drop-shadow-xl" fill="#EF4444" color="white" />
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-1 bg-black/20 rounded-full blur-[2px]"></div>
        </div>
      )}

      {/* Car Marker */}
      {showCar && (
        <div className="absolute top-[250px] left-[250px] -translate-x-1/2 -translate-y-1/2 bg-white p-2.5 rounded-full shadow-xl ring-1 ring-slate-100">
          <Navigation className="w-6 h-6 text-slate-900 -rotate-12" fill="currentColor" />
        </div>
      )}
    </div>
  );
}