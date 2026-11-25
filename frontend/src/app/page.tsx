"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import type { FeatureCollection } from "geojson";
import {
  AlertTriangle,
  CheckCircle2,
  Sprout,
  MapPin,
  Send,
  Activity,
  DollarSign,
  Sparkles,
  Plus,
  ClipboardCheck,
  X,
} from "lucide-react";
import GraficosLote, { type SeriesLote } from "@/components/GraficosLote";
import ChatLote, { type DatoCombinadoLote } from "@/components/ChatLote";
import PronosticoLote, { type PronosticoLoteData } from "@/components/PronosticoLote";
import KpisGerenciales from "@/components/KpisGerenciales";
import ModuloEconomico from "@/components/ModuloEconomico";
import ResumenLoteActivo from "@/components/ResumenLoteActivo";
import MinutaGestionModal from "@/components/MinutaGestionModal";
import GestionLotesModal, {
  type ClienteDisponible,
  type LoteEditable,
  type ResultadoAltaLote,
} from "@/components/GestionLotesModal";
import RecorridaModal, {
  type ContextoRecorrida,
  type RecorridaCampo,
} from "@/components/RecorridaModal";
import {
  ESCENARIOS,
  SUPUESTOS_DEFAULT,
  calcularCarteraEconomica,
  type EscenarioId,
  type PresupuestoLote,
  type SupuestoCultivo,
} from "@/lib/economia";

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
  cliente?: string;
  zona_productiva: string;
  fecha_deteccion: string;
  fecha?: string;
  created_at?: string;
  nivel_severidad: string;
  tipo_anomalia: string;
  diagnostico_llm: string;
  mensaje?: string;
  diagnostico?: string;
  estado: string;
}

const STORAGE_ECONOMIA_KEY = "agrolens:economia:v1";

interface PreferenciasEconomicas {
  supuestos: Record<string, SupuestoCultivo>;
  esCampoAlquilado: boolean;
  arriendoQqSoja: number;
  escenario: EscenarioId;
}

function leerPreferenciasEconomicas(): PreferenciasEconomicas {
  const fallback: PreferenciasEconomicas = {
    supuestos: { ...SUPUESTOS_DEFAULT },
    esCampoAlquilado: false,
    arriendoQqSoja: 12,
    escenario: "base",
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_ECONOMIA_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PreferenciasEconomicas>;
    const escenarioValido =
      parsed.escenario && parsed.escenario in ESCENARIOS
        ? parsed.escenario
        : "base";
    return {
      supuestos:
        parsed.supuestos && typeof parsed.supuestos === "object"
          ? { ...SUPUESTOS_DEFAULT, ...parsed.supuestos }
          : fallback.supuestos,
      esCampoAlquilado: Boolean(parsed.esCampoAlquilado),
      arriendoQqSoja:
        typeof parsed.arriendoQqSoja === "number" && parsed.arriendoQqSoja >= 0
          ? parsed.arriendoQqSoja
          : fallback.arriendoQqSoja,
      escenario: escenarioValido,
    };
  } catch {
    return fallback;
  }
}

interface DiagnosticoEstructurado {
  quePaso?: string;
  causaProbable?: string;
  accionSugerida?: string;
  textoPlano?: string;
}

