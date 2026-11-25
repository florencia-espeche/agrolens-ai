"use client";

import { useState } from "react";
import { X, Copy, Check, Printer, FileText } from "lucide-react";
import {
  ESCENARIOS,
  formatUsd,
  esAlertaActiva,
  type CarteraEconomica,
  type EscenarioId,
} from "@/lib/economia";
import type { PronosticoLoteData } from "@/components/PronosticoLote";
import type { RecorridaCampo } from "@/components/RecorridaModal";

export interface AlertaMinuta {
  id: number;
  lote_id: number;
  nombre_lote: string;
  cultivo_actual: string;
  nivel_severidad: string;
  tipo_anomalia: string;
  diagnostico_llm: string;
  estado: string;
}

interface MinutaGestionModalProps {
  abierto: boolean;
  onCerrar: () => void;
  filtroCliente: string;
  filtroCampana: string;
  ultimaFecha: string;
  cartera: CarteraEconomica;
  esCampoAlquilado: boolean;
  arriendoQqSoja: number;
  escenario: EscenarioId;
  alertasVisibles: AlertaMinuta[];
  recorridasVisibles?: RecorridaCampo[];
  pronosticoLote: PronosticoLoteData | null;
}

function resumirDiagnostico(texto: string) {
  if (!texto) return "";
  const quePaso = texto.match(/QUE_PASO:\s*(.+)/i)?.[1]?.trim();
  const accion = texto.match(/ACCION_SUGERIDA:\s*(.+)/i)?.[1]?.trim();
  if (quePaso || accion) {
    return [quePaso, accion].filter(Boolean).join(" → ");
  }
  return texto;
}

