import type { Feature, FeatureCollection } from "geojson";

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

export interface PresupuestoLote {
  rinde_objetivo_qq_ha: number | null;
  costo_extra_usd_ha: number;
  notas_presupuesto?: string | null;
}

export type EscenarioId =
  | "base"
  | "rinde_menos_10"
  | "rinde_menos_20"
  | "precio_menos_15"
  | "optimista_10";

export const SUPUESTOS_DEFAULT: Record<string, SupuestoCultivo> = {
  "Soja 1ra": { costoUsdHa: 620, precioUsdTn: 290, rindeObjetivoQqHa: 36 },
  "Maíz Temprano": { costoUsdHa: 820, precioUsdTn: 185, rindeObjetivoQqHa: 92 },
  "Maíz Tardío": { costoUsdHa: 740, precioUsdTn: 180, rindeObjetivoQqHa: 80 },
  "Trigo / Soja 2da": { costoUsdHa: 790, precioUsdTn: 245, rindeObjetivoQqHa: 56 },
};

export const SUPUESTO_FALLBACK: SupuestoCultivo = {
  costoUsdHa: 650,
  precioUsdTn: 240,
  rindeObjetivoQqHa: 40,
};

export const ESCENARIOS: Record<
  EscenarioId,
  { label: string; factorRinde: number; factorPrecio: number }
> = {
  base: { label: "Base", factorRinde: 1, factorPrecio: 1 },
  rinde_menos_10: { label: "Rinde -10%", factorRinde: 0.9, factorPrecio: 1 },
  rinde_menos_20: { label: "Sequía (-20% Rinde)", factorRinde: 0.8, factorPrecio: 1 },
  precio_menos_15: { label: "Precio -15%", factorRinde: 1, factorPrecio: 0.85 },
  optimista_10: { label: "Año bueno (+10%)", factorRinde: 1.1, factorPrecio: 1 },
};

export interface FilaEconomicaLote {
  id: number;
  nombreLote: string;
  nombreCorto: string;
  cliente: string;
  cultivo: string;
  hectareas: number;
  costoDirectoHa: number;
  costoExtraManualHa: number;
  costoLaboresHa: number;
  costoUsdHa: number;
  costoUsdHaRedondeado: number;
  margenBrutoHaRedondeado: number;
  precioUsdTn: number;
  rindeObjetivoQqHa: number;
  rindeBaseLoteQqHa: number | null;
  usaRindeIndividual: boolean;
  notasPresupuesto: string | null;
  rindeIndiferenciaQqHa: number;
  holguraQqHa: number;
  margenBrutoHa: number;
  inversionTotalUsd: number;
  ingresoTotalUsd: number;
  margenBrutoTotalUsd: number;
  severidadMaxima: string | null;
  factorRiesgo: number;
  ingresoEnRiesgoUsd: number;
}

export interface TotalesEconomicos {
  hectareas: number;
  inversionUsd: number;
  ingresoUsd: number;
  margenUsd: number;
  margenPromedioHa: number;
  capitalEnAlertaUsd: number;
  hectareasEnAlerta: number;
  ingresoEnRiesgoUsd: number;
  roiPct: number;
}

export interface CarteraEconomica {
  arriendoUsdHa: number;
  filas: FilaEconomicaLote[];
  totales: TotalesEconomicos;
  prioridadUno: FilaEconomicaLote | null;
}

