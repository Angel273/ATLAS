# Estado de implementación — 2026-09-06

Este documento es el punto de entrada para continuar ATLAS. Las reglas obligatorias están en `AGENTS.md`, la experiencia en `design.md`, la arquitectura objetivo en `implementation.md` y las decisiones de ingesta/KPI en `docs/decisions/0002-ingestion-kpi.md`.

## Funcionalidad operativa

- Monorepo pnpm/Turborepo con Next.js, NestJS, PostgreSQL, Redis/BullMQ y MinIO.
- Autenticación propia por email/contraseña, TOTP obligatorio para Admin, sesiones rotadas/revocables y capacidades centralizadas por rol.
- Aislamiento transaccional por tenant y PostgreSQL RLS forzada en todas las tablas de datos, modelos semánticos, dashboards y workforce.
- Ingesta real desde `/app/datasets`: CSV UTF-8 y XLSX; carga directa firmada; perfilado; validación regional; estrategias replace, append y upsert; inmutabilidad garantizada por triggers.
- Ciclo de Vida Dual de Datasets y KPIs (Hard Delete + Archivo/Deprecación Gobernados):
  - Borrado definitivo (Hard Delete): Para datasets y KPIs en estado borrador (sin versiones publicadas ni dependencias), con purga automática de filas en base de datos y archivos binarios en MinIO/S3.
  - Baja lógica y Deprecación (Soft Delete / Archivo): Para datasets y KPIs que contienen datos publicados, garantizando la inmutabilidad histórica requerida por ATLAS (`AGENTS.md` §3). Se archivan datasets y deprecican KPIs ocultándolos de listas activas y del Asistente IA, pero preservando los dashboards y reportes pasados.
  - Triggers de PostgreSQL en el motor de base de datos (`protect_published_dataset_delete`, `protect_published_version_delete`, `protect_published_kpi_delete`) que impiden a nivel de base de datos (`23514`) borrar físicamente cualquier dato publicado.
  - Controles UI en `/app/datasets` y `/app/kpis`: botones contextuales, modales de confirmación adaptativos con advertencia de impacto, selector para mostrar u ocultar archivados/deprecados y reactivación de datasets.
- Capa Semántica y Motor KPI en `/app/kpis`: uniones multi-tabla gobernadas por grafo BFS determinista sin ciclos ni ambigüedades; DSL segura; targets operacionales, advertencias y críticos; cálculo con caché, rangos temporales y linaje auditado.
- Edición de KPIs con Versionado Inmutable: soporte para modificar fórmulas y metas generando automáticamente la versión `v{number + 1}`, manteniendo intactas las versiones históricas para asegurar reproducibilidad.
- Dashboards Gobernados en `/app/dashboards`: cuadrícula responsive de 12 columnas, widgets interactivos ECharts (`kpi_card`, `line_chart`, `bar_chart`, `area_chart`, `table`, `text`), alternativas tabulares accesibles (WCAG 2.2 AA), filtros temporales globales, exportación a CSV, edición efímera para no-administradores y publicación oficial inmutable.
- Workforce & Agent Definer en `/app/workforce`: directorio de agentes con código natural único por tenant, equipos de operación, catálogo de roles laborales, historial de asignaciones y relaciones de supervisión con soporte temporal estricto (`valid_from` y `valid_to`).
- Asistente Operacional de Inteligencia / AI Chat en `/app/chat`: arquitectura multi-proveedor desacoplada (Google Gemini y Mock Determinista), tools 100% de solo lectura gobernadas (`search_kpis`, `get_kpi_definition`, `describe_dataset`, `describe_relationships`, `run_semantic_query`, `get_employee_structure`, `get_published_dashboard`), inyección estricta de tenant desde la sesión, persistencia de linaje y evidencia (`grounding_context`), prevención de prompt injection, y límite estricto de 5 turnos por consulta.
- Navegación Unificada (`AppHeader`): integrada en `/app`, `/app/datasets`, `/app/kpis`, `/app/dashboards`, `/app/workforce` y `/app/chat`.

