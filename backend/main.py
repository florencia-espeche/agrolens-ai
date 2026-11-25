import os
import json
from datetime import date
from typing import List, Dict, Any, Optional
import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
import requests
from google import genai

try:
    from backend import agro_services
except ImportError:
    import agro_services

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
    conn = psycopg2.connect(os.getenv("DATABASE_URL"), cursor_factory=RealDictCursor)
    agro_services.ensure_schema(conn)
    return conn


class EstadoAlertaUpdate(BaseModel):
    estado: str  # 'PENDIENTE', 'EN_REVISION', 'RESUELTA'


class ArchivoPoligonoRequest(BaseModel):
    nombre_archivo: str
    contenido_texto: Optional[str] = None
    contenido_base64: Optional[str] = None


class NuevoClientePayload(BaseModel):
    nombre_razon_social: str
    email_contacto: Optional[str] = None
    zona_productiva: Optional[str] = None


class LoteCreateRequest(BaseModel):
    nombre_lote: str
    cultivo_actual: str
    campana: str = "2026/2027"
    fecha_siembra: Optional[str] = None
    cliente_id: Optional[int] = None
    nuevo_cliente: Optional[NuevoClientePayload] = None
    geometry: Dict[str, Any]


class LoteUpdateRequest(BaseModel):
    nombre_lote: Optional[str] = None
    cultivo_actual: Optional[str] = None
    campana: Optional[str] = None
    fecha_siembra: Optional[str] = None
    cliente_id: Optional[int] = None
    nuevo_cliente: Optional[NuevoClientePayload] = None


class RecorridaCreateRequest(BaseModel):
    lote_id: int
    alerta_id: Optional[int] = None
    fecha_recorrida: Optional[str] = None
    autor: Optional[str] = None
    hallazgo: str
    labor_recomendada: Optional[str] = None
    costo_labor_usd_ha: float = Field(default=0.0, ge=0.0)
    nuevo_estado_alerta: Optional[str] = None


class ConfigEconomicaUpdate(BaseModel):
    ambito: str = "todos::todas"
    supuestos_cultivo: Dict[str, Any] = Field(default_factory=dict)
    es_campo_alquilado: bool = False
    arriendo_qq_soja: float = Field(default=12.0, ge=0.0)
    escenario: str = "base"


class PresupuestoLoteUpdate(BaseModel):
    rinde_objetivo_qq_ha: Optional[float] = Field(default=None, ge=0.0)
    costo_extra_usd_ha: float = Field(default=0.0, ge=0.0)
    notas_presupuesto: Optional[str] = None


def _validar_fecha_iso(valor: Optional[str]) -> Optional[date]:
    if valor is None or not valor.strip():
        return None
    try:
        return date.fromisoformat(valor.strip())
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail="Formato de fecha inválido. Use YYYY-MM-DD.",
        ) from exc


@app.get("/")
def health_check():
    return {"status": "ok", "service": "AgroLens AI API"}


@app.get("/api/clientes")
def listar_clientes():
    """Devuelve los establecimientos / clientes registrados para vincular lotes nuevos."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT id, nombre_razon_social, email_contacto, zona_productiva
            FROM clientes
            ORDER BY nombre_razon_social ASC;
        """)
        return cur.fetchall()
    finally:
        cur.close()
        conn.close()


@app.post("/api/lotes/parsear-archivo")
def parsear_archivo_poligonos(req: ArchivoPoligonoRequest):
    """Extrae polígonos desde KML, KMZ o GeoJSON para previsualización antes de guardar."""
    try:
        poligonos = agro_services.parsear_geometrias_archivo(
            nombre_archivo=req.nombre_archivo,
            contenido_texto=req.contenido_texto,
            contenido_base64=req.contenido_base64,
        )
        return {"poligonos": poligonos}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/lotes")
