-- Habilitar extensión geoespacial
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Clientes / Productores
CREATE TABLE clientes (
    id SERIAL PRIMARY KEY,
    nombre_razon_social VARCHAR(150) NOT NULL,
    email_contacto VARCHAR(150) UNIQUE NOT NULL,
    zona_productiva VARCHAR(100),
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Lotes (Polígonos geoespaciales en WGS 84 - SRID 4326)
CREATE TABLE lotes (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
    nombre_lote VARCHAR(100) NOT NULL,
    cultivo_actual VARCHAR(50),
    campana VARCHAR(20),
    hectareas NUMERIC(10, 2),
    fecha_siembra DATE,
    geom GEOMETRY(Polygon, 4326) NOT NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índice espacial para acelerar consultas geoespaciales
CREATE INDEX idx_lotes_geom ON lotes USING GIST (geom);

-- 3. Serie Temporal: Clima Diario (NASA POWER / IMERG / SMAP)
CREATE TABLE metricas_climaticas (
    id BIGSERIAL PRIMARY KEY,
    lote_id INTEGER REFERENCES lotes(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    temp_max_c NUMERIC(5, 2),
    temp_min_c NUMERIC(5, 2),
    precipitacion_mm NUMERIC(6, 2),
    radiacion_solar_mj NUMERIC(6, 2),
    humedad_suelo_smap NUMERIC(5, 3),
    fuente VARCHAR(50) DEFAULT 'NASA_POWER',
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_clima_lote_fecha UNIQUE (lote_id, fecha)
);

-- 4. Serie Temporal: Índices Satelitales (Sentinel-2 / ECOSTRESS)
CREATE TABLE indices_satelitales (
    id BIGSERIAL PRIMARY KEY,
    lote_id INTEGER REFERENCES lotes(id) ON DELETE CASCADE,
    fecha_imagen DATE NOT NULL,
    ndvi_mediana NUMERIC(5, 4),
    ndvi_p10 NUMERIC(5, 4),
    ndvi_p90 NUMERIC(5, 4),
    ndwi_mediana NUMERIC(5, 4),
    nubosidad_pct NUMERIC(5, 2),
    satelite VARCHAR(50) DEFAULT 'SENTINEL-2',
    CONSTRAINT uq_satelite_lote_fecha UNIQUE (lote_id, fecha_imagen)
);

-- 5. Salida de Modelos Predictivos e IA Generativa (Triage Interno)
CREATE TABLE alertas_ia (
    id SERIAL PRIMARY KEY,
    lote_id INTEGER REFERENCES lotes(id) ON DELETE CASCADE,
    fecha_deteccion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    nivel_severidad VARCHAR(20) CHECK (nivel_severidad IN ('BAJA', 'MEDIA', 'ALTA', 'CRITICA')),
    tipo_anomalia VARCHAR(100),
    score_anomalia NUMERIC(5, 4),
    diagnostico_llm TEXT,
    estado VARCHAR(20) DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'EN_REVISION', 'RESUELTA'))
);

-- 6. Bitácora de Recorridas a Campo (cierre agronómico de alertas y visitas)
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
CREATE INDEX IF NOT EXISTS idx_recorridas_lote_id ON recorridas_campo (lote_id);

-- 7. Configuración Económica Persistida por Cartera / Establecimiento / Campaña
CREATE TABLE IF NOT EXISTS configuracion_economica_cartera (
    id SERIAL PRIMARY KEY,
    clave_ambito VARCHAR(200) UNIQUE NOT NULL,
    supuestos_cultivo JSONB NOT NULL DEFAULT '{}'::jsonb,
    es_campo_alquilado BOOLEAN NOT NULL DEFAULT FALSE,
    arriendo_qq_soja NUMERIC(6, 2) NOT NULL DEFAULT 12,
    escenario VARCHAR(40) NOT NULL DEFAULT 'base',
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Presupuesto y Rinde Esperado Individual por Lote
CREATE TABLE IF NOT EXISTS presupuestos_lote (
    lote_id INTEGER PRIMARY KEY REFERENCES lotes(id) ON DELETE CASCADE,
    rinde_objetivo_qq_ha NUMERIC(8, 2),
    costo_extra_usd_ha NUMERIC(10, 2) DEFAULT 0,
    notas_presupuesto TEXT,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);