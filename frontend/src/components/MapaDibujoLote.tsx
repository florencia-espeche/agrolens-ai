"use client";

import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Polyline,
  CircleMarker,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GeoJsonPolygon } from "@/lib/geoImport";

interface MapaDibujoLoteProps {
  modoDibujo: boolean;
  puntosDibujo: [number, number][]; // [lat, lon]
  onAgregarPunto?: (lat: number, lon: number) => void;
  poligonoPreview?: GeoJsonPolygon | null;
}

function ControladorDibujo({
  modoDibujo,
  onAgregarPunto,
  poligonoPreview,
}: {
  modoDibujo: boolean;
  onAgregarPunto?: (lat: number, lon: number) => void;
  poligonoPreview?: GeoJsonPolygon | null;
}) {
  const map = useMap();

  useMapEvents({
    click(e) {
      if (modoDibujo && onAgregarPunto) {
        onAgregarPunto(e.latlng.lat, e.latlng.lng);
      }
    },
  });

  useEffect(() => {
    if (!poligonoPreview) return;
    const coordsLatLng: [number, number][] = poligonoPreview.coordinates[0].map(
      ([lon, lat]) => [lat, lon]
    );
    if (coordsLatLng.length >= 3) {
      const bounds = L.latLngBounds(coordsLatLng);
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
      }
    }
  }, [map, poligonoPreview]);

  return null;
}

export default function MapaDibujoLote({
  modoDibujo,
  puntosDibujo,
  onAgregarPunto,
  poligonoPreview,
}: MapaDibujoLoteProps) {
  const previewCoordsLatLng: [number, number][] = poligonoPreview
    ? poligonoPreview.coordinates[0].map(([lon, lat]) => [lat, lon])
    : [];

  return (
    <div className="h-[240px] sm:h-[270px] w-full rounded-xl overflow-hidden border border-slate-700 bg-slate-950 relative">
      <MapContainer
        center={[-32.3, -63.4]}
        zoom={7}
        scrollWheelZoom={true}
        wheelPxPerZoomLevel={120}
        className={`h-full w-full z-0 ${modoDibujo ? "cursor-crosshair" : ""}`}
      >
        <ControladorDibujo
          modoDibujo={modoDibujo}
          onAgregarPunto={onAgregarPunto}
          poligonoPreview={poligonoPreview}
        />
        <TileLayer
          attribution="Tiles &copy; Esri"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />

        {previewCoordsLatLng.length >= 3 && !modoDibujo && (
          <Polygon
            positions={previewCoordsLatLng}
            pathOptions={{
              color: "#10b981",
              fillColor: "#10b981",
              fillOpacity: 0.35,
              weight: 3,
            }}
          />
        )}

        {modoDibujo && puntosDibujo.length >= 3 && (
          <Polygon
            positions={puntosDibujo}
            pathOptions={{
              color: "#38bdf8",
              fillColor: "#10b981",
              fillOpacity: 0.35,
              weight: 2.5,
            }}
          />
        )}

        {modoDibujo && puntosDibujo.length === 2 && (
          <Polyline
            positions={puntosDibujo}
            pathOptions={{ color: "#38bdf8", weight: 2.5 }}
          />
        )}

        {modoDibujo &&
          puntosDibujo.map((pt, idx) => (
            <CircleMarker
              key={`${pt[0]}-${pt[1]}-${idx}`}
              center={pt}
              radius={idx === 0 ? 6 : 4.5}
              pathOptions={{
                color: idx === 0 ? "#f59e0b" : "#38bdf8",
                fillColor: idx === 0 ? "#fbbf24" : "#38bdf8",
                fillOpacity: 1,
                weight: 2,
              }}
            />
          ))}
      </MapContainer>

      {modoDibujo && (
        <div className="pointer-events-none absolute bottom-2 left-2 z-[400] rounded-md border border-slate-700 bg-slate-950/85 px-2.5 py-1 text-[11px] text-slate-200 backdrop-blur">
          Haz clic en el mapa para marcar los vértices del lote ({puntosDibujo.length} marcados)
        </div>
      )}
    </div>
  );
}