const parseDiagnostico = (texto: string): DiagnosticoEstructurado => {
  if (!texto) return { textoPlano: "" };

  const quePaso = texto.match(/QUE_PASO:\s*(.+)/i)?.[1]?.trim();
  const causaProbable = texto.match(/CAUSA_PROBABLE:\s*(.+)/i)?.[1]?.trim();
  const accionSugerida = texto.match(/ACCION_SUGERIDA:\s*(.+)/i)?.[1]?.trim();

  if (quePaso || causaProbable || accionSugerida) {
    return { quePaso, causaProbable, accionSugerida };
  }
  return { textoPlano: texto };
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export default function Home() {
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [filtroEstado, setFiltroEstado] = useState<string>("todas");
  const [filtroCliente, setFiltroCliente] = useState<string>("todos");
  const [filtroCampana, setFiltroCampana] = useState<string>("todas");
  const [loteSeleccionado, setLoteSeleccionado] = useState<number | null>(null);
  const [zoomLoteNonce, setZoomLoteNonce] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [isSlowLoad, setIsSlowLoad] = useState(false);
  const [seriesLote, setSeriesLote] = useState<SeriesLote | null>(null);
  const [cargandoSeries, setCargandoSeries] = useState(false);
  const [pronosticoLote, setPronosticoLote] = useState<PronosticoLoteData | null>(null);
  const [cargandoPronostico, setCargandoPronostico] = useState(false);
  const [tabDetalle, setTabDetalle] = useState<"campo" | "economia" | "asistente">("campo");
  const [actualizandoAlertaId, setActualizandoAlertaId] = useState<number | null>(null);
  const [errorAlerta, setErrorAlerta] = useState<string | null>(null);
  const [clientesLista, setClientesLista] = useState<ClienteDisponible[]>([]);
  const [recorridas, setRecorridas] = useState<RecorridaCampo[]>([]);
  const [presupuestosLote, setPresupuestosLote] = useState<Record<string, PresupuestoLote>>({});
  const [sincronizandoEconomia, setSincronizandoEconomia] = useState(false);
  const [errorSyncEconomia, setErrorSyncEconomia] = useState<string | null>(null);

  const [modalLoteAbierto, setModalLoteAbierto] = useState(false);
  const [loteParaEditar, setLoteParaEditar] = useState<LoteEditable | null>(null);
  const [modalLoteNonce, setModalLoteNonce] = useState(0);
  const [contextoRecorrida, setContextoRecorrida] = useState<ContextoRecorrida | null>(null);
  const [recorridaNonce, setRecorridaNonce] = useState(0);
  const [avisoOperativo, setAvisoOperativo] = useState<string | null>(null);
  const [ahoraMs, setAhoraMs] = useState<number | null>(null);

  // Estados compartidos del Módulo Económico y Minuta de Gestión (persistidos en BD + localStorage)
  const [supuestos, setSupuestos] = useState<Record<string, SupuestoCultivo>>(
    () => leerPreferenciasEconomicas().supuestos
  );
  const [esCampoAlquilado, setEsCampoAlquilado] = useState<boolean>(
    () => leerPreferenciasEconomicas().esCampoAlquilado
  );
  const [arriendoQqSoja, setArriendoQqSoja] = useState<number>(
    () => leerPreferenciasEconomicas().arriendoQqSoja
  );
  const [escenario, setEscenario] = useState<EscenarioId>(
    () => leerPreferenciasEconomicas().escenario
  );
  const [mostrarMinuta, setMostrarMinuta] = useState(false);
  const seccionDetalleRef = useRef<HTMLDivElement | null>(null);
  const mapaRef = useRef<HTMLElement | null>(null);
  const timerGuardadoEcoRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ambitoEconomico = `${filtroCliente}::${filtroCampana}`;

  const programarGuardadoEconomia = (
    nextPrefs: PreferenciasEconomicas,
    ambitoDestino: string
  ) => {
    if (timerGuardadoEcoRef.current) {
      clearTimeout(timerGuardadoEcoRef.current);
    }
    setSincronizandoEconomia(true);
    timerGuardadoEcoRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/economia/configuracion`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ambito: ambitoDestino,
            supuestos_cultivo: nextPrefs.supuestos,
            es_campo_alquilado: nextPrefs.esCampoAlquilado,
            arriendo_qq_soja: nextPrefs.arriendoQqSoja,
            escenario: nextPrefs.escenario,
          }),
        });
        if (!res.ok) throw new Error();
        setErrorSyncEconomia(null);
      } catch {
        setErrorSyncEconomia("No se pudo sincronizar con la base de datos.");
      } finally {
        setSincronizandoEconomia(false);
      }
    }, 450);
  };

  const handleChangeSupuestos = (
    updater:
      | Record<string, SupuestoCultivo>
      | ((prev: Record<string, SupuestoCultivo>) => Record<string, SupuestoCultivo>)
  ) => {
    const next = typeof updater === "function" ? updater(supuestos) : updater;
    setSupuestos(next);
    programarGuardadoEconomia(
      { supuestos: next, esCampoAlquilado, arriendoQqSoja, escenario },
      ambitoEconomico
    );
  };

  const handleChangeCampoAlquilado = (val: boolean) => {
    setEsCampoAlquilado(val);
    programarGuardadoEconomia(
      { supuestos, esCampoAlquilado: val, arriendoQqSoja, escenario },
      ambitoEconomico
    );
  };

  const handleChangeArriendoQqSoja = (val: number) => {
    setArriendoQqSoja(val);
    programarGuardadoEconomia(
      { supuestos, esCampoAlquilado, arriendoQqSoja: val, escenario },
      ambitoEconomico
    );
  };

  const handleChangeEscenario = (val: EscenarioId) => {
    setEscenario(val);
    programarGuardadoEconomia(
      { supuestos, esCampoAlquilado, arriendoQqSoja, escenario: val },
      ambitoEconomico
    );
  };

  useEffect(() => {
    try {
      const payload: PreferenciasEconomicas = {
        supuestos,
        esCampoAlquilado,
        arriendoQqSoja,
        escenario,
      };
      window.localStorage.setItem(STORAGE_ECONOMIA_KEY, JSON.stringify(payload));
    } catch {
      // Ignora fallos de almacenamiento privado o cuota excedida
    }
  }, [supuestos, esCampoAlquilado, arriendoQqSoja, escenario]);

  // Estados para la suscripción al Bot de Telegram
  const [chatId, setChatId] = useState("");
  const [estadoSub, setEstadoSub] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "AgroLensAIBot";

  const normalizarEstado = (estado?: string) => (estado || "pendiente").toLowerCase().trim();

  const clientesDisponibles = useMemo(() => {
    const set = new Set<string>();
    (geojson?.features || []).forEach((f) => {
      if (f.properties?.cliente) set.add(String(f.properties.cliente));
    });
    return Array.from(set).sort();
  }, [geojson]);

  const campanasDisponibles = useMemo(() => {
    const set = new Set<string>();
    (geojson?.features || []).forEach((f) => {
      if (f.properties?.campana) set.add(String(f.properties.campana));
    });
    return Array.from(set).sort().reverse();
  }, [geojson]);

  const geojsonFiltrado = useMemo<FeatureCollection | null>(() => {
    if (!geojson) return null;
    const features = geojson.features.filter((f) => {
      const matchCliente =
        filtroCliente === "todos" || f.properties?.cliente === filtroCliente;
      const matchCampana =
        filtroCampana === "todas" || f.properties?.campana === filtroCampana;
      return matchCliente && matchCampana;
    });
    return { ...geojson, features };
  }, [geojson, filtroCliente, filtroCampana]);

  const alertasContexto = useMemo(() => {
    if (!geojsonFiltrado) return alertas;
    if (filtroCliente === "todos" && filtroCampana === "todas") return alertas;
    const idsVisibles = new Set(
      geojsonFiltrado.features.map((f) => Number(f.properties?.id))
    );
    return alertas.filter((a) => idsVisibles.has(a.lote_id));
  }, [alertas, geojsonFiltrado, filtroCliente, filtroCampana]);

  const alertasFiltradas = useMemo(() => {
    if (filtroEstado === "todas") return alertasContexto;
    return alertasContexto.filter((a) => normalizarEstado(a.estado) === filtroEstado);
  }, [alertasContexto, filtroEstado]);

  // Lote activo derivado según filtros visibles (evita setState en useEffect)
  const loteActivoId = useMemo(() => {
    const features = geojsonFiltrado?.features || [];
    if (features.length === 0) return null;
    const sigueVisible = features.some(
      (f) => Number(f.properties?.id) === loteSeleccionado
    );
    return sigueVisible ? loteSeleccionado : Number(features[0].properties?.id);
  }, [geojsonFiltrado, loteSeleccionado]);

  // Recorridas visibles para cartera y para el lote seleccionado
  const recorridasContexto = useMemo(() => {
    if (!geojsonFiltrado) return recorridas;
    if (filtroCliente === "todos" && filtroCampana === "todas") return recorridas;
    const idsVisibles = new Set(
      geojsonFiltrado.features.map((f) => Number(f.properties?.id))
    );
    return recorridas.filter((r) => idsVisibles.has(r.lote_id));
  }, [recorridas, geojsonFiltrado, filtroCliente, filtroCampana]);

  const recorridasLoteActivo = useMemo(() => {
    if (!loteActivoId) return [];
    return recorridas.filter((r) => r.lote_id === loteActivoId);
  }, [recorridas, loteActivoId]);

  // Cartera económica compartida entre KPIs superiores, Módulo Económico y Minuta
  const carteraEconomica = useMemo(
    () =>
      calcularCarteraEconomica({
        geojsonFiltrado,
        alertasVisibles: alertasContexto,
        supuestos,
        esCampoAlquilado,
        arriendoQqSoja,
        escenario,
        presupuestosPorLote: presupuestosLote,
      }),
    [
      geojsonFiltrado,
      alertasContexto,
      supuestos,
      esCampoAlquilado,
      arriendoQqSoja,
      escenario,
      presupuestosLote,
    ]
  );

  const abrirEconomia = () => {
    setTabDetalle("economia");
    requestAnimationFrame(() => {
      seccionDetalleRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const verLoteEnMapa = (id: number) => {
    seleccionarLoteConZoom(id);
    requestAnimationFrame(() => {
      mapaRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  };

  // Combina series satelitales y climáticas para el contexto del Asistente IA
  const datosCombinadosLote = useMemo(() => {
    if (!seriesLote) return [];
    const mapa: Record<string, DatoCombinadoLote> = {};

    (seriesLote.clima || []).forEach((c) => {
      const f = c.fecha ? c.fecha.split("T")[0] : "";
      if (!f) return;
      mapa[f] = {
        fecha: f,
        ndvi: null,
        ndwi: null,
        precipitacion_mm: c.precipitacion_mm,
        temp_max_c: c.temp_max_c,
        temp_min_c: c.temp_min_c,
      };
    });

    (seriesLote.satelite || []).forEach((s) => {
      const f = s.fecha_imagen ? s.fecha_imagen.split("T")[0] : "";
      if (!f) return;
      if (!mapa[f]) {
        mapa[f] = {
          fecha: f,
          ndvi: s.ndvi_mediana,
          ndwi: s.ndwi_mediana,
          precipitacion_mm: null,
          temp_max_c: null,
          temp_min_c: null,
        };
      } else {
        mapa[f].ndvi = s.ndvi_mediana;
        mapa[f].ndwi = s.ndwi_mediana;
      }
    });

    return Object.values(mapa).sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [seriesLote]);

  const contadores = useMemo(() => {
    return {
      todas: alertasContexto.length,
      pendiente: alertasContexto.filter((a) => normalizarEstado(a.estado) === "pendiente").length,
      en_revision: alertasContexto.filter((a) => normalizarEstado(a.estado) === "en_revision").length,
      resuelta: alertasContexto.filter((a) => normalizarEstado(a.estado) === "resuelta").length,
    };
  }, [alertasContexto]);

  useEffect(() => {
    if (!cargando) return;
    const timer = setTimeout(() => setIsSlowLoad(true), 4000);
    return () => clearTimeout(timer);
  }, [cargando]);

  // Calcula la fecha más reciente disponible de las alertas o imágenes satelitales
  const ultimaFecha = useMemo(() => {
    const fechasAlertas = alertas
      .map((a) => a.fecha_deteccion || a.fecha || a.created_at)
      .filter((v): v is string => Boolean(v));

    const fechasLotes = (geojson?.features || [])
      .map((f) => {
        const raw = f.properties?.ultima_fecha_satelital;
        return typeof raw === "string" ? raw : "";
      })
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

  const recargarDatos = async () => {
    try {
      const [resLotes, resAlertas, resClientes, resRecorridas] = await Promise.all([
        fetch(`${API_URL}/api/lotes`),
        fetch(`${API_URL}/api/alertas`),
        fetch(`${API_URL}/api/clientes`),
        fetch(`${API_URL}/api/recorridas`),
      ]);
      const dataLotes = (await resLotes.json()) as FeatureCollection;
      const dataAlertas = (await resAlertas.json()) as Alerta[];
      setGeojson(dataLotes);
      setAlertas(dataAlertas);
      if (resClientes.ok) {
        setClientesLista((await resClientes.json()) as ClienteDisponible[]);
      }
      if (resRecorridas.ok) {
        setRecorridas((await resRecorridas.json()) as RecorridaCampo[]);
      }
    } catch (err) {
      console.error("Error recargando datos de FastAPI:", err);
    }
  };

  useEffect(() => {
    let cancelado = false;
    const inicializar = async () => {
      try {
        const [resLotes, resAlertas, resClientes, resRecorridas] = await Promise.all([
          fetch(`${API_URL}/api/lotes`),
          fetch(`${API_URL}/api/alertas`),
          fetch(`${API_URL}/api/clientes`),
          fetch(`${API_URL}/api/recorridas`),
        ]);
        const dataLotes = (await resLotes.json()) as FeatureCollection;
        const dataAlertas = (await resAlertas.json()) as Alerta[];
        if (cancelado) return;
        setGeojson(dataLotes);
        if (dataLotes.features?.length > 0) {
          const primerId = Number(dataLotes.features[0].properties?.id);
          setLoteSeleccionado((prev) => prev ?? primerId);
        }
        setAlertas(dataAlertas);
        if (resClientes.ok) {
          setClientesLista((await resClientes.json()) as ClienteDisponible[]);
        }
        if (resRecorridas.ok) {
          setRecorridas((await resRecorridas.json()) as RecorridaCampo[]);
        }
        setAhoraMs(Date.now());
      } catch (err) {
        console.error("Error conectando con FastAPI:", err);
      } finally {
        if (!cancelado) {
          setIsSlowLoad(false);
          setCargando(false);
        }
      }
    };
    void inicializar();
    return () => {
      cancelado = true;
    };
  }, []);

  // Carga configuración económica compartida desde PostgreSQL al cambiar establecimiento/campaña
  useEffect(() => {
    let cancelado = false;
    const cargarEconomiaBd = async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/economia/configuracion?ambito=${encodeURIComponent(ambitoEconomico)}`
        );
        if (!res.ok || cancelado) return;
        const data = (await res.json()) as {
          configuracion?: {
            supuestos_cultivo?: Record<string, SupuestoCultivo>;
            es_campo_alquilado?: boolean;
            arriendo_qq_soja?: number;
            escenario?: string;
          } | null;
          presupuestos_lote?: Record<string, PresupuestoLote>;
        };
        if (cancelado) return;
        if (data.presupuestos_lote) {
          setPresupuestosLote(data.presupuestos_lote);
        }
        const cfg = data.configuracion;
        if (cfg) {
          if (cfg.supuestos_cultivo && Object.keys(cfg.supuestos_cultivo).length > 0) {
            setSupuestos({ ...SUPUESTOS_DEFAULT, ...cfg.supuestos_cultivo });
          }
          if (typeof cfg.es_campo_alquilado === "boolean") {
            setEsCampoAlquilado(cfg.es_campo_alquilado);
          }
          if (typeof cfg.arriendo_qq_soja === "number") {
            setArriendoQqSoja(cfg.arriendo_qq_soja);
          }
          if (cfg.escenario && cfg.escenario in ESCENARIOS) {
            setEscenario(cfg.escenario as EscenarioId);
          }
        }
        setErrorSyncEconomia(null);
      } catch {
        // Mantiene fallback localStorage silenciosamente si no hay conexión
      }
    };
    void cargarEconomiaBd();
    return () => {
      cancelado = true;
    };
  }, [ambitoEconomico]);

  const handleSavePresupuestoLote = async (loteId: number, body: PresupuestoLote) => {
    setSincronizandoEconomia(true);
    try {
      const res = await fetch(`${API_URL}/api/economia/lotes/${loteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const saved = (await res.json()) as PresupuestoLote;
      setPresupuestosLote((prev) => ({ ...prev, [String(loteId)]: saved }));
      setErrorSyncEconomia(null);
    } catch {
      setErrorSyncEconomia("No se pudo guardar el presupuesto del lote en la BD.");
    } finally {
      setSincronizandoEconomia(false);
    }
  };

  useEffect(() => {
    if (!loteActivoId) return;
    const cargarSeriesYPronostico = async () => {
      setCargandoSeries(true);
      setCargandoPronostico(true);
      try {
        const [resSeries, resPronostico] = await Promise.allSettled([
          fetch(`${API_URL}/api/lotes/${loteActivoId}/series?dias=90`),
          fetch(`${API_URL}/api/lotes/${loteActivoId}/pronostico?dias=7`),
        ]);

        if (resSeries.status === "fulfilled" && resSeries.value.ok) {
          const data = await resSeries.value.json();
          setSeriesLote(data);
        }

        if (resPronostico.status === "fulfilled" && resPronostico.value.ok) {
          const dataPronostico = await resPronostico.value.json();
          setPronosticoLote(dataPronostico);
        } else {
          setPronosticoLote(null);
        }
      } catch (err) {
        console.error("Error cargando datos del lote:", err);
      } finally {
        setCargandoSeries(false);
        setCargandoPronostico(false);
      }
    };
    cargarSeriesYPronostico();
  }, [loteActivoId]);

  const seleccionarLoteConZoom = (id: number) => {
    setLoteSeleccionado(id);
    setZoomLoteNonce((n) => n + 1);
  };

  const actualizarEstadoAlerta = async (alertaId: number, nuevoEstado: string) => {
    setActualizandoAlertaId(alertaId);
    setErrorAlerta(null);
    try {
      const res = await fetch(`${API_URL}/api/alertas/${alertaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevoEstado }),
      });
      if (!res.ok) throw new Error();
      setAlertas((prev) =>
        prev.map((a) => (a.id === alertaId ? { ...a, estado: nuevoEstado } : a))
      );
      await recargarDatos();
    } catch {
      setErrorAlerta(
        "No se pudo actualizar la alerta en el servidor. Reintenta en unos segundos."
      );
    } finally {
      setActualizandoAlertaId(null);
    }
  };

  const badgeSeveridad = (sev: string) => {
    if (sev === "CRITICA") return "bg-red-500/20 text-red-400 border-red-500/40";
    if (sev === "ALTA") return "bg-orange-500/20 text-orange-400 border-orange-500/40";
    return "bg-yellow-500/20 text-yellow-400 border-yellow-500/40";
  };

  const formatearEstadoHumano = (estado?: string) => {
    const e = (estado || "").toUpperCase().trim();
    if (e === "RESUELTA") return "Resuelta";
    if (e === "EN_REVISION") return "En revisión";
    return "Pendiente";
  };

  const formatearFechaAlerta = (fechaIso?: string) => {
    if (!fechaIso) return "";
    const d = new Date(fechaIso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
  };

  const handleSuscribir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatId.trim()) return;
    setEstadoSub("loading");

    try {
      const res = await fetch(`${API_URL}/api/suscribir-telegram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId.trim() }),
      });
      if (!res.ok) throw new Error();
      setEstadoSub("ok");
      setChatId("");
    } catch {
      setEstadoSub("error");
    }
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-950 text-slate-100 print:overflow-visible print:bg-white print:text-slate-950">
      <main
        className={`w-full max-w-[1600px] mx-auto p-3 sm:p-6 lg:px-8 space-y-4 sm:space-y-6 ${
          mostrarMinuta ? "print:hidden" : ""
        }`}
      >
        {/* Header responsive */}
      <header className="flex flex-col gap-2 border-b border-slate-800 pb-3 sm:flex-row sm:items-center sm:justify-between sm:pb-4">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <Sprout className="w-7 h-7 sm:w-8 sm:h-8 text-emerald-400 shrink-0" />
          <div>
            <h1 className="text-lg font-bold text-slate-100 sm:text-xl">AgroLens AI</h1>
            <p className="text-xs text-slate-400 sm:text-sm">
              Monitoreo Satelital, Clima y Gestión Económica por Lote
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setLoteParaEditar(null);
              setModalLoteNonce((n) => n + 1);
              setModalLoteAbierto(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow-sm hover:bg-emerald-400 active:scale-95 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nuevo lote / Importar</span>
          </button>

          {/* Badge de Frescura de Datos Dinámico */}
          <div
            title="Actualización diaria automática con imágenes Sentinel-2 y datos NASA POWER"
            className="w-fit flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-300 shadow-sm sm:text-xs"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"></span>
            </span>
            <span>Actualizado: {ultimaFecha}</span>
          </div>

          <div className="text-xs sm:text-sm text-slate-400 hidden md:block border-l border-slate-800 pl-3">
            {geojsonFiltrado
              ? `${geojsonFiltrado.features.length} ${
                  geojsonFiltrado.features.length === 1 ? "lote activo" : "lotes activos"
                }`
              : "Conectando..."}
          </div>
        </div>
      </header>

      {avisoOperativo && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs sm:text-sm text-emerald-200">
          <span>{avisoOperativo}</span>
          <button
            type="button"
            onClick={() => setAvisoOperativo(null)}
            aria-label="Cerrar aviso"
            className="rounded p-1 text-emerald-300 hover:bg-emerald-500/20"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Aviso de servidor en Render despertando (Cold Start > 4s) */}
      {isSlowLoad && cargando && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
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
        <div className="space-y-4 sm:space-y-6">
          {/* Skeleton de Barra Gerencial y KPIs */}
          <div className="space-y-3">
            <div className="h-12 rounded-xl border border-slate-800 bg-slate-900/50 animate-pulse" />
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-28 rounded-xl border border-slate-800 bg-slate-900/60 p-4 animate-pulse"
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:gap-6 lg:grid-cols-3">
            {/* Skeleton del Mapa */}
            <div className="relative min-w-0 h-[320px] sm:h-[400px] lg:col-span-2 lg:h-[580px] xl:h-[640px] overflow-hidden rounded-xl border border-slate-800 bg-slate-900 p-3 sm:p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <div className="h-5 w-40 sm:w-44 bg-slate-800/80 rounded animate-pulse"></div>
                <div className="flex gap-2">
                  <div className="h-4 w-10 sm:w-12 bg-slate-800/80 rounded animate-pulse"></div>
                  <div className="h-4 w-10 sm:w-12 bg-slate-800/80 rounded animate-pulse"></div>
                  <div className="h-4 w-10 sm:w-12 bg-slate-800/80 rounded animate-pulse"></div>
                </div>
              </div>
              <div className="flex-1 my-3 bg-slate-800/40 rounded-lg flex flex-col items-center justify-center gap-2 text-slate-500 text-xs sm:text-sm animate-pulse">
                <MapPin className="w-7 h-7 sm:w-8 sm:h-8 text-slate-700 animate-bounce" />
                <span>Cargando capas geoespaciales y polígonos...</span>
              </div>
              <div className="h-4 w-32 sm:w-36 bg-slate-800/80 rounded animate-pulse"></div>
            </div>

            {/* Skeleton del Panel de Alertas */}
            <div className="min-w-0 flex h-[420px] lg:h-[580px] xl:h-[640px] flex-col rounded-xl border border-slate-800 bg-slate-900/50 p-3 sm:p-4 space-y-3">
              <div className="h-5 w-44 bg-slate-800/80 rounded animate-pulse"></div>
              <div className="space-y-3 flex-1 overflow-hidden">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 space-y-2.5 animate-pulse"
                  >
                    <div className="flex justify-between items-center">
                      <div className="h-4 w-28 bg-slate-800/80 rounded"></div>
                      <div className="h-4 w-12 bg-slate-800/80 rounded-full"></div>
                    </div>
                    <div className="h-3 w-36 bg-slate-800/60 rounded"></div>
                    <div className="h-6 w-full bg-slate-800/40 rounded"></div>
                    <div className="h-3 w-24 bg-slate-800/60 rounded"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Skeleton de Gráficos */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6 h-[200px] animate-pulse flex items-center justify-center text-slate-500 text-xs sm:text-sm text-center">
            Cargando series temporales satelitales (Sentinel-2) y agroclimáticas (NASA POWER)...
          </div>
        </div>
      ) : (
        <>
          {/* KPIs Gerenciales + Filtro por Establecimiento y Campaña */}
          <KpisGerenciales
            geojsonFiltrado={geojsonFiltrado}
            alertasVisibles={alertasContexto}
            clientes={clientesDisponibles}
            campanas={campanasDisponibles}
            filtroCliente={filtroCliente}
            filtroCampana={filtroCampana}
            onChangeCliente={setFiltroCliente}
            onChangeCampana={setFiltroCampana}
            loteSeleccionadoId={loteActivoId}
            pronosticoLote={pronosticoLote}
            cargandoPronostico={cargandoPronostico}
            cartera={carteraEconomica}
            escenario={escenario}
            esCampoAlquilado={esCampoAlquilado}
            onAbrirEconomia={abrirEconomia}
            onSelectLoteConZoom={seleccionarLoteConZoom}
            onAbrirMinuta={() => setMostrarMinuta(true)}
          />

          {/* Grid Principal: Mapa + Panel de Alertas */}
          <div className="grid grid-cols-1 gap-4 lg:gap-6 lg:grid-cols-3">
            {/* Mapa (2 columnas) con altura progresiva */}
            <section
              ref={mapaRef}
              className="relative min-w-0 h-[320px] sm:h-[400px] lg:col-span-2 lg:h-[580px] xl:h-[640px] overflow-hidden rounded-xl border border-slate-800 bg-slate-900 p-3 sm:p-4 flex flex-col"
            >
              <div className="flex items-center justify-between mb-2 shrink-0">
                <h2 className="font-semibold text-sm sm:text-base flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-emerald-400" />
                  Mapa de Lotes
                </h2>
                <span className="text-xs text-slate-400">
                  {geojsonFiltrado?.features
                    ? `${geojsonFiltrado.features.length} ${
                        geojsonFiltrado.features.length === 1 ? "lote activo" : "lotes activos"
                      }`
                    : ""}
                </span>
              </div>
              <div className="flex-1 min-h-0 relative rounded-lg overflow-hidden">
                <MapaLotes
                  geojson={geojsonFiltrado}
                  alertas={alertasContexto}
                  loteSeleccionadoId={loteActivoId}
                  zoomLoteNonce={zoomLoteNonce}
                  onSelectLote={seleccionarLoteConZoom}
                />
              </div>
            </section>

            {/* Columna derecha: Feed de Alertas IA a altura completa */}
            <section className="min-w-0 flex max-h-[420px] lg:max-h-none lg:h-[580px] xl:h-[640px] flex-col rounded-xl border border-slate-800 bg-slate-900/50 p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3 shrink-0">
                <h2 className="font-semibold text-sm sm:text-base flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Alertas Agronómicas IA
                </h2>
                <span className="text-xs text-slate-400">
                  {alertasFiltradas.length} de {alertasContexto.length}
                </span>
              </div>

              {/* Barra de chips de filtro deslizable horizontalmente en mobile */}
              <div className="mb-3 flex flex-nowrap gap-1.5 overflow-x-auto pb-1 sm:flex-wrap border-b border-slate-800 shrink-0">
                {[
                  { id: "todas", label: "Todas", count: contadores.todas },
                  { id: "pendiente", label: "Pendientes", count: contadores.pendiente },
                  { id: "en_revision", label: "En revisión", count: contadores.en_revision },
                  { id: "resuelta", label: "Resueltas", count: contadores.resuelta },
                ].map((tab) => {
                  const activo = filtroEstado === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setFiltroEstado(tab.id)}
                      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition whitespace-nowrap shrink-0 ${
                        activo
                          ? "bg-emerald-500 text-slate-950 font-semibold shadow-sm"
                          : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                          activo ? "bg-slate-950/20 text-slate-950 font-bold" : "bg-slate-900 text-slate-400"
                        }`}
                      >
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {errorAlerta && (
                <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 shrink-0">
                  {errorAlerta}
                </div>
              )}

              <p className="mb-2 text-[11px] text-slate-400 shrink-0">
                Aquí solo figuran lotes con anomalías detectadas por IA. Los lotes sanos o recién cargados aparecen en verde en el mapa.
              </p>

              {(geojsonFiltrado?.features || []).some(
                (f) => f.properties?.ultimo_ndvi == null
              ) && (
                <div className="mb-2.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-200 shrink-0 space-y-1">
                  <div className="font-medium">
                    Lotes nuevos esperando lectura satelital Sentinel-2:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(geojsonFiltrado?.features || [])
                      .filter((f) => f.properties?.ultimo_ndvi == null)
                      .map((f) => {
                        const id = Number(f.properties?.id);
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => seleccionarLoteConZoom(id)}
                            className="rounded border border-sky-400/40 bg-sky-950/60 px-2 py-0.5 text-[10px] text-sky-200 hover:bg-sky-500/20 transition"
                          >
                            {String(f.properties?.nombre_lote || `Lote ${id}`)}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {alertasFiltradas.length === 0 ? (
                  <p className="text-center py-12 text-sm text-slate-400">
                    No hay alertas en esta categoría.
                  </p>
                ) : (
                  alertasFiltradas.map((alerta) => {
                    const diag = parseDiagnostico(
                      alerta.diagnostico_llm || alerta.mensaje || alerta.diagnostico || ""
                    );
                    const enActualizacion = actualizandoAlertaId === alerta.id;
                    return (
                      <div
                        key={alerta.id}
                        onClick={() => seleccionarLoteConZoom(alerta.lote_id)}
                        className={`p-3 rounded-lg border cursor-pointer transition ${
                          loteActivoId === alerta.lote_id
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

                        {alerta.cliente && (
                          <p className="text-[11px] text-slate-400 mb-0.5 truncate">
                            {alerta.cliente}
                          </p>
                        )}
                        <p className="text-xs text-emerald-400 mb-2">
                          {alerta.cultivo_actual} · {alerta.tipo_anomalia}
                        </p>

                        {/* Diagnóstico Estructurado o Fallback Legacy */}
                        {diag.textoPlano ? (
                          <p className="text-sm text-slate-300 mb-3">{diag.textoPlano}</p>
                        ) : (
                          <div className="mt-2 mb-3 space-y-2 text-xs leading-relaxed">
                            {diag.quePaso && (
                              <div className="rounded-md bg-slate-800/70 p-2">
                                <span className="font-semibold text-red-400">Qué pasó: </span>
                                <span className="text-slate-200">{diag.quePaso}</span>
                              </div>
                            )}
                            {diag.causaProbable && (
                              <div className="rounded-md bg-slate-800/70 p-2">
                                <span className="font-semibold text-amber-400">Causa probable: </span>
                                <span className="text-slate-200">{diag.causaProbable}</span>
                              </div>
                            )}
                            {diag.accionSugerida && (
                              <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-2">
                                <span className="font-semibold text-emerald-400">Acción sugerida: </span>
                                <span className="text-slate-100">{diag.accionSugerida}</span>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex items-center justify-between border-t border-slate-800 pt-2.5 mt-2 gap-2 flex-wrap">
                          <span className="text-[11px] text-slate-400">
                            Estado:{" "}
                            <strong className="text-slate-200">
                              {formatearEstadoHumano(alerta.estado)}
                            </strong>
                            {alerta.fecha_deteccion && (
                              <span className="text-slate-500">
                                {" "}
                                · {formatearFechaAlerta(alerta.fecha_deteccion)}
                              </span>
                            )}
                          </span>
                          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRecorridaNonce((n) => n + 1);
                                setContextoRecorrida({
                                  loteId: alerta.lote_id,
                                  nombreLote: alerta.nombre_lote,
                                  alertaId: alerta.id,
                                  alertaTipo: alerta.tipo_anomalia,
                                  fechaDefault: new Date().toISOString().split("T")[0],
                                });
                              }}
                              className="text-xs px-2 py-1.5 sm:py-2 min-h-[36px] flex items-center gap-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300 hover:border-emerald-500/40 hover:text-emerald-300 transition"
                              title="Registrar visita / nota de recorrida en este lote"
                            >
                              <ClipboardCheck className="w-3.5 h-3.5" />
                              <span>Nota</span>
                            </button>

                            {alerta.estado !== "RESUELTA" && (
                              <>
                                {alerta.estado === "PENDIENTE" && (
                                  <button
                                    type="button"
                                    disabled={enActualizacion}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setRecorridaNonce((n) => n + 1);
                                      setContextoRecorrida({
                                        loteId: alerta.lote_id,
                                        nombreLote: alerta.nombre_lote,
                                        alertaId: alerta.id,
                                        alertaTipo: alerta.tipo_anomalia,
                                        nuevoEstadoAlerta: "EN_REVISION",
                                        fechaDefault: new Date().toISOString().split("T")[0],
                                      });
                                    }}
                                    className="text-xs px-2.5 py-1.5 sm:py-2 min-h-[36px] flex items-center rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-300 hover:bg-amber-500/20 transition active:scale-95 disabled:opacity-50"
                                  >
                                    {enActualizacion ? "..." : "En revisión"}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={enActualizacion}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRecorridaNonce((n) => n + 1);
                                    setContextoRecorrida({
                                      loteId: alerta.lote_id,
                                      nombreLote: alerta.nombre_lote,
                                      alertaId: alerta.id,
                                      alertaTipo: alerta.tipo_anomalia,
                                      nuevoEstadoAlerta: "RESUELTA",
                                      fechaDefault: new Date().toISOString().split("T")[0],
                                    });
                                  }}
                                  className="text-xs px-2.5 py-1.5 sm:py-2 min-h-[36px] flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20 transition active:scale-95 disabled:opacity-50"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>{enActualizacion ? "Guardando..." : "Marcar resuelta"}</span>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>

          {/* Selector rápido de lotes + Ficha resumen en lenguaje claro */}
          <ResumenLoteActivo
            geojsonFiltrado={geojsonFiltrado}
            loteActivoId={loteActivoId}
            onSelectLote={seleccionarLoteConZoom}
            seriesLote={seriesLote}
            pronosticoLote={pronosticoLote}
            cargandoSeries={cargandoSeries}
            cargandoPronostico={cargandoPronostico}
            alertasVisibles={alertasContexto}
            recorridasDelLote={recorridasLoteActivo}
            ahoraMs={ahoraMs}
            onAbrirRecorrida={(idLote, nombre) => {
              setRecorridaNonce((n) => n + 1);
              setContextoRecorrida({
                loteId: idLote,
                nombreLote: nombre,
                fechaDefault: new Date().toISOString().split("T")[0],
              });
            }}
            onEditarLote={(lote) => {
              setLoteParaEditar(lote);
              setModalLoteNonce((n) => n + 1);
              setModalLoteAbierto(true);
            }}
          />

          {/* Navegación por pestañas para evitar exceso de scroll */}
          <div
            ref={seccionDetalleRef}
            className="flex flex-nowrap overflow-x-auto gap-2 border-b border-slate-800 pb-2"
          >
            <button
              type="button"
              onClick={() => setTabDetalle("campo")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs sm:text-sm font-medium transition whitespace-nowrap shrink-0 ${
                tabDetalle === "campo"
                  ? "bg-emerald-500 text-slate-950 font-semibold shadow-sm"
                  : "bg-slate-900 text-slate-300 border border-slate-800 hover:border-slate-700"
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>Evolución Satelital y Clima</span>
            </button>

            <button
              type="button"
              onClick={() => setTabDetalle("economia")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs sm:text-sm font-medium transition whitespace-nowrap shrink-0 ${
                tabDetalle === "economia"
                  ? "bg-emerald-500 text-slate-950 font-semibold shadow-sm"
                  : "bg-slate-900 text-slate-300 border border-slate-800 hover:border-slate-700"
              }`}
            >
              <DollarSign className="w-4 h-4" />
              <span>Gestión Económica y Márgenes</span>
            </button>

            <button
              type="button"
              onClick={() => setTabDetalle("asistente")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs sm:text-sm font-medium transition whitespace-nowrap shrink-0 ${
                tabDetalle === "asistente"
                  ? "bg-emerald-500 text-slate-950 font-semibold shadow-sm"
                  : "bg-slate-900 text-slate-300 border border-slate-800 hover:border-slate-700"
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Asistente IA y Alertas Telegram</span>
            </button>
          </div>

          {/* Contenido de la pestaña activa */}
          {tabDetalle === "campo" && (
            <div className="space-y-4">
              <GraficosLote series={seriesLote} cargando={cargandoSeries} />
              {loteActivoId && (
                <PronosticoLote pronostico={pronosticoLote} cargando={cargandoPronostico} />
              )}
            </div>
          )}

          {tabDetalle === "economia" && (
            <ModuloEconomico
              geojsonFiltrado={geojsonFiltrado}
              loteSeleccionadoId={loteActivoId}
              onSelectLote={seleccionarLoteConZoom}
              onVerEnMapa={verLoteEnMapa}
              cartera={carteraEconomica}
              supuestos={supuestos}
              onChangeSupuestos={handleChangeSupuestos}
              esCampoAlquilado={esCampoAlquilado}
              onChangeEsCampoAlquilado={handleChangeCampoAlquilado}
              arriendoQqSoja={arriendoQqSoja}
              onChangeArriendoQqSoja={handleChangeArriendoQqSoja}
              escenario={escenario}
              onChangeEscenario={handleChangeEscenario}
              onSavePresupuestoLote={handleSavePresupuestoLote}
              sincronizandoBd={sincronizandoEconomia}
              errorSyncBd={errorSyncEconomia}
            />
          )}

          {tabDetalle === "asistente" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
              <div className="lg:col-span-2 min-w-0">
                {loteActivoId && seriesLote ? (
                  <ChatLote
                    key={loteActivoId}
                    loteNombre={seriesLote.lote.nombre_lote}
                    datosLote={datosCombinadosLote}
                    recorridas={recorridasLoteActivo}
                  />
                ) : (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
                    Selecciona un lote para consultar al Asistente IA.
                  </div>
                )}
              </div>

              {/* Formulario de Suscripción a Telegram */}
              <form
                onSubmit={handleSuscribir}
                className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2.5"
              >
                <div className="flex items-center gap-2">
                  <Send className="w-4 h-4 text-sky-400" />
                  <h4 className="text-sm font-semibold text-slate-100">
                    Recibir avisos diarios en Telegram
                  </h4>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Recibe un mensaje automático a las 06:00 hs si algún lote presenta anomalías:
                  <br />
                  1. Inicia nuestro bot en{" "}
                  <a
                    href={`https://t.me/${botUsername}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 underline font-medium hover:text-emerald-300"
                  >
                    @{botUsername}
                  </a>
                  . <br />
                  2. Obtén tu número de usuario en{" "}
                  <a
                    href="https://t.me/userinfobot"
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 underline font-medium hover:text-emerald-300"
                  >
                    @userinfobot
                  </a>{" "}
                  y pégalo aquí:
                </p>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatId}
                    onChange={(e) => setChatId(e.target.value)}
                    placeholder="Ej: 123456789"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={estadoSub === "loading"}
                    className="shrink-0 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 active:scale-95 disabled:opacity-50"
                  >
                    {estadoSub === "loading" ? "Guardando..." : "Activar"}
                  </button>
                </div>

                {estadoSub === "ok" && (
                  <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>¡Listo! Revisa tu Telegram para confirmar.</span>
                  </p>
                )}
                {estadoSub === "error" && (
                  <p className="text-xs text-red-400">
                    Error al guardar. Verifica tu número o asegúrate de haber iniciado el bot.
                  </p>
                )}
              </form>
            </div>
          )}
        </>
      )}
      </main>

      {mostrarMinuta && (
        <MinutaGestionModal
          abierto={mostrarMinuta}
          onCerrar={() => setMostrarMinuta(false)}
          filtroCliente={filtroCliente}
          filtroCampana={filtroCampana}
          ultimaFecha={ultimaFecha}
          cartera={carteraEconomica}
          esCampoAlquilado={esCampoAlquilado}
          arriendoQqSoja={arriendoQqSoja}
          escenario={escenario}
          alertasVisibles={alertasContexto}
          recorridasVisibles={recorridasContexto}
          pronosticoLote={pronosticoLote}
        />
      )}

      {modalLoteAbierto && (
        <GestionLotesModal
          key={`lote-modal-${modalLoteNonce}-${loteParaEditar?.id ?? "new"}`}
          abierto={modalLoteAbierto}
          loteEditar={loteParaEditar}
          clientes={clientesLista}
          apiUrl={API_URL}
          onCerrar={() => setModalLoteAbierto(false)}
          onLoteCreado={async (res: ResultadoAltaLote) => {
            await recargarDatos();
            seleccionarLoteConZoom(res.id);
            setAvisoOperativo(
              `Lote "${res.nombre_lote}" (${res.cliente ? `${res.cliente}, ` : ""}${res.hectareas} ha) creado. Clima precargado (${res.clima_dias_ingestados} días NASA POWER). ${
                res.satelite_workflow_disparado
                  ? "Ingesta satelital Sentinel-2 disparada."
                  : "Imágenes Sentinel-2 disponibles tras el próximo ciclo ETL (06:00 hs)."
              }`
            );
          }}
          onLoteActualizado={async () => {
            await recargarDatos();
            setAvisoOperativo("Datos agronómicos del lote actualizados.");
          }}
          onLoteEliminado={async (idBorrado: number, nombre: string) => {
            if (loteSeleccionado === idBorrado) {
              setLoteSeleccionado(null);
            }
            await recargarDatos();
            setAvisoOperativo(`Lote "${nombre}" eliminado.`);
          }}
        />
      )}

      {contextoRecorrida && (
        <RecorridaModal
          key={`rec-modal-${recorridaNonce}`}
          contexto={contextoRecorrida}
          apiUrl={API_URL}
          onCerrar={() => setContextoRecorrida(null)}
          onGuardado={async () => {
            await recargarDatos();
            setAvisoOperativo("Recorrida a campo guardada en la bitácora.");
          }}
          onSoloCambiarEstado={async (alertaId, nuevoEstado) => {
            await actualizarEstadoAlerta(alertaId, nuevoEstado);
          }}
        />
      )}
    </div>
  );
}