## Contratos y ubicación del código

- Contratos HTTP/Zod: `packages/contracts/src/data.ts`, `kpi.ts`, `dashboard.ts`, `workforce.ts` y `ai.ts`.
- Ingesta y almacenamiento: `packages/ingestion/src/`.
- Motor semántico y compilador de fórmulas: `packages/kpi/src/`.
- Servicios API NestJS: `apps/api/src/dashboards/`, `apps/api/src/workforce/` y `apps/api/src/ai/`.
- Rutas HTTP y composición Nest: `apps/api/src/app.ts`.
- Consumidor BullMQ: `apps/worker/src/main.ts`.
- UI Web: `apps/web/app/app/datasets/page.tsx`, `kpis/page.tsx`, `dashboards/page.tsx`, `workforce/page.tsx` y `chat/page.tsx`.
- Esquema de base de datos: migraciones `001_foundations.sql` a `013_dataset_kpi_lifecycle.sql`.

## Pendiente inmediato (Fase 6 — Hardening y piloto)

1. Certificación de pruebas de volumen masivo (250 MB, 20M filas) midiendo tiempos y memoria del worker thread.
2. Observabilidad OpenTelemetry, métricas Prometheus y trazas estructuradas.
3. Backups automáticos y recuperación ante desastres en MinIO y PostgreSQL.
4. Threat modeling y revisión final de privacidad y aislamiento.
5. Piloto multi-tenant aislado con datos sintéticos y validación final de accesibilidad WCAG 2.2 AA.

## Verificación disponible

- Unitarias: 39 pruebas pasando (`vitest run`), cubriendo DSL, inferencia tipada, parseo de fórmulas, aislamiento de secretos y contratos de workforce y AI.
- Integración real: 47 pruebas pasando (`vitest run --config vitest.integration.config.ts`), cubriendo ingestión S3/BullMQ, RLS forzada entre organizaciones (Tenant A vs Tenant B), ciclo de vida dual (borrado definitivo de borradores, archivo de publicados, reactivación y bloqueos por triggers en PostgreSQL), compilación SQL multi-tabla, inmutabilidad de dashboards, versiones de KPI, linaje temporal de workforce y bucle de tools de AI Chat.
- Tipos TypeScript: 0 errores bajo configuración estricta en `@atlas/web`, `@atlas/api`, `@atlas/contracts`, `@atlas/ingestion`, `@atlas/kpi` y `@atlas/database`.
- Compilación de producción: `next build` en `@atlas/web` completado exitosamente.

Los servicios locales esperados son web `127.0.0.1:3000`, API `127.0.0.1:4000`, PostgreSQL `54329`, Redis `63799` y MinIO `9009`. La vista `/` sigue siendo un ejemplo sintético; los datos reales viven bajo `/app`.

## Changelog de entregas

### 2026-09-05 — Fase 2: Capa Semántica Multi-tabla y KPI Structure completada

Se abordaron e implementaron los puntos 5, 6 y 7 de la lista de pendientes inmediatos:

