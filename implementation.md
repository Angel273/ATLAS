# ATLAS — Implementation Plan

## 1. Objetivo y alcance

ATLAS será una plataforma SaaS multi-tenant para transformar datos operacionales de call center en un modelo gobernado de KPIs, dashboards configurables y análisis mediante IA.

El MVP debe completar el recorrido:

> archivo Excel/CSV → dataset versionado → relaciones semánticas → KPI publicado → dashboard → consulta de IA sustentada

Usuarios iniciales: Admin, Supervisor, Floor Manager, Quality Coordinator, Operations Manager y CEO.

Decisiones confirmadas:

- SaaS multi-tenant.
- TypeScript end-to-end.
- Identidad laboral completa.
- Volumen medio: hasta 5,000 empleados, decenas de millones de filas y archivos de 250 MB por tenant.
- Datasets versionados.
- Fórmulas mediante DSL segura compilada a SQL.
- Acceso global por rol dentro del tenant.
- Edición no administrativa de dashboards solo durante la sesión.
- IA multi-proveedor, inicialmente Google, de solo lectura.
- Autenticación por email y MFA obligatorio para administradores.

## 2. Arquitectura objetivo

### 2.1 Stack

| Área | Elección |
|---|---|
| Monorepo | pnpm + Turborepo |
| Web | Next.js + React + Tailwind CSS + Radix UI |
| API | NestJS REST |
| Worker | NestJS + BullMQ |
| Base de datos | PostgreSQL |
| ORM | Prisma, complementado con migraciones SQL |
| Cola y caché | Redis |
| Archivos | S3-compatible object storage |
| Validación | Zod |
| Grid | react-grid-layout |
| Gráficas | Apache ECharts |
| Tablas | TanStack Table + virtualización |
| Excel | SheetJS en worker aislado |
| CSV | Parser streaming |
| Observabilidad | OpenTelemetry + logs estructurados |
| E2E | Playwright |

### 2.2 Topología

- **Web:** renderiza la aplicación y consume la API.
- **API:** autentica, autoriza, valida contratos y coordina casos de uso breves.
- **Worker:** procesa importaciones, perfiles, materializaciones y tareas de IA prolongadas.
- **PostgreSQL:** configuración, datos normalizados, semantic layer, auditoría y resultados materiales.
- **Redis:** colas, locks, progreso y caché efímera.
- **Object storage:** originales, reportes de error y exportaciones.

Se implementará como monolito modular desplegado en procesos separados. No se crearán microservicios en el MVP.

## 3. Módulos de dominio

### 3.1 Identity & Access

Responsabilidades:

- Usuarios, credenciales, sesiones, invitaciones y MFA.
- Membresías por tenant.
- Roles y capacidades.
- Recuperación y revocación de sesiones.

Capacidades iniciales:

- `tenant.manage`
- `user.manage`
- `dataset.read`, `dataset.manage`
- `semantic.read`, `semantic.manage`, `semantic.publish`
- `dashboard.read`, `dashboard.manage`, `dashboard.publish`
- `workforce.read`, `workforce.manage`
- `ai.use`
- `audit.read`

Los roles se traducen a capacidades en un único módulo de autorización.

### 3.2 Organizations & Accounts

- Organization/Tenant representa al cliente aislado.
- Account representa una campaña u operación del call center.
- Zona horaria, locale y políticas viven en configuración del tenant.
- Todas las entidades operacionales incorporan `tenant_id`.

### 3.3 Ingestion & Datasets

Entidades principales:

- `Dataset`
- `DatasetVersion`
- `SourceFile`
- `DatasetTable`
- `DatasetField`
- `ImportJob`
- `ImportIssue`
- `Publication`

Estados de una carga:

`uploaded → profiling → awaiting_mapping → validating → importing → ready`

Estados terminales alternos: `failed`, `cancelled`, `archived`.

Flujo:

1. API crea upload firmado y registro inicial.
2. Cliente carga directamente al object storage.
3. API verifica finalización y encola perfilado.
4. Worker detecta hojas, encabezados, tipos y muestras.
5. Admin confirma mapping, claves y estrategia.
6. Worker valida y carga en staging por lotes.
7. Se genera reporte de errores.
8. Una transacción publica la nueva versión lógica.
9. Se invalidan caches y se marcan dependencias para recalcular.

