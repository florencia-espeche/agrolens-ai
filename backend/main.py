import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="AgroLens AI API",
    description="API geoespacial, climática y de alertas agronómicas con IA",
    version="1.0.0"
)

# Habilitar CORS para que el frontend en Next.js (puerto 3000) pueda consumir la API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db_connection():
    return psycopg2.connect(os.getenv("DATABASE_URL"), cursor_factory=RealDictCursor)

class EstadoAlertaUpdate(BaseModel):
    estado: str  # 'PENDIENTE', 'EN_REVISION', 'RESUELTA'

@app.get("/")
def health_check():
    return {"status": "ok", "service": "AgroLens AI API"}

@app.get("/api/lotes")
def obtener_lotes_geojson():
    """
    Devuelve los lotes en formato GeoJSON FeatureCollection con su último NDVI
    y la severidad de alerta más alta pendiente (listo para Leaflet/Mapbox).
    """
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT 
                l.id,
                l.nombre_lote,
                l.cultivo_actual,
                l.campana,
                l.hectareas,
                c.nombre_razon_social AS cliente,
                c.zona_productiva,
                ST_AsGeoJSON(l.geom) AS geojson,
                (
                    SELECT ndvi_mediana FROM indices_satelitales s
                    WHERE s.lote_id = l.id
                    ORDER BY s.fecha_imagen DESC LIMIT 1
                ) AS ultimo_ndvi,
                (
                    SELECT ndwi_mediana FROM indices_satelitales s
                    WHERE s.lote_id = l.id
                    ORDER BY s.fecha_imagen DESC LIMIT 1
                ) AS ultimo_ndwi,
                (
                    SELECT nivel_severidad FROM alertas_ia a
                    WHERE a.lote_id = l.id AND a.estado != 'RESUELTA'
                    ORDER BY CASE a.nivel_severidad
                        WHEN 'CRITICA' THEN 1
                        WHEN 'ALTA' THEN 2
                        WHEN 'MEDIA' THEN 3
                        ELSE 4 END
                    LIMIT 1
                ) AS alerta_activa
            FROM lotes l
            JOIN clientes c ON l.cliente_id = c.id
            ORDER BY l.id ASC;
        """)
        rows = cur.fetchall()

        features = []
        for row in rows:
            geom = json.loads(row.pop("geojson"))
            if row["hectareas"] is not None:
                row["hectareas"] = float(row["hectareas"])
            if row["ultimo_ndvi"] is not None:
                row["ultimo_ndvi"] = float(row["ultimo_ndvi"])
            if row["ultimo_ndwi"] is not None:
                row["ultimo_ndwi"] = float(row["ultimo_ndwi"])

            features.append({
                "type": "Feature",
                "geometry": geom,
                "properties": row
            })

        return {"type": "FeatureCollection", "features": features}
    finally:
        cur.close()
        conn.close()

@app.get("/api/lotes/{lote_id}/series")
def obtener_series_lote(lote_id: int, dias: int = Query(60, ge=7, le=365)):
    """Devuelve las series temporales de clima (NASA POWER) e índices (Sentinel-2) de un lote."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id, nombre_lote, cultivo_actual FROM lotes WHERE id = %s;", (lote_id,))
        lote = cur.fetchone()
        if not lote:
            raise HTTPException(status_code=404, detail="Lote no encontrado")

        cur.execute("""
            SELECT fecha, temp_max_c, temp_min_c, precipitacion_mm, radiacion_solar_mj
            FROM metricas_climaticas
            WHERE lote_id = %s AND fecha >= CURRENT_DATE - (%s || ' days')::INTERVAL
            ORDER BY fecha ASC;
        """, (lote_id, dias))
        clima = cur.fetchall()

        cur.execute("""
            SELECT fecha_imagen, ndvi_mediana, ndvi_p10, ndvi_p90, ndwi_mediana, nubosidad_pct
            FROM indices_satelitales
            WHERE lote_id = %s AND fecha_imagen >= CURRENT_DATE - (%s || ' days')::INTERVAL
            ORDER BY fecha_imagen ASC;
        """, (lote_id, dias))
        satelite = cur.fetchall()

        return {
            "lote": lote,
            "clima": clima,
            "satelite": satelite
        }
    finally:
        cur.close()
        conn.close()

@app.get("/api/alertas")
def obtener_alertas(estado: str | None = Query(None, description="Filtrar por PENDIENTE, EN_REVISION o RESUELTA")):
    """Devuelve el feed de alertas generadas por IA para el panel de triage."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        query = """
            SELECT 
                a.id,
                a.lote_id,
                l.nombre_lote,
                l.cultivo_actual,
                c.nombre_razon_social AS cliente,
                c.zona_productiva,
                a.fecha_deteccion,
                a.nivel_severidad,
                a.tipo_anomalia,
                a.score_anomalia,
                a.diagnostico_llm,
                a.estado
            FROM alertas_ia a
            JOIN lotes l ON a.lote_id = l.id
            JOIN clientes c ON l.cliente_id = c.id
        """
        params = []
        if estado:
            query += " WHERE a.estado = %s"
            params.append(estado.upper())

        query += " ORDER BY a.fecha_deteccion DESC;"
        cur.execute(query, params)
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()

@app.patch("/api/alertas/{alerta_id}")
def actualizar_estado_alerta(alerta_id: int, body: EstadoAlertaUpdate):
    """Permite al equipo agronómico marcar una alerta como EN_REVISION o RESUELTA."""
    estado_nuevo = body.estado.upper()
    if estado_nuevo not in ("PENDIENTE", "EN_REVISION", "RESUELTA"):
        raise HTTPException(status_code=400, detail="Estado inválido. Use PENDIENTE, EN_REVISION o RESUELTA.")

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            UPDATE alertas_ia
            SET estado = %s
            WHERE id = %s
            RETURNING id, lote_id, estado;
        """, (estado_nuevo, alerta_id))
        actualizada = cur.fetchone()
        if not actualizada:
            raise HTTPException(status_code=404, detail="Alerta no encontrada")
        conn.commit()
        return actualizada
    finally:
        cur.close()
        conn.close()