- **Relaciones entre datasets:** Tabla `semantic_relationships` (migración `008_semantic_layer.sql`) con RLS, cardinalidades `one_to_one`, `many_to_one` y `one_to_many`, tipos de join `inner`/`left` y desambiguación por ruta preferida (`is_preferred`).
- **Resolución determinista de JOINs sin ambigüedades ni ciclos:** Implementado en `packages/kpi/src/relations.ts`. Rechaza productos cartesianos (`RELATION_REQUIRED`) y rutas ambiguas (`AMBIGUOUS_JOIN_PATH`).
- **Sintaxis calificada y modelo multi-tabla:** `compileFormula` en `packages/kpi/src/dsl.ts` soporta nombres calificados `dataset.campo` cruzando datasets publicados en la misma consulta SQL con parámetros seguros.
- **KPI Structure con metas, umbrales y deprecación:** Nuevas columnas en `kpi_versions` para `target_direction` (`higher_is_better`, `lower_is_better`, `target_match`), `targets` (objetivo, advertencia, crítico) y `dependencies`. Detección de ciclos (`CIRCULAR_KPI_DEPENDENCY`). Gatillada la deprecación de KPIs sin romper la reproducibilidad de dashboards pasados mediante la migración `009_kpi_deprecation.sql`.
- **Query API con filtros temporales, caché y trazabilidad:** Soporte para `timeRange` (`from`, `to`, `field`), reporte de linaje `joinPath`, evaluación de cumplimiento de meta y caché en memoria con invalidación por publicación.
- **UI en `/app/kpis`:** Sección administrativa para conectar datasets, formulario de métricas con metas operacionales, y vista de consulta con trazabilidad detallada y badges de cumplimiento.
- **Endpoints de API:** Desbloqueado `/api/v1/semantic/relationships` (GET y POST) y `/api/v1/kpis/:id/deprecate`.
- **Pruebas:** 38 pruebas unitarias y 26 pruebas de integración pasando en verde (`vitest.config.ts` y `vitest.integration.config.ts`), certificando el aislamiento por tenant en relaciones y consultas multi-tabla.

### 2026-09-06 — Fase 3: Dashboards Gobernados y Visualizaciones de 12 Columnas completada

Se completó la implementación del punto 9 (Dashboards reales) de la lista de pendientes:

- **Migración y Modelo de Datos:** Migración `010_dashboards.sql` aplicando tablas `dashboards`, `dashboard_versions` y `dashboard_publications` en PostgreSQL con RLS obligatoria (`tenant_scope`) e inmutabilidad estricta.
- **Contratos Zod Tipados:** Schemas y validadores en `packages/contracts/src/dashboard.ts` para widgets (`kpi_card`, `line_chart`, `bar_chart`, `area_chart`, `table`, `text`), cuadrículas 12-col (`widgetGridSchema`) y versiones publicadas.
- **API NestJS y Controladores:** Servicio `DashboardsService` y controlador `DashboardsController` en `apps/api/src/dashboards/dashboards.service.ts` y `apps/api/src/app.ts`. Habilitada la bandera de feature gate `dashboards: true`.
- **UI Web Completa en `/app/dashboards`:** Página interactiva en Next.js con cuadrícula responsive de 12 columnas, selector de dashboards, filtros globales de rango de fechas (`dateFrom`, `dateTo`), widgets ECharts interactivos con tokens de ATLAS, toggle de tabla accesible para cada gráfica, estados de carga y error, y exportación a CSV.
- **Gobernanza de Layouts por Rol:**
  - Administradores: pueden crear paneles, agregar/editar/reordenar/eliminar widgets, guardar versiones borrador y publicar versiones inmutables para la organización.
  - No administradores: solo leen versiones publicadas y cualquier ajuste o filtro permanece en estado efímero local de sesión, con botón de restablecimiento.
