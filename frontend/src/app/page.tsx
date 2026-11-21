"use client";

import { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import type { FeatureCollection } from "geojson";
import { AlertTriangle, CheckCircle2, Sprout, MapPin } from "lucide-react";
import GraficosLote, { type SeriesLote } from "@/components/GraficosLote";

// Leaflet requiere `window`, por eso se importa sin SSR
const MapaLotes = dynamic(() => import("@/components/MapaLotes"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-slate-900 text-slate-400 rounded-xl">
      Cargando mapa satelital...
    </div>
  ),
});

interface Alerta {
  id: number;
  lote_id: number;
  nombre_lote: string;
  cultivo_actual: string;
  zona_productiva: string;
  fecha_deteccion: string;
  nivel_severidad: string;
  tipo_anomalia: string;
  diagnostico_llm: string;
  estado: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export default function Home() {
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [loteSeleccionado, setLoteSeleccionado] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [isSlowLoad, setIsSlowLoad] = useState(false);
  const [seriesLote, setSeriesLote] = useState<SeriesLote | null>(null);
  const [cargandoSeries, setCargandoSeries] = useState(false);

  useEffect(() => {
    if (!cargando) {
      setIsSlowLoad(false);
      return;
    }
    const timer = setTimeout(() => setIsSlowLoad(true), 4000);
    return () => clearTimeout(timer);
  }, [cargando]);

  // Calcula la fecha más reciente disponible de las alertas o imágenes satelitales
  const ultimaFecha = useMemo(() => {
    const fechasAlertas = alertas
      .map((a) => a.fecha_deteccion || (a as any).fecha || (a as any).created_at)
      .filter(Boolean);

    const fechasLotes = (geojson?.features || [])
      .map((f: any) => f.properties?.ultima_fecha_satelital)
      .filter(Boolean);

    const fechas = [...fechasAlertas, ...fechasLotes].sort().reverse();

    if (fechas.length === 0) return "Sincronización diaria · 06:00 hs";

    const fechaStr = String(fechas[0]);
    const fechaMasReciente = new Date(fechaStr.includes("T") ? fechaStr : `${fechaStr}T12:00:00`);
    if (isNaN(fechaMasReciente.getTime())) return "Sincronización diaria · 06:00 hs";

    return fechaMasReciente.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }, [alertas, geojson]);

  const cargarDatos = async () => {
    try {
      const [resLotes, resAlertas] = await Promise.all([
        fetch(`${API_URL}/api/lotes`),
        fetch(`${API_URL}/api/alertas`),
      ]);
      const dataLotes = await resLotes.json();
      const dataAlertas = await resAlertas.json();
      setGeojson(dataLotes);
      if (dataLotes.features?.length > 0) {
        setLoteSeleccionado((prev) => prev ?? dataLotes.features[0].properties.id);
      }
      setAlertas(dataAlertas);
    } catch (err) {
      console.error("Error conectando con FastAPI:", err);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  useEffect(() => {
    if (!loteSeleccionado) return;
    const cargarSeries = async () => {
      setCargandoSeries(true);
      try {
        const res = await fetch(`${API_URL}/api/lotes/${loteSeleccionado}/series?dias=60`);
        const data = await res.json();
        setSeriesLote(data);
      } catch (err) {
        console.error("Error cargando series del lote:", err);
      } finally {
        setCargandoSeries(false);
      }
    };
    cargarSeries();
  }, [loteSeleccionado]);

  const actualizarEstadoAlerta = async (alertaId: number, nuevoEstado: string) => {
    await fetch(`${API_URL}/api/alertas/${alertaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: nuevoEstado }),
    });
    cargarDatos();
  };

  const badgeSeveridad = (sev: string) => {
    if (sev === "CRITICA") return "bg-red-500/20 text-red-400 border-red-500/40";
    if (sev === "ALTA") return "bg-orange-500/20 text-orange-400 border-orange-500/40";
    return "bg-yellow-500/20 text-yellow-400 border-yellow-500/40";
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <Sprout className="w-8 h-8 text-emerald-400 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AgroLens AI</h1>
            <p className="text-sm text-slate-400">
              Monitoreo Satelital (Sentinel-2 + NASA POWER) &amp; Diagnóstico Agronómico
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Badge de Frescura de Datos Dinámico */}
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"></span>
            </span>
            <span>Datos Sentinel-2 / NASA · {ultimaFecha}</span>
          </div>

          <div className="text-sm text-slate-400 hidden md:block border-l border-slate-800 pl-3">
            {geojson ? `${geojson.features.length} lotes monitoreados` : "Conectando..."}
          </div>
        </div>
      </header>

      {/* Aviso de servidor en Render despertando (Cold Start > 4s) */}
      {isSlowLoad && cargando && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500"></span>
          </span>
          <span>
            Despertando servidor satelital en Render… La primera carga puede demorar ~30 segundos por la suspensión de inactividad.
          </span>
        </div>
      )}

      {cargando ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Skeleton del Mapa */}
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-4 h-[600px] flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <div className="h-5 w-44 bg-slate-800/80 rounded animate-pulse"></div>
                <div className="flex gap-2">
                  <div className="h-4 w-12 bg-slate-800/80 rounded animate-pulse"></div>
                  <div className="h-4 w-12 bg-slate-800/80 rounded animate-pulse"></div>
                  <div className="h-4 w-12 bg-slate-800/80 rounded animate-pulse"></div>
                </div>
              </div>
              <div className="flex-1 my-4 bg-slate-800/40 rounded-lg flex flex-col items-center justify-center gap-2 text-slate-500 text-sm animate-pulse">
                <MapPin className="w-8 h-8 text-slate-700 animate-bounce" />
                <span>Cargando capas geoespaciales y polígonos...</span>
              </div>
              <div className="h-4 w-36 bg-slate-800/80 rounded animate-pulse"></div>
            </div>

            {/* Skeleton del Panel de Alertas */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 h-[600px] flex flex-col space-y-4">
              <div className="h-5 w-48 bg-slate-800/80 rounded animate-pulse"></div>
              <div className="space-y-3 flex-1 overflow-hidden">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 space-y-2.5 animate-pulse"
                  >
                    <div className="flex justify-between items-center">
                      <div className="h-4 w-32 bg-slate-800/80 rounded"></div>
                      <div className="h-4 w-14 bg-slate-800/80 rounded-full"></div>
                    </div>
                    <div className="h-3 w-40 bg-slate-800/60 rounded"></div>
                    <div className="h-8 w-full bg-slate-800/40 rounded"></div>
                    <div className="h-3 w-28 bg-slate-800/60 rounded"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Skeleton de Gráficos */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 h-[200px] animate-pulse flex items-center justify-center text-slate-500 text-sm">
            Cargando series temporales satelitales (Sentinel-2) y agroclimáticas (NASA POWER)...
          </div>
        </div>
      ) : (
        <>
          {/* Grid Principal: Mapa + Panel de Alertas */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Mapa (2 columnas) */}
            <section className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-4 h-[600px] flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-emerald-400" />
                  Mapa de Lotes — Córdoba
                </h2>
                <span className="text-xs text-slate-400">
                  {geojson?.features ? `${geojson.features.length} parcelas georreferenciadas` : ""}
                </span>
              </div>
              <div className="flex-1 min-h-0">
                <MapaLotes
                  geojson={geojson}
                  alertas={alertas}
                  loteSeleccionadoId={loteSeleccionado}
                  onSelectLote={setLoteSeleccionado}
                />
              </div>
            </section>

            {/* Feed de Alertas IA (1 columna) */}
            <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 h-[600px] flex flex-col">
              <h2 className="font-semibold flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Alertas Agronómicas IA ({alertas.length})
              </h2>

              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {alertas.length === 0 ? (
                  <p className="text-sm text-slate-400">No hay alertas registradas.</p>
                ) : (
                  alertas.map((alerta) => (
                    <div
                      key={alerta.id}
                      onClick={() => setLoteSeleccionado(alerta.lote_id)}
                      className={`p-3 rounded-lg border cursor-pointer transition ${
                        loteSeleccionado === alerta.lote_id
                          ? "bg-slate-800 border-emerald-500/60"
                          : "bg-slate-950/60 border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-medium text-sm truncate">
                          {alerta.nombre_lote}
                        </span>
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${badgeSeveridad(
                            alerta.nivel_severidad
                          )}`}
                        >
                          {alerta.nivel_severidad}
                        </span>
                      </div>

                      <p className="text-xs text-emerald-400 mb-2">
                        {alerta.cultivo_actual} · {alerta.tipo_anomalia}
                      </p>

                      <p className="text-xs text-slate-300 leading-relaxed mb-3">
                        {alerta.diagnostico_llm}
                      </p>

                      <div className="flex items-center justify-between border-t border-slate-800 pt-2">
                        <span className="text-[11px] text-slate-500">
                          Estado: <strong className="text-slate-300">{alerta.estado}</strong>
                        </span>
                        {alerta.estado !== "RESUELTA" && (
                          <div className="flex items-center gap-2">
                            {alerta.estado === "PENDIENTE" && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  actualizarEstadoAlerta(alerta.id, "EN_REVISION");
                                }}
                                className="text-xs text-amber-400 hover:text-amber-300 hover:underline transition"
                              >
                                En revisión
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                actualizarEstadoAlerta(alerta.id, "RESUELTA");
                              }}
                              className="text-xs flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Marcar resuelta
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
          <GraficosLote series={seriesLote} cargando={cargandoSeries} />
        </>
      )}
    </main>
  );
}