Estrategias:

- **Replace:** la nueva versión se convierte en fuente completa vigente.
- **Append:** agrega registros nuevos conservando historial.
- **Upsert:** actualiza por clave natural configurada; debe detectar claves duplicadas.

Los originales son inmutables. Las macros y fórmulas del archivo no se ejecutan; se importan valores disponibles.

### 3.4 Workforce

Entidades:

- `Employee`
- `EmployeeType`
- `EmployeeAttributeDefinition`
- `EmployeeAttributeValue`
- `EmploymentAssignment`
- `EmployeeRelationship`
- `Team`

Los assignments y relaciones usan `valid_from` y `valid_to` para preservar historial. Una persona puede cambiar de tipo, cuenta, equipo o supervisor sin sobrescribir relaciones anteriores.

El MVP no incluye expedientes disciplinarios, coaching ni evaluaciones.

### 3.5 Semantic Model & KPI Structure

Entidades:

- `SemanticModel`
- `SemanticModelVersion`
- `TableDefinition`
- `FieldDefinition`
- `RelationshipDefinition`
- `KpiDefinition`
- `KpiVersion`
- `KpiDependency`
- `TargetDefinition`

Una relación declara tablas/campos, cardinalidad, dirección, join permitido y estado de validación. Solo relaciones publicadas pueden participar en consultas.

Un KPI publicado contiene:

- slug estable y nombre visible;
- descripción y propietario;
- tipo, unidad, formato y precisión;
- fórmula/AST versionado;
- dimensiones y filtros permitidos;
- granularidad temporal;
- dirección de mejora;
- targets y umbrales;
- políticas de nulos y división entre cero;
- dependencias y lineage;
- estado y timestamps de publicación.

Estados: `draft`, `validated`, `published`, `deprecated`.

Solo Admin puede crear, modificar, validar y publicar. Otros roles tienen lectura.

## 4. Motor de fórmulas

### 4.1 Decisión

El MVP no incorporará Python ni SQL libre. Se implementará una DSL propia, pequeña y segura, inspirada en fórmulas de hojas de cálculo.

Pipeline:

`texto → lexer/parser → AST → resolución de símbolos → inferencia de tipos → validación semántica → plan de consulta → SQL parametrizado`

El AST, no el SQL, es la representación persistida canónica junto con el texto original.

### 4.2 Tipos

- number
- decimal
- integer
- string
- boolean
- date
- datetime
- duration
- null

### 4.3 Operaciones iniciales

- Aritmética: `+`, `-`, `*`, `/`.
- Comparación: `=`, `!=`, `<`, `<=`, `>`, `>=`.
- Lógica: `AND`, `OR`, `NOT`.
- Agregación: `SUM`, `AVG`, `MIN`, `MAX`, `COUNT`, `COUNT_DISTINCT`.
- Control: `IF`, `COALESCE`, `NULLIF`.
- Numéricas: `ROUND`, `ABS`.
- Temporales: `DATE`, `DATE_DIFF`, `DATE_TRUNC`.
- Referencias: campos calificados y KPIs publicados.

Semántica base:

- División entre cero retorna `null` y advertencia, salvo uso explícito de `NULLIF`/`IF`.
- Agregaciones ignoran nulos; `COUNT(field)` cuenta no nulos.
- Conversiones implícitas se limitan a casos seguros.
- Fechas se evalúan en la zona horaria del tenant y se almacenan en UTC.
- Dependencias KPI no pueden formar ciclos.

### 4.4 Relaciones y joins

El compilador calcula una ruta entre tablas usando únicamente relaciones publicadas.

- Cero rutas: error de relación faltante.
- Una ruta válida: se utiliza.
- Varias rutas: error de ambigüedad salvo que una esté marcada como preferida.
- No se permiten productos cartesianos.
- Las cardinalidades se validan durante publicación y se monitorean en cargas nuevas.

### 4.5 Seguridad y coste

Antes de ejecutar se aplican:

- Tenant scope obligatorio.
- Lista permitida de campos y funciones.
- Parámetros enlazados para filtros.
- Límite de filas y dimensiones.
- Timeout de consulta.
- Estimación de coste/complejidad.
- Cancelación y correlation ID.
- Caché por tenant, versión semántica, versión dataset y query hash.

