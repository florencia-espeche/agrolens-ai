"use client";

import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Polyline,
  CircleMarker,
  Marker,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GeoJsonPolygon } from "@/lib/geoImport";

export interface CentroMapaObjetivo {
  lat: number;
  lon: number;
  nonce: number;
}

interface MapaDibujoLoteProps {
  modoDibujo: boolean;
  puntosDibujo: [number, number][]; // [lat, lon]
  onAgregarPunto?: (lat: number, lon: number) => void;
  onActualizarPunto?: (index: number, lat: number, lon: number) => void;
  poligonoPreview?: GeoJsonPolygon | null;
  centroObjetivo?: CentroMapaObjetivo | null;
}

function ControladorDibujo({
  modoDibujo,
  onAgregarPunto,
  poligonoPreview,
  centroObjetivo,
}: {
  modoDibujo: boolean;
  onAgregarPunto?: (lat: number, lon: number) => void;
  poligonoPreview?: GeoJsonPolygon | null;
  centroObjetivo?: CentroMapaObjetivo | null;
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

  useEffect(() => {
    if (!centroObjetivo) return;
    map.flyTo([centroObjetivo.lat, centroObjetivo.lon], 16, { duration: 0.7 });
  }, [map, centroObjetivo]);

  return null;
}

export default function MapaDibujoLote({
  modoDibujo,
  puntosDibujo,
  onAgregarPunto,
  onActualizarPunto,
  poligonoPreview,
  centroObjetivo,
}: MapaDibujoLoteProps) {
  const previewCoordsLatLng: [number, number][] = poligonoPreview
    ? poligonoPreview.coordinates[0].map(([lon, lat]) => [lat, lon])
    : [];

  const iconoVerticeInicial = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: '<div style="width:12px;height:12px;border-radius:9999px;background:#fbbf24;border:2px solid #0f172a;box-shadow:0 0 0 2px rgba(251,191,36,0.45)"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      }),
    []
  );

  const iconoVertice = useMemo(
    () =>
      L.divIcon({
        className: "",
        html: '<div style="width:11px;height:11px;border-radius:9999px;background:#38bdf8;border:2px solid #0f172a;box-shadow:0 0 0 2px rgba(56,189,248,0.45)"></div>',
        iconSize: [11, 11],
        iconAnchor: [5.5, 5.5],
      }),
    []
  );

  return (
    <div className="h-[240px] sm:h-[270px] w-full rounded-xl overflow-hidden border border-slate-700 bg-slate-950 relative">
      <MapContainer
        center={[-32.3, -63.4]}
        zoom={7}
        zoomSnap={0.5}
        scrollWheelZoom={true}
        wheelPxPerZoomLevel={120}
        className={`h-full w-full z-0 ${modoDibujo ? "cursor-crosshair" : ""}`}
      >
        <ControladorDibujo
          modoDibujo={modoDibujo}
          onAgregarPunto={onAgregarPunto}
          poligonoPreview={poligonoPreview}
          centroObjetivo={centroObjetivo}
        />
        <TileLayer
          attribution="Tiles &copy; Esri"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />

        {centroObjetivo && (
          <CircleMarker
            center={[centroObjetivo.lat, centroObjetivo.lon]}
            radius={7}
            interactive={false}
            pathOptions={{
              color: "#f59e0b",
              fillColor: "#fbbf24",
              fillOpacity: 0.75,
              weight: 2,
            }}
          />
        )}

        {previewCoordsLatLng.length >= 3 && !modoDibujo && (
          <Polygon
            positions={previewCoordsLatLng}
            interactive={false}
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
            interactive={false}
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
            interactive={false}
            pathOptions={{ color: "#38bdf8", weight: 2.5 }}
          />
        )}

        {modoDibujo &&
          puntosDibujo.map((pt, idx) =>
            onActualizarPunto ? (
              <Marker
                key={`v-${idx}`}
                position={pt}
                draggable={true}
                icon={idx === 0 ? iconoVerticeInicial : iconoVertice}
                eventHandlers={{
                  dragend: (e) => {
                    const pos = (e.target as L.Marker).getLatLng();
                    onActualizarPunto(idx, pos.lat, pos.lng);
                  },
                }}
              />
            ) : (
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
            )
          )}
      </MapContainer>

      {modoDibujo && (
        <div className="pointer-events-none absolute bottom-2 left-2 z-[400] rounded-md border border-slate-700 bg-slate-950/85 px-2.5 py-1 text-[11px] text-slate-200 backdrop-blur">
          Clic para agregar vértices · Arrastra los puntos para ajustar ({puntosDibujo.length} marcados)
        </div>
      )}
    </div>
  );
}
