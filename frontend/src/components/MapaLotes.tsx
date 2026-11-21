"use client";

import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { FeatureCollection, Feature } from "geojson";

export interface AlertaMapa {
  id: number;
  lote_id: number;
  estado: string;
  nivel_severidad?: string;
  [key: string]: any;
}

interface MapaLotesProps {
  geojson: FeatureCollection | null;
  alertas?: AlertaMapa[];
  loteSeleccionadoId: number | null;
  onSelectLote: (loteId: number) => void;
}

// Helper para determinar el estilo de cada polígono según sus alertas (Semáforo)
const getLoteStyle = (
  loteId: number | string,
  alertas: AlertaMapa[],
  isSelected: boolean
) => {
  const alertasLote = alertas.filter((a) => a.lote_id === loteId);

  const tienePendiente = alertasLote.some(
    (a) =>
      a.estado?.toLowerCase() === "pendiente" ||
      a.estado?.toLowerCase() === "activa"
  );
  const tieneEnRevision = alertasLote.some(
    (a) =>
      a.estado?.toLowerCase() === "en_revision" ||
      a.estado?.toLowerCase() === "en revisión"
  );

  let color = "#22c55e"; // Verde: Estable
  if (tienePendiente) {
    color = "#ef4444"; // Rojo: Alerta activa / pendiente
  } else if (tieneEnRevision) {
    color = "#f59e0b"; // Amarillo/Ámbar: En revisión
  }

  return {
    color: isSelected ? "#ffffff" : color,
    fillColor: color,
    weight: isSelected ? 3 : 2,
    fillOpacity: isSelected ? 0.55 : 0.35,
  };
};

export default function MapaLotes({
  geojson,
  alertas = [],
  loteSeleccionadoId,
  onSelectLote,
}: MapaLotesProps) {
  // Key dinámica para forzar repintado en React-Leaflet al cambiar estado de alertas o selección
  const alertasKey = alertas.map((a) => `${a.id}:${a.estado}`).join(",");
  const mapKey = `${JSON.stringify(geojson)}-${alertasKey}-${loteSeleccionadoId}`;

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={[-32.2, -63.6]} // Centro de la provincia de Córdoba
        zoom={7}
        className="h-full w-full rounded-xl z-0"
      >
        {/* Capa base satelital de Esri */}
        <TileLayer
          attribution="Tiles &copy; Esri"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />

        {geojson && (
          <GeoJSON
            key={mapKey}
            data={geojson}
            style={(feature?: Feature) => {
              const props = feature?.properties || {};
              const isSelected = props.id === loteSeleccionadoId;
              return getLoteStyle(props.id, alertas, isSelected);
            }}
            onEachFeature={(feature, layer) => {
              const p = feature.properties;
              const alertasLote = alertas.filter((a) => a.lote_id === p.id);
              const tienePendiente = alertasLote.some(
                (a) =>
                  a.estado?.toLowerCase() === "pendiente" ||
                  a.estado?.toLowerCase() === "activa"
              );
              const tieneEnRevision = alertasLote.some(
                (a) =>
                  a.estado?.toLowerCase() === "en_revision" ||
                  a.estado?.toLowerCase() === "en revisión"
              );

              const estadoSemaforo = tienePendiente
                ? "🔴 Alerta activa"
                : tieneEnRevision
                ? "🟡 En revisión"
                : "🟢 Estable";

              const fechaFoto = p.ultima_fecha_satelital
                ? `<br/>📅 Imagen: ${p.ultima_fecha_satelital}`
                : "";

              layer.bindTooltip(
                `<strong>${p.nombre_lote}</strong><br/>
                 Cultivo: ${p.cultivo_actual}<br/>
                 NDVI: ${p.ultimo_ndvi ?? "N/A"}${fechaFoto}<br/>
                 Semáforo: ${estadoSemaforo}`,
                { sticky: true }
              );
              layer.on("click", () => onSelectLote(p.id));
            }}
          />
        )}
      </MapContainer>

      {/* Leyenda compacta flotando en la esquina inferior izquierda */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-[400] flex items-center gap-4 rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-200 backdrop-blur shadow-lg">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Alerta activa
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> En revisión
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Estable
        </span>
      </div>
    </div>
  );
}
