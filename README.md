# 🌱 AgroLens AI

Plataforma full-stack de monitoreo agrícola inteligente que integra imágenes satelitales (**Sentinel-2** vía Google Earth Engine), datos agroclimáticos (**NASA POWER**) y detección de anomalías con **Machine Learning e Inteligencia Artificial** para generar alertas tempranas y diagnósticos agronómicos interactivos.

[![Next.js](https://img.shields.io/badge/Frontend-Next.js%2016-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![PostgreSQL](https://img.shields.io/badge/Database-Supabase%20%2F%20PostGIS-336791?logo=postgresql&logoColor=white)](https://supabase.com/)
[![Google Earth Engine](https://img.shields.io/badge/Satelital-Sentinel--2%20%2F%20GEE-4285F4?logo=google&logoColor=white)](https://earthengine.google.com/)
[![Gemini](https://img.shields.io/badge/AI-Google%20Gemini%20API-8E75C2?logo=google-gemini&logoColor=white)](https://ai.google.dev/)
[![Render](https://img.shields.io/badge/Deploy-Render-46E3B7?logo=render&logoColor=white)](https://render.com/)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel&logoColor=white)](https://vercel.com/)

---

## 🔗 Enlaces del Proyecto

- **Demo en vivo (Frontend):** [https://agrolens-ai-ochre.vercel.app/](https://agrolens-ai-ochre.vercel.app/)
- **API en producción (Backend):** [https://agrolens-ai-bs39.onrender.com](https://agrolens-ai-bs39.onrender.com)
- **Documentación interactiva de la API:** [https://agrolens-ai-bs39.onrender.com/docs](https://agrolens-ai-bs39.onrender.com/docs)

---

## 📐 Arquitectura del Sistema

```mermaid
flowchart LR
    A["🛰️ Sentinel-2 (GEE) & NASA POWER"] -->|ETL diario - GitHub Actions| B[("🗄️ Supabase (PostgreSQL + PostGIS)")]
    B -->|Isolation Forest + Gemini AI| B
    B --> C["⚡ Backend (FastAPI en Render)"]
    C -->|REST API + GeoJSON| D["💻 Dashboard (Next.js en Vercel)"]
```

### Componentes Clave

1. **Ingesta automatizada (GitHub Actions):**  
   Pipeline programado (cron diario a las 09:00 UTC) que extrae índices de vegetación e hídricos (**NDVI**, **NDWI**) desde Google Earth Engine y variables agroclimáticas (temperaturas, precipitaciones, radiación solar) desde la API de NASA POWER.
2. **Detección de anomalías y Diagnóstico con IA:**  
   Un modelo no supervisado (**Isolation Forest**) analiza desviaciones en la evolución de los índices de cada lote en relación con las condiciones climáticas. Si se detecta una anomalía significativa, la **API de Google Gemini** genera un diagnóstico técnico agronómico claro, contextualizado y accionable.
3. **API REST Geoespacial (FastAPI en Render):**  
   Servicio backend que procesa y sirve los polígonos de las parcelas en formato **GeoJSON**, provee series temporales consolidadas y gestiona el ciclo de vida de las alertas mediante endpoints REST.
4. **Dashboard Interactivo (Next.js en Vercel):**  
   Interfaz moderna con soporte para mapas interactivos (**Leaflet** / **React-Leaflet**), gráficos de evolución temporal (**Recharts**) y una consola de triage para que los ingenieros agrónomos gestionen el estado de las alertas en tiempo real.

---

## 🛠️ Stack Tecnológico

| Capa | Tecnologías |
|---|---|
| **Frontend** | [Next.js 16](https://nextjs.org/) (App Router), [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS v4](https://tailwindcss.com/), [React-Leaflet](https://react-leaflet.js.org/), [Recharts](https://recharts.org/), [Lucide React](https://lucide.dev/) |
| **Backend** | [Python 3.13](https://www.python.org/), [FastAPI](https://fastapi.tiangolo.com/), [Uvicorn](https://www.uvicorn.org/), [Psycopg2](https://www.psycopg.org/), [Pydantic](https://docs.pydantic.dev/) |
| **Base de Datos** | [PostgreSQL](https://www.postgresql.org/) con extensión geoespacial [PostGIS](https://postgis.net/) alojado en [Supabase](https://supabase.com/) |
| **Data & Machine Learning** | [Google Earth Engine](https://earthengine.google.com/), [NASA POWER API](https://power.larc.nasa.gov/), [Pandas](https://pandas.pydata.org/), [Scikit-Learn](https://scikit-learn.org/), [Google Gemini API](https://ai.google.dev/) (`google-genai`) |
| **DevOps & CI/CD** | [GitHub Actions](https://github.com/features/actions) (ejecución diaria automatizada), [Render](https://render.com/) (Web Service Backend), [Vercel](https://vercel.com/) (Hosting Frontend) |

---

## 📁 Estructura del Proyecto

```text
agrolens-ai/
├── .github/workflows/
│   └── daily_etl.yml          # Workflow de GitHub Actions (ETL diario + Detector de alertas)
├── backend/
│   ├── main.py                # Endpoints FastAPI (GeoJSON, series temporales, alertas)
│   └── requirements.txt       # Dependencias livianas para despliegue en Render
├── database/
│   ├── schema.sql             # DDL: tablas PostGIS, clientes, lotes, clima, índices y alertas
│   └── seed_lotes.sql         # Datos iniciales de parcelas de prueba
├── frontend/
│   ├── src/
│   │   ├── app/               # Páginas, layout y estilos globales de Next.js
│   │   └── components/        # Componentes reutilizables (Mapa, Gráficos, Alertas)
│   ├── package.json           # Scripts y dependencias de Node.js
│   └── tsconfig.json          # Configuración de TypeScript
├── pipelines/
│   ├── etl_ingesta_agro.py    # Ingesta satelital (Sentinel-2 GEE) y climática (NASA POWER)
│   └── ia_detector_alertas.py # Algoritmo Isolation Forest + Diagnóstico agronómico con Gemini
├── requirements.txt           # Dependencias para ejecución de pipelines locales/CI
└── README.md                  # Documentación del proyecto
```

---

## 🔌 Endpoints de la API

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/` | Health check del servicio |
| `GET` | `/api/lotes` | FeatureCollection GeoJSON con lotes, último NDVI/NDWI y severidad activa |
| `GET` | `/api/lotes/{lote_id}/series?dias=60` | Series temporales climáticas y satelitales del lote solicitado |
| `GET` | `/api/alertas?estado={estado}` | Listado de alertas generadas por IA (filtro: `PENDIENTE`, `EN_REVISION`, `RESUELTA`) |
| `PATCH` | `/api/alertas/{alerta_id}` | Actualización del estado de gestión de una alerta agronómica |