- **Barra de Navegación Unificada (`AppHeader`):** Integrada en `/app`, `/app/datasets`, `/app/kpis` y `/app/dashboards` garantizando acceso directo a todas las fases desarrolladas.
- **Verificación Completa:** Suite de 38 pruebas unitarias y 33 pruebas de integración pasando al 100% (incluyendo `apps/api/src/dashboards.integration.test.ts`), con chequeo de tipos TypeScript estricto en `@atlas/web` y `@atlas/api`.
- **Motor de Personalización, Drag & Drop y Sidebar de Widgets:** Reordenamiento Drag & Drop nativo con `GripVertical`, tiradores de ancho y altura, panel lateral `WidgetConfigSidebar` para configurar colores, líneas de meta (markLine) en gráficos, y soporte para columnas calculadas y formato condicional (semaforización) en tablas.
- **Tiradores e Interfaz de Enfoque Armonizada con design.md:**
  - Eliminada la barra oscura superior y la tarjeta artificial `# CHART 6/12 COLS`, restaurando la estética editorial sobria de ATLAS.
  - Reemplazado el contorno azul eléctrico por el token institucional `var(--accent)` (`#365C4A`, Verde ATLAS) con radio de 3px y elevación sutil (`box-shadow: 0 0 0 1px var(--accent), 0 3px 12px rgba(54, 92, 74, 0.12)`).
  - Tiradores encapsulados con acabado `var(--surface)` (`#FAF8F2`) y borde en `var(--accent)` (`#365C4A`), con estados hover en `var(--surface-muted)` (`#E9E5DB`):
    - Tirador lateral derecho (`ew-resize`, 7px × 28px) para ajuste continuo de columnas (2 a 12) y clic rápido.
    - Tirador inferior (`ns-resize`, 28px × 7px) para ajuste vertical continuo y clic de escala.
    - Tirador de esquina inferior derecha (`nwse-resize`, 10px × 10px) para redimensionamiento 2D simultáneo.
  - Encabezado unificado de tarjeta con título, identificador KPI, botones de span en cuadrícula, vista alternativa accesible y configuración/descarte.

### 2026-09-06 — Edición de KPIs con Versionado Inmutable y Preparación de Fase 4 (Workforce)

- **Edición de KPIs Gobernados en `/app/kpis`:**
  - Incorporado el botón **Editar** en la tabla "Definiciones guardadas" para usuarios con capacidad `semantic.manage`.
  - Carga reactiva de la definición completa al formulario (nombre, descripción, dataset principal, datasets adicionales, fórmula, unidad, precisión, metas, umbrales y dimensiones).
  - Implementado banner de **Modo Edición / Versionado Activo** explicando el principio de inmutabilidad de ATLAS.
  - Al guardar, el backend genera atómicamente la versión `v{number + 1}` (`MAX(number) + 1`), conservando la versión previa intacta para preservar el linaje de dashboards y consultas pasadas.
  - El identificador slug se mantiene fijo durante la edición para asegurar continuidad de identidad.
  - Opción de cancelación de edición para limpiar el formulario y volver al modo de creación.
### 2026-09-06 — Fase 4: Workforce / Agent Definer completada

Se completó integralmente la implementación de la Fase 4 (Workforce / Agent Definer):

- **Modelo de Base de Datos y Aislamiento RLS:**
  - Migración `011_workforce.sql` con tablas `employee_types`, `teams`, `employees`, `employee_attribute_definitions`, `employee_attribute_values`, `employment_assignments` y `employee_relationships`.
  - Aislamiento multi-tenant obligatorio mediante PostgreSQL Row-Level Security (`tenant_scope`) en todas las tablas laborales.
  - Soporte de integridad temporal (`valid_from` y `valid_to`) en asignaciones de equipo y jerarquías de supervisión: transferir un agente cierra la vigencia previa y crea una nueva sin sobrescribir ni borrar los periodos pasados.
- **Contratos Zod Tipados:**
  - Definidos en `packages/contracts/src/workforce.ts` y re-exportados en el índice (`employeeSchema`, `teamSchema`, `employeeTypeSchema`, `employmentAssignmentSchema`, `employeeRelationshipSchema` y sus respectivos schemas de creación y listado).
- **API NestJS y Controladores:**
  - Servicio `WorkforceService` y controlador `WorkforceController` bajo `/api/v1/workforce` (`/employee-types`, `/teams`, `/employees`, `/assignments`, `/relationships`).
  - Habilitada la compuerta de características con `workforce: true` y removido el bloqueo 503.
  - Validación de capacidades `workforce.read` para lectura y `workforce.manage` para mutaciones.