def obtener_lotes_geojson():
    """
    Devuelve los lotes en formato GeoJSON FeatureCollection con su último NDVI,
    metadatos fenológicos/económicos y severidad de alerta activa.
    """
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT 
                l.id,
                l.cliente_id,
                l.nombre_lote,
                l.cultivo_actual,
                l.campana,
                l.hectareas,
                l.fecha_siembra::text AS fecha_siembra,
                c.nombre_razon_social AS cliente,
                c.zona_productiva,
                ST_AsGeoJSON(l.geom) AS geojson,
                ult.ndvi_mediana AS ultimo_ndvi,
                ult.ndwi_mediana AS ultimo_ndwi,
                ult.fecha_imagen::text AS ultima_fecha_satelital,
                ult.nubosidad_pct AS ultima_nubosidad_pct,
                pl.rinde_objetivo_qq_ha AS rinde_objetivo_lote_qq_ha,
                pl.costo_extra_usd_ha AS costo_extra_usd_ha,
                pl.notas_presupuesto AS notas_presupuesto,
                COALESCE(rec.costo_labores_usd_ha, 0) AS costo_labores_recorrida_usd_ha,
                COALESCE(rec.total_recorridas, 0) AS total_recorridas,
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
            LEFT JOIN presupuestos_lote pl ON pl.lote_id = l.id
            LEFT JOIN LATERAL (
                SELECT
                    COALESCE(SUM(r.costo_labor_usd_ha), 0) AS costo_labores_usd_ha,
                    COUNT(*) AS total_recorridas
                FROM recorridas_campo r
                WHERE r.lote_id = l.id
            ) rec ON TRUE
            LEFT JOIN LATERAL (
                SELECT ndvi_mediana, ndwi_mediana, fecha_imagen, nubosidad_pct
                FROM indices_satelitales s
                WHERE s.lote_id = l.id
                ORDER BY s.fecha_imagen DESC
                LIMIT 1
            ) ult ON TRUE
            ORDER BY l.id ASC;
        """)
        rows = cur.fetchall()

        features = []
        for row in rows:
            geom = json.loads(row.pop("geojson"))
            for num_col in (
                "hectareas",
                "ultimo_ndvi",
                "ultimo_ndwi",
                "ultima_nubosidad_pct",
                "rinde_objetivo_lote_qq_ha",
                "costo_extra_usd_ha",
                "costo_labores_recorrida_usd_ha",
            ):
                if row.get(num_col) is not None:
                    row[num_col] = float(row[num_col])
            row["total_recorridas"] = int(row.get("total_recorridas") or 0)

            features.append({
                "type": "Feature",
                "geometry": geom,
                "properties": row
            })

        return {"type": "FeatureCollection", "features": features}
    finally:
        cur.close()
        conn.close()


def _resolver_o_crear_cliente(
    cur: Any,
    cliente_id: Optional[int],
    nuevo_cliente: Optional[NuevoClientePayload],
) -> tuple[int, str]:
    """Valida un cliente existente o registra uno nuevo devolviendo (id, nombre_razon_social)."""
    if cliente_id is not None:
        cur.execute(
            "SELECT id, nombre_razon_social FROM clientes WHERE id = %s;",
            (cliente_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Establecimiento / dueño no encontrado.")
        return row["id"], row["nombre_razon_social"]

    if not nuevo_cliente or not nuevo_cliente.nombre_razon_social.strip():
        raise HTTPException(
            status_code=400,
            detail="Debe seleccionar un dueño / establecimiento o crear uno nuevo.",
        )

    razon = nuevo_cliente.nombre_razon_social.strip()
    email = (
        nuevo_cliente.email_contacto.strip()
        if nuevo_cliente.email_contacto and nuevo_cliente.email_contacto.strip()
        else agro_services.slug_email_establecimiento(razon)
    )
    zona = (nuevo_cliente.zona_productiva or "").strip() or "Argentina"
    cur.execute(
        """
        INSERT INTO clientes (nombre_razon_social, email_contacto, zona_productiva)
        VALUES (%s, %s, %s)
        ON CONFLICT (email_contacto) DO UPDATE SET
            nombre_razon_social = EXCLUDED.nombre_razon_social,
            zona_productiva = EXCLUDED.zona_productiva
        RETURNING id, nombre_razon_social;
        """,
        (razon, email, zona),
    )
    row = cur.fetchone()
    return row["id"], row["nombre_razon_social"]


@app.post("/api/lotes", status_code=201)
def crear_lote(req: LoteCreateRequest):
    """
    Crea un lote (y opcionalmente su establecimiento), calcula hectáreas en PostGIS,
    precarga el historial climático de NASA POWER y dispara opcionalmente el ETL satelital.
    """
    nombre_lote = req.nombre_lote.strip()
    cultivo = req.cultivo_actual.strip()
    campana = req.campana.strip() or "2026/2027"
    if not nombre_lote or not cultivo:
        raise HTTPException(status_code=400, detail="Nombre del lote y cultivo son obligatorios.")

    fecha_siembra = _validar_fecha_iso(req.fecha_siembra)

    try:
        geom_norm = agro_services.normalizar_poligono_geojson(req.geometry)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cliente_id, cliente_nombre = _resolver_o_crear_cliente(
            cur, req.cliente_id, req.nuevo_cliente
        )

        geom_json = json.dumps(geom_norm)
        cur.execute(
            """
            WITH pol AS (
                SELECT
                    CASE
                        WHEN ST_GeometryType(raw_g) = 'ST_Polygon' THEN raw_g
                        ELSE (
                            SELECT d.geom
                            FROM ST_Dump(ST_CollectionExtract(raw_g, 3)) AS d
                            ORDER BY ST_Area(d.geom::geography) DESC
                            LIMIT 1
                        )
                    END AS geom
                FROM (
                    SELECT ST_Force2D(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))) AS raw_g
                ) sub
            )
            INSERT INTO lotes (cliente_id, nombre_lote, cultivo_actual, campana, hectareas, fecha_siembra, geom)
            SELECT
                %s,
                %s,
                %s,
                %s,
                ROUND((ST_Area(pol.geom::geography) / 10000.0)::numeric, 2),
                %s,
                pol.geom
            FROM pol
            WHERE pol.geom IS NOT NULL
            RETURNING
                id,
                nombre_lote,
                hectareas,
                ST_Y(ST_Centroid(geom)) AS lat,
                ST_X(ST_Centroid(geom)) AS lon;
            """,
            (geom_json, cliente_id, nombre_lote, cultivo, campana, fecha_siembra),
        )
        creado = cur.fetchone()
        if not creado:
            raise HTTPException(status_code=400, detail="No se pudo construir un polígono geográfico válido.")
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error creando lote: {exc}") from exc
    finally:
        cur.close()

    try:
        clima_dias = agro_services.ingestar_clima_nasa_power(
            conn,
            creado["id"],
            float(creado["lat"]),
            float(creado["lon"]),
            dias=60,
        )
    finally:
        conn.close()

    satelite_disparado = agro_services.disparar_etl_satelital_github()

    return {
        "id": creado["id"],
        "nombre_lote": creado["nombre_lote"],
        "cliente": cliente_nombre,
        "hectareas": float(creado["hectareas"] or 0),
        "clima_dias_ingestados": clima_dias,
        "satelite_workflow_disparado": satelite_disparado,
    }


@app.patch("/api/lotes/{lote_id}")
def actualizar_lote(lote_id: int, body: LoteUpdateRequest):
    """Permite editar dueño, nombre, cultivo, campaña o fecha de siembra de un lote existente."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT id, cliente_id, nombre_lote, cultivo_actual, campana, fecha_siembra FROM lotes WHERE id = %s;",
            (lote_id,),
        )
        actual = cur.fetchone()
        if not actual:
            raise HTTPException(status_code=404, detail="Lote no encontrado.")

        cliente_id = actual["cliente_id"]
        if body.cliente_id is not None or body.nuevo_cliente is not None:
            cliente_id, _ = _resolver_o_crear_cliente(
                cur, body.cliente_id, body.nuevo_cliente
            )

        nombre = body.nombre_lote.strip() if body.nombre_lote is not None else actual["nombre_lote"]
        cultivo = body.cultivo_actual.strip() if body.cultivo_actual is not None else actual["cultivo_actual"]
        campana = body.campana.strip() if body.campana is not None else actual["campana"]

        if not nombre or not cultivo:
            raise HTTPException(status_code=400, detail="Nombre del lote y cultivo no pueden quedar vacíos.")

        if body.fecha_siembra is not None:
            fecha_siembra = _validar_fecha_iso(body.fecha_siembra)
        else:
            fecha_siembra = actual["fecha_siembra"]

        cur.execute(
            """
            UPDATE lotes
            SET cliente_id = %s,
                nombre_lote = %s,
                cultivo_actual = %s,
                campana = %s,
                fecha_siembra = %s
            WHERE id = %s
            RETURNING id, cliente_id, nombre_lote, cultivo_actual, campana, fecha_siembra::text AS fecha_siembra;
            """,
            (cliente_id, nombre, cultivo, campana, fecha_siembra, lote_id),
        )
        actualizado = cur.fetchone()
        conn.commit()
        return actualizado
    except HTTPException:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


