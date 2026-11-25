"use client";

import type { Feature, FeatureCollection } from "geojson";
import {
  Leaf,
  Droplets,
  CloudRain,
  MapPin,
  TrendingUp,
  TrendingDown,
  ClipboardCheck,
  Pencil,
} from "lucide-react";
import type { SeriesLote } from "@/components/GraficosLote";
import type { PronosticoLoteData } from "@/components/PronosticoLote";
import type { RecorridaCampo } from "@/components/RecorridaModal";
import type { LoteEditable } from "@/components/GestionLotesModal";

export interface AlertaResumen {
  id: number;
  lote_id: number;
  estado: string;
}

interface ResumenLoteActivoProps {
  geojsonFiltrado: FeatureCollection | null;
  loteActivoId: number | null;
  onSelectLote: (loteId: number) => void;
  seriesLote: SeriesLote | null;
  pronosticoLote: PronosticoLoteData | null;
  cargandoSeries?: boolean;
  cargandoPronostico?: boolean;
  alertasVisibles: AlertaResumen[];
  recorridasDelLote?: RecorridaCampo[];
  ahoraMs?: number | null;
  onAbrirRecorrida?: (loteId: number, nombreLote: string) => void;
  onEditarLote?: (lote: LoteEditable) => void;
}

function obtenerEstadoGeneral(loteId: number, alertas: AlertaResumen[]) {
  const delLote = alertas.filter((a) => a.lote_id === loteId);
  const tienePendiente = delLote.some((a) => {
    const e = a.estado?.toLowerCase();
    return e === "pendiente" || e === "activa";
  });
  if (tienePendiente) {
    return {
      dot: "bg-red-500",
      label: "Con alerta activa",
      badge: "border-red-500/30 bg-red-500/10 text-red-300",
    };
  }
  const tieneRevision = delLote.some((a) => {
    const e = a.estado?.toLowerCase();
    return e === "en_revision" || e === "en revisión";
  });
  if (tieneRevision) {
    return {
      dot: "bg-amber-400",
      label: "En revisión",
      badge: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    };
  }
  return {
    dot: "bg-emerald-500",
    label: "Saludable",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  };
}

function interpretarNdvi(ndvi: number | null) {
  if (ndvi === null || Number.isNaN(ndvi)) {
    return { texto: "Sin imagen reciente", color: "text-slate-400" };
  }
  if (ndvi >= 0.65) {
    return { texto: "Vigor alto (óptimo)", color: "text-emerald-400" };
  }
  if (ndvi >= 0.4) {
    return { texto: "Vigor moderado (en desarrollo)", color: "text-amber-300" };
  }
  return { texto: "Vigor bajo (emergencia, rastrojo o estrés)", color: "text-red-400" };
}

function interpretarNdwi(ndwi: number | null) {
  if (ndwi === null || Number.isNaN(ndwi)) {
    return { texto: "Sin dato hídrico", color: "text-slate-400" };
  }
  if (ndwi >= 0.1) {
    return { texto: "Buen contenido hídrico", color: "text-sky-300" };
  }
  if (ndwi >= -0.1) {
    return { texto: "Humedad ajustada", color: "text-amber-300" };
  }
  return { texto: "Posible estrés hídrico", color: "text-red-400" };
}

