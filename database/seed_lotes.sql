-- 1. Insertar clientes de prueba
INSERT INTO clientes (nombre_razon_social, email_contacto, zona_productiva)
VALUES 
    ('Establecimiento La Pampa S.A.', 'gerencia@lapampasa.com.ar', 'Zona Núcleo - Marcos Juárez'),
    ('Agropecuaria del Sur S.R.L.', 'contacto@agropecuariadelsur.com.ar', 'Sur y Norte de Córdoba')
ON CONFLICT (email_contacto) DO NOTHING;

-- 2. Insertar 4 lotes agrícolas en Córdoba (Coordenadas Lon/Lat en WGS 84 - SRID 4326)
INSERT INTO lotes (cliente_id, nombre_lote, cultivo_actual, campana, geom)
VALUES
    -- Lote 1: Marcos Juárez (Sudeste - Zona Núcleo)
    (
        (SELECT id FROM clientes WHERE email_contacto = 'gerencia@lapampasa.com.ar'),
        'Lote 01 - El Ombú (Marcos Juárez)',
        'Soja 1ra',
        '2026/2027',
        ST_GeomFromText('POLYGON((
            -62.1350 -32.7250,
            -62.1240 -32.7250,
            -62.1240 -32.7160,
            -62.1350 -32.7160,
            -62.1350 -32.7250
        ))', 4326)
    ),
    -- Lote 2: Villa María (Centro-Sur)
    (
        (SELECT id FROM clientes WHERE email_contacto = 'gerencia@lapampasa.com.ar'),
        'Lote 02 - La Posta (Villa María)',
        'Maíz Temprano',
        '2026/2027',
        ST_GeomFromText('POLYGON((
            -63.2150 -32.4650,
            -63.2040 -32.4650,
            -63.2040 -32.4560,
            -63.2150 -32.4560,
            -63.2150 -32.4650
        ))', 4326)
    ),
    -- Lote 3: Río Cuarto (Sur)
    (
        (SELECT id FROM clientes WHERE email_contacto = 'contacto@agropecuariadelsur.com.ar'),
        'Lote 03 - Las Higueras (Río Cuarto)',
        'Maíz Tardío',
        '2026/2027',
        ST_GeomFromText('POLYGON((
            -64.2650 -33.1650,
            -64.2530 -33.1650,
            -64.2530 -33.1550,
            -64.2650 -33.1550,
            -64.2650 -33.1650
        ))', 4326)
    ),
    -- Lote 4: Jesús María / Sinsacate (Norte)
    (
        (SELECT id FROM clientes WHERE email_contacto = 'contacto@agropecuariadelsur.com.ar'),
        'Lote 04 - Los Algarrobos (Jesús María)',
        'Trigo / Soja 2da',
        '2026/2027',
        ST_GeomFromText('POLYGON((
            -64.0620 -30.9620,
            -64.0520 -30.9620,
            -64.0520 -30.9540,
            -64.0620 -30.9540,
            -64.0620 -30.9620
        ))', 4326)
    );

-- 3. Calcular automáticamente la superficie real en hectáreas desde el polígono
UPDATE lotes
SET hectareas = ROUND((ST_Area(geom::geography) / 10000.0)::numeric, 2)
WHERE hectareas IS NULL;