## 5. Query API

El contrato público será declarativo. Ejemplo conceptual:

```json
{
  "measures": ["aht", "quality_score"],
  "dimensions": ["team", "day"],
  "filters": [
    { "field": "account", "operator": "eq", "value": "support" }
  ],
  "timeRange": { "from": "2026-08-01", "to": "2026-08-31" },
  "orderBy": [{ "field": "day", "direction": "asc" }],
  "limit": 1000
}
```

Respuesta normalizada:

```json
{
  "columns": [
    { "key": "team", "type": "string" },
    { "key": "aht", "type": "duration", "unit": "seconds" }
  ],
  "rows": [],
  "context": {
    "semanticModelVersion": "...",
    "datasetVersions": [],
    "timezone": "America/Guatemala",
    "generatedAt": "..."
  },
  "warnings": []
}
```

Endpoints iniciales bajo `/api/v1`:

- Uploads y datasets.
- Versiones, mapping, validación y publicación.
- Modelo semántico, relaciones y KPIs.
- Validación/preview de fórmulas.
- Ejecución y exportación de consultas.
- Dashboards, versiones y publicación.
- Workforce y relaciones.
- Conversaciones y mensajes de IA.
- Auditoría administrativa.

Los contratos definitivos se generarán desde esquemas Zod y tendrán pruebas de compatibilidad.

## 6. Dashboards

Entidades:

- `Dashboard`
- `DashboardVersion`
- `WidgetDefinition`
- `DashboardPublication`

Cada versión contiene metadata, layout responsive, widgets, filtros globales y referencias semánticas. Un widget guarda una consulta declarativa, visualización y formato; nunca SQL.

Widgets MVP:

- KPI card
- table
- line chart
- bar chart
- area chart
- composition chart
- text/title
- deterministic insight
- global filter

Solo Admin guarda borradores y publica. Para otros roles, el layout editado existe únicamente en memoria/session storage y no crea registros en servidor.

Las columnas calculadas se compilan con la misma DSL sobre el conjunto permitido del widget.

Filtros globales y operacionales de contact center:
- Rango temporal con columna configurable a nivel global y anulable por widget (`dateField`).
- Auto-detección de columnas de fecha (`date`, `datetime`, o patrones `fecha|date|timestamp|call_date|created_at`) cuando el campo se omite o difiere del estándar.
- Filtros operacionales para call center (`supervisor`, `fm`, `wave`) con resolución de sinónimos (`sup`, `team_leader`, `tl`, `floor_manager`, `jefe_piso`, `ola`, `cohorte`).
- Degradación tolerante: si un dataset en el panel no posee la columna operativa, se omite el filtro para ese widget específico sin generar errores ni detener la renderización de los demás.

## 7. AI Chat

### 7.1 Arquitectura

Definir una interfaz `AIProvider` con capacidades para generación, reasoning soportado por proveedor, tool calling, streaming, uso y errores normalizados. El primer adaptador será Google; proveedores posteriores no alterarán tools ni contratos de dominio.

La orquestación controla:

- contexto autorizado;
- catálogo de tools;
- límite de iteraciones;
- presupuesto de tokens/coste;
- timeout y cancelación;
- persistencia redactada;
- trazas y feedback.

### 7.2 Tools MVP

- `search_kpis`
- `get_kpi_definition`
- `describe_dataset`
- `describe_relationships`
- `run_semantic_query`
- `compare_periods`
- `get_employee_structure`
- `get_published_dashboard`

Todas son de solo lectura y reciben el tenant desde el contexto de ejecución, no desde argumentos del modelo.

### 7.3 Respuesta y trazabilidad

Una respuesta analítica debe conservar:

- modelo/proveedor;
- tools utilizadas;
- argumentos redactados;
- KPIs, filtros y periodo;
- versiones de modelo semántico y datasets;
- latencia y uso;
- advertencias o resultados parciales.

La UI muestra fuentes de datos y un resumen metodológico, nunca chain-of-thought.

## 8. Seguridad, privacidad y auditoría

