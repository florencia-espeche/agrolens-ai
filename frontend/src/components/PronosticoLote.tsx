"use client";

import {
  Sun,
  Cloud,
  CloudSun,
  CloudRain,
  CloudLightning,
  Droplets,
  Calendar,
} from "lucide-react";

export interface DiaPronostico {
  fecha: string;
  weather_code: number | null;
  temp_max_c: number | null;
  temp_min_c: number | null;
  precipitacion_mm: number;
  probabilidad_lluvia_pct: number | null;
  evapotranspiracion_mm: number | null;
}

export interface PronosticoLoteData {
  lote_id: number;
  nombre_lote: string;
  lat: number;
  lon: number;
  lluvia_acumulada_mm: number;
  dias: DiaPronostico[];
}

interface PronosticoLoteProps {
  pronostico: PronosticoLoteData | null;
  cargando: boolean;
}

/** Mapea códigos WMO de Open-Meteo a icono y descripción breve en español. */
function describirClima(code: number | null) {
  if (code === null || code === undefined) {
    return { label: "Sin dato", Icon: Cloud, color: "text-slate-400" };
  }
  if (code === 0) {
    return { label: "Despejado", Icon: Sun, color: "text-amber-400" };
  }
  if (code <= 2) {
    return { label: "Algo nublado", Icon: CloudSun, color: "text-amber-300" };
  }
  if (code === 3 || code === 45 || code === 48) {
    return { label: "Nublado", Icon: Cloud, color: "text-slate-300" };
  }
  if (code >= 95) {
    return { label: "Tormenta", Icon: CloudLightning, color: "text-yellow-400" };
  }
  return { label: "Lluvias", Icon: CloudRain, color: "text-sky-400" };
}

function formatearDiaSemana(fechaIso: string, idx: number) {
  if (idx === 0) return "Hoy";
  const d = new Date(`${fechaIso}T12:00:00`);
  return d.toLocaleDateString("es-AR", { weekday: "short", day: "numeric" });
}

export default function PronosticoLote({ pronostico, cargando }: PronosticoLoteProps) {
  if (cargando) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 animate-pulse">
        <div className="h-5 w-64 rounded bg-slate-800 mb-3" />
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="h-28 rounded-lg bg-slate-800/50 border border-slate-800" />
          ))}
        </div>
      </section>
    );
  }

  if (!pronostico || pronostico.dias.length === 0) {
    return null;
  }

  const lluvia7d = pronostico.lluvia_acumulada_mm;
  const et0Total = pronostico.dias.reduce(
    (acc, d) => acc + (Number(d.evapotranspiracion_mm) || 0),
    0
  );
  const recomendacion =
    lluvia7d >= 15
      ? {
          texto: "Lluvias relevantes en camino — evaluar postergar riego o pulverización",
          clase: "border-sky-500/30 bg-sky-500/10 text-sky-300",
        }
      : lluvia7d >= 4
      ? {
          texto: "Precipitaciones moderadas previstas en los próximos 7 días",
          clase: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
        }
      : {
          texto: "Semana mayormente seca — vigilar balance hídrico y reserva de suelo",
          clase: "border-amber-500/30 bg-amber-500/10 text-amber-300",
        };

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:p-4 space-y-3 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-sky-400 shrink-0" />
            <span>
              Pronóstico para el Lote (Próximos 7 días) —{" "}
              <span className="text-sky-400">{pronostico.nombre_lote}</span>
            </span>
          </h3>
          <p
            className="text-[11px] text-slate-400"
            title={`Coordenadas del lote: ${pronostico.lat}, ${pronostico.lon}`}
          >
            Lluvias esperadas y consumo hídrico estimado (ET₀) · Datos Open-Meteo
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-300">
            <Droplets className="w-3.5 h-3.5" />
            Lluvia 7d: <strong>{lluvia7d} mm</strong>
          </span>
          {et0Total > 0 && (
            <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs text-slate-300">
              Demanda ET₀: <strong className="ml-1 text-slate-100">{et0Total.toFixed(0)} mm</strong>
            </span>
          )}
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${recomendacion.clase}`}>
            {recomendacion.texto}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
        {pronostico.dias.map((dia, idx) => {
          const { label, Icon, color } = describirClima(dia.weather_code);
          const tieneLluvia = dia.precipitacion_mm >= 1;

          return (
            <div
              key={dia.fecha}
              className={`min-w-0 rounded-lg border p-2.5 flex flex-col justify-between gap-2 transition ${
                tieneLluvia
                  ? "border-sky-500/30 bg-sky-950/20"
                  : "border-slate-800 bg-slate-950/60"
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-semibold text-slate-200 capitalize">
                  {formatearDiaSemana(dia.fecha, idx)}
                </span>
                <Icon className={`w-4 h-4 shrink-0 ${color}`} />
              </div>

              <div className="text-[11px] text-slate-400 truncate" title={label}>
                {label}
              </div>

              <div className="flex items-baseline justify-between text-xs font-mono">
                <span className="text-orange-300 font-semibold">
                  {dia.temp_max_c !== null ? `${Math.round(dia.temp_max_c)}°` : "--"}
                </span>
                <span className="text-slate-400">
                  {dia.temp_min_c !== null ? `${Math.round(dia.temp_min_c)}°` : "--"}
                </span>
              </div>

              <div className="border-t border-slate-800/80 pt-1.5 flex items-center justify-between text-[11px]">
                <span className={tieneLluvia ? "text-sky-300 font-semibold" : "text-slate-400"}>
                  {dia.precipitacion_mm} mm
                </span>
                {dia.probabilidad_lluvia_pct !== null && (
                  <span className="text-slate-500">{dia.probabilidad_lluvia_pct}%</span>
                )}
              </div>

              {dia.evapotranspiracion_mm !== null && (
                <div
                  className="text-[10px] text-slate-500 flex justify-between"
                  title="Evapotranspiración de referencia (consumo de agua estimado del cultivo)"
                >
                  <span>Consumo</span>
                  <span>{dia.evapotranspiracion_mm.toFixed(1)} mm</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