export default function MinutaGestionModal({
  abierto,
  onCerrar,
  filtroCliente,
  filtroCampana,
  ultimaFecha,
  cartera,
  esCampoAlquilado,
  arriendoQqSoja,
  escenario,
  alertasVisibles,
  recorridasVisibles = [],
  pronosticoLote,
}: MinutaGestionModalProps) {
  const [copiado, setCopiado] = useState(false);

  if (!abierto) return null;

  const { totales, filas, prioridadUno } = cartera;
  const alertasActivas = alertasVisibles.filter((a) => esAlertaActiva(a.estado));
  const establecimientoLabel =
    filtroCliente === "todos" ? "Cartera Consolidada" : filtroCliente;
  const campanaLabel =
    filtroCampana === "todas" ? "Todas las campañas" : `Campaña ${filtroCampana}`;
  const regimenLabel = esCampoAlquilado
    ? `Campo alquilado (${arriendoQqSoja} qq soja/ha)`
    : "Campo propio";

  const haEstables = Math.max(0, totales.hectareas - totales.hectareasEnAlerta);
  const pctEstable =
    totales.hectareas > 0
      ? Math.round((haEstables / totales.hectareas) * 100)
      : 100;

  const generarTextoWhatsApp = () => {
    const lineas: string[] = [
      `📋 *MINUTA DE GESTIÓN — AgroLens AI*`,
      `🏢 *Establecimiento:* ${establecimientoLabel} (${campanaLabel})`,
      `📅 *Fecha de corte:* ${ultimaFecha}`,
      `⚙️ *Escenario:* ${(ESCENARIOS[escenario] ?? ESCENARIOS.base).label} · ${regimenLabel}`,
      "",
      `🌱 *1. SUPERFICIE Y ESTADO PRODUCTIVO*`,
      `• Superficie monitoreada: ${totales.hectareas.toLocaleString("es-AR", { maximumFractionDigits: 1 })} ha (${filas.length} lotes)`,
      `• Superficie estable: ${pctEstable}% (${totales.hectareasEnAlerta > 0 ? `${totales.hectareasEnAlerta.toLocaleString("es-AR", { maximumFractionDigits: 1 })} ha bajo alerta` : "0 ha comprometidas"})`,
      "",
      `💰 *2. RESUMEN ECONÓMICO PROYECTADO*`,
      `• Costo total invertido: ${formatUsd(totales.inversionUsd)}`,
      `• Margen bruto proyectado: ${formatUsd(totales.margenUsd)} (prom. USD ${Math.round(totales.margenPromedioHa)}/ha · ${totales.roiPct}% s/costo)`,
      `• Ingreso potencial en riesgo: ${formatUsd(totales.ingresoEnRiesgoUsd)}`,
    ];

    if (prioridadUno) {
      lineas.push(
        "",
        `🚨 *3. PRIORIDAD DE RECORRIDA*`,
        `• Prioridad #1: ${prioridadUno.nombreLote} (${prioridadUno.cultivo}) — ${prioridadUno.severidadMaxima} · ~${formatUsd(prioridadUno.ingresoEnRiesgoUsd)} expuestos`
      );
    } else {
      lineas.push("", `✅ *3. ALERTAS DE CAMPO*: Sin alertas activas pendientes.`);
    }

    if (pronosticoLote) {
      lineas.push(
        "",
        `🌦️ *4. PRONÓSTICO 7 DÍAS (${pronosticoLote.nombre_lote})*`,
        `• Lluvia acumulada prevista: ${pronosticoLote.lluvia_acumulada_mm} mm`
      );
    }

    if (recorridasVisibles.length > 0) {
      lineas.push("", `🚜 *5. ÚLTIMAS RECORRIDAS A CAMPO*`);
      recorridasVisibles.slice(0, 4).forEach((r) => {
        const extraLabor = r.labor_recomendada ? ` → ${r.labor_recomendada}` : "";
        lineas.push(
          `• [${r.fecha_recorrida}] ${r.nombre_lote || `Lote ${r.lote_id}`}: ${r.hallazgo}${extraLabor}`
        );
      });
    }

    return lineas.join("\n");
  };

  const handleCopiar = async () => {
    try {
      await navigator.clipboard.writeText(generarTextoWhatsApp());
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch (err) {
      console.error("No se pudo copiar la minuta:", err);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Minuta de Gestión Mensual"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/80 p-3 sm:p-6 backdrop-blur-sm overflow-y-auto print:static print:bg-white print:p-0"
    >
      <div className="w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl overflow-hidden my-auto print:border-none print:shadow-none print:bg-white print:text-slate-950 print:max-w-none">
        {/* Barra superior de acciones (oculta al imprimir) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/80 px-4 py-3 sm:px-6 print:hidden">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
            <FileText className="w-4 h-4" />
            <span>Minuta Ejecutiva para Reunión de Gestión</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleCopiar}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 transition"
            >
              {copiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiado ? "¡Copiado!" : "Copiar para WhatsApp / Acta"}</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500 transition"
            >
              <Printer className="w-3.5 h-3.5 text-sky-400" />
              <span>Imprimir / PDF</span>
            </button>

            <button
              type="button"
              onClick={onCerrar}
              aria-label="Cerrar minuta"
              className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Contenido imprimible */}
        <div className="p-4 sm:p-6 space-y-5 max-h-[80vh] overflow-y-auto print:max-h-none print:overflow-visible">
          <div className="border-b border-slate-800 pb-3 print:border-slate-300">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <h2 className="text-lg font-bold text-slate-100 print:text-slate-950">
                  Informe de Situación Productiva y Económica
                </h2>
                <p className="text-xs text-slate-400 print:text-slate-600">
                  {establecimientoLabel} · {campanaLabel} · Escenario {(ESCENARIOS[escenario] ?? ESCENARIOS.base).label} ({regimenLabel})
                </p>
              </div>
              <span className="rounded-full border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-[11px] text-slate-300 print:border-slate-300 print:bg-slate-100 print:text-slate-800">
                Corte: {ultimaFecha}
              </span>
            </div>
          </div>

          {/* Bloque 1 y 2: Resumen productivo y financiero */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 print:border-slate-300 print:bg-slate-50">
              <span className="text-slate-400 print:text-slate-600 block">Superficie</span>
              <strong className="text-base text-slate-100 print:text-slate-950">
                {totales.hectareas.toLocaleString("es-AR", { maximumFractionDigits: 1 })} ha
              </strong>
              <span className="block text-[11px] text-slate-400 print:text-slate-600">
                {pctEstable}% estable
              </span>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 print:border-slate-300 print:bg-slate-50">
              <span className="text-slate-400 print:text-slate-600 block">Inversión total</span>
              <strong className="text-base text-slate-100 print:text-slate-950">
                {formatUsd(totales.inversionUsd)}
              </strong>
              <span className="block text-[11px] text-slate-400 print:text-slate-600">
                Costo de campaña
              </span>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 print:border-slate-300 print:bg-slate-50">
              <span className="text-slate-400 print:text-slate-600 block">Margen bruto</span>
              <strong
                className={`text-base ${
                  totales.margenUsd >= 0
                    ? "text-emerald-400 print:text-emerald-700"
                    : "text-red-400 print:text-red-700"
                }`}
              >
                {formatUsd(totales.margenUsd)}
              </strong>
              <span className="block text-[11px] text-slate-400 print:text-slate-600">
                USD {Math.round(totales.margenPromedioHa).toLocaleString("es-AR")}/ha · {totales.roiPct}%
              </span>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 print:border-slate-300 print:bg-slate-50">
              <span className="text-slate-400 print:text-slate-600 block">Ingreso en riesgo</span>
              <strong className="text-base text-amber-300 print:text-amber-700">
                {formatUsd(totales.ingresoEnRiesgoUsd)}
              </strong>
              <span className="block text-[11px] text-slate-400 print:text-slate-600">
                {alertasActivas.length} {alertasActivas.length === 1 ? "alerta activa" : "alertas activas"}
              </span>
            </div>
          </div>

          {/* Bloque 3: Detalle económico por lote */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 print:text-slate-700">
              Desglose por Lote (Unidad de Negocio)
            </h3>
            <div className="overflow-x-auto rounded-lg border border-slate-800 print:border-slate-300">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/70 text-slate-400 print:border-slate-300 print:bg-slate-100 print:text-slate-700">
                    <th className="py-2 px-2.5">Lote</th>
                    <th className="py-2 px-2.5">Cultivo · ha</th>
                    <th className="py-2 px-2.5 text-right">Indif.</th>
                    <th className="py-2 px-2.5 text-right">Rinde Obj.</th>
                    <th className="py-2 px-2.5 text-right">Margen Total</th>
                    <th className="py-2 px-2.5 text-right">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 print:divide-slate-200">
                  {filas.map((f) => (
                    <tr key={f.id}>
                      <td className="py-2 px-2.5 font-medium">{f.nombreLote}</td>
                      <td className="py-2 px-2.5">
                        {f.cultivo} · {f.hectareas.toFixed(1)} ha
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono">
                        {f.rindeIndiferenciaQqHa.toFixed(1)} qq
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono">
                        {f.rindeObjetivoQqHa} qq
                      </td>
                      <td
                        className={`py-2 px-2.5 text-right font-mono font-semibold ${
                          f.margenBrutoTotalUsd >= 0
                            ? "text-emerald-400 print:text-emerald-700"
                            : "text-red-400 print:text-red-700"
                        }`}
                      >
                        {formatUsd(f.margenBrutoTotalUsd)}
                      </td>
                      <td className="py-2 px-2.5 text-right">
                        {f.severidadMaxima || "Estable"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bloque 4: Prioridades de campo */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 print:text-slate-700">
              Prioridades de Recorrida y Puntos de Atención
            </h3>
            {alertasActivas.length === 0 ? (
              <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-300 print:border-emerald-300 print:bg-emerald-50 print:text-emerald-800">
                Sin alertas activas pendientes. Toda la superficie visible se encuentra bajo monitoreo normal.
              </p>
            ) : (
              <div className="space-y-2">
                {prioridadUno && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200 print:border-amber-400 print:bg-amber-50 print:text-amber-900">
                    <strong>Prioridad #1 por exposición económica:</strong> {prioridadUno.nombreLote} ({prioridadUno.cultivo}) · ~{formatUsd(prioridadUno.ingresoEnRiesgoUsd)} en riesgo estimado.
                  </div>
                )}
                {alertasActivas.slice(0, 4).map((a) => (
                  <div
                    key={a.id}
                    className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-xs print:border-slate-300 print:bg-white"
                  >
                    <div className="font-semibold text-slate-200 print:text-slate-950">
                      [{a.nivel_severidad}] {a.nombre_lote} — {a.tipo_anomalia}
                    </div>
                    <p className="text-slate-400 mt-0.5 print:text-slate-700">
                      {resumirDiagnostico(a.diagnostico_llm)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {recorridasVisibles.length > 0 && (
            <div className="space-y-2 border-t border-slate-800 pt-3 print:border-slate-300">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 print:text-slate-700">
                Bitácora Reciente de Recorridas a Campo
              </h3>
              <div className="space-y-1.5">
                {recorridasVisibles.slice(0, 5).map((r) => (
                  <div
                    key={r.id}
                    className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-xs print:border-slate-300 print:bg-white"
                  >
                    <div className="flex items-center justify-between gap-2 font-semibold text-slate-200 print:text-slate-950">
                      <span>
                        [{r.fecha_recorrida}] {r.nombre_lote || `Lote ${r.lote_id}`}
                        {r.autor ? ` · ${r.autor}` : ""}
                      </span>
                      {r.costo_labor_usd_ha > 0 && (
                        <span className="font-mono text-amber-300 print:text-amber-700">
                          +USD {r.costo_labor_usd_ha}/ha
                        </span>
                      )}
                    </div>
                    <p className="text-slate-300 mt-0.5 print:text-slate-700">{r.hallazgo}</p>
                    {r.labor_recomendada && (
                      <p className="text-emerald-300 mt-0.5 print:text-emerald-700">
                        Labor definida: {r.labor_recomendada}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {pronosticoLote && (
            <p className="text-xs text-slate-400 border-t border-slate-800 pt-3 print:border-slate-300 print:text-slate-700">
              <strong>Clima próximo (7 días en {pronosticoLote.nombre_lote}):</strong> Lluvia acumulada esperada de{" "}
              <strong>{pronosticoLote.lluvia_acumulada_mm} mm</strong>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
