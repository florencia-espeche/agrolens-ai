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

/**
 * Interpreta una ubicación desde:
 * - Par decimal: "-32.7205, -62.1295" o "-32.7205 -62.1295"
 * - Grados Minutos Segundos (DMS): 32°43'13.8"S 62°07'46.2"W (o O para Oeste)
 * - URL de Google Maps con @lat,lon, ?q=lat,lon o !3dlat!4dlon
 */
export function parsearParLatLon(texto: string): [number, number] | null {
  const raw = texto.trim();
  if (!raw) return null;

  // 1. Links de Google Maps
  const urlPatterns = [
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|ll|center)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
  ];
  for (const regex of urlPatterns) {
    const m = raw.match(regex);
    if (m) {
      const lat = Number(m[1]);
      const lon = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return [lat, lon];
      }
    }
  }

  // 2. Formato DMS (ej: 32°43'13.8"S 62°07'46.2"W)
  const dmsRegex = /(\d+(?:\.\d+)?)\s*[°º]\s*(?:(\d+(?:\.\d+)?)\s*['′’]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:"|''|″|”)?\s*)?([NSEWO])/gi;
  const dmsMatches = [...raw.matchAll(dmsRegex)];
  if (dmsMatches.length >= 2) {
    const toDecimal = (m: RegExpMatchArray): number => {
      const g = Number(m[1]);
      const min = m[2] ? Number(m[2]) : 0;
      const seg = m[3] ? Number(m[3]) : 0;
      const hemi = m[4].toUpperCase();
      const absVal = g + min / 60 + seg / 3600;
      return hemi === "S" || hemi === "W" || hemi === "O" ? -absVal : absVal;
    };
    let lat: number | null = null;
    let lon: number | null = null;
    for (const m of dmsMatches) {
      const h = m[4].toUpperCase();
      if ((h === "N" || h === "S") && lat === null) lat = toDecimal(m);
      if ((h === "E" || h === "W" || h === "O") && lon === null) lon = toDecimal(m);
    }
    if (lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return [Number(lat.toFixed(6)), Number(lon.toFixed(6))];
    }
  }

  // 3. Par decimal clásico ("lat, lon" o "lat lon")
  const limpio = raw.replace(/[()[\]]/g, "").trim();
  const partes = limpio.split(/[\s,;]+/).filter(Boolean);
  if (partes.length < 2) return null;

  const lat = Number(partes[0]);
  const lon = Number(partes[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return [lat, lon];
}

/** Construye un polígono rectangular centrado en (lat, lon) con la superficie indicada en ha. */
export function generarPoligonoDesdeCentro(
  lat: number,
  lon: number,
  hectareas: number
): GeoJsonPolygon {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Ingresa latitud y longitud numéricas válidas.");
  }
  if (lat <= -85 || lat >= 85 || lon < -180 || lon > 180) {
    throw new Error("Coordenadas fuera de rango geográfico (Lat -85..85, Lon -180..180).");
  }
  if (!Number.isFinite(hectareas) || hectareas < 0.5 || hectareas > 50000) {
    throw new Error("La superficie aproximada debe estar entre 0.5 y 50.000 ha.");
  }

  const areaM2 = hectareas * 10000;
  const ladoM = Math.sqrt(areaM2);
  const halfLatDeg = ladoM / 2 / 111320;
  const cosLat = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  const halfLonDeg = ladoM / 2 / (111320 * cosLat);

  const anillo = normalizarAnillo([
    [lon - halfLonDeg, lat - halfLatDeg],
    [lon + halfLonDeg, lat - halfLatDeg],
    [lon + halfLonDeg, lat + halfLatDeg],
    [lon - halfLonDeg, lat + halfLatDeg],
  ]);
  return { type: "Polygon", coordinates: [anillo] };
}

/**
 * Parsea una lista manual de vértices (una coordenada por línea, JSON o WKT POLYGON((...))).
 */
export function parsearCoordenadasTexto(
  texto: string,
  orden: "lat_lon" | "lon_lat"
): GeoJsonPolygon {
  const raw = texto.trim();
  if (!raw) {
    throw new Error("Ingresa al menos 3 pares de coordenadas para armar el polígono.");
  }

  // Soporte JSON array directo: [[-62.1, -32.7], ...]
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length >= 3) {
        const coords: number[][] = [];
        for (const item of parsed) {
          if (!Array.isArray(item) || item.length < 2) continue;
          const v1 = Number(item[0]);
          const v2 = Number(item[1]);
          coords.push(orden === "lat_lon" ? [v2, v1] : [v1, v2]);
        }
        return { type: "Polygon", coordinates: [normalizarAnillo(coords)] };
      }
    } catch {
      // Continúa con parseo por texto libre
    }
  }

  // Soporte WKT: POLYGON((-62.135 -32.725, ...))
  const wktMatch = raw.match(/POLYGON\s*\(\(\s*([^)]+)\s*\)\)/i);
  const puntosCrudos: number[][] = [];

  if (wktMatch) {
    const tokens = wktMatch[1].split(",");
    for (const tok of tokens) {
      const nums = tok.trim().split(/\s+/).map(Number);
      if (nums.length >= 2 && Number.isFinite(nums[0]) && Number.isFinite(nums[1])) {
        puntosCrudos.push(
          orden === "lat_lon" ? [nums[1], nums[0]] : [nums[0], nums[1]]
        );
      }
    }
  } else {
    const segmentos = raw
      .split(/[\n;]+/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("#") && !s.startsWith("//"));

    for (const seg of segmentos) {
      const nums = seg
        .replace(/[()[\]]/g, "")
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      if (nums.length < 2 || !Number.isFinite(nums[0]) || !Number.isFinite(nums[1])) {
        throw new Error(`No se pudo leer la línea de coordenada: "${seg}"`);
      }
      puntosCrudos.push(
        orden === "lat_lon" ? [nums[1], nums[0]] : [nums[0], nums[1]]
      );
    }
  }

  return { type: "Polygon", coordinates: [normalizarAnillo(puntosCrudos)] };
}
