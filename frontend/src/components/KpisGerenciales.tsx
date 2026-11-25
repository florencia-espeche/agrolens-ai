"use client";

import type { Feature, FeatureCollection } from "geojson";
import {
  Building2,
  Layers,
  ShieldCheck,
  AlertTriangle,
  DollarSign,
  CloudRain,
  FileText,
  ArrowUpRight,
} from "lucide-react";
import type { PronosticoLoteData } from "@/components/PronosticoLote";
import {
  ESCENARIOS,
  esAlertaActiva,
  formatUsd,
  type CarteraEconomica,
  type EscenarioId,
} from "@/lib/economia";

export interface AlertaKpi {
  id: number;
  lote_id: number;
  estado: string;
  nivel_severidad: string;
}

interface KpisGerencialesProps {
  geojsonFiltrado: FeatureCollection | null;
  alertasVisibles: AlertaKpi[];
  clientes: string[];
  campanas: string[];
  filtroCliente: string;
  filtroCampana: string;
  onChangeCliente: (cliente: string) => void;
  onChangeCampana: (campana: string) => void;
  loteSeleccionadoId: number | null;
  pronosticoLote: PronosticoLoteData | null;
  cargandoPronostico: boolean;
  cartera: CarteraEconomica;
  escenario: EscenarioId;
  esCampoAlquilado: boolean;
  onAbrirEconomia: () => void;
  onSelectLoteConZoom: (loteId: number) => void;
  onAbrirMinuta: () => void;
}

