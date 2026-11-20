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