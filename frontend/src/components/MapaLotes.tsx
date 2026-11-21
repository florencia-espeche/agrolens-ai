"use client";

import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { FeatureCollection, Feature } from "geojson";

interface MapaLotesProps {
  geojson: FeatureCollection | null;
  loteSeleccionadoId: number | null;
  onSelectLote: (loteId: number) => void;
}

function getColorLote(props: Record<string, any>): string {
  if (props.alerta_activa === "CRITICA") return "#ef4444"; // Rojo
  if (props.alerta_activa === "ALTA") return "#f97316";    // Naranja
  if (props.alerta_activa === "MEDIA") return "#eab308";   // Amarillo
  if (props.ultimo_ndvi >= 0.6) return "#22c55e";          // Verde vigoroso
  return "#3b82f6";                                        // Azul neutro
}

export default function MapaLotes({
  geojson,
  loteSeleccionadoId,
  onSelectLote,
}: MapaLotesProps) {
  return (
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
          key={JSON.stringify(geojson) + loteSeleccionadoId}
          data={geojson}
          style={(feature?: Feature) => {
            const props = feature?.properties || {};
            const isSelected = props.id === loteSeleccionadoId;
            const color = getColorLote(props);
            return {
              color: isSelected ? "#ffffff" : color,
              weight: isSelected ? 4 : 2,
              fillColor: color,
              fillOpacity: isSelected ? 0.55 : 0.35,
            };
          }}
          onEachFeature={(feature, layer) => {
            const p = feature.properties;
            layer.bindTooltip(
              `<strong>${p.nombre_lote}</strong><br/>
               Cultivo: ${p.cultivo_actual}<br/>
               NDVI: ${p.ultimo_ndvi ?? "N/A"}<br/>
               Alerta: ${p.alerta_activa ?? "Normal"}`,
              { sticky: true }
            );
            layer.on("click", () => onSelectLote(p.id));
          }}
        />
      )}
    </MapContainer>
  );
}