- **UI Web Completa en `/app/workforce`:**
  - Directorio visual de agentes con búsqueda instantánea por código, nombre y correo, y filtros por equipo y estado.
  - Gestión de Equipos de Operación con conteo de agentes asignados.
  - Catálogo de Roles y Tipos de Empleado.
  - Ficha de Linaje Temporal por agente mostrando el historial de asignaciones y líderes a lo largo del tiempo.
  - Flujo de transferencia de equipo y cambio de supervisor conservando la trazabilidad histórica.
  - Enlace directo a Workforce integrado en la barra de navegación unificada `AppHeader`.
- **Verificación Completa:**
  - 39 pruebas unitarias y 39 pruebas de integración pasando al 100% (incluyendo `workforce.integration.test.ts` con pruebas negativas de acceso cruzado entre organizaciones bajo RLS).

### 2026-09-06 — Fase 5: AI Chat Multi-Proveedor y Asistente Operacional de Inteligencia completada

Se completó con éxito la implementación de la Fase 5 (AI Chat y Asistente Operacional):

- **Modelo de Datos y Aislamiento RLS en PostgreSQL:**
  - Migración `012_conversations.sql` con tablas `conversations`, `conversation_messages` y `conversation_tool_executions`.
  - Aislamiento multi-tenant forzado con PostgreSQL Row-Level Security (`tenant_scope`) para el rol `atlas_app`.
- **Contratos Zod Tipados:**
  - Nuevos contratos y tipos en `packages/contracts/src/ai.ts`: `conversationSchema`, `conversationMessageSchema`, `sendMessageSchema`, `toolExecutionSchema`, `groundingCitationSchema` y `conversationDetailSchema`.
- **Arquitectura Multi-Proveedor Agnóstica:**
  - Interfaz desacoplada `AIProvider` en `apps/api/src/ai/provider.ts`.
  - Adaptador para **Google Gemini** con function calling y formateo de instrucciones del sistema.
  - Adaptador **Mock Determinista** que resuelve offline y en pruebas automatizadas todas las consultas operacionales sin requerir API keys externas.
- **Catálogo de Tools de Solo Lectura con Inyección de Tenant:**
  - `apps/api/src/ai/tools.ts` implementa 7 herramientas de solo lectura: `search_kpis`, `get_kpi_definition`, `describe_dataset`, `describe_relationships`, `run_semantic_query`, `get_employee_structure` y `get_published_dashboard`.
  - El `tenant_id` se inyecta siempre desde la sesión autenticada (`actor.tenantId`), nunca desde los parámetros del modelo.
  - Límite duro de 5 turnos de herramientas por consulta para evitar bucles o consumo desmedido de tokens.
  - Parámetros sensibles redactados y tiempos de ejecución registrados en auditoría.
- **API NestJS y Controladores:**
  - Servicio `ConversationsService` y controlador `ConversationsController` en `/api/v1/conversations`.
  - Habilitada la bandera `aiChat: true` en `/features` y liberada la compuerta 503 para el asistente.
- **UI Web Editorial en `/app/chat`:**
  - Panel conversacional con paleta editorial (`--surface: #FAF8F2`, `--surface-muted: #E9E5DB`, `--accent: #365C4A`, fuentes serif institucionales).
  - Historial de consultas previas y botón de nueva consulta.
  - Tarjetas con preguntas sugeridas de call center en estado inicial.
  - Respuestas estructuradas que diferencian hechos, cálculos gobernados e interpretación.
  - Cajón desplegable de **Fuentes y evidencia gobernada** mostrando KPIs, datasets, versiones, hashes de consulta y herramientas ejecutadas.
  - Acciones de copiar respuesta y métricas de tokens y tiempo de ejecución.
  - Enlace directo a Asistente IA (`<Sparkles size={14} />`) integrado en `AppHeader`.
- **Verificación Completa:**
  - 39 pruebas unitarias y 45 pruebas de integración pasando al 100% (incluyendo `conversations.integration.test.ts` con validación de tools, aislamiento RLS y defensa contra prompt injection).
  - 0 errores en chequeo de tipos TypeScript en los 7 paquetes del monorepo (`turbo run typecheck`).

