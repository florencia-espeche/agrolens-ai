"use client";

import { useState } from "react";
import { X, ClipboardCheck, AlertCircle } from "lucide-react";

export interface RecorridaCampo {
  id: number;
  lote_id: number;
  nombre_lote?: string;
  alerta_id?: number | null;
  alerta_tipo?: string | null;
  fecha_recorrida: string;
  autor?: string | null;
  hallazgo: string;
  labor_recomendada?: string | null;
  costo_labor_usd_ha: number;
}

export interface ContextoRecorrida {
  loteId: number;
  nombreLote: string;
  alertaId?: number;
  alertaTipo?: string;
  nuevoEstadoAlerta?: "EN_REVISION" | "RESUELTA";
}

interface RecorridaModalProps {
  contexto: ContextoRecorrida | null;
  apiUrl: string;
  onCerrar: () => void;
  onGuardado: () => Promise<void> | void;
  onSoloCambiarEstado?: (alertaId: number, estado: "EN_REVISION" | "RESUELTA") => Promise<void> | void;
}

const AUTOR_STORAGE_KEY = "agrolens:autor-recorrida";

const SUGERENCIAS_HALLAZGO = [
  "Estrés hídrico confirmado en cabecera/loma",
  "Foco de malezas o manchoneo puntual",
  "Daño por insecto / enfermedad foliar",
  "Cultivo estable, recuperación tras lluvias",
];

function leerUltimoAutor(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(AUTOR_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export default function RecorridaModal({
  contexto,
  apiUrl,
  onCerrar,
  onGuardado,
  onSoloCambiarEstado,
}: RecorridaModalProps) {
  const [fecha, setFecha] = useState(() => new Date().toISOString().split("T")[0]);
  const [autor, setAutor] = useState(leerUltimoAutor);
  const [hallazgo, setHallazgo] = useState("");
  const [labor, setLabor] = useState("");
  const [costoUsdHa, setCostoUsdHa] = useState("0");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!contexto) return null;

  const tituloEstado =
    contexto.nuevoEstadoAlerta === "RESUELTA"
      ? "Resolver alerta con nota de recorrida"
      : contexto.nuevoEstadoAlerta === "EN_REVISION"
      ? "Pasar alerta a revisión y registrar nota"
      : "Registrar recorrida a campo";

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hallazgo.trim()) {
      setError("Describe brevemente qué se encontró en el lote.");
      return;
    }

    setGuardando(true);
    setError(null);
    try {
      if (autor.trim()) {
        try {
          window.localStorage.setItem(AUTOR_STORAGE_KEY, autor.trim());
        } catch {
          // Ignora storage privado
        }
      }

      const res = await fetch(`${apiUrl}/api/recorridas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lote_id: contexto.loteId,
          alerta_id: contexto.alertaId ?? null,
          fecha_recorrida: fecha || undefined,
          autor: autor.trim() || null,
          hallazgo: hallazgo.trim(),
          labor_recomendada: labor.trim() || null,
          costo_labor_usd_ha: Math.max(0, Number(costoUsdHa) || 0),
          nuevo_estado_alerta: contexto.nuevoEstadoAlerta ?? null,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(payload.detail || "No se pudo guardar la recorrida.");
      }

      await onGuardado();
      onCerrar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar la recorrida.");
    } finally {
      setGuardando(false);
    }
  };

  const handleSoloEstado = async () => {
    if (!contexto.alertaId || !contexto.nuevoEstadoAlerta || !onSoloCambiarEstado) return;
    setGuardando(true);
    setError(null);
    try {
      await onSoloCambiarEstado(contexto.alertaId, contexto.nuevoEstadoAlerta);
      onCerrar();
    } catch {
      setError("No se pudo actualizar el estado de la alerta.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bitácora de recorrida a campo"
      className="fixed inset-0 z-[1050] flex items-center justify-center bg-slate-950/80 p-3 sm:p-5 backdrop-blur-sm overflow-y-auto"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl overflow-hidden my-auto">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
            <ClipboardCheck className="w-4 h-4 shrink-0" />
            <span>{tituloEstado}</span>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleGuardar} className="p-4 sm:p-5 space-y-3.5 text-xs">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
            <div className="font-semibold text-slate-200">{contexto.nombreLote}</div>
            {contexto.alertaTipo && (
              <div className="text-[11px] text-amber-300 mt-0.5">
                Alerta vinculada: {contexto.alertaTipo}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-slate-300 font-medium block mb-1">Fecha recorrida</span>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-slate-300 font-medium block mb-1">
                Agrónomo / Responsable
              </span>
              <input
                type="text"
                value={autor}
                onChange={(e) => setAutor(e.target.value)}
                placeholder="Ej: Ing. Juan Pérez"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </label>
          </div>

          <div>
            <span className="text-slate-300 font-medium block mb-1">
              ¿Qué se verificó a campo? *
            </span>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {SUGERENCIAS_HALLAZGO.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => setHallazgo(sug)}
                  className="rounded-md border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[10px] text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300 transition"
                >
                  {sug}
                </button>
              ))}
            </div>
            <textarea
              rows={3}
              value={hallazgo}
              onChange={(e) => setHallazgo(e.target.value)}
              placeholder="Ej: Manchoneo de gramíneas en cabecera sur (aprox. 8 ha); resto del lote parejo."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block sm:col-span-2">
              <span className="text-slate-300 font-medium block mb-1">
                Labor / Acción definida
              </span>
              <input
                type="text"
                value={labor}
                onChange={(e) => setLabor(e.target.value)}
                placeholder="Ej: Aplicar graminicida selectivo"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="text-slate-300 font-medium block mb-1">
                Costo extra (USD/ha)
              </span>
              <input
                type="number"
                min={0}
                step="0.5"
                value={costoUsdHa}
                onChange={(e) => setCostoUsdHa(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </label>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-800 pt-3">
            {contexto.alertaId && contexto.nuevoEstadoAlerta && onSoloCambiarEstado && (
              <button
                type="button"
                disabled={guardando}
                onClick={handleSoloEstado}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition disabled:opacity-50"
              >
                Cambiar estado sin nota
              </button>
            )}
            <button
              type="button"
              disabled={guardando}
              onClick={onCerrar}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 transition disabled:opacity-50"
            >
              {guardando
                ? "Guardando..."
                : contexto.nuevoEstadoAlerta === "RESUELTA"
                ? "Guardar y resolver alerta"
                : contexto.nuevoEstadoAlerta === "EN_REVISION"
                ? "Guardar y pasar a revisión"
                : "Guardar recorrida"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
