export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface PoligonoImportado {
  nombre_sugerido: string;
  geometry: GeoJsonPolygon;
  hectareas_aprox: number;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const RADIO_TIERRA_M = 6371008.8;

/** Estima hectáreas sobre la esfera terrestre (WGS84) para previsualización previa a PostGIS. */
export function calcularHectareasAprox(coordinates: number[][][]): number {
  const anillo = coordinates[0];
  if (!anillo || anillo.length < 4) return 0;

  let suma = 0;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  for (let i = 0; i < anillo.length - 1; i++) {
    const [lon1, lat1] = anillo[i];
    const [lon2, lat2] = anillo[i + 1];
    suma += toRad(lon2 - lon1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  const areaM2 = (Math.abs(suma) * RADIO_TIERRA_M * RADIO_TIERRA_M) / 2;
  return Number((areaM2 / 10000).toFixed(2));
}

export function normalizarAnillo(coords: number[][]): number[][] {
  const limpios: number[][] = [];
  for (const pt of coords) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const lon = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error("Coordenadas inválidas en el polígono.");
    }
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      throw new Error("Coordenadas fuera de rango WGS84 (longitud/latitud).");
    }
    limpios.push([Number(lon.toFixed(6)), Number(lat.toFixed(6))]);
  }
  if (limpios.length < 3) {
    throw new Error("Un polígono requiere al menos 3 vértices.");
  }
  const [lon0, lat0] = limpios[0];
  const [lonN, latN] = limpios[limpios.length - 1];
  if (lon0 !== lonN || lat0 !== latN) {
    limpios.push([lon0, lat0]);
  }
  return limpios;
}

function normalizarGeometria(rawGeom: unknown): GeoJsonPolygon {
  if (!rawGeom || typeof rawGeom !== "object") {
    throw new Error("Geometría GeoJSON inválida.");
  }
  const obj = rawGeom as { type?: string; coordinates?: unknown };
  if (obj.type === "Polygon" && Array.isArray(obj.coordinates) && obj.coordinates.length > 0) {
    const exterior = normalizarAnillo(obj.coordinates[0] as number[][]);
    return { type: "Polygon", coordinates: [exterior] };
  }
  if (
    obj.type === "MultiPolygon" &&
    Array.isArray(obj.coordinates) &&
    obj.coordinates.length > 0
  ) {
    const polys = obj.coordinates as number[][][][];
    let mejor: GeoJsonPolygon | null = null;
    let mejorArea = -1;
    for (const poly of polys) {
      if (!Array.isArray(poly) || poly.length === 0) continue;
      const anillo = normalizarAnillo(poly[0]);
      const candidato: GeoJsonPolygon = { type: "Polygon", coordinates: [anillo] };
      const ha = calcularHectareasAprox(candidato.coordinates);
      if (ha > mejorArea) {
        mejorArea = ha;
        mejor = candidato;
      }
    }
    if (mejor) return mejor;
  }
  throw new Error("Solo se admiten geometrías Polygon o MultiPolygon.");
}

function extraerNombreProp(props: unknown, idx: number): string {
  if (props && typeof props === "object") {
    const p = props as Record<string, unknown>;
    for (const k of ["nombre_lote", "nombre", "name", "Name", "lote", "Lote", "title"]) {
      const val = p[k];
      if (typeof val === "string" && val.trim()) {
        return val.trim().slice(0, 90);
      }
    }
  }
  return `Lote importado ${idx}`;
}

function parsearGeoJsonLocal(texto: string): PoligonoImportado[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(texto);
  } catch {
    throw new Error("El archivo GeoJSON/JSON no tiene sintaxis JSON válida.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Estructura GeoJSON inválida.");
  }
  const obj = parsed as {
    type?: string;
    features?: Array<{ geometry?: unknown; properties?: unknown }>;
    geometry?: unknown;
    properties?: unknown;
  };
  const out: PoligonoImportado[] = [];

  if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
    obj.features.forEach((f, idx) => {
      if (!f?.geometry) return;
      try {
        const geom = normalizarGeometria(f.geometry);
        out.push({
          nombre_sugerido: extraerNombreProp(f.properties, idx + 1),
          geometry: geom,
          hectareas_aprox: calcularHectareasAprox(geom.coordinates),
        });
      } catch {
        // Ignora geometrías puntuales/líneas dentro de colecciones mixtas
      }
    });
  } else if (obj.type === "Feature" && obj.geometry) {
    const geom = normalizarGeometria(obj.geometry);
    out.push({
      nombre_sugerido: extraerNombreProp(obj.properties, 1),
      geometry: geom,
      hectareas_aprox: calcularHectareasAprox(geom.coordinates),
    });
  } else if (obj.type === "Polygon" || obj.type === "MultiPolygon") {
    const geom = normalizarGeometria(obj);
    out.push({
      nombre_sugerido: "Lote GeoJSON 1",
      geometry: geom,
      hectareas_aprox: calcularHectareasAprox(geom.coordinates),
    });
  }

  if (out.length === 0) {
    throw new Error("No se encontraron polígonos en el archivo GeoJSON.");
  }
  return out;
}

