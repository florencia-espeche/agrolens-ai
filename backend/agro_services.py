"""Servicios auxiliares para esquema, importación KML/KMZ/GeoJSON e ingesta climática."""

import base64
import io
import json
import math
import os
import re
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import requests

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
_schema_verificado = False


def ensure_schema(conn: Any) -> None:
    """Crea de forma idempotente las columnas y tablas operativas si faltan en PostgreSQL."""
    global _schema_verificado
    if _schema_verificado:
        return

    ddl_statements = [
        "ALTER TABLE lotes ADD COLUMN IF NOT EXISTS fecha_siembra DATE;",
        """
        CREATE TABLE IF NOT EXISTS recorridas_campo (
            id SERIAL PRIMARY KEY,
            lote_id INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
            alerta_id INTEGER REFERENCES alertas_ia(id) ON DELETE SET NULL,
            fecha_recorrida DATE NOT NULL DEFAULT CURRENT_DATE,
            autor VARCHAR(100),
            hallazgo TEXT NOT NULL,
            labor_recomendada TEXT,
            costo_labor_usd_ha NUMERIC(10, 2) DEFAULT 0,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_recorridas_lote_id ON recorridas_campo (lote_id);",
        """
        CREATE TABLE IF NOT EXISTS configuracion_economica_cartera (
            id SERIAL PRIMARY KEY,
            clave_ambito VARCHAR(200) UNIQUE NOT NULL,
            supuestos_cultivo JSONB NOT NULL DEFAULT '{}'::jsonb,
            es_campo_alquilado BOOLEAN NOT NULL DEFAULT FALSE,
            arriendo_qq_soja NUMERIC(6, 2) NOT NULL DEFAULT 12,
            escenario VARCHAR(40) NOT NULL DEFAULT 'base',
            actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS presupuestos_lote (
            lote_id INTEGER PRIMARY KEY REFERENCES lotes(id) ON DELETE CASCADE,
            rinde_objetivo_qq_ha NUMERIC(8, 2),
            costo_extra_usd_ha NUMERIC(10, 2) DEFAULT 0,
            notas_presupuesto TEXT,
            actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """,
    ]

    cur = conn.cursor()
    try:
        for stmt in ddl_statements:
            cur.execute(stmt)
        conn.commit()
        _schema_verificado = True
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


def _limpiar_anillo(coords: list[Any]) -> list[list[float]]:
    """Convierte puntos [lon, lat, z?] a 2D válidos y asegura cierre del anillo."""
    puntos: list[list[float]] = []
    for pt in coords:
        if not isinstance(pt, (list, tuple)) or len(pt) < 2:
            continue
        lon = float(pt[0])
        lat = float(pt[1])
        if not (math.isfinite(lon) and math.isfinite(lat)):
            raise ValueError("Coordenadas no numéricas en el polígono.")
        if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
            raise ValueError("Coordenadas fuera de rango geográfico (WGS84 lon/lat).")
        puntos.append([round(lon, 6), round(lat, 6)])

    if len(puntos) < 3:
        raise ValueError("El polígono debe tener al menos 3 vértices.")

    if puntos[0] != puntos[-1]:
        puntos.append(list(puntos[0]))

    if len(puntos) < 4:
        raise ValueError("El polígono cerrado debe tener al menos 4 puntos.")

    return puntos


def _area_aprox_planar(anillo: list[list[float]]) -> float:
    """Área planar relativa (shoelace) usada para elegir el polígono principal en MultiPolygon."""
    area = 0.0
    for i in range(len(anillo) - 1):
        x1, y1 = anillo[i]
        x2, y2 = anillo[i + 1]
        area += x1 * y2 - x2 * y1
    return abs(area) * 0.5


def normalizar_poligono_geojson(geometry: dict[str, Any]) -> dict[str, Any]:
    """Normaliza una geometría Polygon o MultiPolygon a un GeoJSON Polygon 2D cerrado."""
    if not isinstance(geometry, dict):
        raise ValueError("La geometría debe ser un objeto GeoJSON válido.")

    gtype = geometry.get("type")
    coords = geometry.get("coordinates")

    if gtype == "Polygon" and isinstance(coords, list) and coords:
        anillos = [_limpiar_anillo(coords[0])]
        for hueco in coords[1:]:
            if isinstance(hueco, list) and len(hueco) >= 3:
                anillos.append(_limpiar_anillo(hueco))
        return {"type": "Polygon", "coordinates": anillos}

    if gtype == "MultiPolygon" and isinstance(coords, list) and coords:
        candidatos: list[tuple[float, list[list[list[float]]]]] = []
        for poly in coords:
            if not isinstance(poly, list) or not poly:
                continue
            exterior = _limpiar_anillo(poly[0])
            anillos = [exterior]
            for hueco in poly[1:]:
                if isinstance(hueco, list) and len(hueco) >= 3:
                    anillos.append(_limpiar_anillo(hueco))
            candidatos.append((_area_aprox_planar(exterior), anillos))
        if candidatos:
            candidatos.sort(key=lambda item: item[0], reverse=True)
            return {"type": "Polygon", "coordinates": candidatos[0][1]}

    raise ValueError("Solo se admiten geometrías de tipo Polygon o MultiPolygon con coordenadas válidas.")


def _extraer_nombre_props(props: Any, indice: int) -> str:
    if isinstance(props, dict):
        for clave in ("nombre_lote", "nombre", "name", "Name", "lote", "Lote", "title"):
            val = props.get(clave)
            if isinstance(val, str) and val.strip():
                return val.strip()[:90]
    return f"Lote importado {indice}"


def _parsear_kml_texto(kml_texto: str) -> list[dict[str, Any]]:
    try:
        root = ET.fromstring(kml_texto)
    except ET.ParseError as exc:
        raise ValueError(f"El archivo KML no tiene formato XML válido: {exc}") from exc

    def tag_local(elem: ET.Element) -> str:
        return elem.tag.split("}")[-1]

    def parsear_coords_kml(texto: str) -> list[list[float]]:
        crudos = []
        for token in (texto or "").strip().split():
            partes = token.split(",")
            if len(partes) >= 2:
                crudos.append([float(partes[0]), float(partes[1])])
        return crudos

    resultados: list[dict[str, Any]] = []
    placemarks = [el for el in root.iter() if tag_local(el) == "Placemark"]
    contenedores = placemarks if placemarks else [root]

    for idx, bloque in enumerate(contenedores, start=1):
        nombre = f"Lote KML {idx}"
        for child in bloque:
            if tag_local(child) == "name" and child.text and child.text.strip():
                nombre = child.text.strip()[:90]
                break

        poligonos_xml = [el for el in bloque.iter() if tag_local(el) == "Polygon"]
        for p_idx, poly_el in enumerate(poligonos_xml, start=1):
            coord_text = None
            outer = next((el for el in poly_el.iter() if tag_local(el) == "outerBoundaryIs"), poly_el)
            coord_el = next((el for el in outer.iter() if tag_local(el) == "coordinates"), None)
            if coord_el is not None and coord_el.text:
                coord_text = coord_el.text

            if not coord_text:
                continue

            puntos = parsear_coords_kml(coord_text)
            if len(puntos) < 3:
                continue

            geom = normalizar_poligono_geojson({"type": "Polygon", "coordinates": [puntos]})
            sufijo = f" ({p_idx})" if len(poligonos_xml) > 1 else ""
            resultados.append({
                "nombre_sugerido": f"{nombre}{sufijo}",
                "geometry": geom,
            })

    if not resultados:
        raise ValueError("No se encontraron polígonos válidos dentro del KML.")
    return resultados


def _parsear_geojson_texto(geojson_texto: str) -> list[dict[str, Any]]:
    try:
        data = json.loads(geojson_texto)
    except json.JSONDecodeError as exc:
        raise ValueError(f"El archivo GeoJSON no tiene formato JSON válido: {exc}") from exc

    resultados: list[dict[str, Any]] = []
    if not isinstance(data, dict):
        raise ValueError("Estructura GeoJSON inválida.")

    tipo = data.get("type")
    if tipo == "FeatureCollection":
        features = data.get("features") or []
        for idx, feat in enumerate(features, start=1):
            if not isinstance(feat, dict):
                continue
            geom_raw = feat.get("geometry")
            if not isinstance(geom_raw, dict):
                continue
            if geom_raw.get("type") in ("Polygon", "MultiPolygon"):
                geom = normalizar_poligono_geojson(geom_raw)
                resultados.append({
                    "nombre_sugerido": _extraer_nombre_props(feat.get("properties"), idx),
                    "geometry": geom,
                })
    elif tipo == "Feature":
        geom_raw = data.get("geometry")
        if isinstance(geom_raw, dict):
            resultados.append({
                "nombre_sugerido": _extraer_nombre_props(data.get("properties"), 1),
                "geometry": normalizar_poligono_geojson(geom_raw),
            })
    elif tipo in ("Polygon", "MultiPolygon"):
        resultados.append({
            "nombre_sugerido": "Lote GeoJSON 1",
            "geometry": normalizar_poligono_geojson(data),
        })

    if not resultados:
        raise ValueError("No se encontraron polígonos (Polygon/MultiPolygon) en el GeoJSON.")
    return resultados


def parsear_geometrias_archivo(
    nombre_archivo: str,
    contenido_texto: Optional[str] = None,
    contenido_base64: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Extrae uno o más polígonos normalizados desde KML, KMZ o GeoJSON."""
    nombre_lower = (nombre_archivo or "").lower().strip()

    if nombre_lower.endswith(".kmz"):
        if not contenido_base64:
            raise ValueError("Falta el contenido binario en base64 para el archivo KMZ.")
        raw_bytes = base64.b64decode(contenido_base64, validate=True)
        if len(raw_bytes) > MAX_UPLOAD_BYTES:
            raise ValueError("El archivo KMZ supera el tamaño máximo permitido (5 MB).")
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
                kml_entries = [n for n in zf.namelist() if n.lower().endswith(".kml")]
                if not kml_entries:
                    raise ValueError("El archivo KMZ no contiene ningún archivo .kml interno.")
                elegido = next((n for n in kml_entries if n.lower().endswith("doc.kml")), kml_entries[0])
                kml_bytes = zf.read(elegido)
                if len(kml_bytes) > MAX_UPLOAD_BYTES:
                    raise ValueError("El KML interno supera el tamaño máximo permitido (5 MB).")
                kml_texto = kml_bytes.decode("utf-8", errors="replace")
                return _parsear_kml_texto(kml_texto)
        except zipfile.BadZipFile as exc:
            raise ValueError("El archivo KMZ está dañado o no es un ZIP válido.") from exc

    texto = contenido_texto
    if texto is None and contenido_base64:
        raw_bytes = base64.b64decode(contenido_base64, validate=True)
        if len(raw_bytes) > MAX_UPLOAD_BYTES:
            raise ValueError("El archivo supera el tamaño máximo permitido (5 MB).")
        texto = raw_bytes.decode("utf-8", errors="replace")

    if not texto or not texto.strip():
        raise ValueError("El archivo recibido está vacío.")

    if nombre_lower.endswith(".kml") or texto.lstrip().startswith("<"):
        return _parsear_kml_texto(texto)

    return _parsear_geojson_texto(texto)


def slug_email_establecimiento(nombre_razon_social: str) -> str:
    """Genera un identificador único estable si el usuario no carga un email comercial."""
    base = re.sub(r"[^a-z0-9]+", "-", nombre_razon_social.lower()).strip("-") or "establecimiento"
    return f"{base}@agrolens.local"


def ingestar_clima_nasa_power(conn: Any, lote_id: int, lat: float, lon: float, dias: int = 60) -> int:
    """Descarga clima histórico NASA POWER (Tmax, Tmin, Lluvia, Radiación) e inserta en Postgres."""
    hoy = datetime.now(timezone.utc)
    inicio = hoy - timedelta(days=dias)
    url = "https://power.larc.nasa.gov/api/temporal/daily/point"
    params = {
        "parameters": "T2M_MAX,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN",
        "community": "AG",
        "longitude": lon,
        "latitude": lat,
        "start": inicio.strftime("%Y%m%d"),
        "end": hoy.strftime("%Y%m%d"),
        "format": "JSON",
    }

    try:
        res = requests.get(url, params=params, timeout=15)
        res.raise_for_status()
        parametros = res.json()["properties"]["parameter"]
    except Exception as exc:
        print(f"[NASA POWER] No se pudo precargar clima para lote {lote_id}: {exc}")
        return 0

    insertados = 0
    cur = conn.cursor()
    try:
        for f_str, t_max in (parametros.get("T2M_MAX") or {}).items():
            if t_max in (None, -999):
                continue
            t_min = (parametros.get("T2M_MIN") or {}).get(f_str)
            lluvia = (parametros.get("PRECTOTCORR") or {}).get(f_str)
            rad = (parametros.get("ALLSKY_SFC_SW_DWN") or {}).get(f_str)

            fecha_sql = datetime.strptime(f_str, "%Y%m%d").date()
            cur.execute(
                """
                INSERT INTO metricas_climaticas
                    (lote_id, fecha, temp_max_c, temp_min_c, precipitacion_mm, radiacion_solar_mj)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (lote_id, fecha) DO UPDATE SET
                    temp_max_c = EXCLUDED.temp_max_c,
                    temp_min_c = EXCLUDED.temp_min_c,
                    precipitacion_mm = EXCLUDED.precipitacion_mm,
                    radiacion_solar_mj = EXCLUDED.radiacion_solar_mj,
                    actualizado_en = CURRENT_TIMESTAMP;
                """,
                (
                    lote_id,
                    fecha_sql,
                    t_max,
                    None if t_min == -999 else t_min,
                    0.0 if lluvia in (None, -999) else lluvia,
                    None if rad == -999 else rad,
                ),
            )
            insertados += 1
        conn.commit()
        return insertados
    except Exception as exc:
        conn.rollback()
        print(f"[NASA POWER] Error guardando clima para lote {lote_id}: {exc}")
        return 0
    finally:
        cur.close()


def disparar_etl_satelital_github() -> bool:
    """Dispara el workflow daily_etl.yml en GitHub Actions si GITHUB_TOKEN está configurado."""
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        return False

    repo = os.getenv("GITHUB_REPO", "florencia-espeche/agrolens-ai")
    ref = os.getenv("GITHUB_BRANCH", "main")
    url = f"https://api.github.com/repos/{repo}/actions/workflows/daily_etl.yml/dispatches"
    try:
        res = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            json={"ref": ref},
            timeout=5,
        )
        return res.status_code in (201, 204)
    except Exception as exc:
        print(f"[GitHub Actions] No se pudo disparar daily_etl.yml: {exc}")
        return False