- TLS en tránsito y cifrado administrado en almacenamiento.
- MFA obligatorio para Admin.
- Sesiones revocables y rotación segura de tokens.
- RLS de PostgreSQL en todas las tablas multi-tenant.
- Contexto de tenant establecido por transacción en API y workers.
- URLs firmadas de corta duración para archivos.
- Escaneo y validación de tipo real del archivo.
- Límites de tamaño, filas, columnas y compresión.
- Protección contra CSV injection en exportaciones.
- Redacción de PII en logs, trazas y prompts.
- Auditoría append-only para cambios administrativos y exportaciones.
- Política definida de retención y eliminación por tenant antes del piloto productivo.
- Backups cifrados y restauración probada.

## 9. Rendimiento y operación

- Importación streaming/batch con checkpoints.
- Índices compuestos por tenant, versión, claves de unión y tiempo.
- Particionamiento temporal o por tenant para tablas factuales según mediciones reales.
- Materializaciones para KPIs costosos y dashboards frecuentes.
- Cache keys incluyen tenant y todas las versiones relevantes.
- Presupuestos iniciales:
  - respuesta API no analítica p95 menor a 500 ms;
  - consulta dashboard cacheada p95 menor a 2 s;
  - consulta analítica interactiva p95 menor a 8 s;
  - feedback inicial del chat por streaming menor a 2 s, excluyendo tools;
  - carga de 250 MB procesada de forma asíncrona sin bloquear API.
- Alertas por errores de importación, cola atrasada, consultas lentas, fallos de RLS, coste IA y disponibilidad de proveedor.

## 10. Fases de entrega

### Fase 0 — Fundaciones [Completada]

- Monorepo, CI, entornos y secretos.
- Autenticación, tenants, roles, capacidades y MFA.
- PostgreSQL, RLS, auditoría y observabilidad.
- Shell visual y design tokens.

Salida: dos tenants de prueba aislados y matriz de permisos verificable.

### Fase 1 — Ingesta [Completada]

- Uploads directos, object storage y jobs.
- Perfilado Excel/CSV, mapping, validación y reportes.
- Replace, append, upsert y publicación versionada.

Salida: un admin publica y restaura versiones sin pérdida del original.

### Fase 2 — Semantic Layer y KPIs [Completada]

- Catálogo de tablas/campos y relaciones.
- Canvas KPI Structure con metas y umbrales.
- Parser, AST, type checker y compilador SQL.
- Query API, límites, lineage y cache.
- Edición de KPIs con versionado inmutable v{number + 1}.

Salida: KPIs reproducibles sobre múltiples tablas relacionadas.

### Fase 3 — Dashboards [Completada]

- Grid responsive de 12 columnas, widgets ECharts y filtros globales.
- Alternativa tabular accesible (WCAG 2.2 AA).
- Columnas calculadas y semaforización condicional en tablas.
- Borradores, versiones y publicación inmutable.
- Edición temporal para usuarios no administradores y exportación a CSV.

Salida: dashboard oficial consultable y exportable a CSV.

### Fase 4 — Agent Definer básico / Workforce [Completada]

- Tipos, atributos, empleados, equipos y assignments.
- Roster con código natural único y validación por tenant.
- Historial temporal con `valid_from` y `valid_to` en transferencias y jerarquía.
- Directorio web de agentes, equipos y catálogo de roles.

Salida: roster versionado utilizable como dimensión KPI.

### Fase 5 — AI Chat [Completada]

- Interfaz multi-proveedor y adaptador Google Gemini con respaldo determinista.
- Tools read-only y ejecución gobernada con tenant_scope forzado.
- Fuentes, trazas, límites (5 turnos), feedback y manejo de fallos.
- Persistencia de conversaciones, mensajes y grounding_context en PostgreSQL con RLS.
- UI conversacional editorial en `/app/chat` con cajón de evidencia y preguntas sugeridas.

Salida: preguntas operacionales respondidas mediante Query API con contexto verificable y linaje auditable.

### Fase 6 — Hardening y piloto [Planificada]

- Rendimiento, accesibilidad y pruebas de carga.
- Threat modeling y revisión de privacidad.
- Backups/restauración y runbooks.
- Evaluación de exactitud de IA y KPIs.

Salida: piloto con dos tenants, datos sintéticos y criterios de aceptación cumplidos.