export default function KpisGerenciales({
  geojsonFiltrado,
  alertasVisibles,
  clientes,
  campanas,
  filtroCliente,
  filtroCampana,
  onChangeCliente,
  onChangeCampana,
  loteSeleccionadoId,
  pronosticoLote,
  cargandoPronostico,
  cartera,
  escenario,
  esCampoAlquilado,
  onAbrirEconomia,
  onSelectLoteConZoom,
  onAbrirMinuta,
}: KpisGerencialesProps) {
  const features: Feature[] = geojsonFiltrado?.features || [];
  const { totales, prioridadUno } = cartera;

  const lotesConAlertaSet = new Set(
    alertasVisibles
      .filter((a) => esAlertaActiva(a.estado))
      .map((a) => a.lote_id)
  );

  const featuresEnAlerta = features.filter((f) =>
    lotesConAlertaSet.has(Number(f.properties?.id))
  );
  const haEnAlerta = totales.hectareasEnAlerta;
  const haEstables = Math.max(0, totales.hectareas - haEnAlerta);
  const pctEstable =
    totales.hectareas > 0 ? Math.round((haEstables / totales.hectareas) * 100) : 100;

  // Agrupación por unidad de negocio (cultivo)
  const mapaCultivos: Record<string, number> = {};
  features.forEach((f) => {
    const cultivo = f.properties?.cultivo_actual || "Sin especificar";
    mapaCultivos[cultivo] =
      (mapaCultivos[cultivo] || 0) + (Number(f.properties?.hectareas) || 0);
  });
  const cultivosOrdenados = Object.entries(mapaCultivos).sort(
    (a, b) => b[1] - a[1]
  );

  const establecimientosVisibles = new Set(
    features.map((f) => f.properties?.cliente).filter(Boolean)
  ).size;

  // Vigor promedio (NDVI) y lote activo
  const ndvis = features
    .map((f) => f.properties?.ultimo_ndvi)
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  const ndviPromedio =
    ndvis.length > 0
      ? (ndvis.reduce((acc, v) => acc + v, 0) / ndvis.length).toFixed(2)
      : null;

  const featureSeleccionado = features.find(
    (f) => Number(f.properties?.id) === loteSeleccionadoId
  );
  const nombreLoteActivo = featureSeleccionado?.properties?.nombre_lote;

  const hayFiltroActivo =
    filtroCliente !== "todos" || filtroCampana !== "todas";

  return (
    <section className="space-y-3 min-w-0">
      {/* Barra de filtros gerenciales por Establecimiento y Campaña + Minuta */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-2 text-xs sm:text-sm font-medium text-slate-200">
          <Building2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>Tablero Gerencial por Establecimiento</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filtrar por establecimiento"
            value={filtroCliente}
            onChange={(e) => onChangeCliente(e.target.value)}
            className="min-w-0 max-w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
          >
            <option value="todos">Todos los establecimientos ({clientes.length})</option>
            {clientes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            aria-label="Filtrar por campaña"
            value={filtroCampana}
            onChange={(e) => onChangeCampana(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
          >
            <option value="todas">Todas las campañas</option>
            {campanas.map((camp) => (
              <option key={camp} value={camp}>
                Campaña {camp}
              </option>
            ))}
          </select>

          {hayFiltroActivo && (
            <button
              type="button"
              onClick={() => {
                onChangeCliente("todos");
                onChangeCampana("todas");
              }}
              className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:border-slate-600 transition"
            >
              Ver todos
            </button>
          )}

          <button
            type="button"
            onClick={onAbrirMinuta}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 transition"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Minuta de Gestión</span>
          </button>
        </div>
      </div>

      {/* 4 Tarjetas KPI Ejecutivas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {/* KPI 1: Superficie y Unidades de Negocio */}
        <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/70 p-3.5 sm:p-4 flex flex-col justify-between gap-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Superficie y cultivos</span>
            <Layers className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">
              {totales.hectareas > 0
                ? `${totales.hectareas.toLocaleString("es-AR", {
                    maximumFractionDigits: 1,
                  })} ha`
                : "—"}
            </span>
            <span className="text-[11px] text-slate-400 shrink-0">
              {features.length} {features.length === 1 ? "lote" : "lotes"} ·{" "}
              {establecimientosVisibles} est.
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {cultivosOrdenados.slice(0, 3).map(([cultivo, ha]) => (
              <span
                key={cultivo}
                className="inline-flex items-center gap-1 rounded bg-slate-800/90 border border-slate-700/70 px-1.5 py-0.5 text-[10px] text-slate-300 max-w-full truncate"
              >
                <span className="truncate">{cultivo}</span>
                {ha > 0 && (
                  <span className="text-emerald-400 font-mono shrink-0">
                    {Math.round(ha)}ha
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>

        {/* KPI 2: Salud de Superficie + Prioridad #1 de Recorrida */}
        <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/70 p-3.5 sm:p-4 flex flex-col justify-between gap-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Salud y prioridad de recorrida</span>
            {haEnAlerta > 0 ? (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={`text-xl sm:text-2xl font-bold tracking-tight ${
                pctEstable >= 80
                  ? "text-emerald-400"
                  : pctEstable >= 50
                  ? "text-amber-400"
                  : "text-red-400"
              }`}
            >
              {pctEstable}% estable
            </span>
            <span className="text-[11px] text-slate-400">
              {featuresEnAlerta.length} en alerta
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                pctEstable >= 80
                  ? "bg-emerald-500"
                  : pctEstable >= 50
                  ? "bg-amber-400"
                  : "bg-red-500"
              }`}
              style={{ width: `${pctEstable}%` }}
            />
          </div>
          {prioridadUno ? (
            <button
              type="button"
              onClick={() => onSelectLoteConZoom(prioridadUno.id)}
              className="text-left text-[11px] text-amber-300 hover:text-amber-200 underline decoration-amber-500/40 truncate transition"
              title="Clic para enfocar el lote prioritario en el mapa"
            >
              Prioridad #1: {prioridadUno.nombreCorto} (~
              {formatUsd(prioridadUno.ingresoEnRiesgoUsd)})
            </button>
          ) : (
            <p className="text-[11px] text-slate-400 truncate">
              0 ha comprometidas por alertas activas
            </p>
          )}
        </div>

        {/* KPI 3: Margen Bruto Proyectado & Capital en Riesgo (clic lleva a Gestión Económica) */}
        <button
          type="button"
          onClick={onAbrirEconomia}
          className="min-w-0 text-left rounded-xl border border-slate-800 bg-slate-900/70 hover:border-emerald-500/50 p-3.5 sm:p-4 flex flex-col justify-between gap-1.5 transition group"
        >
          <div className="flex items-center justify-between text-xs text-slate-400 w-full gap-1.5">
            <span className="inline-flex items-center gap-1 truncate">
              <DollarSign className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="truncate">Margen bruto proyectado</span>
            </span>
            <span className="rounded bg-slate-800/90 border border-slate-700/80 px-1.5 py-0.5 text-[10px] text-slate-300 shrink-0 whitespace-nowrap">
              {(ESCENARIOS[escenario] ?? ESCENARIOS.base).label} · {esCampoAlquilado ? "Alq." : "Propio"}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 w-full">
            <span
              className={`text-xl sm:text-2xl font-bold tracking-tight ${
                totales.margenUsd >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {formatUsd(totales.margenUsd)}
            </span>
            <span className="text-[11px] font-mono text-slate-300 shrink-0">
              USD {Math.round(totales.margenPromedioHa).toLocaleString("es-AR")}/ha
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 w-full text-[11px]">
            <span
              className={
                totales.ingresoEnRiesgoUsd > 0 ? "text-amber-300" : "text-slate-400"
              }
            >
              {totales.ingresoEnRiesgoUsd > 0
                ? `En riesgo: ${formatUsd(totales.ingresoEnRiesgoUsd)}`
                : "Sin capital en riesgo"}
            </span>
            <span className="inline-flex items-center gap-0.5 text-emerald-400 group-hover:underline shrink-0">
              Detalle
              <ArrowUpRight className="w-3 h-3" />
            </span>
          </div>
        </button>

        {/* KPI 4: Lluvia Prevista 7d (Lote activo) & Vigor Promedio de Cartera */}
        <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/70 p-3.5 sm:p-4 flex flex-col justify-between gap-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Clima 7d (lote) · Vigor cartera</span>
            <CloudRain className="w-4 h-4 text-sky-400 shrink-0" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xl sm:text-2xl font-bold text-sky-300 tracking-tight">
              {cargandoPronostico
                ? "..."
                : pronosticoLote
                ? `${pronosticoLote.lluvia_acumulada_mm} mm`
                : "—"}
            </span>
            {ndviPromedio && (
              <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-mono text-emerald-300">
                NDVI cartera: {ndviPromedio}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 truncate">
            {nombreLoteActivo
              ? `Lluvia 7d en ${nombreLoteActivo}`
              : "Selecciona un lote para ver pronóstico"}
          </p>
        </div>
      </div>
    </section>
  );
}
