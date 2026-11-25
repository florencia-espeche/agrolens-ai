"use client";

import {
  Fragment,
  useState,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
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
  Sliders,
  Database,
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
import {
  ESCENARIOS,
  SUPUESTOS_DEFAULT,
  obtenerSupuestoInicial,
  formatUsd,
  type CarteraEconomica,
  type EscenarioId,
  type FilaEconomicaLote,
  type PresupuestoLote,
  type SupuestoCultivo,
} from "@/lib/economia";

interface ModuloEconomicoProps {
  geojsonFiltrado: FeatureCollection | null;
  loteSeleccionadoId: number | null;
  onSelectLote: (loteId: number) => void;
  onVerEnMapa?: (loteId: number) => void;
  cartera: CarteraEconomica;
  supuestos: Record<string, SupuestoCultivo>;
  onChangeSupuestos: Dispatch<SetStateAction<Record<string, SupuestoCultivo>>>;
  esCampoAlquilado: boolean;
  onChangeEsCampoAlquilado: (val: boolean) => void;
  arriendoQqSoja: number;
  onChangeArriendoQqSoja: (val: number) => void;
  escenario: EscenarioId;
  onChangeEscenario: (val: EscenarioId) => void;
  onSavePresupuestoLote?: (loteId: number, data: PresupuestoLote) => Promise<void>;
  sincronizandoBd?: boolean;
  errorSyncBd?: string | null;
}

export default function ModuloEconomico({
  geojsonFiltrado,
  loteSeleccionadoId,
  onSelectLote,
  onVerEnMapa,
  cartera,
  supuestos,
  onChangeSupuestos,
  esCampoAlquilado,
  onChangeEsCampoAlquilado,
  arriendoQqSoja,
  onChangeArriendoQqSoja,
  escenario,
  onChangeEscenario,
  onSavePresupuestoLote,
  sincronizandoBd = false,
  errorSyncBd = null,
}: ModuloEconomicoProps) {
  const [mostrarEditor, setMostrarEditor] = useState(false);
  const [editandoLoteId, setEditandoLoteId] = useState<number | null>(null);
  const [rindeLoteInput, setRindeLoteInput] = useState("");
  const [costoExtraInput, setCostoExtraInput] = useState("0");
  const [notasLoteInput, setNotasLoteInput] = useState("");
  const [guardandoLote, setGuardandoLote] = useState(false);

  const abrirAjusteLote = (row: FilaEconomicaLote) => {
    if (editandoLoteId === row.id) {
      setEditandoLoteId(null);
      return;
    }
    setEditandoLoteId(row.id);
    setRindeLoteInput(
      row.rindeBaseLoteQqHa !== null ? String(row.rindeBaseLoteQqHa) : ""
    );
    setCostoExtraInput(String(row.costoExtraManualHa || 0));
    setNotasLoteInput(row.notasPresupuesto || "");
  };

  const handleGuardarLote = async (loteId: number) => {
    if (!onSavePresupuestoLote) return;
    setGuardandoLote(true);
    try {
      const rindeParsed =
        rindeLoteInput.trim() === ""
          ? null
          : Math.max(0, Number(rindeLoteInput) || 0);
      await onSavePresupuestoLote(loteId, {
        rinde_objetivo_qq_ha: rindeParsed && rindeParsed > 0 ? rindeParsed : null,
        costo_extra_usd_ha: Math.max(0, Number(costoExtraInput) || 0),
        notas_presupuesto: notasLoteInput.trim() || null,
      });
      setEditandoLoteId(null);
    } finally {
      setGuardandoLote(false);
    }
  };

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

  const { filas: filasCalculadas, totales, arriendoUsdHa } = cartera;

  const actualizarSupuesto = (
    cultivo: string,
    campo: keyof SupuestoCultivo,
    valorRaw: string
  ) => {
    const valor = Math.max(0, Number(valorRaw) || 0);
    onChangeSupuestos((prev) => {
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
    onChangeSupuestos({ ...SUPUESTOS_DEFAULT });
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
          <h2 className="text-base sm:text-lg font-semibold text-slate-100 flex items-center gap-2 flex-wrap">
            <DollarSign className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>Gestión Económica · Margen Bruto y Rinde de Indiferencia</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                errorSyncBd
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : sincronizandoBd
                  ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              }`}
              title={errorSyncBd || "Los parámetros económicos se guardan en PostgreSQL"}
            >
              <Database className="w-3 h-3" />
              {errorSyncBd
                ? "Solo local (sin conexión BD)"
                : sincronizandoBd
                ? "Guardando en BD..."
                : "Sincronizado en BD"}
            </span>
          </h2>
          <p className="text-xs text-slate-400">
            Cruce financiero por lote y cultivo sobre {totales.hectareas.toLocaleString("es-AR", { maximumFractionDigits: 1 })} ha monitoreadas (supuestos compartidos editables)
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle Campo Propio vs Alquilado */}
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => onChangeEsCampoAlquilado(false)}
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
              onClick={() => onChangeEsCampoAlquilado(true)}
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
            <label className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200 whitespace-nowrap">
              <span>Arriendo:</span>
              <input
                type="number"
                min={0}
                max={40}
                value={arriendoQqSoja}
                onChange={(e) =>
                  onChangeArriendoQqSoja(Math.max(0, Number(e.target.value) || 0))
                }
                className="w-12 rounded border border-amber-500/40 bg-slate-950 px-1.5 py-0.5 text-xs text-slate-100 focus:outline-none"
              />
              <span>qq soja/ha</span>
              <span className="text-[11px] text-amber-300/80">
                (USD {Math.round(arriendoUsdHa).toLocaleString("es-AR")}/ha)
              </span>
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
                onClick={() => onChangeEscenario(idEsc)}
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
              USD {Math.round(totales.margenPromedioHa).toLocaleString("es-AR")}/ha
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
                : "USD 0 en alerta"}
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
                  formatter={(value) => {
                    const num = typeof value === "number" ? value : Number(value);
                    return Number.isFinite(num)
                      ? `USD ${Math.round(num).toLocaleString("es-AR")}/ha`
                      : String(value ?? "");
                  }}
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
                  formatter={(value) => {
                    const num = typeof value === "number" ? value : Number(value);
                    return Number.isFinite(num)
                      ? `${num.toFixed(1)} qq/ha`
                      : String(value ?? "");
                  }}
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
              const editando = editandoLoteId === row.id;
              return (
                <Fragment key={row.id}>
                  <tr
                    onClick={() => onSelectLote(row.id)}
                    className={`cursor-pointer transition ${
                      seleccionado
                        ? "bg-emerald-500/10"
                        : "bg-slate-900/30 hover:bg-slate-800/50"
                    }`}
                  >
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-100 whitespace-nowrap">
                          {row.nombreLote}
                        </span>
                        {onVerEnMapa && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onVerEnMapa(row.id);
                            }}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
                              seleccionado
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                : "bg-slate-800 text-slate-300 border border-slate-700 hover:border-emerald-500/40 hover:text-emerald-300"
                            }`}
                          >
                            Ver mapa ↑
                          </button>
                        )}
                        {onSavePresupuestoLote && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              abrirAjusteLote(row);
                            }}
                            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-amber-500/50 hover:text-amber-300 transition"
                            title="Ajustar rinde objetivo o costo extra de este lote"
                          >
                            <Sliders className="w-2.5 h-2.5" />
                            <span>{editando ? "Cerrar" : "Ajustar"}</span>
                          </button>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 whitespace-nowrap">
                        {row.cliente}
                        {row.notasPresupuesto ? ` · ${row.notasPresupuesto}` : ""}
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
                      <span>USD {Math.round(row.costoUsdHa).toLocaleString("es-AR")}/ha</span>
                      {(row.costoExtraManualHa > 0 || row.costoLaboresHa > 0) && (
                        <span className="block text-[10px] text-amber-300">
                          Incl. +USD{" "}
                          {Math.round(
                            row.costoExtraManualHa + row.costoLaboresHa
                          ).toLocaleString("es-AR")}
                          /ha extra/lab.
                        </span>
                      )}
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
                      <span>{row.rindeObjetivoQqHa} qq/ha</span>
                      {row.usaRindeIndividual && (
                        <span className="block text-[10px] text-sky-300">
                          Rinde propio del lote
                        </span>
                      )}
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
                        USD {Math.round(row.margenBrutoHa).toLocaleString("es-AR")}/ha
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
                  {editando && onSavePresupuestoLote && (
                    <tr className="bg-slate-950/90 border-t border-slate-800">
                      <td colSpan={7} className="p-3">
                        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 flex-1">
                            <label className="block">
                              <span className="text-[11px] text-slate-300 block mb-1">
                                Rinde esperado propio (qq/ha)
                              </span>
                              <input
                                type="number"
                                min={0}
                                step="0.5"
                                placeholder="Vacío = usa estándar del cultivo"
                                value={rindeLoteInput}
                                onChange={(e) => setRindeLoteInput(e.target.value)}
                                className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[11px] text-slate-300 block mb-1">
                                Costo extra ejecutado (USD/ha)
                              </span>
                              <input
                                type="number"
                                min={0}
                                step="1"
                                value={costoExtraInput}
                                onChange={(e) => setCostoExtraInput(e.target.value)}
                                className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                              />
                              {row.costoLaboresHa > 0 && (
                                <span className="text-[10px] text-amber-300 block mt-0.5">
                                  Se suman +USD {row.costoLaboresHa}/ha de recorridas registradas
                                </span>
                              )}
                            </label>
                            <label className="block">
                              <span className="text-[11px] text-slate-300 block mb-1">
                                Nota agronómica / financiera
                              </span>
                              <input
                                type="text"
                                placeholder="Ej: Lote con tosca / refertilización"
                                value={notasLoteInput}
                                onChange={(e) => setNotasLoteInput(e.target.value)}
                                className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                              />
                            </label>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => setEditandoLoteId(null)}
                              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              disabled={guardandoLote}
                              onClick={() => handleGuardarLote(row.id)}
                              className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                            >
                              {guardandoLote ? "Guardando..." : "Guardar lote"}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
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
              <td
                className={`py-2.5 px-3 text-right font-mono whitespace-nowrap ${
                  totales.margenUsd >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
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
