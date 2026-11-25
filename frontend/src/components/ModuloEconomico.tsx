"use client";

import { useState, useMemo } from "react";
import type { Feature, FeatureCollection } from "geojson";
import {
  DollarSign,
  TrendingUp,
  ShieldAlert,
  Scale,
  SlidersHorizontal,
  RotateCcw,
  Download,
  BarChart3,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  Cell,
} from "recharts";

export interface AlertaEconomica {
  id: number;
  lote_id: number;
  nivel_severidad: string;
  estado: string;
}

export interface SupuestoCultivo {
  costoUsdHa: number;
  precioUsdTn: number;
  rindeObjetivoQqHa: number;
}

interface ModuloEconomicoProps {
  geojsonFiltrado: FeatureCollection | null;
  alertasVisibles: AlertaEconomica[];
  loteSeleccionadoId: number | null;
  onSelectLote: (loteId: number) => void;
}

const SUPUESTOS_DEFAULT: Record<string, SupuestoCultivo> = {
  "Soja 1ra": { costoUsdHa: 620, precioUsdTn: 290, rindeObjetivoQqHa: 36 },
  "Maíz Temprano": { costoUsdHa: 820, precioUsdTn: 185, rindeObjetivoQqHa: 92 },
  "Maíz Tardío": { costoUsdHa: 740, precioUsdTn: 180, rindeObjetivoQqHa: 80 },
  "Trigo / Soja 2da": { costoUsdHa: 790, precioUsdTn: 245, rindeObjetivoQqHa: 56 },
};

const SUPUESTO_FALLBACK: SupuestoCultivo = {
  costoUsdHa: 650,
  precioUsdTn: 240,
  rindeObjetivoQqHa: 40,
};

type EscenarioId =
  | "base"
  | "rinde_menos_10"
  | "rinde_menos_20"
  | "precio_menos_15"
  | "optimista_10";

const ESCENARIOS: Record<
  EscenarioId,
  { label: string; factorRinde: number; factorPrecio: number }
> = {
  base: { label: "Base", factorRinde: 1, factorPrecio: 1 },
  rinde_menos_10: { label: "Rinde -10%", factorRinde: 0.9, factorPrecio: 1 },
  rinde_menos_20: { label: "Sequía (-20% Rinde)", factorRinde: 0.8, factorPrecio: 1 },
  precio_menos_15: { label: "Precio -15%", factorRinde: 1, factorPrecio: 0.85 },
  optimista_10: { label: "Año bueno (+10%)", factorRinde: 1.1, factorPrecio: 1 },
};

