import os
import json
import argparse
import requests
import psycopg2
import ee
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv()

ee.Initialize(project=os.getenv("GEE_PROJECT_ID"))

def get_db_connection():
    return psycopg2.connect(os.getenv("DATABASE_URL"))

def fetch_nasa_power(lat: float, lon: float, start_date: str, end_date: str) -> dict:
    """Consulta la API de Agroclimatología de NASA POWER para un punto (lat, lon)."""
    url = "https://power.larc.nasa.gov/api/temporal/daily/point"
    params = {
        "parameters": "T2M_MAX,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN",
        "community": "AG",
        "longitude": lon,
        "latitude": lat,
        "start": start_date,
        "end": end_date,
        "format": "JSON"
    }
    response = requests.get(url, params=params, timeout=30)
    response.raise_for_status()
    return response.json()["properties"]["parameter"]

def fetch_sentinel2_series(geojson_str: str, start_date: str, end_date: str) -> list[dict]:
    """
    Calcula NDVI (mediana, p10, p90) y NDWI en Google Earth Engine para TODAS las
    pasadas despejadas (< 20% nubes) dentro de la ventana de fechas.
    """
    geom_dict = json.loads(geojson_str)
    roi = ee.Geometry.Polygon(geom_dict["coordinates"])

    collection = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(roi)
        .filterDate(start_date, end_date)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
        .sort("system:time_start", True)
    )

    count = collection.size().getInfo()
    if count == 0:
        return []

    img_list = collection.toList(count)
    reducer = ee.Reducer.percentile([10, 50, 90])
    resultados = []

    for i in range(count):
        img = ee.Image(img_list.get(i))
        img_date = ee.Date(img.get("system:time_start")).format("YYYY-MM-dd").getInfo()
        cloud_pct = img.get("CLOUDY_PIXEL_PERCENTAGE").getInfo()

        ndvi = img.normalizedDifference(["B8", "B4"]).rename("NDVI")
        ndwi = img.normalizedDifference(["B8", "B11"]).rename("NDWI")
        indices_img = ndvi.addBands(ndwi)

        stats = indices_img.reduceRegion(
            reducer=reducer,
            geometry=roi,
            scale=10,
            maxPixels=1e8
        ).getInfo()

        if stats.get("NDVI_p50") is not None:
            resultados.append({
                "fecha_imagen": img_date,
                "ndvi_p10": stats.get("NDVI_p10"),
                "ndvi_mediana": stats.get("NDVI_p50"),
                "ndvi_p90": stats.get("NDVI_p90"),
                "ndwi_mediana": stats.get("NDWI_p50"),
                "nubosidad_pct": cloud_pct
            })

    return resultados

def run_etl(days: int = 7):
    conn = get_db_connection()
    cur = conn.cursor()

    hoy = datetime.now(timezone.utc)
    fecha_inicio = hoy - timedelta(days=days)
    print(f"Iniciando ETL para los últimos {days} días ({fecha_inicio.date()} a {hoy.date()})...")

    cur.execute("""
        SELECT 
            id, 
            nombre_lote,
            ST_Y(ST_Centroid(geom)) AS lat,
            ST_X(ST_Centroid(geom)) AS lon,
            ST_AsGeoJSON(geom) AS geojson
        FROM lotes;
    """)
    lotes = cur.fetchall()

    for lote_id, nombre, lat, lon, geojson in lotes:
        print(f"Procesando lote {lote_id} ({nombre})...")

        # --- 1. INGESTA NASA POWER ---
        try:
            clima = fetch_nasa_power(
                lat, lon,
                fecha_inicio.strftime("%Y%m%d"),
                hoy.strftime("%Y%m%d")
            )
            for f_str in clima["T2M_MAX"].keys():
                t_max = clima["T2M_MAX"][f_str]
                if t_max == -999:
                    continue

                fecha_sql = datetime.strptime(f_str, "%Y%m%d").date()
                cur.execute("""
                    INSERT INTO metricas_climaticas 
                        (lote_id, fecha, temp_max_c, temp_min_c, precipitacion_mm, radiacion_solar_mj)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (lote_id, fecha) DO UPDATE SET
                        temp_max_c = EXCLUDED.temp_max_c,
                        temp_min_c = EXCLUDED.temp_min_c,
                        precipitacion_mm = EXCLUDED.precipitacion_mm,
                        radiacion_solar_mj = EXCLUDED.radiacion_solar_mj,
                        actualizado_en = CURRENT_TIMESTAMP;
                """, (
                    lote_id, fecha_sql,
                    t_max,
                    clima["T2M_MIN"][f_str],
                    clima["PRECTOTCORR"][f_str],
                    clima["ALLSKY_SFC_SW_DWN"][f_str]
                ))
        except Exception as e:
            print(f"Error en NASA POWER para lote {lote_id}: {e}")

        # --- 2. INGESTA SENTINEL-2 (GEE) ---
        try:
            pasadas = fetch_sentinel2_series(
                geojson,
                fecha_inicio.strftime("%Y-%m-%d"),
                hoy.strftime("%Y-%m-%d")
            )
            print(f"  -> {len(pasadas)} imágenes despejadas encontradas en Sentinel-2.")
            for s2 in pasadas:
                cur.execute("""
                    INSERT INTO indices_satelitales
                        (lote_id, fecha_imagen, ndvi_mediana, ndvi_p10, ndvi_p90, ndwi_mediana, nubosidad_pct)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (lote_id, fecha_imagen) DO UPDATE SET
                        ndvi_mediana = EXCLUDED.ndvi_mediana,
                        ndvi_p10 = EXCLUDED.ndvi_p10,
                        ndvi_p90 = EXCLUDED.ndvi_p90,
                        ndwi_mediana = EXCLUDED.ndwi_mediana,
                        nubosidad_pct = EXCLUDED.nubosidad_pct;
                """, (
                    lote_id, s2["fecha_imagen"],
                    round(s2["ndvi_mediana"], 4),
                    round(s2["ndvi_p10"], 4),
                    round(s2["ndvi_p90"], 4),
                    round(s2["ndwi_mediana"], 4),
                    round(s2["nubosidad_pct"], 2)
                ))
        except Exception as e:
            print(f"Error en Sentinel-2 para lote {lote_id}: {e}")

    conn.commit()
    cur.close()
    conn.close()
    print("Pipeline finalizado con éxito.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ETL AgroLens AI")
    parser.add_argument("--days", type=int, default=7, help="Cantidad de días hacia atrás a ingestar")
    args = parser.parse_args()
    run_etl(days=args.days)