import os
import json
from typing import List, Dict, Any
import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import requests
from google import genai

load_dotenv()

app = FastAPI(
    title="AgroLens AI API",
    description="API geoespacial, climática y de alertas agronómicas con IA",
    version="1.0.0"
)

# Habilitar CORS para que el frontend en Next.js (local y Vercel) pueda consumir la API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",  # Permite tu app y previews de Vercel
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
def obtener_series_lote(lote_id: int, dias: int = Query(90, ge=7, le=365)):
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

@app.get("/api/lotes/{lote_id}/pronostico")
def obtener_pronostico_lote(lote_id: int, dias: int = Query(7, ge=1, le=14)):
    """
    Obtiene el pronóstico agroclimático a 7 días desde Open-Meteo (sin API key)
    usando el centroide geográfico del lote en PostGIS.
    """
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT
                id,
                nombre_lote,
                ST_Y(ST_Centroid(geom)) AS lat,
                ST_X(ST_Centroid(geom)) AS lon
            FROM lotes
            WHERE id = %s;
        """, (lote_id,))
        lote = cur.fetchone()
        if not lote:
            raise HTTPException(status_code=404, detail="Lote no encontrado")
    finally:
        cur.close()
        conn.close()

    lat = float(lote["lat"])
    lon = float(lote["lon"])

    try:
        res = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat,
                "longitude": lon,
                "daily": (
                    "weather_code,temperature_2m_max,temperature_2m_min,"
                    "precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration"
                ),
                "timezone": "auto",
                "forecast_days": dias,
            },
            timeout=10,
        )
        res.raise_for_status()
        data = res.json()
        daily = data.get("daily", {})
        fechas = daily.get("time", [])

        codigos = daily.get("weather_code") or []
        t_max = daily.get("temperature_2m_max") or []
        t_min = daily.get("temperature_2m_min") or []
        lluvias = daily.get("precipitation_sum") or []
        probs = daily.get("precipitation_probability_max") or []
        et0s = daily.get("et0_fao_evapotranspiration") or []

        pronostico = []
        for i, fecha in enumerate(fechas):
            lluvia_val = float(lluvias[i]) if i < len(lluvias) and lluvias[i] is not None else 0.0
            pronostico.append({
                "fecha": fecha,
                "weather_code": codigos[i] if i < len(codigos) else None,
                "temp_max_c": t_max[i] if i < len(t_max) else None,
                "temp_min_c": t_min[i] if i < len(t_min) else None,
                "precipitacion_mm": round(lluvia_val, 1),
                "probabilidad_lluvia_pct": probs[i] if i < len(probs) else None,
                "evapotranspiracion_mm": et0s[i] if i < len(et0s) else None,
            })

        lluvia_acumulada = round(sum(d["precipitacion_mm"] for d in pronostico), 1)
        return {
            "lote_id": lote["id"],
            "nombre_lote": lote["nombre_lote"],
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "lluvia_acumulada_mm": lluvia_acumulada,
            "dias": pronostico,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"No se pudo obtener el pronóstico desde Open-Meteo: {str(e)}",
        )

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

class SuscripcionTelegram(BaseModel):
    chat_id: str

@app.post("/api/suscribir-telegram")
def suscribir_telegram(data: SuscripcionTelegram):
    chat_id = data.chat_id.strip()
    if not chat_id:
        raise HTTPException(status_code=400, detail="El chat_id de Telegram es obligatorio")

    token = os.getenv("TELEGRAM_BOT_TOKEN")

    # 1. Guardar en Supabase (crea la tabla si no existe e ignora duplicados)
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS suscriptores_telegram (
                id SERIAL PRIMARY KEY,
                chat_id TEXT UNIQUE NOT NULL,
                activo BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        cur.execute(
            """
            INSERT INTO suscriptores_telegram (chat_id, activo)
            VALUES (%s, TRUE)
            ON CONFLICT (chat_id) DO UPDATE SET activo = TRUE;
            """,
            (chat_id,),
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error guardando suscripción: {str(e)}")
    finally:
        cur.close()
        conn.close()

    # 2. Enviar mensaje de confirmación inmediato
    telegram_enviado = False
    detalle_telegram = None
    if token:
        try:
            url = f"https://api.telegram.org/bot{token}/sendMessage"
            res = requests.post(
                url,
                json={
                    "chat_id": chat_id,
                    "text": "✅ ¡Suscripción activada en AgroLens AI!\nRecibirás aquí las alertas agronómicas críticas de tus lotes.",
                    "parse_mode": "HTML",
                },
                timeout=10,
            )
            telegram_enviado = (res.status_code == 200)
            if not telegram_enviado:
                detalle_telegram = res.text
        except Exception as e:
            detalle_telegram = str(e)

    return {
        "status": "ok",
        "message": "Suscripción guardada correctamente",
        "telegram_notificado": telegram_enviado,
        "detalle": detalle_telegram,
    }

class ChatLoteRequest(BaseModel):
    lote_nombre: str
    pregunta: str
    datos: List[Dict[str, Any]]  # Últimos 60 días (fecha, ndvi, lluvia, temp)

MODELOS_CHAT = ["gemini-3.5-flash-lite", "gemini-3.8-flash"]

@app.post("/api/chat-lote")
def chat_lote(req: ChatLoteRequest):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY no configurada")

    client = genai.Client(api_key=api_key)

    # Limita a los últimos 60 registros para mantener el contexto liviano y rápido
    contexto_json = json.dumps(req.datos[-60:], ensure_ascii=False)

    prompt = f"""
Eres el asistente agronómico de AgroLens AI. Responde la pregunta del usuario sobre el lote "{req.lote_nombre}" basándote EXCLUSIVAMENTE en los datos reales provistos abajo.

Reglas:
- Cita fechas exactas y valores concretos (NDVI, mm de lluvia, °C) cuando correspondan.
- Sé conciso y claro (máximo 4 o 5 líneas).
- Si los datos no alcanzan para responder algo, dilo con honestidad sin inventar cifras.

Datos históricos del lote (JSON):
{contexto_json}

Pregunta del usuario:
{req.pregunta}
"""

    for modelo in MODELOS_CHAT:
        try:
            response = client.models.generate_content(
                model=modelo,
                contents=prompt,
            )
            return {"respuesta": response.text}
        except Exception as e:
            print(f"Fallo con {modelo}: {e}")
            continue

    raise HTTPException(
        status_code=503,
        detail="El servicio de IA tiene alta demanda en este momento. Intenta de nuevo en unos segundos.",
    )