## 11. Estrategia de pruebas

### Unitarias

- Inferencia y conversión de tipos.
- Parser, AST, funciones y semántica de nulos.
- Detección de ciclos y rutas de joins.
- Capacidades por rol.
- Normalización de errores de proveedores IA.

### Integración

- RLS real con intentos de acceso cruzado.
- Importación, idempotencia y publicación transaccional.
- Replace, append y upsert con duplicados.
- SQL compilado contra datasets conocidos.
- Colas, reintentos y cancelación.

### E2E

- Login/MFA e invitación.
- Archivo → mapping → publicación.
- Dataset → relación → KPI → preview → publicación.
- KPI → widget → dashboard → publicación.
- Cambio temporal de layout y restauración al recargar.
- Pregunta de IA → tool → resultado → fuentes.

### Seguridad y resiliencia

- Prompt injection contenido en archivos y campos.
- Fórmulas maliciosas o excesivamente complejas.
- Archivos corruptos, zip bombs y extensiones falsas.
- Timeouts, caída de Redis, proveedor IA indisponible y jobs duplicados.
- CSV injection en exportaciones.
- Verificación de ausencia de PII en logs.

### Accesibilidad y rendimiento

- Navegación completa por teclado.
- Alternativas accesibles de gráficas y drag and drop.
- Contraste WCAG 2.2 AA.
- Prueba de archivo de 250 MB y decenas de millones de filas sintéticas.

## 12. Criterios de aceptación del MVP

- Dos tenants operan concurrentemente sin fuga de datos.
- Un Admin completa el recorrido de extremo a extremo sin intervención técnica.
- Las versiones publicadas de dataset, KPI y dashboard son restaurables y auditables.
- Las fórmulas inválidas, ciclos y joins ambiguos se rechazan antes de publicar.
- Todos los widgets consultan la API semántica y muestran versión/periodo.
- Los usuarios no administradores no pueden persistir cambios de layout.
- El chat no modifica estado y todas sus consultas respetan permisos y límites.
- Una respuesta de IA puede rastrearse hasta KPIs, filtros y versiones de datos.
- Los flujos principales cumplen WCAG 2.2 AA.
- Los objetivos iniciales de rendimiento se cumplen con el volumen acordado.

## 13. Evolución posterior

- Scopes jerárquicos de autorización por cuenta, equipo y supervisor.
- Vistas personales persistentes.
- Conectores CRM, WFM, QA y almacenamiento externo.
- Coaching, evaluaciones, planes de acción y seguimiento laboral.
- Alertas, anomalías y proyecciones.
- Workers Python aislados para estadística o machine learning cuando exista un caso medido.
- Almacén columnar dedicado si PostgreSQL deja de cumplir los SLO observados.
- Acciones de IA con preview, autorización y confirmación explícita.

Estas capacidades no deben adelantarse dentro del MVP salvo cambio formal de alcance.

## 14. Changelog de Implementación

### [2026-09-05] — Fase 2: Capa Semántica Multi-tabla y KPI Structure

Se completó la implementación de la Fase 2 (Capa Semántica y Motor de KPIs Multi-tabla):

- **Modelo de Relaciones Semánticas:** Migración `008_semantic_layer.sql` creando la tabla `semantic_relationships` con aislamiento por tenant obligatorio vía PostgreSQL Row-Level Security (`tenant_scope`) e inmutabilidad estricta de relaciones publicadas.
- **Compilador de JOINs y Grafo Semántico:** Módulo `packages/kpi/src/relations.ts` con algoritmo BFS para resolución determinista de rutas entre datasets. Soporta desambiguación mediante rutas preferidas (`is_preferred`) y rechaza productos cartesianos (`RELATION_REQUIRED`) y rutas ambiguas (`AMBIGUOUS_JOIN_PATH`).
- **Sintaxis Calificada y Catálogo Multi-tabla:** Extensión de `compileFormula` en `packages/kpi/src/dsl.ts` para resolver campos calificados `dataset.campo` sobre múltiples datasets publicados.
- **KPI Structure Gobernado:** Soporte para metas (`targets`: objetivo, advertencia, crítico), dirección de mejora (`higher_is_better`, `lower_is_better`, `target_match`), detección de ciclos en dependencias (`CIRCULAR_KPI_DEPENDENCY`), y deprecación de métricas sin alterar la reproducibilidad histórica (migración `009_kpi_deprecation.sql`).
- **Query Engine & Caché:** Soporte para filtros de rango temporal (`timeRange`), evaluación automática de estado de metas (good, warning, critical), reporte de `joinPath` ejecutado y caché en memoria por huella de consulta.
- **API & UI:** Controlador `SemanticController` bajo `/api/v1/semantic/relationships`, desbloqueo de la ruta en API, y UI completa en `/app/kpis` para publicar relaciones, definir KPIs gobernados con targets y consultar resultados con badges e inspección de linaje.
- **Verificación:** Cobertura de pruebas unitarias (`relations.test.ts`, `dsl.test.ts`) y suite de integración (`semantic.integration.test.ts`) contra PostgreSQL y RLS real.