### 2026-09-06 — Ciclo de Vida Dual, Eliminación y Archivo de Datasets y KPIs completada

Se implementó el ciclo de vida gobernado con enfoque dual para la eliminación y archivo de Datasets y KPIs:

- **Modelo de Datos y Triggers de Inmutabilidad en PostgreSQL:**
  - Migración `013_dataset_kpi_lifecycle.sql` incorporando la columna `archived_at timestamptz` en la tabla `datasets`.
  - Permisos `DELETE` concedidos de manera controlada al rol `atlas_app` en `datasets`, `dataset_versions`, `dataset_publications` y `kpi_versions`.
  - Triggers de seguridad en PostgreSQL (`protect_published_dataset_delete`, `protect_published_version_delete`, `protect_published_kpi_delete`) que lanzan excepción `23514` (`PUBLISHED_*_IMMUTABLE`) si se intenta borrar físicamente cualquier dataset, versión o KPI publicado.
- **Contratos Zod Tipados:**
  - `datasetSchema` enriquecido con `archivedAt: z.string().nullable().default(null)`.
  - Nuevos esquemas tipados `datasetLifecycleResultSchema` y `kpiLifecycleResultSchema`.
- **Almacenamiento e Ingesta:**
  - Módulo `ObjectStorage` con soporte para eliminación física de objetos (`DeleteObjectCommand` de S3/MinIO).
  - `IngestionService.deleteOrArchive`:
    - Si tiene versiones publicadas: ejecuta archivo lógico (`archived_at = now()`) y registra evento `dataset.archived`.
    - Si es borrador sin publicar: valida que no existan relaciones semánticas ni KPIs dependientes, purga objetos binarios en S3, desvincula claves foráneas circulares, elimina filas y versiones, y registra `dataset.deleted`.
  - `IngestionService.unarchive`: reactivación de datasets archivados (`archived_at = NULL`) con auditoría `dataset.unarchived`.
  - Carga bloqueada en datasets archivados con error `DATASET_ARCHIVED`.
- **Motor Semántico & KPIs:**
  - `KpiService.deleteOrDeprecate`:
    - Si el KPI está publicado: se depreca (`deprecated_at = now()`) preservando los cálculos históricos y auditando `kpi.deprecated`.
    - Si es borrador no publicado: valida dependencias de otros KPIs, elimina físicamente de `kpi_versions` e invalida la caché de consultas.
  - Filtro por defecto en listados para ocultar elementos archivados o deprecados (`WHERE archived_at IS NULL` / `WHERE deprecated_at IS NULL`).
- **Integración con IA:**
  - La herramienta `search_kpis` excluye métricas deprecadas para garantizar que el Asistente IA solo recomiende métricas vigentes.
- **UI Web en Next.js:**
  - En `/app/datasets`: checkbox "Mostrar datasets archivados", botón contextual para "Archivar dataset" o "Eliminar dataset", modal de confirmación con explicación de impacto y botón de "Reactivar dataset".
  - En `/app/kpis`: checkbox "Mostrar KPIs deprecados", botón contextual para "Eliminar" (borradores) o "Deprecar" (publicados), modal de confirmación y badge visual `Deprecado`.
- **Verificación Completa:**
  - 47 pruebas de integración pasando al 100% (incluyendo validación de hard delete, soft delete, reactivación y triggers de PostgreSQL en `data.integration.test.ts`).
  - 40 pruebas unitarias pasando al 100%.
  - 0 errores en verificación de tipos Turborepo (11 paquetes).
  - Compilación de producción `next build` exitosa.

### 2026-09-06 — Filtro Flexible de Fechas y Filtros Operacionales de Call Center (Supervisor, FM, Wave)

Se resolvió la limitación del filtro temporal y se agregaron filtros operacionales para supervisión de contact center:

