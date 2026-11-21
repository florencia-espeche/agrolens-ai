"use client";

import { useState, useMemo } from "react";
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
  ReferenceLine,
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
  const partes = fechaIso.split("-");
  if (partes.length >= 3) {
    return `${partes[2].slice(0, 2)}/${partes[1]}`;
  }
  return fechaIso;
}

export default function GraficosLote({ series, cargando }: GraficosLoteProps) {
  const [diasVentana, setDiasVentana] = useState<30 | 60 | 90>(60);

  // Filtrado temporal en memoria para la serie satelital
  const sateliteFiltrado = useMemo(() => {
    if (!series?.satelite || series.satelite.length === 0) return [];
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() - diasVentana);
    return series.satelite.filter((d) => new Date(d.fecha_imagen) >= fechaLimite);
  }, [series?.satelite, diasVentana]);

  // Filtrado temporal en memoria para la serie climática
  const climaFiltrado = useMemo(() => {
    if (!series?.clima || series.clima.length === 0) return [];
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() - diasVentana);
    return series.clima.filter((d) => new Date(d.fecha) >= fechaLimite);
  }, [series?.clima, diasVentana]);

  // Cálculo del promedio histórico de NDVI para la línea de referencia
  const promedioNdvi = useMemo(() => {
    const valores = sateliteFiltrado
      .map((d) => Number(d.ndvi_mediana))
      .filter((v) => !isNaN(v) && v > 0);

    if (valores.length === 0) return null;

    const suma = valores.reduce((acc, val) => acc + val, 0);
    return Number((suma / valores.length).toFixed(2));
  }, [sateliteFiltrado]);

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
      {/* Encabezado con selector de 30 / 60 / 90 días */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <span>Series Temporales — {series.lote.nombre_lote}</span>
          </h2>
          <p className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
            <span>Cultivo: {series.lote.cultivo_actual}</span>
            <span>·</span>
            <span>Ventana de {diasVentana} días</span>
            {promedioNdvi !== null && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 border border-amber-500/20">
                Promedio NDVI: {promedioNdvi}
              </span>
            )}
          </p>
        </div>

        {/* Botones del selector (30 / 60 / 90 días) */}
        <div className="inline-flex self-start sm:self-auto rounded-lg border border-slate-700 bg-slate-900 p-0.5 text-xs">
          {([30, 60, 90] as const).map((dias) => (
            <button
              key={dias}
              onClick={() => setDiasVentana(dias)}
              className={`rounded-md px-3 py-1 font-medium transition ${
                diasVentana === dias
                  ? "bg-emerald-500 text-slate-950 font-semibold shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {dias}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gráfico 1: Índices Satelitales (Sentinel-2) */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              Vigor Vegetativo (NDVI) y Humedad (NDWI)
            </h3>
            {promedioNdvi !== null && (
              <span className="text-[11px] text-amber-400 font-mono">
                Ref. Promedio: {promedioNdvi}
              </span>
            )}
          </div>

          {sateliteFiltrado.length === 0 ? (
            <p className="text-xs text-slate-400 py-16 text-center">
              Sin pasadas despejadas de Sentinel-2 en la ventana de {diasVentana} días.
            </p>
          ) : (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sateliteFiltrado} syncId="agroCharts">
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

                  {/* Línea de referencia histórica de NDVI */}
                  {promedioNdvi !== null && (
                    <ReferenceLine
                      y={promedioNdvi}
                      stroke="#f59e0b"
                      strokeDasharray="5 5"
                      strokeWidth={1.5}
                      label={{
                        value: `Prom: ${promedioNdvi}`,
                        position: "insideTopRight",
                        fill: "#f59e0b",
                        fontSize: 11,
                      }}
                    />
                  )}

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

          {climaFiltrado.length === 0 ? (
            <p className="text-xs text-slate-400 py-16 text-center">
              Sin registros climáticos en la ventana de {diasVentana} días.
            </p>
          ) : (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={climaFiltrado} syncId="agroCharts">
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