### [2026-09-06] — Fase 3: Dashboards Gobernados, Widgets, Layouts Responsivos y Versionado

Se completó la implementación de la Fase 3 (Dashboards Gobernados):

- **Modelo de Datos y Versionado:** Migración `010_dashboards.sql` agregando las tablas `dashboards`, `dashboard_versions` y `dashboard_publications`, con aislamiento por tenant forzado mediante PostgreSQL Row-Level Security (`tenant_scope`) e inmutabilidad estricta garantizada por triggers en versiones publicadas.
- **Contratos y Schemas Zod:** Definidos en `packages/contracts/src/dashboard.ts` y exportados en el índice de contratos (`widgetTypeSchema`, `widgetGridSchema`, `widgetDefinitionSchema`, `dashboardCreateSchema`, `dashboardVersionSchema`, `dashboardSchema`, `dashboardListSchema`).
- **Servicio y Controlador API:** `DashboardsService` y `DashboardsController` en `apps/api/src/dashboards/dashboards.service.ts` y `apps/api/src/app.ts`. Desbloqueo de la bandera `dashboards: true` en la compuerta de características (`FoundationController.features`). Soporte para creación idempotente de dashboards con borrador inicial v1, guardado de nuevas versiones de layout y publicación oficial inmutable.
- **Transaccionalidad en Aislamiento RLS:** Reutilización de conexión cliente transaccional (`getInternal`) dentro de `withTenant` para evitar interbloqueos en nivel de aislamiento Read Committed de PostgreSQL.
- **Diseño Responsivo en Cuadrícula de 12 Columnas:** Implementado en `apps/web/app/app/dashboards/page.tsx` con disposición fluida de 12 columnas y colapso accesible en dispositivos móviles.
- **Componentes y Widgets Visuales:**
  - `kpi_card`: Cifra destacada en tipografía serif, unidad, estado dinámico de cumplimiento de meta (`Meta Cumplida`, `En Riesgo`, `Bajo Umbral`), fuente de dataset y huella de caché.
  - `line_chart`, `area_chart` y `bar_chart`: Gráficas vectoriales interactivas mediante ECharts en `apps/web/components/widget-chart.tsx` renderizadas con los tokens de diseño de ATLAS (`--accent`, `--surface`, `--secondary`), respetando `prefers-reduced-motion` y adaptables a redimensionamiento de pantalla.
  - **Alternativa Tabular Accesible:** Toggle instantáneo "Ver gráfica" / "Ver tabla accesible" en cada widget gráfico con alineación numérica derecha y fuentes tabulares conforme a WCAG 2.2 AA y `design.md`.
  - `table`: Tabla detallada con desglose por dimensión y resultados numéricos.
  - `text`: Tarjeta de anotaciones y contexto operativo.
- **Gobernanza de Roles y Estado Efímero:**
  - Los administradores (`dashboard.manage`, `dashboard.publish`) pueden crear dashboards, agregar, editar, reordenar y eliminar widgets, guardar borradores de versión y publicar oficialmente.
  - Los roles no administradores (`dashboard.read`) visualizan únicamente dashboards y versiones publicadas; cualquier cambio o ajuste de filtros se mantiene en el estado local de la sesión con aviso explícito y botón para "Restablecer diseño publicado".
