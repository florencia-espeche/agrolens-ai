"use client";

import { useState } from "react";
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
    color: isSelected ? "#38bdf8" : color,
    fillColor: color,
    weight: isSelected ? 4 : 2,
    fillOpacity: isSelected ? 0.65 : 0.4,
  };
};

export default function MapaLotes({
  geojson,
  alertas = [],
  loteSeleccionadoId,
  onSelectLote,
}: MapaLotesProps) {
  const [tipoCapa, setTipoCapa] = useState<"satelital" | "oscuro">("satelital");

  // Key dinámica para forzar repintado en React-Leaflet al cambiar estado de alertas o selección
  const alertasKey = alertas.map((a) => `${a.id}:${a.estado}`).join(",");
  const mapKey = `${JSON.stringify(geojson)}-${alertasKey}-${loteSeleccionadoId}`;

  return (
    <div className="relative h-full w-full">
      {/* Selector de capa: Satelital vs Modo Oscuro */}
      <div className="absolute top-2 right-2 z-[400] flex items-center rounded-lg border border-slate-700 bg-slate-900/90 p-0.5 text-[11px] backdrop-blur shadow-md">
        <button
          type="button"
          onClick={() => setTipoCapa("satelital")}
          className={`px-2.5 py-1 rounded-md font-medium transition ${
            tipoCapa === "satelital"
              ? "bg-emerald-500 text-slate-950 font-semibold shadow-sm"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Satelital
        </button>
        <button
          type="button"
          onClick={() => setTipoCapa("oscuro")}
          className={`px-2.5 py-1 rounded-md font-medium transition ${
            tipoCapa === "oscuro"
              ? "bg-emerald-500 text-slate-950 font-semibold shadow-sm"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Modo Oscuro
        </button>
      </div>

      <MapContainer
        center={[-32.2, -63.6]} // Centro de la provincia de Córdoba
        zoom={7}
        scrollWheelZoom={false}
        className="h-full w-full rounded-xl z-0"
      >
        {/* Capa de mapa: Satelital (Esri) o Modo Oscuro (CartoDB Dark Matter) */}
        {tipoCapa === "satelital" ? (
          <TileLayer
            key="satelital"
            attribution="Tiles &copy; Esri"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        ) : (
          <TileLayer
            key="oscuro"
            attribution="&copy; OpenStreetMap &copy; CARTO"
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
        )}

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

      {/* Leyenda compacta que no tapa el mapa en mobile */}
      <div className="pointer-events-none absolute bottom-2 left-2 z-[400] flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/90 px-2.5 py-1 text-[10px] text-slate-200 backdrop-blur sm:bottom-3 sm:left-3 sm:gap-4 sm:px-3 sm:py-1.5 sm:text-xs">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-red-500" /> Alerta
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-amber-400" /> Revisión
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> Estable
        </span>
      </div>
    </div>
  );
}