function obtenerSupuestoInicial(cultivo: string): SupuestoCultivo {
  if (SUPUESTOS_DEFAULT[cultivo]) return SUPUESTOS_DEFAULT[cultivo];
  const lower = cultivo.toLowerCase();
  if (lower.includes("soja") && lower.includes("trigo")) {
    return SUPUESTOS_DEFAULT["Trigo / Soja 2da"];
  }
  if (lower.includes("maíz") || lower.includes("maiz")) {
    return lower.includes("tard")
      ? SUPUESTOS_DEFAULT["Maíz Tardío"]
      : SUPUESTOS_DEFAULT["Maíz Temprano"];
  }
  if (lower.includes("soja")) return SUPUESTOS_DEFAULT["Soja 1ra"];
  return SUPUESTO_FALLBACK;
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

function factorRiesgoPorSeveridad(severidad?: string): number {
  const sev = (severidad || "").toUpperCase().trim();
  if (sev === "CRITICA") return 0.25;
  if (sev === "ALTA") return 0.15;
  if (sev === "MEDIA") return 0.08;
  return 0.05;
}

function formatUsd(valor: number): string {
  return `USD ${Math.round(valor).toLocaleString("es-AR")}`;
}

export default function ModuloEconomico({
  geojsonFiltrado,
  alertasVisibles,
  loteSeleccionadoId,
  onSelectLote,
}: ModuloEconomicoProps) {
  const [supuestos, setSupuestos] = useState<Record<string, SupuestoCultivo>>(
    () => ({ ...SUPUESTOS_DEFAULT })
  );
  const [mostrarEditor, setMostrarEditor] = useState(false);
  const [esCampoAlquilado, setEsCampoAlquilado] = useState(false);
  const [arriendoQqSoja, setArriendoQqSoja] = useState(12);
  const [escenario, setEscenario] = useState<EscenarioId>("base");

  const features: Feature[] = useMemo(
    () => geojsonFiltrado?.features || [],
    [geojsonFiltrado]
  );

  // Cultivos presentes en los lotes actualmente filtrados
  const cultivosActivos = useMemo(() => {
    const set = new Set<string>();
    features.forEach((f) => {
      const c = String(f.properties?.cultivo_actual || "Sin especificar");
      set.add(c);
    });
    return Array.from(set);
  }, [features]);

  const configEscenario = ESCENARIOS[escenario];

  const precioSojaReferencia =
    (supuestos["Soja 1ra"]?.precioUsdTn ?? SUPUESTOS_DEFAULT["Soja 1ra"].precioUsdTn) *
    configEscenario.factorPrecio;
  const arriendoUsdHa = esCampoAlquilado
    ? (arriendoQqSoja / 10) * precioSojaReferencia
    : 0;

  const filasCalculadas = useMemo(() => {
    return features.map((f) => {
      const p = f.properties || {};
      const id = Number(p.id);
      const nombreLote = String(p.nombre_lote || `Lote ${id}`);
      const nombreCorto = nombreLote.split(" - ")[0] || nombreLote;
      const cliente = String(p.cliente || "Sin establecimiento");
      const cultivo = String(p.cultivo_actual || "Sin especificar");
      const hectareas = Number(p.hectareas) || 0;

      const supuesto = supuestos[cultivo] || obtenerSupuestoInicial(cultivo);
      const costoDirectoHa = supuesto.costoUsdHa;
      const precioUsdTn = Math.round(supuesto.precioUsdTn * configEscenario.factorPrecio);
      const rindeObjetivoQqHa = Number(
        (supuesto.rindeObjetivoQqHa * configEscenario.factorRinde).toFixed(1)
      );
      const costoUsdHa = costoDirectoHa + arriendoUsdHa;

      // 1 tonelada = 10 quintales
      const ingresoBrutoHa = (rindeObjetivoQqHa / 10) * precioUsdTn;
      const margenBrutoHa = ingresoBrutoHa - costoUsdHa;
      const rindeIndiferenciaQqHa =
        precioUsdTn > 0 ? (costoUsdHa / precioUsdTn) * 10 : 0;
      const holguraQqHa = rindeObjetivoQqHa - rindeIndiferenciaQqHa;

      const inversionTotalUsd = hectareas * costoUsdHa;
      const ingresoTotalUsd = hectareas * ingresoBrutoHa;
      const margenBrutoTotalUsd = hectareas * margenBrutoHa;

      // Buscar alerta activa de mayor severidad en el lote
      const alertasLoteActivas = alertasVisibles.filter(
        (a) => a.lote_id === id && esAlertaActiva(a.estado)
      );

      let severidadMaxima: string | null = null;
      if (alertasLoteActivas.length > 0) {
        const orden: Record<string, number> = {
          CRITICA: 1,
          ALTA: 2,
          MEDIA: 3,
          BAJA: 4,
        };
        const ordenada = [...alertasLoteActivas].sort(
          (a, b) =>
            (orden[a.nivel_severidad?.toUpperCase()] ?? 99) -
            (orden[b.nivel_severidad?.toUpperCase()] ?? 99)
        );
        severidadMaxima = ordenada[0].nivel_severidad?.toUpperCase() || "ACTIVA";
      }

      const factorRiesgo = severidadMaxima
        ? factorRiesgoPorSeveridad(severidadMaxima)
        : 0;
      const ingresoEnRiesgoUsd = ingresoTotalUsd * factorRiesgo;

      return {
        id,
        nombreLote,
        nombreCorto,
        cliente,
        cultivo,
        hectareas,
        costoUsdHa,
        costoUsdHaRedondeado: Math.round(costoUsdHa),
        margenBrutoHaRedondeado: Math.round(margenBrutoHa),
        precioUsdTn,
        rindeObjetivoQqHa,
        rindeIndiferenciaQqHa: Number(rindeIndiferenciaQqHa.toFixed(1)),
        holguraQqHa,
        margenBrutoHa,
        inversionTotalUsd,
        ingresoTotalUsd,
        margenBrutoTotalUsd,
        severidadMaxima,
        factorRiesgo,
        ingresoEnRiesgoUsd,
      };
    });
  }, [features, alertasVisibles, supuestos, arriendoUsdHa, configEscenario]);

  const totales = useMemo(() => {
    const hectareas = filasCalculadas.reduce((acc, r) => acc + r.hectareas, 0);
    const inversionUsd = filasCalculadas.reduce(
      (acc, r) => acc + r.inversionTotalUsd,
      0
    );
    const ingresoUsd = filasCalculadas.reduce(
      (acc, r) => acc + r.ingresoTotalUsd,
      0
    );
    const margenUsd = filasCalculadas.reduce(
      (acc, r) => acc + r.margenBrutoTotalUsd,
      0
    );
    const capitalEnAlertaUsd = filasCalculadas
      .filter((r) => r.severidadMaxima !== null)
      .reduce((acc, r) => acc + r.inversionTotalUsd, 0);
    const hectareasEnAlerta = filasCalculadas
      .filter((r) => r.severidadMaxima !== null)
      .reduce((acc, r) => acc + r.hectareas, 0);
    const ingresoEnRiesgoUsd = filasCalculadas.reduce(
      (acc, r) => acc + r.ingresoEnRiesgoUsd,
      0
    );

    const margenPromedioHa = hectareas > 0 ? margenUsd / hectareas : 0;
    const roiPct = inversionUsd > 0 ? Math.round((margenUsd / inversionUsd) * 100) : 0;

    return {
      hectareas,
      inversionUsd,
      ingresoUsd,
      margenUsd,
      margenPromedioHa,
      capitalEnAlertaUsd,
      hectareasEnAlerta,
      ingresoEnRiesgoUsd,
      roiPct,
    };
  }, [filasCalculadas]);

  const actualizarSupuesto = (
    cultivo: string,
    campo: keyof SupuestoCultivo,
    valorRaw: string
  ) => {
    const valor = Math.max(0, Number(valorRaw) || 0);
    setSupuestos((prev) => {
      const actual = prev[cultivo] || obtenerSupuestoInicial(cultivo);
      return {
        ...prev,
        [cultivo]: {
          ...actual,
          [campo]: valor,
        },
      };
    });
  };

  const restablecerSupuestos = () => {
    setSupuestos({ ...SUPUESTOS_DEFAULT });
  };

  const exportarEconomicoCSV = () => {
    if (filasCalculadas.length === 0) return;

    const headers = [
      "Lote",
      "Establecimiento",
      "Cultivo",
      "Hectareas",
      "Costo_USD_ha",
      "Precio_USD_tn",
      "Rinde_Objetivo_qq_ha",
      "Rinde_Indiferencia_qq_ha",
      "Margen_Bruto_USD_ha",
      "Inversion_Total_USD",
      "Margen_Bruto_Total_USD",
      "Alerta_Activa",
      "Ingreso_En_Riesgo_USD",
    ];

    const filas = filasCalculadas.map((r) => [
      `"${r.nombreLote.replace(/"/g, '""')}"`,
      `"${r.cliente.replace(/"/g, '""')}"`,
      `"${r.cultivo.replace(/"/g, '""')}"`,
      r.hectareas.toFixed(2),
      r.costoUsdHa.toFixed(0),
      r.precioUsdTn,
      r.rindeObjetivoQqHa,
      r.rindeIndiferenciaQqHa.toFixed(1),
      r.margenBrutoHa.toFixed(0),
      r.inversionTotalUsd.toFixed(0),
      r.margenBrutoTotalUsd.toFixed(0),
      r.severidadMaxima || "ESTABLE",
      r.ingresoEnRiesgoUsd.toFixed(0),
    ]);

    const csv = [headers.join(","), ...filas.map((f) => f.join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "agrolens_gestion_economica.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (features.length === 0) {
    return null;
  }

  return (
    <section className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:p-5 space-y-4">
      {/* Header del Módulo Económico */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-slate-100 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>Gestión Económica · Margen Bruto y Rinde de Indiferencia</span>
          </h2>
          <p className="text-xs text-slate-400">
            Cruce financiero por lote y cultivo sobre {totales.hectareas.toLocaleString("es-AR", { maximumFractionDigits: 1 })} ha monitoreadas (supuestos zonales editables)
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle Campo Propio vs Alquilado */}
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setEsCampoAlquilado(false)}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                !esCampoAlquilado
                  ? "bg-emerald-500 text-slate-950 font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Campo propio
            </button>
            <button
              type="button"
              onClick={() => setEsCampoAlquilado(true)}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                esCampoAlquilado
                  ? "bg-amber-400 text-slate-950 font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Alquilado
            </button>
          </div>

          {esCampoAlquilado && (
            <label className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
              <span>Arriendo:</span>
              <input
                type="number"
                min={0}
                max={40}
                value={arriendoQqSoja}
                onChange={(e) => setArriendoQqSoja(Math.max(0, Number(e.target.value) || 0))}
                className="w-12 rounded border border-amber-500/40 bg-slate-950 px-1.5 py-0.5 text-xs text-slate-100 focus:outline-none"
              />
              <span>qq soja/ha</span>
            </label>
          )}

          <button
            type="button"
            onClick={() => setMostrarEditor((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              mostrarEditor
                ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
                : "border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-600"
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>{mostrarEditor ? "Ocultar supuestos" : "Editar costos y precios"}</span>
          </button>

          <button
            type="button"
            onClick={exportarEconomicoCSV}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-emerald-500/50 hover:bg-slate-700"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Exportar Excel (CSV)</span>
          </button>
        </div>
      </div>

      {/* Editor interactivo de supuestos por cultivo */}
      {mostrarEditor && (
        <div className="rounded-xl border border-slate-700/80 bg-slate-950/70 p-3 sm:p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-medium text-slate-300">
              Parámetros por Unidad de Negocio (impactan en tiempo real en toda la cartera)
            </span>
            <button
              type="button"
              onClick={restablecerSupuestos}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-emerald-300 transition"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Restablecer valores de referencia</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {cultivosActivos.map((cultivo) => {
              const s = supuestos[cultivo] || obtenerSupuestoInicial(cultivo);
              return (
                <div
                  key={cultivo}
                  className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 space-y-2"
                >
                  <div className="text-xs font-semibold text-emerald-400 truncate">
                    {cultivo}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="block">
                      <span className="text-[10px] text-slate-400 block">Costo $/ha</span>
                      <input
                        type="number"
                        min={0}
                        value={s.costoUsdHa}
                        onChange={(e) =>
                          actualizarSupuesto(cultivo, "costoUsdHa", e.target.value)
                        }
                        className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-slate-400 block">Precio $/tn</span>
                      <input
                        type="number"
                        min={0}
                        value={s.precioUsdTn}
                        onChange={(e) =>
                          actualizarSupuesto(cultivo, "precioUsdTn", e.target.value)
                        }
                        className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-slate-400 block">Rinde qq/ha</span>
                      <input
                        type="number"
                        min={0}
                        value={s.rindeObjetivoQqHa}
                        onChange={(e) =>
                          actualizarSupuesto(
                            cultivo,
                            "rindeObjetivoQqHa",
                            e.target.value
                          )
                        }
                        className="mt-0.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Simulador de Sensibilidad ("¿Y si...?") */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5">
        <span className="text-xs font-medium text-slate-300 shrink-0">
          Simular escenario de campaña:
        </span>
        <div className="flex flex-nowrap sm:flex-wrap items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {(Object.keys(ESCENARIOS) as EscenarioId[]).map((idEsc) => {
            const activo = escenario === idEsc;
            return (
              <button
                key={idEsc}
                type="button"
                onClick={() => setEscenario(idEsc)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition whitespace-nowrap shrink-0 ${
                  activo
                    ? idEsc === "base" || idEsc === "optimista_10"
                      ? "border-emerald-500 bg-emerald-500/20 text-emerald-300 font-semibold"
                      : "border-amber-400 bg-amber-500/15 text-amber-300 font-semibold"
                    : "border-slate-700/80 bg-slate-900 text-slate-400 hover:text-slate-200"
                }`}
              >
                {ESCENARIOS[idEsc].label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3 Tarjetas Financieras Ejecutivas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
        {/* Card 1: Margen Bruto Proyectado */}
        <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 sm:p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Margen bruto proyectado</span>
            <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <div
            className={`text-xl sm:text-2xl font-bold tracking-tight ${
              totales.margenUsd >= 0 ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {formatUsd(totales.margenUsd)}
          </div>
          <p className="text-[11px] text-slate-400">
            Prom.{" "}
            <strong className="text-slate-200">
              {Math.round(totales.margenPromedioHa)} USD/ha
            </strong>{" "}
            · Relación Margen / Costo:{" "}
            <strong className="text-emerald-300">{totales.roiPct}%</strong>
          </p>
        </div>

        {/* Card 2: Inversión Total y Capital bajo Alerta */}
        <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 sm:p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Capital invertido / bajo alerta</span>
            <Scale className="w-4 h-4 text-amber-400 shrink-0" />
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">
              {formatUsd(totales.inversionUsd)}
            </span>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                totales.capitalEnAlertaUsd > 0
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              }`}
            >
              {totales.capitalEnAlertaUsd > 0
                ? `${formatUsd(totales.capitalEnAlertaUsd)} en alerta`
                : "0 USD en alerta"}
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            {totales.hectareasEnAlerta > 0
              ? `${totales.hectareasEnAlerta.toLocaleString("es-AR", {
                  maximumFractionDigits: 1,
                })} ha con alerta activa requieren verificación`
              : "100% del capital invertido en lotes estables"}
          </p>
        </div>

        {/* Card 3: Riesgo Productivo Estimado por Alertas */}
        <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 sm:p-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Ingreso potencial en riesgo</span>
            <ShieldAlert
              className={`w-4 h-4 shrink-0 ${
                totales.ingresoEnRiesgoUsd > 0 ? "text-red-400" : "text-emerald-400"
              }`}
            />
          </div>
          <div
            className={`text-xl sm:text-2xl font-bold tracking-tight ${
              totales.ingresoEnRiesgoUsd > 0 ? "text-amber-300" : "text-emerald-400"
            }`}
          >
            {formatUsd(totales.ingresoEnRiesgoUsd)}
          </div>
          <p className="text-[11px] text-slate-400">
            Impacto estimado por severidad satelital (8% Media · 15% Alta · 25% Crítica)
          </p>
        </div>
      </div>

      {/* 2 Gráficos Gerenciales Recharts: Costo vs Margen y Rinde vs Indiferencia */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Gráfico A: Costo vs Margen Bruto (USD/ha) */}
        <div className="min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-xs sm:text-sm font-semibold text-slate-200 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-400 shrink-0" />
              Costo Total vs. Margen Bruto por Lote (USD/ha)
            </h3>
          </div>
          <div className="h-[220px] sm:h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={filasCalculadas}
                margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="nombreCorto" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} width={45} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    borderColor: "#334155",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <ReferenceLine y={0} stroke="#475569" />
                <Bar
                  dataKey="costoUsdHaRedondeado"
                  name="Costo (USD/ha)"
                  fill="#64748b"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="margenBrutoHaRedondeado"
                  name="Margen (USD/ha)"
                  radius={[4, 4, 0, 0]}
                >
                  {filasCalculadas.map((entry) => (
                    <Cell
                      key={entry.id}
                      fill={entry.margenBrutoHaRedondeado >= 0 ? "#10b981" : "#ef4444"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfico B: Rinde Esperado vs Rinde de Indiferencia (qq/ha) */}
        <div className="min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-xs sm:text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Scale className="w-4 h-4 text-amber-400 shrink-0" />
              Rinde Esperado vs. Indiferencia (qq/ha)
            </h3>
          </div>
          <div className="h-[220px] sm:h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={filasCalculadas}
                margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="nombreCorto" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} width={40} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    borderColor: "#334155",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar
                  dataKey="rindeIndiferenciaQqHa"
                  name="Indiferencia (qq/ha)"
                  fill="#f59e0b"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="rindeObjetivoQqHa"
                  name="Rinde Esperado (qq/ha)"
                  radius={[4, 4, 0, 0]}
                >
                  {filasCalculadas.map((entry) => (
                    <Cell
                      key={entry.id}
                      fill={
                        entry.rindeObjetivoQqHa >= entry.rindeIndiferenciaQqHa
                          ? "#22c55e"
                          : "#ef4444"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Tabla de Rinde de Indiferencia y Margen por Lote */}
      <div className="min-w-0 overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400">
              <th className="py-2.5 px-3 font-medium">Lote / Establecimiento</th>
              <th className="py-2.5 px-3 font-medium">Cultivo · Sup.</th>
              <th className="py-2.5 px-3 font-medium text-right">Costo</th>
              <th className="py-2.5 px-3 font-medium text-right">Indiferencia</th>
              <th className="py-2.5 px-3 font-medium text-right">Rinde Obj.</th>
              <th className="py-2.5 px-3 font-medium text-right">Margen Bruto</th>
              <th className="py-2.5 px-3 font-medium text-right">Riesgo / Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {filasCalculadas.map((row) => {
              const seleccionado = row.id === loteSeleccionadoId;
              return (
                <tr
                  key={row.id}
                  onClick={() => onSelectLote(row.id)}
                  className={`cursor-pointer transition ${
                    seleccionado
                      ? "bg-emerald-500/10"
                      : "bg-slate-900/30 hover:bg-slate-800/50"
                  }`}
                >
                  <td className="py-2.5 px-3">
                    <div className="font-medium text-slate-100 whitespace-nowrap">
                      {row.nombreLote}
                    </div>
                    <div className="text-[11px] text-slate-400 whitespace-nowrap">
                      {row.cliente}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className="text-emerald-300 font-medium">{row.cultivo}</span>
                    <span className="text-slate-400 block text-[11px]">
                      {row.hectareas.toLocaleString("es-AR", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      ha
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-300 whitespace-nowrap">
                    ${Math.round(row.costoUsdHa)}/ha
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                    <span className="text-amber-300 font-semibold">
                      {row.rindeIndiferenciaQqHa.toFixed(1)} qq/ha
                    </span>
                    <span className="block text-[10px] text-slate-400">
                      Holgura: {row.holguraQqHa >= 0 ? "+" : ""}
                      {row.holguraQqHa.toFixed(1)} qq
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-200 whitespace-nowrap">
                    {row.rindeObjetivoQqHa} qq/ha
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                    <span
                      className={`font-semibold ${
                        row.margenBrutoTotalUsd >= 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {formatUsd(row.margenBrutoTotalUsd)}
                    </span>
                    <span className="block text-[10px] text-slate-400">
                      ${Math.round(row.margenBrutoHa)}/ha
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right whitespace-nowrap">
                    {row.severidadMaxima ? (
                      <div>
                        <span className="inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                          {row.severidadMaxima} · -{Math.round(row.factorRiesgo * 100)}%
                        </span>
                        <span className="block text-[10px] text-red-300 font-mono mt-0.5">
                          ~{formatUsd(row.ingresoEnRiesgoUsd)}
                        </span>
                      </div>
                    ) : (
                      <span className="inline-block rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                        Estable
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700 bg-slate-950/90 font-semibold text-slate-200">
              <td className="py-2.5 px-3">Total Cartera Visible</td>
              <td className="py-2.5 px-3 whitespace-nowrap">
                {totales.hectareas.toLocaleString("es-AR", {
                  maximumFractionDigits: 1,
                })}{" "}
                ha
              </td>
              <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                {formatUsd(totales.inversionUsd)}
              </td>
              <td className="py-2.5 px-3 text-right text-slate-400">—</td>
              <td className="py-2.5 px-3 text-right text-slate-400">—</td>
              <td className="py-2.5 px-3 text-right font-mono text-emerald-400 whitespace-nowrap">
                {formatUsd(totales.margenUsd)}
              </td>
              <td className="py-2.5 px-3 text-right font-mono text-amber-300 whitespace-nowrap">
                {totales.ingresoEnRiesgoUsd > 0
                  ? formatUsd(totales.ingresoEnRiesgoUsd)
                  : "USD 0"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
