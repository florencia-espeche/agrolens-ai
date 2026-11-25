"use client";

import { useState } from "react";
import { Sparkles, Send } from "lucide-react";
import type { RecorridaCampo } from "@/components/RecorridaModal";

export interface DatoCombinadoLote {
  fecha: string;
  ndvi: number | null;
  ndwi: number | null;
  precipitacion_mm: number | null;
  temp_max_c: number | null;
  temp_min_c: number | null;
}

interface Mensaje {
  rol: "user" | "assistant";
  texto: string;
}

interface ChatLoteProps {
  loteNombre: string;
  datosLote: DatoCombinadoLote[];
  recorridas?: RecorridaCampo[];
}

const SUGERENCIAS = [
  "¿Cuál fue la semana con peor caída de NDVI y cuánto llovió?",
  "¿Hay señales de estrés hídrico en los últimos 30 días?",
  "Dame un resumen ejecutivo del estado actual del lote",
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export default function ChatLote({
  loteNombre,
  datosLote,
  recorridas = [],
}: ChatLoteProps) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [input, setInput] = useState("");
  const [cargando, setCargando] = useState(false);

  const enviarPregunta = async (textoPregunta: string) => {
    const pregunta = textoPregunta.trim();
    if (!pregunta || cargando || datosLote.length === 0) return;

    setMensajes((prev) => [...prev, { rol: "user", texto: pregunta }]);
    setInput("");
    setCargando(true);

    try {
      const res = await fetch(`${API_URL}/api/chat-lote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lote_nombre: loteNombre,
          pregunta,
          datos: datosLote.slice(-60),
          recorridas: recorridas.slice(0, 10),
        }),
      });

      if (!res.ok) throw new Error();
      const data = await res.json();

      setMensajes((prev) => [
        ...prev,
        { rol: "assistant", texto: data.respuesta },
      ]);
    } catch {
      setMensajes((prev) => [
        ...prev,
        {
          rol: "assistant",
          texto: "No pude consultar al asistente en este momento. Intenta nuevamente.",
        },
      ]);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <span>
            Asistente IA · <span className="text-emerald-400">{loteNombre}</span>
          </span>
        </h3>
        <span className="text-[11px] text-slate-400">Contexto: últimos 60 días</span>
      </div>

      {/* Chips de preguntas rápidas (se muestran si el chat está vacío) */}
      {mensajes.length === 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {SUGERENCIAS.map((sug) => (
            <button
              key={sug}
              onClick={() => enviarPregunta(sug)}
              disabled={datosLote.length === 0}
              className="rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-left text-xs text-slate-300 transition hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-50"
            >
              {sug}
            </button>
          ))}
        </div>
      )}

      {/* Historial de mensajes */}
      {mensajes.length > 0 && (
        <div className="mb-3 max-h-60 space-y-2.5 overflow-y-auto pr-1 text-xs">
          {mensajes.map((m, idx) => (
            <div
              key={idx}
              className={`rounded-lg px-3 py-2 leading-relaxed ${
                m.rol === "user"
                  ? "ml-8 bg-emerald-500/15 text-emerald-100 border border-emerald-500/20"
                  : "mr-8 bg-slate-800/90 text-slate-200 whitespace-pre-line border border-slate-700/60"
              }`}
            >
              {m.texto}
            </div>
          ))}
          {cargando && (
            <div className="mr-8 animate-pulse rounded-lg bg-slate-800/60 px-3 py-2 text-slate-400 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping"></span>
              <span>Analizando datos satelitales y climáticos con Gemini...</span>
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviarPregunta(input);
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pregunta sobre NDVI, lluvias o anomalías..."
          disabled={cargando || datosLote.length === 0}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={cargando || !input.trim() || datosLote.length === 0}
          className="shrink-0 flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 active:scale-95 disabled:opacity-40"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Enviar</span>
        </button>
      </form>
    </div>
  );
}
