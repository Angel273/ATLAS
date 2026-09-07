# Dashboards Gobernados, Workforce y Asistente IA

Fecha: 2026-09-06.

## Dashboards Gobernados y Visualizaciones de 12 Columnas

Se implementó el módulo de dashboards (`/app/dashboards`) bajo el principio de gobernanza estricta por rol y reproducibilidad histórica:

1. **Cuadrícula responsive de 12 columnas:** El layout del dashboard utiliza una cuadrícula de 12 columnas (`widgetGridSchema`) con soporte para redimensionamiento en anchos estándar (3, 4, 6, 8, 12 columnas) y ajuste vertical en píxeles. En pantallas reducidas, la cuadrícula colapsa de forma fluida y accesible.
2. **Widgets declarativos:** Los widgets (`kpi_card`, `line_chart`, `bar_chart`, `area_chart`, `table`, `text`) no almacenan consultas SQL arbitrarias ni código ejecutable; guardan una especificación declarativa referenciando un KPI publicado, una dimensión opcional y configuraciones cosméticas (paletas de color, líneas de meta `markLine`, formatos condicionales).
3. **Alternativa tabular accesible obligatoria (WCAG 2.2 AA):** Conforme a `design.md` y `AGENTS.md` §10, toda gráfica vectorial interactiva generada con Apache ECharts incluye un control conmutador accesible para alternar a una vista tabular con alineación numérica a la derecha y tipografía monoespaciada tabular.
4. **Gobernanza de Layouts y Estado Efímero:**
   - **Administradores (`dashboard.manage`, `dashboard.publish`):** Pueden diseñar paneles, arrastrar y redimensionar tarjetas mediante drag-and-drop con `GripVertical`, guardar versiones borrador (`v1`, `v2`...) y publicar la versión oficial inmutable para toda la organización.
   - **No administradores (`dashboard.read`):** Visualizan únicamente versiones publicadas. Cualquier ajuste en filtros globales o cambios visuales permanece exclusivamente en la memoria local de la sesión y se descarta al recargar o cerrar la página, disponiendo además de un botón explícito para "Restablecer diseño publicado".
5. **Filtros Flexibles y Operacionales de Call Center:**
   - Desacoplamiento de filtros `WHERE` respecto a las dimensiones `GROUP BY`.
   - Detección automática y fallback seguro de columnas temporales (`date`, `created_at`, `timestamp`).
   - Filtros de jerarquía y cohorte operativa (Supervisor, Floor Manager, Wave) mediante endpoint dinámico (`/api/v1/dashboards/:id/filter-options`) con resolución de sinónimos y dropdowns enriquecidos con datos reales del call center.

## Workforce y Agent Definer

Se estructuró el directorio laboral y las relaciones operacionales (`/app/workforce`):

1. **Aislamiento Multi-tenant en Profundidad:** Tablas aseguradas con PostgreSQL Row-Level Security (`tenant_scope`) para el rol `atlas_app`, impidiendo cualquier filtración entre organizaciones.
2. **Integridad Temporal Estricta (`valid_from` y `valid_to`):** Las asignaciones de empleados a equipos (`employment_assignments`) y las relaciones de supervisión y reporte (`employee_relationships`) utilizan rangos de vigencia temporal. Las reasignaciones o cambios organizacionales cierran el periodo previo y abren uno nuevo, sin sobrescribir ni destruir el historial operativo necesario para calcular KPIs retrospectivos.
3. **Identificadores Naturales Únicos:** Cada empleado cuenta con un código laboral único por organización (`code`), índice de nombre normalizado (`normalized_name`), identificador externo de marcador (`bms_id`), cohorte operativa (`wave`) y metadatos flexibles en JSONB (`custom_fields`).

## Asistente Operacional de Inteligencia (AI Chat)

Se integró el asistente conversacional analítico (`/app/chat`) bajo aislamiento estricto de datos:

1. **Arquitectura Multi-Proveedor Agnóstica:** Interfaz `AIProvider` desacoplada del dominio central. Soporta Google Gemini (con function calling y esquemas de parámetros) y un proveedor Mock Determinista offline que permite ejecutar pruebas automatizadas y entornos sin conectividad externa de manera predecible.
2. **Tools 100% de Solo Lectura con Inyección Forzada de Tenant:**
   - Las 7 herramientas gobernadas (`search_kpis`, `get_kpi_definition`, `describe_dataset`, `describe_relationships`, `run_semantic_query`, `get_employee_structure`, `get_published_dashboard`) reciben el `tenant_id` derivado directamente de la sesión del usuario autenticado (`actor.tenantId`), nunca de los argumentos generados por el modelo de IA.
   - Límite duro de 5 turnos de herramientas por interacción para garantizar acotamiento de costes y evitar ciclos infinitos.
3. **Grounding, Citas y Prevención de Prompt Injection:**
   - La respuesta del asistente desglosa hechos numéricos de su interpretación operacional y cita explícitamente los KPIs, datasets, versiones y huellas de consulta utilizadas.
   - El contenido de archivos y metadatos cargados por usuarios se trata estrictamente como datos no confiables y no como instrucciones ejecutivas.
   - Persistencia auditable de la conversación, mensajes y ejecuciones de herramientas en PostgreSQL con RLS.