@app.delete("/api/lotes/{lote_id}")
def eliminar_lote(lote_id: int):
    """Elimina un lote y sus series asociadas (cascada configurada en esquema)."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM lotes WHERE id = %s RETURNING id, nombre_lote;", (lote_id,))
        borrado = cur.fetchone()
        if not borrado:
            raise HTTPException(status_code=404, detail="Lote no encontrado.")
        conn.commit()
        return {"status": "deleted", **borrado}
    finally:
        cur.close()
        conn.close()


@app.get("/api/recorridas")
def listar_recorridas(lote_id: Optional[int] = Query(None), limit: int = Query(50, ge=1, le=200)):
    """Devuelve la bitácora de recorridas a campo (opcionalmente filtrada por lote)."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        query = """
            SELECT
                r.id,
                r.lote_id,
                l.nombre_lote,
                r.alerta_id,
                a.tipo_anomalia AS alerta_tipo,
                r.fecha_recorrida::text AS fecha_recorrida,
                r.autor,
                r.hallazgo,
                r.labor_recomendada,
                r.costo_labor_usd_ha,
                r.creado_en
            FROM recorridas_campo r
            JOIN lotes l ON r.lote_id = l.id
            LEFT JOIN alertas_ia a ON r.alerta_id = a.id
        """
        params: list[Any] = []
        if lote_id is not None:
            query += " WHERE r.lote_id = %s"
            params.append(lote_id)
        query += " ORDER BY r.fecha_recorrida DESC, r.id DESC LIMIT %s;"
        params.append(limit)

        cur.execute(query, params)
        rows = cur.fetchall()
        for row in rows:
            if row.get("costo_labor_usd_ha") is not None:
                row["costo_labor_usd_ha"] = float(row["costo_labor_usd_ha"])
        return rows
    finally:
        cur.close()
        conn.close()


@app.post("/api/recorridas", status_code=201)
def registrar_recorrida(req: RecorridaCreateRequest):
    """
    Registra una nota de recorrida a campo y, si se indica una alerta y estado nuevo,
    actualiza dicha alerta dentro de la misma transacción.
    """
    hallazgo = req.hallazgo.strip()
    if not hallazgo:
        raise HTTPException(status_code=400, detail="El hallazgo de la recorrida es obligatorio.")

    fecha_rec = _validar_fecha_iso(req.fecha_recorrida) or date.today()
    estado_alerta = None
    if req.nuevo_estado_alerta:
        estado_alerta = req.nuevo_estado_alerta.upper().strip()
        if estado_alerta not in ("PENDIENTE", "EN_REVISION", "RESUELTA"):
            raise HTTPException(
                status_code=400,
                detail="Estado de alerta inválido. Use PENDIENTE, EN_REVISION o RESUELTA.",
            )

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM lotes WHERE id = %s;", (req.lote_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Lote no encontrado.")

        cur.execute(
            """
            INSERT INTO recorridas_campo
                (lote_id, alerta_id, fecha_recorrida, autor, hallazgo, labor_recomendada, costo_labor_usd_ha)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING
                id, lote_id, alerta_id, fecha_recorrida::text AS fecha_recorrida,
                autor, hallazgo, labor_recomendada, costo_labor_usd_ha, creado_en;
            """,
            (
                req.lote_id,
                req.alerta_id,
                fecha_rec,
                (req.autor or "").strip() or None,
                hallazgo,
                (req.labor_recomendada or "").strip() or None,
                req.costo_labor_usd_ha,
            ),
        )
        recorrida = cur.fetchone()
        if recorrida.get("costo_labor_usd_ha") is not None:
            recorrida["costo_labor_usd_ha"] = float(recorrida["costo_labor_usd_ha"])

        alerta_actualizada = None
        if req.alerta_id is not None and estado_alerta is not None:
            cur.execute(
                """
                UPDATE alertas_ia
                SET estado = %s
                WHERE id = %s AND lote_id = %s
                RETURNING id, lote_id, estado;
                """,
                (estado_alerta, req.alerta_id, req.lote_id),
            )
            alerta_actualizada = cur.fetchone()

        conn.commit()
        return {"recorrida": recorrida, "alerta_actualizada": alerta_actualizada}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error registrando recorrida: {exc}") from exc
    finally:
        cur.close()
        conn.close()


@app.get("/api/economia/configuracion")
def obtener_configuracion_economica(ambito: str = Query("todos::todas")):
    """Obtiene supuestos económicos persistidos para un ámbito cartera/cliente y presupuestos por lote."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT clave_ambito, supuestos_cultivo, es_campo_alquilado, arriendo_qq_soja, escenario, actualizado_en
            FROM configuracion_economica_cartera
            WHERE clave_ambito = %s
            LIMIT 1;
            """,
            (ambito,),
        )
        config = cur.fetchone()
        if config and config.get("arriendo_qq_soja") is not None:
            config["arriendo_qq_soja"] = float(config["arriendo_qq_soja"])

        cur.execute(
            """
            SELECT lote_id, rinde_objetivo_qq_ha, costo_extra_usd_ha, notas_presupuesto
            FROM presupuestos_lote;
            """
        )
        presupuestos = {}
        for row in cur.fetchall():
            presupuestos[str(row["lote_id"])] = {
                "rinde_objetivo_qq_ha": (
                    float(row["rinde_objetivo_qq_ha"])
                    if row["rinde_objetivo_qq_ha"] is not None
                    else None
                ),
                "costo_extra_usd_ha": float(row["costo_extra_usd_ha"] or 0),
                "notas_presupuesto": row["notas_presupuesto"],
            }

        return {"configuracion": config, "presupuestos_lote": presupuestos}
    finally:
        cur.close()
        conn.close()


@app.put("/api/economia/configuracion")
def guardar_configuracion_economica(body: ConfigEconomicaUpdate):
    """Guarda los supuestos económicos, arriendo y escenario para un ámbito en PostgreSQL."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO configuracion_economica_cartera
                (clave_ambito, supuestos_cultivo, es_campo_alquilado, arriendo_qq_soja, escenario, actualizado_en)
            VALUES (%s, %s::jsonb, %s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (clave_ambito) DO UPDATE SET
                supuestos_cultivo = EXCLUDED.supuestos_cultivo,
                es_campo_alquilado = EXCLUDED.es_campo_alquilado,
                arriendo_qq_soja = EXCLUDED.arriendo_qq_soja,
                escenario = EXCLUDED.escenario,
                actualizado_en = CURRENT_TIMESTAMP
            RETURNING clave_ambito, supuestos_cultivo, es_campo_alquilado, arriendo_qq_soja, escenario;
            """,
            (
                body.ambito,
                json.dumps(body.supuestos_cultivo),
                body.es_campo_alquilado,
                body.arriendo_qq_soja,
                body.escenario,
            ),
        )
        saved = cur.fetchone()
        conn.commit()
        if saved.get("arriendo_qq_soja") is not None:
            saved["arriendo_qq_soja"] = float(saved["arriendo_qq_soja"])
        return saved
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error guardando configuración económica: {exc}") from exc
    finally:
        cur.close()
        conn.close()


@app.put("/api/economia/lotes/{lote_id}")
def guardar_presupuesto_lote(lote_id: int, body: PresupuestoLoteUpdate):
    """Guarda rinde objetivo individual y costos extra ejecutados para un lote específico."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM lotes WHERE id = %s;", (lote_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Lote no encontrado.")

        cur.execute(
            """
            INSERT INTO presupuestos_lote
                (lote_id, rinde_objetivo_qq_ha, costo_extra_usd_ha, notas_presupuesto, actualizado_en)
            VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (lote_id) DO UPDATE SET
                rinde_objetivo_qq_ha = EXCLUDED.rinde_objetivo_qq_ha,
                costo_extra_usd_ha = EXCLUDED.costo_extra_usd_ha,
                notas_presupuesto = EXCLUDED.notas_presupuesto,
                actualizado_en = CURRENT_TIMESTAMP
            RETURNING lote_id, rinde_objetivo_qq_ha, costo_extra_usd_ha, notas_presupuesto;
            """,
            (
                lote_id,
                body.rinde_objetivo_qq_ha,
                body.costo_extra_usd_ha,
                (body.notas_presupuesto or "").strip() or None,
            ),
        )
        saved = cur.fetchone()
        conn.commit()
        return {
            "lote_id": saved["lote_id"],
            "rinde_objetivo_qq_ha": (
                float(saved["rinde_objetivo_qq_ha"])
                if saved["rinde_objetivo_qq_ha"] is not None
                else None
            ),
            "costo_extra_usd_ha": float(saved["costo_extra_usd_ha"] or 0),
            "notas_presupuesto": saved["notas_presupuesto"],
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error guardando presupuesto del lote: {exc}") from exc
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
def obtener_alertas(estado: Optional[str] = Query(None, description="Filtrar por PENDIENTE, EN_REVISION o RESUELTA")):
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
    recorridas: List[Dict[str, Any]] = Field(default_factory=list)

MODELOS_CHAT = ["gemini-3.5-flash-lite", "gemini-3.8-flash"]

@app.post("/api/chat-lote")
def chat_lote(req: ChatLoteRequest):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY no configurada")

    client = genai.Client(api_key=api_key)

    # Limita a los últimos 60 registros para mantener el contexto liviano y rápido
    contexto_json = json.dumps(req.datos[-60:], ensure_ascii=False)
    recorridas_json = json.dumps(req.recorridas[-15:], ensure_ascii=False)

    prompt = f"""
Eres el asistente agronómico de AgroLens AI. Responde la pregunta del usuario sobre el lote "{req.lote_nombre}" basándote EXCLUSIVAMENTE en los datos reales provistos abajo.

Reglas:
- Cita fechas exactas y valores concretos (NDVI, mm de lluvia, °C) o hallazgos de recorridas cuando correspondan.
- Sé conciso y claro (máximo 4 o 5 líneas).
- Si los datos no alcanzan para responder algo, dilo con honestidad sin inventar cifras.

Datos históricos del lote (JSON):
{contexto_json}

Bitácora de recorridas a campo registradas (JSON):
{recorridas_json}

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