"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { Activity, CloudRain } from "lucide-react";

export interface DatoClima {
  fecha: string;
  temp_max_c: number;
  temp_min_c: number;
  precipitacion_mm: number;
  radiacion_solar_mj: number;
}

export interface DatoSatelite {
  fecha_imagen: string;
  ndvi_mediana: number;
  ndvi_p10: number;
  ndvi_p90: number;
  ndwi_mediana: number;
  nubosidad_pct: number;
}

export interface SeriesLote {
  lote: {
    id: number;
    nombre_lote: string;
    cultivo_actual: string;
  };
  clima: DatoClima[];
  satelite: DatoSatelite[];
}

interface GraficosLoteProps {
  series: SeriesLote | null;
  cargando: boolean;
}

function formatearFechaCorta(fechaIso: string) {
  if (!fechaIso) return "";
  const [, mes, dia] = fechaIso.split("-");
  return `${dia}/${mes}`;
}

export default function GraficosLote({ series, cargando }: GraficosLoteProps) {
  if (cargando) {
    return (
      <section className="mt-6 bg-slate-900 border border-slate-800 rounded-xl p-6 text-sm text-slate-400">
        Cargando series temporales de Sentinel-2 y NASA POWER...
      </section>
    );
  }

  if (!series) {
    return (
      <section className="mt-6 bg-slate-900 border border-slate-800 rounded-xl p-6 text-sm text-slate-400">
        Haz clic en un lote del mapa o en una alerta para ver su evolución de NDVI y clima.
      </section>
    );
  }

  return (
    <section className="mt-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">
            Series Temporales — {series.lote.nombre_lote}
          </h2>
          <p className="text-xs text-slate-400">
            Cultivo: {series.lote.cultivo_actual} · Últimos 60 días
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gráfico 1: Índices Satelitales (Sentinel-2) */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h3 className="font-semibold text-sm flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-emerald-400" />
            Vigor Vegetativo (NDVI) y Humedad (NDWI)
          </h3>

          {series.satelite.length === 0 ? (
            <p className="text-xs text-slate-400 py-16 text-center">
              Sin pasadas despejadas de Sentinel-2 en este período.
            </p>
          ) : (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series.satelite}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="fecha_imagen"
                    tickFormatter={formatearFechaCorta}
                    stroke="#94a3b8"
                    fontSize={11}
                  />
                  <YAxis domain={[-0.2, 1]} stroke="#94a3b8" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                      fontSize: "12px",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  <Line
                    type="monotone"
                    dataKey="ndvi_mediana"
                    name="NDVI Mediana"
                    stroke="#22c55e"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="ndvi_p90"
                    name="NDVI P90"
                    stroke="#86efac"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="ndvi_p10"
                    name="NDVI P10"
                    stroke="#eab308"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="ndwi_mediana"
                    name="NDWI (Agua)"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Gráfico 2: Clima Diario (NASA POWER) */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h3 className="font-semibold text-sm flex items-center gap-2 mb-4">
            <CloudRain className="w-4 h-4 text-sky-400" />
            Precipitaciones (mm) y Temperaturas (°C)
          </h3>

          {series.clima.length === 0 ? (
            <p className="text-xs text-slate-400 py-16 text-center">
              Sin registros climáticos en este período.
            </p>
          ) : (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series.clima}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="fecha"
                    tickFormatter={formatearFechaCorta}
                    stroke="#94a3b8"
                    fontSize={11}
                  />
                  {/* Eje Y izquierdo: Temperaturas */}
                  <YAxis
                    yAxisId="temp"
                    stroke="#94a3b8"
                    fontSize={11}
                    unit="°C"
                  />
                  {/* Eje Y derecho: Precipitación */}
                  <YAxis
                    yAxisId="lluvia"
                    orientation="right"
                    stroke="#38bdf8"
                    fontSize={11}
                    unit="mm"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                      fontSize: "12px",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  <Bar
                    yAxisId="lluvia"
                    dataKey="precipitacion_mm"
                    name="Lluvia (mm)"
                    fill="#0ea5e9"
                    opacity={0.55}
                    radius={[3, 3, 0, 0]}
                  />
                  <Line
                    yAxisId="temp"
                    type="monotone"
                    dataKey="temp_max_c"
                    name="Temp. Máx (°C)"
                    stroke="#f97316"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="temp"
                    type="monotone"
                    dataKey="temp_min_c"
                    name="Temp. Mín (°C)"
                    stroke="#a855f7"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}