function parsearKmlLocal(texto: string): PoligonoImportado[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(texto, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("El archivo KML no es un XML válido.");
  }

  const getByLocalName = (root: Element | Document, localName: string): Element[] => {
    const matched: Element[] = [];
    const todos = root.getElementsByTagName("*");
    for (let i = 0; i < todos.length; i++) {
      const el = todos[i];
      if (el.localName === localName) matched.push(el);
    }
    return matched;
  };

  const placemarks = getByLocalName(doc, "Placemark");
  const contenedores: Array<Element | Document> = placemarks.length > 0 ? placemarks : [doc];
  const out: PoligonoImportado[] = [];

  contenedores.forEach((bloque, idx) => {
    let nombre = `Lote KML ${idx + 1}`;
    if (bloque instanceof Element) {
      for (let i = 0; i < bloque.children.length; i++) {
        const ch = bloque.children[i];
        if (ch.localName === "name" && ch.textContent?.trim()) {
          nombre = ch.textContent.trim().slice(0, 90);
          break;
        }
      }
    }

    const poligonos = getByLocalName(bloque, "Polygon");
    poligonos.forEach((polyEl, pIdx) => {
      const outers = getByLocalName(polyEl, "outerBoundaryIs");
      const scope = outers[0] || polyEl;
      const coordsEls = getByLocalName(scope, "coordinates");
      const rawText = coordsEls[0]?.textContent?.trim();
      if (!rawText) return;

      const pts: number[][] = [];
      for (const token of rawText.split(/\s+/)) {
        const parts = token.split(",");
        if (parts.length >= 2) {
          pts.push([Number(parts[0]), Number(parts[1])]);
        }
      }
      if (pts.length < 3) return;
      const anillo = normalizarAnillo(pts);
      const geom: GeoJsonPolygon = { type: "Polygon", coordinates: [anillo] };
      const sufijo = poligonos.length > 1 ? ` (${pIdx + 1})` : "";
      out.push({
        nombre_sugerido: `${nombre}${sufijo}`,
        geometry: geom,
        hectareas_aprox: calcularHectareasAprox(geom.coordinates),
      });
    });
  });

  if (out.length === 0) {
    throw new Error("No se encontraron polígonos dentro del KML.");
  }
  return out;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Parsea KML o GeoJSON en el navegador y delega KMZ comprimidos al backend FastAPI.
 */
export async function parsearArchivoPoligonos(
  file: File,
  apiUrl: string
): Promise<PoligonoImportado[]> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("El archivo supera el límite de 5 MB.");
  }

  const nombre = file.name.toLowerCase();
  if (nombre.endsWith(".kmz")) {
    const buffer = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    const res = await fetch(`${apiUrl}/api/lotes/parsear-archivo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre_archivo: file.name,
        contenido_base64: base64,
      }),
    });
    const data = (await res.json()) as {
      detail?: string;
      poligonos?: Array<{ nombre_sugerido: string; geometry: GeoJsonPolygon }>;
    };
    if (!res.ok || !data.poligonos) {
      throw new Error(data.detail || "No se pudo interpretar el archivo KMZ.");
    }
    return data.poligonos.map((p) => ({
      nombre_sugerido: p.nombre_sugerido,
      geometry: p.geometry,
      hectareas_aprox: calcularHectareasAprox(p.geometry.coordinates),
    }));
  }

  const texto = await file.text();
  if (nombre.endsWith(".kml") || texto.trimStart().startsWith("<")) {
    return parsearKmlLocal(texto);
  }
  return parsearGeoJsonLocal(texto);
}
