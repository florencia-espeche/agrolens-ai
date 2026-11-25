"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  X,
  Upload,
  PenTool,
  MapPin,
  Sprout,
  Undo2,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Crosshair,
  LocateFixed,
} from "lucide-react";
import {
  parsearArchivoPoligonos,
  normalizarAnillo,
  calcularHectareasAprox,
  parsearParLatLon,
  generarPoligonoDesdeCentro,
  parsearCoordenadasTexto,
  type GeoJsonPolygon,
  type PoligonoImportado,
} from "@/lib/geoImport";
import type { CentroMapaObjetivo } from "@/components/MapaDibujoLote";

const MapaDibujoLote = dynamic(() => import("@/components/MapaDibujoLote"), {
  ssr: false,
  loading: () => (
    <div className="h-[240px] w-full rounded-xl border border-slate-700 bg-slate-950 flex items-center justify-center text-xs text-slate-400">
      Cargando mapa interactivo...
    </div>
  ),
});

export interface ClienteDisponible {
  id: number;
  nombre_razon_social: string;
  email_contacto?: string | null;
  zona_productiva?: string | null;
}

export interface LoteEditable {
  id: number;
  cliente_id?: number | null;
  nombre_lote: string;
  cultivo_actual: string;
  campana: string;
  fecha_siembra?: string | null;
  hectareas?: number | null;
  cliente?: string | null;
}

export interface ResultadoAltaLote {
  id: number;
  nombre_lote: string;
  cliente?: string;
  hectareas: number;
  clima_dias_ingestados: number;
  satelite_workflow_disparado: boolean;
}

interface GestionLotesModalProps {
  abierto: boolean;
  loteEditar: LoteEditable | null;
  clientes: ClienteDisponible[];
  apiUrl: string;
  onCerrar: () => void;
  onLoteCreado: (res: ResultadoAltaLote) => Promise<void> | void;
  onLoteActualizado: () => Promise<void> | void;
  onLoteEliminado: (loteId: number, nombre: string) => Promise<void> | void;
}

const CULTIVOS_SUGERIDOS = [
  "Soja 1ra",
  "Maíz Temprano",
  "Maíz Tardío",
  "Trigo / Soja 2da",
  "Trigo",
  "Girasol",
];

