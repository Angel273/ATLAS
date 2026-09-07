# Lienzo Semántico Visual, Semanas Operativas, Carga de Roster y Mapeo Dinámico

Fecha: 2026-09-06.

## Lienzo Visual Interactivo para Capa Semántica y KPIs (Lucidchart Style)

Para simplificar la gobernanza de datos a directores de operaciones y analistas de call center sin conocimientos técnicos avanzados de SQL:

1. **Arquitectura del Lienzo:** Implementado mediante `@xyflow/react` (React Flow) en `/app/kpis` como una vista dual intercambiable (Modo Lienzo Interactivo y Modo Lista Clásica).
2. **Nodos Especializados:**
   - **Nodos de Datasets:** Muestran el esquema de campos, tipos de datos, llaves primarias, total de registros y estado de publicación con la paleta sobria de ATLAS.
   - **Nodos de KPIs:** Reflejan la fórmula DSL, metas operacionales, badges de estado y datasets de origen.
3. **Aristas y Ruteo Inteligente:**
   - Aristas de relaciones semánticas con etiquetas de cardinalidad (`1:1`, `1:N`, `N:1`), tipo de join (`INNER`, `LEFT`) y badges interactivos.
   - Enrutamiento horizontal con halo de contraste en primer plano para máxima legibilidad visual sobre tarjetas de datasets.
   - Aristas de dependencia entre KPIs calculados.
4. **Paneles y Herramientas Integradas:**
   - **Simulador de Rutas de Consulta:** Valida visualmente el camino de JOINs determinista (algoritmo BFS) entre tablas seleccionadas.
   - **Constructor Visual de Fórmulas:** Panel lateral con autocompletado de funciones agregadas y campos disponibles.
   - **Detección de Ciclos en Tiempo Real:** Algoritmo determinista de validación que previene ciclos antes de emitir transacciones a la base de datos.
   - **Auto-Layout y Exportación:** Organización automática de diagramas mediante Dagre y exportación de esquemas a PNG/SVG.

## Ciclo de Vida Dual de Datasets y KPIs

Se adoptó un modelo híbrido para balancear la limpieza operativa y la inmutabilidad histórica requerida por `AGENTS.md` §3:

1. **Borradores no publicados (Hard Delete):** Datasets y KPIs en borrador que nunca han sido publicados y no cuentan con dependencias activas pueden eliminarse físicamente de la base de datos y de MinIO/S3 para evitar acumulación de pruebas descartadas.
2. **Entidades con versiones publicadas (Soft Delete / Archivo y Deprecación):**
   - Una vez publicada una versión de dataset o un KPI, está estrictamente prohibido su borrado físico.
   - Se aplican triggers en PostgreSQL (`protect_published_dataset_delete`, `protect_published_version_delete`, `protect_published_kpi_delete`) que interceptan cualquier sentencia `DELETE` y devuelven error de violación de check `23514`.
   - Se proporciona archivo lógico (`archived_at = now()`) para datasets y deprecación lógica (`deprecated_at = now()`) para KPIs. Los elementos archivados o deprecados se ocultan de listas activas y del Asistente IA, pero se preservan intactos para la resolución histórica de dashboards y auditorías pasadas.

## Semanas Operativas y Carga Masiva de Rosters Excel

La gestión de personal en operaciones BPO/Call Center opera fundamentalmente sobre ciclos semanales:

1. **Semanas Operativas (`workforce_weeks`):**
   - Tabla dedicada con semanas formalizadas de Lunes a Domingo (`start_date` a `end_date = start_date + 6 days`), código canónico ISO (`YYYY-Www`), estado (`open`, `closed`, `current`) y atributos personalizados en JSONB.
   - Vinculación de asignaciones de equipo (`employment_assignments`) y jerarquías (`employee_relationships`) a un `week_id` opcional, permitiendo cambios de estructura semanales sin alterar el histórico.
2. **Ingesta Inteligente de Rosters Excel (`excel-roster.ts`):**
   - Lector streaming basado en `ExcelJS` capaz de procesar libros de cálculo con múltiples hojas (p. ej. una hoja por semana operativa o por campaña) o una hoja única.
   - Auto-detección y normalización de encabezados sin importar mayúsculas, tildes o variaciones de nombres (código, cédula, nombre, apellido, correo, BMS ID, Wave, equipo, supervisor, rol).
   - Inserción y actualización idempotente de agentes, equipos, semanas y jerarquías temporales en una sola transacción gobernada.

## Mapeo Dinámico de Workforce en la Capa Semántica

Para evitar tener que desnormalizar previamente los archivos operativos de llamadas o tickets:

1. **Configuración de Mapeo en KPIs (`kpi_versions.workforce_mapping`):**
   - Se incorpora configuración declarativa en cada KPI para asociar el dataset operacional con el módulo de workforce.
   - Clave de coincidencia configurable (`matchKey`: código de empleado, BMS ID, nombre normalizado o email).
   - Selección dinámica de columnas organizacionales a inyectar en la consulta (`supervisor`, `floor_manager`, `wave`, `tenure`, `team`).
2. **Compilación Transparente de JOINs:**
   - El motor semántico compila automáticamente los JOINs necesarios hacia las tablas de empleados y jerarquías vigentes en la fecha del registro analizado, permitiendo filtrar o agrupar métricas operacionales por Supervisor o Wave sin alterar los datasets originales importados.