export function obtenerSupuestoInicial(cultivo: string): SupuestoCultivo {
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

export function esAlertaActiva(estado?: string): boolean {
  const norm = (estado || "").toLowerCase().trim();
  return (
    norm === "pendiente" ||
    norm === "activa" ||
    norm === "en_revision" ||
    norm === "en revisión"
  );
}

export function factorRiesgoPorSeveridad(severidad?: string): number {
  const sev = (severidad || "").toUpperCase().trim();
  if (sev === "CRITICA") return 0.25;
  if (sev === "ALTA") return 0.15;
  if (sev === "MEDIA") return 0.08;
  return 0.05;
}

export function formatUsd(valor: number): string {
  return `USD ${Math.round(valor).toLocaleString("es-AR")}`;
}

export function calcularCarteraEconomica({
  geojsonFiltrado,
  alertasVisibles,
  supuestos,
  esCampoAlquilado,
  arriendoQqSoja,
  escenario,
  presupuestosPorLote = {},
}: {
  geojsonFiltrado: FeatureCollection | null;
  alertasVisibles: AlertaEconomica[];
  supuestos: Record<string, SupuestoCultivo>;
  esCampoAlquilado: boolean;
  arriendoQqSoja: number;
  escenario: EscenarioId;
  presupuestosPorLote?: Record<string, PresupuestoLote>;
}): CarteraEconomica {
  const features: Feature[] = geojsonFiltrado?.features || [];
  const configEscenario = ESCENARIOS[escenario] ?? ESCENARIOS.base;

  const precioSojaReferencia =
    (supuestos["Soja 1ra"]?.precioUsdTn ?? SUPUESTOS_DEFAULT["Soja 1ra"].precioUsdTn) *
    configEscenario.factorPrecio;
  const arriendoUsdHa = esCampoAlquilado
    ? (arriendoQqSoja / 10) * precioSojaReferencia
    : 0;

  const filas: FilaEconomicaLote[] = features.map((f) => {
    const p = f.properties || {};
    const id = Number(p.id);
    const nombreLote = String(p.nombre_lote || `Lote ${id}`);
    const nombreCorto = nombreLote.split(" - ")[0] || nombreLote;
    const cliente = String(p.cliente || "Sin establecimiento");
    const cultivo = String(p.cultivo_actual || "Sin especificar");
    const hectareas = Number(p.hectareas) || 0;

    const presupuestoOverride = presupuestosPorLote[String(id)];
    const rindeBaseLote =
      presupuestoOverride !== undefined
        ? presupuestoOverride.rinde_objetivo_qq_ha
        : typeof p.rinde_objetivo_lote_qq_ha === "number"
        ? p.rinde_objetivo_lote_qq_ha
        : null;

    const costoExtraManualHa =
      presupuestoOverride !== undefined
        ? Number(presupuestoOverride.costo_extra_usd_ha) || 0
        : Number(p.costo_extra_usd_ha) || 0;

    const costoLaboresHa = Number(p.costo_labores_recorrida_usd_ha) || 0;
    const notasPresupuesto =
      presupuestoOverride !== undefined
        ? presupuestoOverride.notas_presupuesto ?? null
        : typeof p.notas_presupuesto === "string"
        ? p.notas_presupuesto
        : null;

    const supuesto = supuestos[cultivo] || obtenerSupuestoInicial(cultivo);
    const costoDirectoHa = supuesto.costoUsdHa;
    const usaRindeIndividual = rindeBaseLote !== null && rindeBaseLote > 0;
    const rindeBaseAplicado = usaRindeIndividual ? rindeBaseLote : supuesto.rindeObjetivoQqHa;

    const precioUsdTn = Math.round(supuesto.precioUsdTn * configEscenario.factorPrecio);
    const rindeObjetivoQqHa = Number(
      (rindeBaseAplicado * configEscenario.factorRinde).toFixed(1)
    );
    const costoUsdHa = costoDirectoHa + arriendoUsdHa + costoExtraManualHa + costoLaboresHa;

    const ingresoBrutoHa = (rindeObjetivoQqHa / 10) * precioUsdTn;
    const margenBrutoHa = ingresoBrutoHa - costoUsdHa;
    const rindeIndiferenciaQqHa =
      precioUsdTn > 0 ? (costoUsdHa / precioUsdTn) * 10 : 0;
    const holguraQqHa = rindeObjetivoQqHa - rindeIndiferenciaQqHa;

    const inversionTotalUsd = hectareas * costoUsdHa;
    const ingresoTotalUsd = hectareas * ingresoBrutoHa;
    const margenBrutoTotalUsd = hectareas * margenBrutoHa;

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
      costoDirectoHa,
      costoExtraManualHa,
      costoLaboresHa,
      costoUsdHa,
      costoUsdHaRedondeado: Math.round(costoUsdHa),
      margenBrutoHaRedondeado: Math.round(margenBrutoHa),
      precioUsdTn,
      rindeObjetivoQqHa,
      rindeBaseLoteQqHa: rindeBaseLote,
      usaRindeIndividual,
      notasPresupuesto,
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

  const hectareas = filas.reduce((acc, r) => acc + r.hectareas, 0);
  const inversionUsd = filas.reduce((acc, r) => acc + r.inversionTotalUsd, 0);
  const ingresoUsd = filas.reduce((acc, r) => acc + r.ingresoTotalUsd, 0);
  const margenUsd = filas.reduce((acc, r) => acc + r.margenBrutoTotalUsd, 0);
  const capitalEnAlertaUsd = filas
    .filter((r) => r.severidadMaxima !== null)
    .reduce((acc, r) => acc + r.inversionTotalUsd, 0);
  const hectareasEnAlerta = filas
    .filter((r) => r.severidadMaxima !== null)
    .reduce((acc, r) => acc + r.hectareas, 0);
  const ingresoEnRiesgoUsd = filas.reduce(
    (acc, r) => acc + r.ingresoEnRiesgoUsd,
    0
  );

  const margenPromedioHa = hectareas > 0 ? margenUsd / hectareas : 0;
  const roiPct = inversionUsd > 0 ? Math.round((margenUsd / inversionUsd) * 100) : 0;

  const enAlertaOrdenados = filas
    .filter((r) => r.severidadMaxima !== null)
    .sort((a, b) => b.ingresoEnRiesgoUsd - a.ingresoEnRiesgoUsd);

  return {
    arriendoUsdHa,
    filas,
    totales: {
      hectareas,
      inversionUsd,
      ingresoUsd,
      margenUsd,
      margenPromedioHa,
      capitalEnAlertaUsd,
      hectareasEnAlerta,
      ingresoEnRiesgoUsd,
      roiPct,
    },
    prioridadUno: enAlertaOrdenados.length > 0 ? enAlertaOrdenados[0] : null,
  };
}