export default function ResumenLoteActivo({
  geojsonFiltrado,
  loteActivoId,
  onSelectLote,
  seriesLote,
  pronosticoLote,
  cargandoSeries = false,
  cargandoPronostico = false,
  alertasVisibles,
  recorridasDelLote = [],
  ahoraMs = null,
  onAbrirRecorrida,
  onEditarLote,
}: ResumenLoteActivoProps) {
  const features: Feature[] = geojsonFiltrado?.features || [];
  if (features.length === 0) return null;

  const featureActivo =
    features.find((f) => Number(f.properties?.id) === loteActivoId) || features[0];
  const props = featureActivo.properties || {};
  const idActivo = Number(props.id);
  const estadoGeneral = obtenerEstadoGeneral(idActivo, alertasVisibles);

  // Garantiza que no se muestren datos residuales del lote anterior mientras carga el nuevo
  const seriesActual =
    !cargandoSeries && seriesLote?.lote?.id === idActivo ? seriesLote : null;
  const pronosticoActual =
    !cargandoPronostico && pronosticoLote?.lote_id === idActivo ? pronosticoLote : null;

  // Datos de las últimas dos pasadas satelitales para mostrar variación y nubosidad real
  const satelite = seriesActual?.satelite || [];
  const ultimaPasada = satelite.length > 0 ? satelite[satelite.length - 1] : null;
  const pasadaAnterior = satelite.length > 1 ? satelite[satelite.length - 2] : null;

  const ndviActual =
    ultimaPasada?.ndvi_mediana ??
    (typeof props.ultimo_ndvi === "number" ? props.ultimo_ndvi : null);
  const ndwiActual =
    ultimaPasada?.ndwi_mediana ??
    (typeof props.ultimo_ndwi === "number" ? props.ultimo_ndwi : null);

  let variacionNdviPct: number | null = null;
  if (
    ultimaPasada &&
    pasadaAnterior &&
    pasadaAnterior.ndvi_mediana &&
    pasadaAnterior.ndvi_mediana !== 0
  ) {
    variacionNdviPct =
      ((ultimaPasada.ndvi_mediana - pasadaAnterior.ndvi_mediana) /
        Math.abs(pasadaAnterior.ndvi_mediana)) *
      100;
  }

  const lecturaVigor = interpretarNdvi(ndviActual);
  const lecturaAgua = interpretarNdwi(ndwiActual);

  const fechaCruda =
    ultimaPasada?.fecha_imagen ||
    (typeof props.ultima_fecha_satelital === "string"
      ? props.ultima_fecha_satelital
      : null);

  const nubosidadActual =
    ultimaPasada?.nubosidad_pct ??
    (typeof props.ultima_nubosidad_pct === "number"
      ? props.ultima_nubosidad_pct
      : null);

  const fechaImagenTexto = fechaCruda
    ? new Date(`${fechaCruda.split("T")[0]}T12:00:00`).toLocaleDateString(
        "es-AR",
        { day: "2-digit", month: "short" }
      )
    : null;

  // Balance hídrico próximos 7 días
  const lluvia7d = pronosticoActual ? pronosticoActual.lluvia_acumulada_mm : null;
  const et0Total7d = pronosticoActual
    ? pronosticoActual.dias.reduce(
        (acc, d) => acc + (Number(d.evapotranspiracion_mm) || 0),
        0
      )
    : null;
  const balanceMm =
    lluvia7d !== null && et0Total7d !== null ? lluvia7d - et0Total7d : null;

  const fechaSiembraTexto =
    typeof props.fecha_siembra === "string" && props.fecha_siembra
      ? new Date(`${props.fecha_siembra.split("T")[0]}T12:00:00`).toLocaleDateString(
          "es-AR",
          { day: "2-digit", month: "short", year: "2-digit" }
        )
      : null;

  const diasDesdeSiembra =
    ahoraMs !== null &&
    typeof props.fecha_siembra === "string" &&
    props.fecha_siembra
      ? Math.max(
          0,
          Math.floor(
            (ahoraMs -
              new Date(`${props.fecha_siembra.split("T")[0]}T12:00:00`).getTime()) /
              86400000
          )
        )
      : null;

  return (
    <section className="space-y-3 min-w-0">
      {/* Selector rápido de lotes en 1 clic */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-2.5 sm:px-4">
        <span className="text-xs font-medium text-slate-400 shrink-0">
          Elegir lote para inspeccionar:
        </span>
        <div className="flex flex-nowrap sm:flex-wrap items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {features.map((f) => {
            const p = f.properties || {};
            const id = Number(p.id);
            const activo = id === idActivo;
            const estadoPill = obtenerEstadoGeneral(id, alertasVisibles);

            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectLote(id)}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition whitespace-nowrap shrink-0 ${
                  activo
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-200 font-semibold shadow-sm"
                    : "border-slate-700/80 bg-slate-950/70 text-slate-300 hover:border-slate-600 hover:text-white"
                }`}
              >
                <span className={`h-2 w-2 rounded-full shrink-0 ${estadoPill.dot}`} />
                <span>{p.nombre_lote}</span>
                {p.hectareas != null && (
                  <span className="text-[10px] text-slate-400 font-normal">
                    ({Math.round(Number(p.hectareas))} ha)
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Ficha rápida: ¿Cómo está este lote hoy? */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap border-b border-slate-800/80 pb-2.5">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${estadoGeneral.dot}`} />
            <h3 className="text-xs sm:text-sm font-semibold text-slate-100">
              ¿Cómo está este lote hoy?
            </h3>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {onAbrirRecorrida && (
              <button
                type="button"
                onClick={() =>
                  onAbrirRecorrida(idActivo, String(props.nombre_lote || `Lote ${idActivo}`))
                }
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-emerald-500/50 hover:text-emerald-300 transition"
              >
                <ClipboardCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Registrar recorrida</span>
              </button>
            )}
            {onEditarLote && (
              <button
                type="button"
                onClick={() =>
                  onEditarLote({
                    id: idActivo,
                    nombre_lote: String(props.nombre_lote || `Lote ${idActivo}`),
                    cultivo_actual: String(props.cultivo_actual || "Soja 1ra"),
                    campana: String(props.campana || "2026/2027"),
                    fecha_siembra:
                      typeof props.fecha_siembra === "string" ? props.fecha_siembra : null,
                    hectareas: props.hectareas != null ? Number(props.hectareas) : null,
                    cliente: typeof props.cliente === "string" ? props.cliente : null,
                  })
                }
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white transition"
              >
                <Pencil className="w-3 h-3" />
                <span>Editar lote</span>
              </button>
            )}
            <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${estadoGeneral.badge}`}>
              {estadoGeneral.label}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {/* Identificación del lote */}
        <div className="min-w-0 flex flex-col justify-between gap-1 sm:border-r sm:border-slate-800/80 sm:pr-3">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Lote seleccionado</span>
          </div>
          <div className="text-sm font-semibold text-slate-100 truncate">
            {props.nombre_lote}
          </div>
          <p className="text-xs text-slate-400 truncate">
            <span className="text-emerald-400 font-medium">{props.cultivo_actual}</span>
            {props.hectareas != null ? ` · ${props.hectareas} ha` : ""}
            {props.campana ? ` · Camp. ${props.campana}` : ""}
          </p>
          {fechaSiembraTexto && (
            <p className="text-[11px] text-slate-400 truncate">
              Siembra: {fechaSiembraTexto}
              {diasDesdeSiembra !== null ? ` (${diasDesdeSiembra} días)` : ""}
            </p>
          )}
        </div>

        {/* Estado de vigor (NDVI traducido) */}
        <div className="min-w-0 flex flex-col justify-between gap-1 xl:border-r xl:border-slate-800/80 xl:pr-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <Leaf className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              Vigor del cultivo
            </span>
            {ndviActual !== null && (
              <span className="font-mono text-slate-300">NDVI {ndviActual.toFixed(2)}</span>
            )}
          </div>
          <div className={`text-sm font-semibold ${lecturaVigor.color}`}>
            {lecturaVigor.texto}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
            {variacionNdviPct !== null && (
              <span
                className={`inline-flex items-center gap-0.5 font-medium ${
                  variacionNdviPct >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {variacionNdviPct >= 0 ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                {variacionNdviPct >= 0 ? "+" : ""}
                {variacionNdviPct.toFixed(1)}% vs. pasada previa
              </span>
            )}
            {fechaImagenTexto && (
              <span>
                · Foto {fechaImagenTexto}
                {nubosidadActual != null
                  ? ` (${Math.round(nubosidadActual)}% nubes)`
                  : ""}
              </span>
            )}
          </div>
        </div>

        {/* Humedad en planta (NDWI traducido) */}
        <div className="min-w-0 flex flex-col justify-between gap-1 sm:border-r sm:border-slate-800/80 sm:pr-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <Droplets className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              Humedad en planta
            </span>
            {ndwiActual !== null && (
              <span className="font-mono text-slate-300">NDWI {ndwiActual.toFixed(2)}</span>
            )}
          </div>
          <div className={`text-sm font-semibold ${lecturaAgua.color}`}>
            {lecturaAgua.texto}
          </div>
          <p className="text-[11px] text-slate-400">
            Ayuda a distinguir si una baja de vigor se debe a falta de agua
          </p>
        </div>

        {/* Balance hídrico próximos 7 días */}
        <div className="min-w-0 flex flex-col justify-between gap-1">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <CloudRain className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              Balance hídrico (7 días)
            </span>
          </div>
          {lluvia7d !== null && et0Total7d !== null && balanceMm !== null ? (
            <>
              <div className="text-sm font-semibold text-slate-100 flex items-baseline gap-2 flex-wrap">
                <span>
                  <span className="text-sky-300">{lluvia7d} mm</span>{" "}
                  <span className="text-xs font-normal text-slate-400">
                    lluvia vs. {et0Total7d.toFixed(0)} mm ET₀
                  </span>
                </span>
                <span
                  className={`text-[11px] font-mono ${
                    balanceMm >= 0 ? "text-emerald-400" : "text-amber-300"
                  }`}
                >
                  ({balanceMm >= 0 ? "+" : ""}
                  {balanceMm.toFixed(0)} mm)
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {balanceMm >= 0
                  ? "Recarga hídrica prevista por encima de la demanda (ET₀)"
                  : lluvia7d >= 10
                  ? "Aporte parcial de lluvia; revisar humedad del perfil"
                  : "Semana seca frente a la demanda hídrica del cultivo"}
              </p>
            </>
          ) : cargandoPronostico ? (
            <div className="text-xs text-slate-400 animate-pulse">
              Consultando pronóstico a 7 días...
            </div>
          ) : (
            <div className="text-xs text-slate-400">Sin datos de pronóstico</div>
          )}
        </div>
        </div>

        {recorridasDelLote.length > 0 && (
          <div className="border-t border-slate-800/80 pt-3 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5 font-medium text-slate-300">
                <ClipboardCheck className="w-3.5 h-3.5 text-emerald-400" />
                Bitácora de recorridas ({recorridasDelLote.length})
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {recorridasDelLote.slice(0, 3).map((rec) => (
                <div
                  key={rec.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-[11px] space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 text-slate-400">
                    <span>
                      {new Date(`${rec.fecha_recorrida.split("T")[0]}T12:00:00`).toLocaleDateString(
                        "es-AR",
                        { day: "2-digit", month: "short" }
                      )}
                      {rec.autor ? ` · ${rec.autor}` : ""}
                    </span>
                    {rec.costo_labor_usd_ha > 0 && (
                      <span className="font-mono text-amber-300">
                        +USD {rec.costo_labor_usd_ha}/ha
                      </span>
                    )}
                  </div>
                  <p className="text-slate-200 line-clamp-2">{rec.hallazgo}</p>
                  {rec.labor_recomendada && (
                    <p className="text-emerald-300/90 truncate">
                      Acción: {rec.labor_recomendada}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
