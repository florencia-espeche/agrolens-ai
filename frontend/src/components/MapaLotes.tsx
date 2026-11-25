"use client";

import { useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FeatureCollection, Feature } from "geojson";

export interface AlertaMapa {
  id: number;
  lote_id: number;
  estado: string;
  nivel_severidad?: string;
}

function formatearFechaTooltip(fechaIso?: string) {
  if (!fechaIso) return "";
  const soloFecha = String(fechaIso).split("T")[0];
  const d = new Date(`${soloFecha}T12:00:00`);
  if (Number.isNaN(d.getTime())) return soloFecha;
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

interface MapaLotesProps {
  geojson: FeatureCollection | null;
  alertas?: AlertaMapa[];
  loteSeleccionadoId: number | null;
  zoomLoteNonce?: number;
  onSelectLote: (loteId: number) => void;
}

// Helper para determinar el estilo de cada polígono según sus alertas (Semáforo)
const getLoteStyle = (
  loteId: number | string,
  alertas: AlertaMapa[],
  isSelected: boolean
) => {
  const idNum = Number(loteId);
  const alertasLote = alertas.filter((a) => Number(a.lote_id) === idNum);

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

/** Controla la vista inicial general y el zoom al hacer clic explícito en un lote. */
function ControladorVistaMapa({
  geojson,
  loteSeleccionadoId,
  zoomLoteNonce,
  vistaGeneralTrigger,
  centrarLoteTrigger,
}: {
  geojson: FeatureCollection | null;
  loteSeleccionadoId: number | null;
  zoomLoteNonce: number;
  vistaGeneralTrigger: number;
  centrarLoteTrigger: number;
}) {
  const map = useMap();

  // Identificador estable de los lotes visibles (evita re-encuadrar al cambiar estado de alertas)
  const geojsonIdsSignature = (geojson?.features || [])
    .map((f) => f.properties?.id)
    .join(",");

  // Vista general de todos los lotes al abrir o cambiar de establecimiento/campaña
  useEffect(() => {
    if (!geojson || geojson.features.length === 0) return;
    const allBounds = L.geoJSON(geojson).getBounds();
    if (allBounds.isValid()) {
      map.flyToBounds(allBounds, { padding: [35, 35], maxZoom: 10, duration: 0.7 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geojsonIdsSignature]);

  // Zoom de detalle únicamente cuando el usuario selecciona o pide centrar un lote
  useEffect(() => {
    const totalTriggers = zoomLoteNonce + centrarLoteTrigger;
    if (totalTriggers === 0 || !geojson || !loteSeleccionadoId) return;

    const feature = geojson.features.find(
      (f) => Number(f.properties?.id) === loteSeleccionadoId
    );
    if (feature) {
      const bounds = L.geoJSON(feature).getBounds();
      if (bounds.isValid()) {
        map.flyToBounds(bounds, {
          padding: [55, 55],
          maxZoom: 14,
          duration: 0.7,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, loteSeleccionadoId, zoomLoteNonce, centrarLoteTrigger]);

  useEffect(() => {
    if (vistaGeneralTrigger === 0 || !geojson || geojson.features.length === 0) return;
    const allBounds = L.geoJSON(geojson).getBounds();
    if (allBounds.isValid()) {
      map.flyToBounds(allBounds, { padding: [35, 35], maxZoom: 10, duration: 0.7 });
    }
  }, [map, geojson, vistaGeneralTrigger]);

  return null;
}

export default function MapaLotes({
  geojson,
  alertas = [],
  loteSeleccionadoId,
  zoomLoteNonce = 0,
  onSelectLote,
}: MapaLotesProps) {
  const [tipoCapa, setTipoCapa] = useState<"satelital" | "oscuro">("satelital");
  const [vistaGeneralTrigger, setVistaGeneralTrigger] = useState(0);
  const [centrarLoteTrigger, setCentrarLoteTrigger] = useState(0);
  const geoJsonRef = useRef<L.GeoJSON | null>(null);

  // Actualiza estilos en el lugar sin desmontar/remountar los polígonos al elegir un lote
  useEffect(() => {
    const layerGroup = geoJsonRef.current;
    if (!layerGroup) return;
    layerGroup.eachLayer((subLayer) => {
      const featureLayer = subLayer as L.Path & { feature?: Feature };
      const id = featureLayer.feature?.properties?.id;
      if (id !== undefined && featureLayer.setStyle) {
        const isSelected = Number(id) === loteSeleccionadoId;
        featureLayer.setStyle(getLoteStyle(Number(id), alertas, isSelected));
        if (isSelected && featureLayer.bringToFront) {
          featureLayer.bringToFront();
        }
      }
    });
  }, [loteSeleccionadoId, alertas, geojson]);

  // Solo reconstruye la capa GeoJSON si cambian los lotes o el estado de las alertas
  const alertasKey = alertas.map((a) => `${a.id}:${a.estado}`).join(",");
  const geojsonIdsKey = (geojson?.features || [])
    .map((f) => `${f.properties?.id}:${f.properties?.ultimo_ndvi ?? ""}`)
    .join(",");
  const mapKey = `${geojsonIdsKey}-${alertasKey}`;

  return (
    <div className="relative h-full w-full">
      {/* Controles superiores derechos: Zoom rápido + Selector de capa */}
      <div className="absolute top-2 right-2 z-[400] flex flex-wrap items-center justify-end gap-1.5">
        {geojson && geojson.features.length > 0 && (
          <div className="flex items-center rounded-lg border border-slate-700 bg-slate-900/90 p-0.5 text-[11px] backdrop-blur shadow-md">
            {loteSeleccionadoId && (
              <button
                type="button"
                onClick={() => setCentrarLoteTrigger((n) => n + 1)}
                className="px-2 py-1 rounded-md text-slate-300 hover:text-emerald-300 transition"
                title="Acercar al lote seleccionado"
              >
                Acercar lote
              </button>
            )}
            <button
              type="button"
              onClick={() => setVistaGeneralTrigger((n) => n + 1)}
              className="px-2 py-1 rounded-md text-slate-300 hover:text-sky-300 transition"
              title="Ver todos los lotes en el mapa"
            >
              Ver todos
            </button>
          </div>
        )}

        <div className="flex items-center rounded-lg border border-slate-700 bg-slate-900/90 p-0.5 text-[11px] backdrop-blur shadow-md">
          <button
            type="button"
            onClick={() => setTipoCapa("satelital")}
            title="Vista fotográfica satelital"
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
            title="Vista de caminos, rutas y localidades"
            className={`px-2.5 py-1 rounded-md font-medium transition ${
              tipoCapa === "oscuro"
                ? "bg-emerald-500 text-slate-950 font-semibold shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Mapa y Rutas
          </button>
        </div>
      </div>

      <MapContainer
        center={[-32.2, -63.6]} // Centro de la provincia de Córdoba
        zoom={7}
        scrollWheelZoom={true}
        touchZoom={true}
        wheelPxPerZoomLevel={120}
        zoomSnap={0.25}
        zoomDelta={0.5}
        className="h-full w-full rounded-xl z-0"
      >
        <ControladorVistaMapa
          geojson={geojson}
          loteSeleccionadoId={loteSeleccionadoId}
          zoomLoteNonce={zoomLoteNonce}
          vistaGeneralTrigger={vistaGeneralTrigger}
          centrarLoteTrigger={centrarLoteTrigger}
        />
        {/* Capa de mapa: Satelital (Esri) o Modo Oscuro (OpenStreetMap con filtro CSS) */}
        {tipoCapa === "satelital" ? (
          <TileLayer
            key="satelital"
            attribution="Tiles &copy; Esri"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        ) : (
          <TileLayer
            key="oscuro"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
            className="map-tiles-dark"
          />
        )}

        {geojson && (
          <GeoJSON
            ref={geoJsonRef}
            key={mapKey}
            data={geojson}
            style={(feature?: Feature) => {
              const props = feature?.properties || {};
              const isSelected = Number(props.id) === loteSeleccionadoId;
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
                ? "🔴 Requiere revisión"
                : tieneEnRevision
                ? "🟡 En seguimiento"
                : "🟢 Saludable";

              const fechaFormateada = formatearFechaTooltip(p.ultima_fecha_satelital);
              const fechaFoto = fechaFormateada
                ? `<br/>📅 Imagen: ${fechaFormateada}`
                : "";

              layer.bindTooltip(
                `<strong>${p.nombre_lote}</strong><br/>
                 ${p.cliente ? `Establecimiento: ${p.cliente}<br/>` : ""}
                 Cultivo: ${p.cultivo_actual}${p.hectareas != null ? ` (${p.hectareas} ha)` : ""}<br/>
                 Vigor (NDVI): ${p.ultimo_ndvi ?? "Sin datos"}${fechaFoto}<br/>
                 Estado: ${estadoSemaforo}`,
                { sticky: true }
              );
              layer.on("click", () => {
                onSelectLote(p.id);
              });
            }}
          />
        )}
      </MapContainer>

      {/* Leyenda compacta que no tapa el mapa en mobile */}
      <div className="pointer-events-none absolute bottom-2 left-2 z-[400] flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/90 px-2.5 py-1 text-[10px] text-slate-200 backdrop-blur sm:bottom-3 sm:left-3 sm:gap-4 sm:px-3 sm:py-1.5 sm:text-xs">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-red-500" /> Con alerta
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-amber-400" /> En revisión
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> Saludable
        </span>
      </div>
    </div>
  );
}
