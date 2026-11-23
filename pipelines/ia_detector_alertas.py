import os
import json
import psycopg2
import pandas as pd
from sklearn.ensemble import IsolationForest
from google import genai
from google.genai import types
from dotenv import load_dotenv
import time
import requests

load_dotenv()

# Inicializar cliente de Gemini (lee GEMINI_API_KEY automáticamente desde .env)
client = genai.Client(http_options=types.HttpOptions(timeout=15000))

def get_db_connection():
    return psycopg2.connect(os.getenv("DATABASE_URL"))

def obtener_datos_lote(conn, lote_id: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Extrae los últimos 20 registros satelitales y los últimos 14 días de clima."""
    query_sat = """
        SELECT fecha_imagen, ndvi_mediana, ndvi_p10, ndvi_p90, ndwi_mediana
        FROM indices_satelitales
        WHERE lote_id = %s
        ORDER BY fecha_imagen DESC
        LIMIT 20;
    """
    query_clima = """
        SELECT fecha, temp_max_c, temp_min_c, precipitacion_mm, humedad_suelo_smap
        FROM metricas_climaticas
        WHERE lote_id = %s
          AND fecha >= CURRENT_DATE - INTERVAL '14 days'
        ORDER BY fecha ASC;
    """
    df_sat = pd.read_sql(query_sat, conn, params=(lote_id,)).sort_values("fecha_imagen")
    df_clima = pd.read_sql(query_clima, conn, params=(lote_id,))
    return df_sat, df_clima

def analizar_anomalia(df_sat: pd.DataFrame, df_clima: pd.DataFrame) -> dict | None:
    """
    Enfoque híbrido:
    - Isolation Forest sobre la serie de NDVI/NDWI (si hay al menos 5 pasadas).
    - Reglas agronómicas para clasificar el tipo de estrés y severidad.
    """
    if len(df_sat) < 2:
        return None  # Sin historial mínimo para comparar

    ultimo = df_sat.iloc[-1]
    anterior = df_sat.iloc[-2]

    # 1. Feature Engineering
    caida_ndvi_pct = ((ultimo["ndvi_mediana"] - anterior["ndvi_mediana"]) / max(anterior["ndvi_mediana"], 0.01)) * 100
    heterogeneidad = float(ultimo["ndvi_p90"] - ultimo["ndvi_p10"])
    lluvia_14d = float(df_clima["precipitacion_mm"].sum()) if not df_clima.empty else 0.0
    dias_calor_extremo = int((df_clima["temp_max_c"] >= 35.0).sum()) if not df_clima.empty else 0

    # 2. Score de anomalía con Isolation Forest (si hay suficiente historia)
    ml_anomalia = False
    score_anomalia = 0.0
    if len(df_sat) >= 5:
        features = df_sat[["ndvi_mediana", "ndvi_p10", "ndwi_mediana"]].dropna()
        if len(features) >= 5:
            iso = IsolationForest(contamination=0.15, random_state=42)
            iso.fit(features)
            pred = iso.predict(features.iloc[[-1]])[0]
            raw_score = iso.decision_function(features.iloc[[-1]])[0]
            score_anomalia = round(max(0.0, min(1.0, 0.5 - raw_score)), 4)
            ml_anomalia = (pred == -1)

    # 3. Clasificación de negocio (Reglas + ML)
    if caida_ndvi_pct <= -15.0 and dias_calor_extremo >= 3:
        severidad = "CRITICA"
        tipo = "Caída abrupta de NDVI + Estrés Térmico"
    elif caida_ndvi_pct <= -10.0 or (ml_anomalia and ultimo["ndwi_mediana"] < 0.1):
        severidad = "ALTA"
        tipo = "Déficit Hídrico / Pérdida de Vigor"
    elif heterogeneidad >= 0.25:
        severidad = "MEDIA"
        tipo = "Alta Heterogeneidad Intra-Lote (Posible manchoneo/malezas)"
    else:
        return None  # Lote operando dentro de parámetros normales

    return {
        "nivel_severidad": severidad,
        "tipo_anomalia": tipo,
        "score_anomalia": score_anomalia if score_anomalia > 0 else 0.75,
        "metricas_contexto": {
            "fecha_ultima_imagen": str(ultimo["fecha_imagen"]),
            "ndvi_actual": round(float(ultimo["ndvi_mediana"]), 3),
            "variacion_ndvi_pct": round(float(caida_ndvi_pct), 1),
            "heterogeneidad_p90_p10": round(heterogeneidad, 3),
            "ndwi_actual": round(float(ultimo["ndwi_mediana"]), 3),
            "lluvia_acumulada_14d_mm": round(lluvia_14d, 1),
            "dias_temp_mayor_35c": dias_calor_extremo
        }
    }

def generar_diagnostico_llm(lote_info: dict, anomalia: dict) -> str:
    """Usa Gemini con reintento automático y fallback determinístico ante errores 503."""
    m = anomalia["metricas_contexto"]
    prompt = f"""
Eres un ingeniero agrónomo analizando una anomalía detectada por satélite (Sentinel-2) y datos climáticos (NASA POWER).

Datos del lote {lote_info['nombre_lote']} ({lote_info['cultivo_actual']}, {lote_info['zona_productiva']}):
- Tipo de anomalía: {anomalia['tipo_anomalia']} (Severidad: {anomalia['nivel_severidad']})
- NDVI actual: {m['ndvi_actual']:.3f} (variación reciente: {m['variacion_ndvi_pct']}%)
- NDWI actual (humedad foliar): {m['ndwi_actual']}
- Precipitación acumulada (14 días): {m['lluvia_acumulada_14d_mm']:.1f} mm
- Días con temperatura > 35°C: {m['dias_temp_mayor_35c']}

Redacta un diagnóstico conciso usando EXACTAMENTE estas 3 etiquetas (una por línea, máximo 25 palabras por sección, sin introducción ni saludos):

QUE_PASO: [Dato concreto de la anomalía en el vigor vegetal]
CAUSA_PROBABLE: [Cruce con las variables climáticas o hipótesis agronómica]
ACCION_SUGERIDA: [Paso práctico y específico para revisar a campo]
"""

    for intento in range(2):
        try:
            response = client.models.generate_content(
                model="gemini-3.8-flash",
                contents=prompt,
                config=types.GenerateContentConfig(temperature=0.2)
            )
            return response.text.strip()
        except Exception as e:
            print(f"Aviso: Gemini no disponible (intento {intento + 1}/2): {e}")
            time.sleep(3)

    # Fallback determinístico estructurado si la API está temporalmente saturada
    return (
        f"QUE_PASO: Caída en vigor vegetal con NDVI en {m['ndvi_actual']} (variación de {m['variacion_ndvi_pct']}%) detectado por Sentinel-2.\n"
        f"CAUSA_PROBABLE: Condiciones hidro-térmicas con {m['lluvia_acumulada_14d_mm']} mm de lluvia en 14d y {m['dias_temp_mayor_35c']} días de estrés térmico.\n"
        f"ACCION_SUGERIDA: Realizar recorrida a campo priorizando sectores con menor índice de vegetación para evaluar sanidad foliar y perfil de humedad."
    )

def run_ia_pipeline():
    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute("""
        SELECT l.id, l.nombre_lote, l.cultivo_actual, l.campana, l.hectareas, c.zona_productiva
        FROM lotes l
        JOIN clientes c ON l.cliente_id = c.id;
    """)
    lotes = cur.fetchall()

    for row in lotes:
        lote_info = {
            "id": row[0], "nombre_lote": row[1], "cultivo_actual": row[2],
            "campana": row[3], "hectareas": float(row[4] or 0), "zona_productiva": row[5]
        }

        df_sat, df_clima = obtener_datos_lote(conn, lote_info["id"])
        anomalia = analizar_anomalia(df_sat, df_clima)

        if not anomalia:
            print(f"[OK] Lote {lote_info['nombre_lote']}: sin anomalías detectadas.")
            continue

        # Evitar duplicar alertas pendientes del mismo tipo para el mismo lote en las últimas 48hs
        cur.execute("""
            SELECT 1 FROM alertas_ia
            WHERE lote_id = %s
              AND tipo_anomalia = %s
              AND estado = 'PENDIENTE'
              AND fecha_deteccion >= NOW() - INTERVAL '48 hours';
        """, (lote_info["id"], anomalia["tipo_anomalia"]))

        if cur.fetchone():
            print(f"Alerta ya existente para lote {lote_info['id']}, omitiendo.")
            continue

        diagnostico = generar_diagnostico_llm(lote_info, anomalia)

        cur.execute("""
            INSERT INTO alertas_ia
                (lote_id, nivel_severidad, tipo_anomalia, score_anomalia, diagnostico_llm)
            VALUES (%s, %s, %s, %s, %s);
        """, (
            lote_info["id"],
            anomalia["nivel_severidad"],
            anomalia["tipo_anomalia"],
            float(anomalia["score_anomalia"]),
            diagnostico
        ))
        conn.commit()
        print(f"[ALERTA {anomalia['nivel_severidad']}] Lote {lote_info['nombre_lote']}: {diagnostico}")

        # Notificar a los suscriptores de Telegram
        notificar_telegram(lote_info["nombre_lote"], diagnostico, anomalia["nivel_severidad"], conn)

    cur.close()
    conn.close()

def notificar_telegram(nombre_lote: str, diagnostico: str, severidad: str, conn):
    """Envía la alerta detectada a todos los suscriptores activos en Telegram."""
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        print("[Telegram] TELEGRAM_BOT_TOKEN no configurado, omitiendo notificación.")
        return

    try:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS suscriptores_telegram (
                id SERIAL PRIMARY KEY,
                chat_id TEXT UNIQUE NOT NULL,
                activo BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        conn.commit()
        cur.execute("SELECT chat_id FROM suscriptores_telegram WHERE activo = TRUE;")
        suscriptores = [row[0] for row in cur.fetchall()]
        cur.close()
    except Exception as e:
        print(f"[Telegram] Error consultando suscriptores: {e}")
        return

    if not suscriptores:
        print("[Telegram] No hay suscriptores activos registrados.")
        return

    # Formatear el diagnóstico para Telegram con HTML seguro (evita errores con guiones bajos)
    diag_formateado = (
        diagnostico
        .replace("QUE_PASO:", "🔍 <b>Qué pasó:</b>")
        .replace("CAUSA_PROBABLE:", "⚠️ <b>Causa probable:</b>")
        .replace("ACCION_SUGERIDA:", "🌱 <b>Acción sugerida:</b>")
    )

    icono = "🚨" if severidad == "CRITICA" else "⚠️"
    mensaje = (
        f"{icono} <b>Alerta {severidad} — AgroLens AI</b>\n"
        f"📍 <b>Lote:</b> {nombre_lote}\n\n"
        f"{diag_formateado}"
    )

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    for chat_id in suscriptores:
        try:
            res = requests.post(
                url,
                json={"chat_id": chat_id, "text": mensaje, "parse_mode": "HTML"},
                timeout=10,
            )
            if res.status_code == 200:
                print(f"[Telegram] Alerta enviada con éxito a chat_id {chat_id}")
            else:
                print(f"[Telegram] Fallo enviando a {chat_id}: {res.status_code} - {res.text}")
        except Exception as e:
            print(f"[Telegram] Error de red enviando a {chat_id}: {e}")

if __name__ == "__main__":
    run_ia_pipeline()