- **Exportación de Datos a CSV:** Exportación de resultados agregados y desglosados de los widgets a archivo CSV con codificación UTF-8 con BOM.
- **Barra de Navegación Unificada:** Componente `AppHeader` (`apps/web/components/app-header.tsx`) integrado en todas las vistas (`/app`, `/app/datasets`, `/app/kpis`, `/app/dashboards`) permitiendo alternar fluidamente entre módulos sin perder contexto de sesión ni capacidades de rol.
- **Verificación:** Suite de integración `apps/api/src/dashboards.integration.test.ts` (7 pruebas pasando al 100%) validando creación, edición, publicación, control de acceso cruzado entre tenants vía RLS e inmutabilidad de versiones.
- **Motor de Personalización de Widgets y Drag & Drop:**
  - Reordenamiento visual directo mediante HTML5 Drag and Drop con `GripVertical` y drop targets resaltados.
  - Tiradores de redimensionamiento rápido para anchos de 3, 4, 6, 8 y 12 columnas (25%, 33%, 50%, 66%, 100%).
  - Sidebar interactiva `WidgetConfigSidebar` para edición en vivo de título, KPI, dimensión, paletas de color y parámetros.
  - Línea de meta horizontal (`markLine`) integrada en ECharts para gráficos de líneas y barras con etiqueta y valor objetivo.
  - Columnas calculadas para tablas con fórmulas (`% sobre meta`, `diferencia neta vs meta`, `multiplicador x100`).
  - Formatos condicionales para tablas con semaforización verde/rojo según umbrales (insignias, fondos suaves o barras inline).
- **Tiradores e Interfaz de Enfoque Armonizada con design.md:**
  - Supresión de la barra superior oscura y la tarjeta `# CHART 6/12 COLS`, preservando la sobriedad editorial de ATLAS.
  - Reemplazo del borde azul eléctrico por `var(--accent)` (`#365C4A`, Verde ATLAS), radio de 3px y halo de sombra sutil (`0 0 0 1px var(--accent), 0 3px 12px rgba(54, 92, 74, 0.12)`).
  - Tiradores con acabado en `var(--surface)` (`#FAF8F2`), borde `var(--accent)` (`#365C4A`) y hover en `var(--surface-muted)` (`#E9E5DB`): tirador vertical derecho (`ew-resize`), tirador horizontal inferior (`ns-resize`) y tirador de esquina (`nwse-resize`).
  - Encabezado unificado de tarjeta combinando controles de arrastre, título, KPI, selectores de ancho, vista accesible y configuración.

### [2026-09-06] — Edición de KPIs con Versionado Inmutable y Preparación de Fase 4 (Workforce)

- **Edición de KPIs Gobernados en `/app/kpis`:**
  - Se habilitó la acción **Editar** para cada definición guardada en la tabla de métricas gobernadas (visible para roles con `semantic.manage`).
  - Carga controlada y reactiva de los parámetros de la métrica hacia el formulario de definición (`name`, `description`, `datasetVersionId`, `formula`, `unit`, `precision`, `targetDirection`, `targets`, `dimensions`).
  - Modo de edición explícito con aviso informativo sobre la inmutabilidad de versiones previas.
  - Conservación estricta del slug para garantizar continuidad de identidad, incrementando atómicamente el número de versión (`v{kpi.number + 1}`) al persistir.
  - Botón de cancelación de edición para limpiar el formulario y regresar al modo de definición inicial.
- **Planificación y Entrega de Fase 4 (Workforce / Agent Definer):**
  - Migración relacional `011_workforce.sql` con soporte para empleados, equipos, roles laborales, asignaciones temporales con `valid_from`/`valid_to` y jerarquía de reporte.
  - Aislamiento multi-tenant obligatorio mediante PostgreSQL Row-Level Security (`tenant_scope`) y control de acceso por capacidades (`workforce.read`, `workforce.manage`).
  - Endpoints REST en NestJS bajo `/api/v1/workforce` (`/employee-types`, `/teams`, `/employees`, `/assignments`, `/relationships`).
  - Interfaz web interactiva en `/app/workforce` con directorio de agentes, equipos, catálogo de roles, linaje temporal auditable y navegación en `AppHeader`.
  - Cobertura de pruebas unitarias y suite de integración `workforce.integration.test.ts` con validación de aislamiento entre organizaciones bajo RLS.