- **Desacoplamiento de Filtros WHERE y Dimensiones GROUP BY:**
  - El motor de consultas semánticas (`packages/kpi/src/index.ts`) diferenciaba erróneamente las cláusulas de agrupación (`dimensions`) de las cláusulas de filtrado (`filters` y `timeRange`). Ahora, cualquier columna disponible en las tablas participantes puede usarse en cláusulas `WHERE` sin necesidad de estar declarada como dimensión de desglose en `kpi.dimensions`.
- **Auto-detección y Fallback Inteligente de Columnas de Fecha:**
  - `querySchema.timeRange.field` ahora es opcional con valor por defecto `''`.
  - Si no se especifica columna de fecha o el campo indicado no existe, el motor KPI busca automáticamente columnas de tipo `date` o `datetime` en el dataset o columnas con nombres comunes (`fecha`, `date`, `timestamp`, `call_date`, `created_at`, `dia`, `periodo`).
  - Si un dataset en particular no contiene campos temporales, el filtro temporal se omite de forma segura sin abortar la ejecución del dashboard con error 400.
- **Selector Global y por Widget de Columna de Fecha:**
  - En la barra de herramientas del dashboard (`/app/dashboards`): selector de columna temporal con opciones frecuentes (`Auto`, `fecha`, `created_at`, `date`, `call_date`, `timestamp`) y modo `Personalizada…` para ingresar cualquier columna arbitraria.
  - En el panel de configuración de widgets (`WidgetConfigSidebar`): propiedad opcional `dateField` en `widgetDefinitionSchema` para sobrescribir la columna de fecha a nivel de tarjeta individual si un KPI utiliza un campo específico diferente al global.
- **Filtros Operacionales de Call Center (Supervisor, FM, Wave) con Dropdowns Dinámicos:**
  - Endpoint dedicado `GET /api/v1/dashboards/:id/filter-options` que analiza los datasets asociados a los KPIs del dashboard y los registros de workforce para extraer los valores únicos de supervisores, jefes de piso (FM) y cohortes (Wave).
  - En la interfaz de `/app/dashboards`, los controles de Supervisor, FM y Wave se transforman automáticamente en menús desplegables (`<select>`) enriquecidos con los valores reales del dataset (ej. `Majano Siliezar, Michael E`, `Bermudez Delgado, Cesar E`, etc.) y las olas detectadas (`Wave 6`, `Wave 9`, `Wave 11`).
  - Resolución inteligente de sinónimos/alias en el motor KPI (`supervisor` -> `sup`, `team_leader`, `tl`; `fm` -> `floor_manager`, `jefe_piso`; `wave` -> `ola`, `cohorte`).
  - Degradación elegante: si un dataset en el dashboard no incluye la columna operativa consultada, el filtro se ignora para ese widget específico sin bloquear la renderización del resto. Si un dashboard no tiene valores preexistentes, los campos se mantienen como inputs de texto libre.
- **UX y Gobernanza:**
  - Badge dinámico de filtros activos (`X filtros activos`) y botón de restablecimiento rápido con un clic (`Limpiar filtros`).
  - Persistencia de los filtros globales (`globalFilters`) en las versiones borrador y publicadas del dashboard para administradores, y restauración de filtros por defecto al cargar o restablecer.
- **Verificación:**
  - 40 pruebas unitarias pasando (`packages/contracts/src/index.test.ts` validando `querySchema` y `widgetDefinitionSchema.dateField`).
  - 47 pruebas de integración pasando (`pnpm test:integration`).
  - Compilación de producción de Next.js (`pnpm --filter @atlas/web build`) completada con 0 errores de tipos.
  - Verificación visual end-to-end con subagente de navegador confirmando la población de opciones en los dropdowns, filtrado instantáneo en vivo (ej. `Supervisor: Majano Siliezar` + `Wave: 9` filtrando a los 3 agentes correspondientes) y reactividad del badge de filtros activos.



