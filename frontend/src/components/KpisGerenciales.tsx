"use client";

import type { Feature, FeatureCollection } from "geojson";
import {
  Building2,
  Layers,
  ShieldCheck,
  AlertTriangle,
  Sprout,
  CloudRain,
} from "lucide-react";
import type { PronosticoLoteData } from "@/components/PronosticoLote";

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
}

function esAlertaActiva(estado?: string): boolean {
  const norm = (estado || "").toLowerCase().trim();
  return (
    norm === "pendiente" ||
    norm === "activa" ||
    norm === "en_revision" ||
    norm === "en revisión"
  );
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
}: KpisGerencialesProps) {
  const features: Feature[] = geojsonFiltrado?.features || [];

  const totalHectareas = features.reduce(
    (acc, f) => acc + (Number(f.properties?.hectareas) || 0),
    0
  );

  const lotesConAlertaSet = new Set(
    alertasVisibles
      .filter((a) => esAlertaActiva(a.estado))
      .map((a) => a.lote_id)
  );

  const featuresEnAlerta = features.filter((f) =>
    lotesConAlertaSet.has(Number(f.properties?.id))
  );
  const haEnAlerta = featuresEnAlerta.reduce(
    (acc, f) => acc + (Number(f.properties?.hectareas) || 0),
    0
  );
  const haEstables = Math.max(0, totalHectareas - haEnAlerta);
  const pctEstable =
    totalHectareas > 0 ? Math.round((haEstables / totalHectareas) * 100) : 100;

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
      {/* Barra de filtros gerenciales por Establecimiento y Campaña */}
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
        </div>
      </div>

      {/* 4 Tarjetas KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {/* KPI 1: Superficie Monitoreada */}
        <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/70 p-3.5 sm:p-4 flex flex-col justify-between gap-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Superficie monitoreada</span>
            <Layers className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">
            {totalHectareas > 0
              ? `${totalHectareas.toLocaleString("es-AR", {
                  maximumFractionDigits: 1,
                })} ha`
              : "—"}
          </div>
          <p className="text-[11px] text-slate-400 truncate">
            {features.length} {features.length === 1 ? "parcela" : "parcelas"} ·{" "}
            {establecimientosVisibles}{" "}
            {establecimientosVisibles === 1 ? "establecimiento" : "establecimientos"}
          </p>
        </div>

        {/* KPI 2: Superficie Estable vs En Alerta */}
        <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/70 p-3.5 sm:p-4 flex flex-col justify-between gap-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Salud de superficie</span>
            {haEnAlerta > 0 ? (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
          </div>
          <div className="flex items-baseline gap-2">
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
          <p className="text-[11px] text-slate-400 truncate">
            {haEnAlerta > 0
              ? `${haEnAlerta.toLocaleString("es-AR", {
                  maximumFractionDigits: 1,
                })} ha en alerta (${featuresEnAlerta.length} ${
                  featuresEnAlerta.length === 1 ? "lote" : "lotes"
                })`
              : "0 ha comprometidas por alertas activas"}
          </p>
        </div>

        {/* KPI 3: Unidades de Negocio (Cultivos) */}
        <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/70 p-3.5 sm:p-4 flex flex-col justify-between gap-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Unidades de negocio</span>
            <Sprout className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">
            {cultivosOrdenados.length}{" "}
            <span className="text-sm font-medium text-slate-400">
              {cultivosOrdenados.length === 1 ? "cultivo" : "cultivos"}
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

        {/* KPI 4: Lluvia Prevista 7d & Vigor Promedio */}
        <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/70 p-3.5 sm:p-4 flex flex-col justify-between gap-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Lluvia 7d · Vigor</span>
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
                NDVI prom: {ndviPromedio}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 truncate">
            {nombreLoteActivo
              ? `Pronóstico en ${nombreLoteActivo}`
              : "Selecciona un lote para ver pronóstico"}
          </p>
        </div>
      </div>
    </section>
  );
}