### [2026-09-06] — Fase 5: AI Chat Multi-Proveedor y Asistente Operacional de Inteligencia

Se implementó el Asistente Operacional de Inteligencia en `/app/chat`:

- **Modelo de Base de Datos y Aislamiento RLS:**
  - Migración `012_conversations.sql` con tablas `conversations`, `conversation_messages` y `conversation_tool_executions`, aseguradas con PostgreSQL Row-Level Security (`tenant_scope`) para el rol `atlas_app`.
- **Contratos Zod Tipados:**
  - `packages/contracts/src/ai.ts` con esquemas para conversaciones, mensajes, ejecuciones de tools y evidencia (`grounding_context`).
- **Arquitectura Multi-Proveedor Agnóstica:**
  - Interfaz desacoplada `AIProvider` en `apps/api/src/ai/provider.ts` con adaptadores para Google Gemini (function calling, thinking model signatures) y Mock Determinista offline para pruebas.
  - Variable de entorno `GEMINI_MODEL` para selección dinámica del modelo (por defecto `gemini-2.5-flash`).
- **Catálogo de Tools de Solo Lectura con Aislamiento Estricto:**
  - 7 herramientas gobernadas en `apps/api/src/ai/tools.ts` (`search_kpis`, `get_kpi_definition`, `describe_dataset`, `describe_relationships`, `run_semantic_query`, `get_employee_structure`, `get_published_dashboard`).
  - Inyección estricta del `tenant_id` desde el actor de sesión (`actor.tenantId`), previniendo prompt injection y acceso cruzado.
  - Límite duro de 5 turnos de herramientas por mensaje para protección de tokens y coste.
- **UI Web Editorial en `/app/chat`:**
  - Diseño editorial acorde a `design.md`, historial de conversaciones en barra lateral, cajón de evidencia gobernada (citas de KPIs, datasets y hashes SQL) y sugerencias iniciales.
- **Verificación:**
  - Suite de integración `conversations.integration.test.ts` (6 pruebas) pasando con validación de tools y aislamiento entre organizaciones.

### [2026-09-06] — Ciclo de Vida Dual, Eliminación y Archivo de Datasets y KPIs

Se completó la implementación del ciclo de vida gobernado con enfoque dual:

- **Modelo de Datos y Triggers en PostgreSQL:**
  - Migración `013_dataset_kpi_lifecycle.sql` con columna `archived_at timestamptz` en `datasets`.
  - Permisos `DELETE` concedidos a `atlas_app` en `datasets`, `dataset_versions`, `dataset_publications` y `kpi_versions`.
  - Triggers `protect_published_dataset_delete`, `protect_published_version_delete` y `protect_published_kpi_delete` que bloquean en PostgreSQL (error `23514`) cualquier intento de borrado físico sobre datos publicados.
- **Contratos Zod Tipados:**
  - `datasetSchema` con `archivedAt: z.string().nullable().default(null)`.
  - `datasetLifecycleResultSchema` y `kpiLifecycleResultSchema`.
- **Ingesta y Almacenamiento:**
  - `ObjectStorage.delete` para purga de binarios en MinIO/S3.
  - `IngestionService.deleteOrArchive`: Hard delete de borradores sin publicar (verificando ausencia de relaciones semánticas o KPIs asociados) y Soft delete (archivado lógico) para datasets con datos publicados.
  - `IngestionService.unarchive`: reactivación de datasets archivados.
- **Motor Semántico & KPIs:**
  - `KpiService.deleteOrDeprecate`: Hard delete de borradores y deprecación de métricas publicadas preservando historial.
- **Integración con IA y UI Web:**
  - Herramienta `search_kpis` excluye métricas deprecadas.
  - Vistas `/app/datasets` y `/app/kpis` con selectores para mostrar/ocultar archivados y deprecados, botones contextuales y modales explicativos de confirmación.
- **Verificación:**
  - 47 pruebas de integración pasando al 100% (incluyendo validaciones de borrado, archivo y triggers en `data.integration.test.ts`).
  - 39 pruebas unitarias pasando al 100%.
  - Verificación de tipos Turborepo limpia (11 tareas exitosas, 0 errores).