export default function GestionLotesModal({
  abierto,
  loteEditar,
  clientes,
  apiUrl,
  onCerrar,
  onLoteCreado,
  onLoteActualizado,
  onLoteEliminado,
}: GestionLotesModalProps) {
  const esEdicion = loteEditar !== null;

  const cultivoInicial = loteEditar?.cultivo_actual || "Soja 1ra";
  const cultivoEnLista = CULTIVOS_SUGERIDOS.includes(cultivoInicial);

  const [modoGeometria, setModoGeometria] = useState<"archivo" | "dibujo" | "coordenadas">("dibujo");
  const [poligonosArchivo, setPoligonosArchivo] = useState<PoligonoImportado[]>([]);
  const [indicePoligono, setIndicePoligono] = useState(0);
  const [puntosDibujo, setPuntosDibujo] = useState<[number, number][]>([]);
  const [irACoordsInput, setIrACoordsInput] = useState("");
  const [centroObjetivo, setCentroObjetivo] = useState<CentroMapaObjetivo | null>(null);

  const [subModoCoords, setSubModoCoords] = useState<"centro" | "vertices">("centro");
  const [centroLatInput, setCentroLatInput] = useState("");
  const [centroLonInput, setCentroLonInput] = useState("");
  const [centroHectareasInput, setCentroHectareasInput] = useState("50");
  const [ordenCoords, setOrdenCoords] = useState<"lat_lon" | "lon_lat">("lat_lon");
  const [verticesTexto, setVerticesTexto] = useState("");

  const clienteInicialId = (() => {
    if (!loteEditar) return "";
    if (loteEditar.cliente_id != null) return String(loteEditar.cliente_id);
    const match = clientes.find((c) => c.nombre_razon_social === loteEditar.cliente);
    return match ? String(match.id) : "";
  })();

  const [usarNuevoCliente, setUsarNuevoCliente] = useState(clientes.length === 0);
  const [clienteId, setClienteId] = useState<string>(clienteInicialId);
  const [nuevoClienteNombre, setNuevoClienteNombre] = useState("");
  const [nuevoClienteZona, setNuevoClienteZona] = useState("");
  const [nuevoClienteEmail, setNuevoClienteEmail] = useState("");

  const [nombreLote, setNombreLote] = useState(loteEditar?.nombre_lote || "");
  const [cultivoSelect, setCultivoSelect] = useState(
    cultivoEnLista ? cultivoInicial : "Otro"
  );
  const [cultivoOtro, setCultivoOtro] = useState(
    cultivoEnLista ? "" : cultivoInicial
  );
  const [campana, setCampana] = useState(loteEditar?.campana || "2026/2027");
  const [fechaSiembra, setFechaSiembra] = useState(loteEditar?.fecha_siembra || "");

  const [error, setError] = useState<string | null>(null);
  const [leyendoArchivo, setLeyendoArchivo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);

  const { geom: geometriaActiva, coordError } = useMemo<{
    geom: GeoJsonPolygon | null;
    coordError: string | null;
  }>(() => {
    if (modoGeometria === "archivo") {
      return {
        geom: poligonosArchivo[indicePoligono]?.geometry || null,
        coordError: null,
      };
    }

    if (modoGeometria === "coordenadas") {
      if (subModoCoords === "centro") {
        if (!centroLatInput.trim() || !centroLonInput.trim()) {
          return { geom: null, coordError: null };
        }
        try {
          const geom = generarPoligonoDesdeCentro(
            Number(centroLatInput),
            Number(centroLonInput),
            Number(centroHectareasInput)
          );
          return { geom, coordError: null };
        } catch (err) {
          return {
            geom: null,
            coordError: err instanceof Error ? err.message : "Coordenadas inválidas.",
          };
        }
      }

      if (!verticesTexto.trim()) {
        return { geom: null, coordError: null };
      }
      try {
        const geom = parsearCoordenadasTexto(verticesTexto, ordenCoords);
        return { geom, coordError: null };
      } catch (err) {
        return {
          geom: null,
          coordError: err instanceof Error ? err.message : "Formato de vértices inválido.",
        };
      }
    }

    if (puntosDibujo.length < 3) return { geom: null, coordError: null };
    try {
      const anillo = normalizarAnillo(
        puntosDibujo.map(([lat, lon]) => [lon, lat])
      );
      return { geom: { type: "Polygon", coordinates: [anillo] }, coordError: null };
    } catch {
      return { geom: null, coordError: null };
    }
  }, [
    modoGeometria,
    poligonosArchivo,
    indicePoligono,
    subModoCoords,
    centroLatInput,
    centroLonInput,
    centroHectareasInput,
    verticesTexto,
    ordenCoords,
    puntosDibujo,
  ]);

  const hectareasPreview = useMemo(() => {
    if (!geometriaActiva) return 0;
    return calcularHectareasAprox(geometriaActiva.coordinates);
  }, [geometriaActiva]);

  const handleUbicarMapaDesdeBarra = () => {
    const par = parsearParLatLon(irACoordsInput);
    if (!par) {
      setError(
        "No se reconocieron coordenadas válidas. Usa Lat, Lon (ej: -32.7205, -62.1295), formato DMS o pega un link de Google Maps."
      );
      return;
    }
    setError(null);
    setCentroObjetivo((prev) => ({
      lat: par[0],
      lon: par[1],
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  };

  const handleCentroLatChange = (val: string) => {
    const par = parsearParLatLon(val);
    if (par && /[\s,;]+/.test(val.trim())) {
      setCentroLatInput(String(par[0]));
      setCentroLonInput(String(par[1]));
      setCentroObjetivo((prev) => ({
        lat: par[0],
        lon: par[1],
        nonce: (prev?.nonce ?? 0) + 1,
      }));
      return;
    }
    setCentroLatInput(val);
  };

  const pasarPoligonoADibujo = () => {
    if (!geometriaActiva) return;
    const anillo = geometriaActiva.coordinates[0];
    const verticesSinCierre: [number, number][] = anillo
      .slice(0, Math.max(3, anillo.length - 1))
      .map(([lon, lat]) => [lat, lon]);
    setPuntosDibujo(verticesSinCierre);
    const lats = verticesSinCierre.map((p) => p[0]);
    const lons = verticesSinCierre.map((p) => p[1]);
    setCentroObjetivo((prev) => ({
      lat: lats.reduce((a, b) => a + b, 0) / lats.length,
      lon: lons.reduce((a, b) => a + b, 0) / lons.length,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
    setModoGeometria("dibujo");
  };

  if (!abierto) return null;

  const cultivoFinal =
    cultivoSelect === "Otro" ? cultivoOtro.trim() : cultivoSelect;

  const handleArchivoSeleccionado = async (file: File | undefined) => {
    if (!file) return;
    setLeyendoArchivo(true);
    setError(null);
    try {
      const pols = await parsearArchivoPoligonos(file, apiUrl);
      setPoligonosArchivo(pols);
      setIndicePoligono(0);
      if (pols[0] && !nombreLote.trim()) {
        setNombreLote(pols[0].nombre_sugerido);
      }
    } catch (err) {
      setPoligonosArchivo([]);
      setError(err instanceof Error ? err.message : "No se pudo leer el archivo.");
    } finally {
      setLeyendoArchivo(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!nombreLote.trim()) {
      setError("Indica el nombre del lote.");
      return;
    }
    if (usarNuevoCliente && !nuevoClienteNombre.trim()) {
      setError("Indica el dueño o razón social del nuevo establecimiento.");
      return;
    }
    if (!usarNuevoCliente && !clienteId) {
      setError("Selecciona quién es el dueño/establecimiento del lote o crea uno nuevo.");
      return;
    }
    if (!cultivoFinal) {
      setError("Indica el cultivo actual.");
      return;
    }

    const payloadCliente = {
      cliente_id: usarNuevoCliente ? null : Number(clienteId),
      nuevo_cliente: usarNuevoCliente
        ? {
            nombre_razon_social: nuevoClienteNombre.trim(),
            zona_productiva: nuevoClienteZona.trim() || null,
            email_contacto: nuevoClienteEmail.trim() || null,
          }
        : null,
    };

    if (esEdicion && loteEditar) {
      setGuardando(true);
      try {
        const res = await fetch(`${apiUrl}/api/lotes/${loteEditar.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre_lote: nombreLote.trim(),
            cultivo_actual: cultivoFinal,
            campana: campana.trim() || "2026/2027",
            fecha_siembra: fechaSiembra,
            ...payloadCliente,
          }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { detail?: string };
          throw new Error(payload.detail || "No se pudo actualizar el lote.");
        }
        await onLoteActualizado();
        onCerrar();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error actualizando lote.");
      } finally {
        setGuardando(false);
      }
      return;
    }

    if (!geometriaActiva) {
      setError(
        coordError ||
          (modoGeometria === "archivo"
            ? "Sube un archivo KML, KMZ o GeoJSON válido."
            : modoGeometria === "coordenadas"
            ? "Ingresa coordenadas válidas para definir el polígono del lote."
            : "Marca al menos 3 puntos en el mapa para definir el polígono del lote.")
      );
      return;
    }

    setGuardando(true);
    try {
      const payload = {
        nombre_lote: nombreLote.trim(),
        cultivo_actual: cultivoFinal,
        campana: campana.trim() || "2026/2027",
        fecha_siembra: fechaSiembra || null,
        ...payloadCliente,
        geometry: geometriaActiva,
      };

      const res = await fetch(`${apiUrl}/api/lotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ResultadoAltaLote> & {
        detail?: string;
      };
      if (!res.ok || data.id == null) {
        throw new Error(data.detail || "No se pudo crear el lote.");
      }

      await onLoteCreado({
        id: data.id,
        nombre_lote: data.nombre_lote || nombreLote.trim(),
        cliente:
          data.cliente ||
          (usarNuevoCliente
            ? nuevoClienteNombre.trim()
            : clientes.find((c) => String(c.id) === clienteId)?.nombre_razon_social),
        hectareas: Number(data.hectareas ?? hectareasPreview),
        clima_dias_ingestados: Number(data.clima_dias_ingestados ?? 0),
        satelite_workflow_disparado: Boolean(data.satelite_workflow_disparado),
      });
      onCerrar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creando lote.");
    } finally {
      setGuardando(false);
    }
  };

  const handleEliminar = async () => {
    if (!loteEditar) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/lotes/${loteEditar.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(payload.detail || "No se pudo eliminar el lote.");
      }
      await onLoteEliminado(loteEditar.id, loteEditar.nombre_lote);
      onCerrar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error eliminando lote.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={esEdicion ? "Editar lote" : "Nuevo lote o importación"}
      className="fixed inset-0 z-[1050] flex items-center justify-center bg-slate-950/80 p-3 sm:p-5 backdrop-blur-sm overflow-y-auto"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl overflow-hidden my-auto">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
            <Sprout className="w-4 h-4 shrink-0" />
            <span>
              {esEdicion
                ? `Editar lote — ${loteEditar?.nombre_lote}`
                : "Alta de Lote / Importar Polígono (KML, KMZ, GeoJSON)"}
            </span>
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

        <form
          onSubmit={handleSubmit}
          className="p-4 sm:p-6 space-y-4 max-h-[82vh] overflow-y-auto text-xs"
        >
          {/* Dueño / Establecimiento visible arriba en alta y edición */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-medium text-slate-200 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                Dueño / Establecimiento del lote *
              </span>
              {clientes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setUsarNuevoCliente((v) => !v)}
                  className="text-[11px] font-medium text-emerald-400 hover:underline"
                >
                  {usarNuevoCliente
                    ? "Elegir establecimiento existente"
                    : "+ Crear nuevo dueño / establecimiento"}
                </button>
              )}
            </div>

            {!usarNuevoCliente && clientes.length > 0 ? (
              <select
                value={clienteId}
                onChange={(e) => setClienteId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value="">— Selecciona un dueño / establecimiento —</option>
                {clientes.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.nombre_razon_social}
                    {c.zona_productiva ? ` (${c.zona_productiva})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={nuevoClienteNombre}
                  onChange={(e) => setNuevoClienteNombre(e.target.value)}
                  placeholder="Dueño / Razón social *"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={nuevoClienteZona}
                  onChange={(e) => setNuevoClienteZona(e.target.value)}
                  placeholder="Zona (ej: Pergamino)"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
                <input
                  type="email"
                  value={nuevoClienteEmail}
                  onChange={(e) => setNuevoClienteEmail(e.target.value)}
                  placeholder="Email (opcional)"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          {!esEdicion && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex flex-wrap rounded-lg border border-slate-700 bg-slate-950 p-0.5 gap-0.5">
                  <button
                    type="button"
                    onClick={() => setModoGeometria("dibujo")}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition ${
                      modoGeometria === "dibujo"
                        ? "bg-emerald-500 text-slate-950 font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <PenTool className="w-3.5 h-3.5" />
                    <span>Ubicar y dibujar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setModoGeometria("archivo")}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition ${
                      modoGeometria === "archivo"
                        ? "bg-emerald-500 text-slate-950 font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>KML / GeoJSON</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setModoGeometria("coordenadas")}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition ${
                      modoGeometria === "coordenadas"
                        ? "bg-emerald-500 text-slate-950 font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    <span>Vértices / Centro</span>
                  </button>
                </div>

                {hectareasPreview > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Superficie estimada: {hectareasPreview.toLocaleString("es-AR")} ha
                  </span>
                )}
              </div>

              {modoGeometria === "archivo" && (
                <div className="space-y-2.5">
                  <label className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-700 bg-slate-950/60 px-4 py-4 cursor-pointer hover:border-emerald-500/60 transition">
                    <Upload className="w-5 h-5 text-emerald-400" />
                    <span className="text-slate-200 font-medium">
                      {leyendoArchivo
                        ? "Leyendo geometría..."
                        : "Haz clic para elegir un archivo .kml, .kmz o .geojson"}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Compatible con Google Earth, QGIS y monitores de siembra/cosecha
                    </span>
                    <input
                      type="file"
                      accept=".kml,.kmz,.geojson,.json"
                      className="hidden"
                      onChange={(e) => handleArchivoSeleccionado(e.target.files?.[0])}
                    />
                  </label>

                  {poligonosArchivo.length > 1 && (
                    <div className="space-y-1">
                      <span className="text-[11px] text-slate-400 block">
                        Se detectaron {poligonosArchivo.length} lotes en el archivo. Elige el que vas a cargar:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {poligonosArchivo.map((pol, idx) => (
                          <button
                            key={`${pol.nombre_sugerido}-${idx}`}
                            type="button"
                            onClick={() => {
                              setIndicePoligono(idx);
                              setNombreLote(pol.nombre_sugerido);
                            }}
                            className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${
                              indicePoligono === idx
                                ? "border-emerald-500 bg-emerald-500/20 text-emerald-300 font-semibold"
                                : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500"
                            }`}
                          >
                            {pol.nombre_sugerido} ({pol.hectareas_aprox} ha)
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {modoGeometria === "coordenadas" && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setSubModoCoords("centro")}
                        className={`rounded-md px-2.5 py-1 font-medium transition ${
                          subModoCoords === "centro"
                            ? "bg-sky-500 text-slate-950 font-semibold"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        Punto central + hectáreas
                      </button>
                      <button
                        type="button"
                        onClick={() => setSubModoCoords("vertices")}
                        className={`rounded-md px-2.5 py-1 font-medium transition ${
                          subModoCoords === "vertices"
                            ? "bg-sky-500 text-slate-950 font-semibold"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        Vértices del polígono
                      </button>
                    </div>

                    {geometriaActiva && (
                      <button
                        type="button"
                        onClick={pasarPoligonoADibujo}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20 transition"
                      >
                        <PenTool className="w-3 h-3" />
                        <span>Ajustar esquinas en el mapa</span>
                      </button>
                    )}
                  </div>

                  {subModoCoords === "centro" ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <label className="block">
                          <span className="text-[11px] text-slate-300 block mb-1">
                            Latitud (o pega Lat, Lon)
                          </span>
                          <input
                            type="text"
                            value={centroLatInput}
                            onChange={(e) => handleCentroLatChange(e.target.value)}
                            placeholder="-32.7205"
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[11px] text-slate-300 block mb-1">
                            Longitud
                          </span>
                          <input
                            type="text"
                            value={centroLonInput}
                            onChange={(e) => setCentroLonInput(e.target.value)}
                            placeholder="-62.1295"
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[11px] text-slate-300 block mb-1">
                            Superficie aprox. (ha)
                          </span>
                          <input
                            type="number"
                            min={1}
                            max={50000}
                            step="1"
                            value={centroHectareasInput}
                            onChange={(e) => setCentroHectareasInput(e.target.value)}
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                          />
                        </label>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Pega directamente un punto copiado de Google Maps (ej. <code className="text-slate-300">-32.7205, -62.1295</code>) en Latitud y generamos el cuadro inicial en el mapa satelital.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <span className="text-slate-400">Orden:</span>
                          <button
                            type="button"
                            onClick={() => setOrdenCoords("lat_lon")}
                            className={`rounded border px-2 py-0.5 transition ${
                              ordenCoords === "lat_lon"
                                ? "border-emerald-500 bg-emerald-500/15 text-emerald-300 font-medium"
                                : "border-slate-700 bg-slate-900 text-slate-400"
                            }`}
                          >
                            Lat, Lon (Google Maps)
                          </button>
                          <button
                            type="button"
                            onClick={() => setOrdenCoords("lon_lat")}
                            className={`rounded border px-2 py-0.5 transition ${
                              ordenCoords === "lon_lat"
                                ? "border-emerald-500 bg-emerald-500/15 text-emerald-300 font-medium"
                                : "border-slate-700 bg-slate-900 text-slate-400"
                            }`}
                          >
                            Lon, Lat (WKT / GeoJSON)
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setOrdenCoords("lat_lon");
                            setVerticesTexto(
                              "-32.7250, -62.1350\n-32.7250, -62.1240\n-32.7160, -62.1240\n-32.7160, -62.1350"
                            );
                          }}
                          className="text-[11px] text-sky-300 hover:underline"
                        >
                          Cargar ejemplo
                        </button>
                      </div>

                      <textarea
                        rows={3}
                        value={verticesTexto}
                        onChange={(e) => setVerticesTexto(e.target.value)}
                        placeholder={
                          ordenCoords === "lat_lon"
                            ? "Un vértice por línea, ej:\n-32.7250, -62.1350\n-32.7250, -62.1240\n-32.7160, -62.1240\n-32.7160, -62.1350"
                            : "Un vértice por línea (lon, lat) o WKT POLYGON((-62.135 -32.725, ...))"
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-[11px] text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  )}

                  {coordError && (
                    <p className="text-[11px] text-amber-300">{coordError}</p>
                  )}
                </div>
              )}

              {modoGeometria === "dibujo" && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-sky-300 flex items-center gap-1.5">
                      <LocateFixed className="w-3.5 h-3.5 shrink-0" />
                      <span>1. Ubica el lote por coordenadas o link de Google Maps</span>
                    </span>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPuntosDibujo((prev) => prev.slice(0, -1))}
                        disabled={puntosDibujo.length === 0}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        <span>Deshacer punto</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPuntosDibujo([])}
                        disabled={puntosDibujo.length === 0}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                      >
                        Limpiar
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                    <input
                      type="text"
                      value={irACoordsInput}
                      onChange={(e) => setIrACoordsInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleUbicarMapaDesdeBarra();
                        }
                      }}
                      placeholder="Pegar Lat, Lon, DMS o link Google Maps (ej: -32.7205, -62.1295)"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleUbicarMapaDesdeBarra}
                      className="inline-flex items-center gap-1.5 shrink-0 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition"
                    >
                      <LocateFixed className="w-3.5 h-3.5" />
                      <span>Ubicar en mapa</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span>
                      2. Haz clic en las esquinas del potrero sobre el satélite para marcar el contorno.
                    </span>
                    {centroObjetivo && (
                      <span className="font-mono text-amber-300">
                        Pin guía: {centroObjetivo.lat.toFixed(4)}, {centroObjetivo.lon.toFixed(4)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <MapaDibujoLote
                modoDibujo={modoGeometria === "dibujo"}
                puntosDibujo={puntosDibujo}
                onAgregarPunto={(lat, lon) =>
                  setPuntosDibujo((prev) => [...prev, [lat, lon]])
                }
                onActualizarPunto={(idx, lat, lon) =>
                  setPuntosDibujo((prev) =>
                    prev.map((pt, i) => (i === idx ? [lat, lon] : pt))
                  )
                }
                poligonoPreview={modoGeometria !== "dibujo" ? geometriaActiva : null}
                centroObjetivo={centroObjetivo}
              />
            </div>
          )}

          {/* Metadatos del Lote */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-slate-300 font-medium block mb-1">
                Nombre del lote *
              </span>
              <input
                type="text"
                value={nombreLote}
                onChange={(e) => setNombreLote(e.target.value)}
                placeholder="Ej: Lote 05 - La Cañada"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="text-slate-300 font-medium block mb-1">Campaña</span>
              <input
                type="text"
                value={campana}
                onChange={(e) => setCampana(e.target.value)}
                placeholder="2026/2027"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="text-slate-300 font-medium block mb-1">
                Cultivo actual *
              </span>
              <select
                value={cultivoSelect}
                onChange={(e) => setCultivoSelect(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                {CULTIVOS_SUGERIDOS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="Otro">Otro cultivo...</option>
              </select>
              {cultivoSelect === "Otro" && (
                <input
                  type="text"
                  value={cultivoOtro}
                  onChange={(e) => setCultivoOtro(e.target.value)}
                  placeholder="Especificar cultivo (ej: Cebada)"
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              )}
            </label>

            <label className="block">
              <span className="text-slate-300 font-medium block mb-1">
                Fecha de siembra (opcional)
              </span>
              <input
                type="date"
                value={fechaSiembra}
                onChange={(e) => setFechaSiembra(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </label>
          </div>

          {!esEdicion && (
            <p className="text-[11px] text-slate-400">
              Al guardar, AgroLens AI calcula las hectáreas reales en PostGIS, carga automáticamente 60 días de clima histórico (NASA POWER) y programa las imágenes Sentinel-2.
            </p>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
            {esEdicion ? (
              <div>
                {!confirmarEliminar ? (
                  <button
                    type="button"
                    disabled={guardando}
                    onClick={() => setConfirmarEliminar(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Eliminar lote</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={guardando}
                      onClick={handleEliminar}
                      className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-400 transition disabled:opacity-50"
                    >
                      Confirmar eliminación
                    </button>
                    <button
                      type="button"
                      disabled={guardando}
                      onClick={() => setConfirmarEliminar(false)}
                      className="text-xs text-slate-400 hover:text-slate-200"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={guardando}
                onClick={onCerrar}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition"
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
                  : esEdicion
                  ? "Guardar cambios"
                  : "Guardar lote e ingestar clima"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
