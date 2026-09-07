# ATLAS Operational Intelligence

Plataforma SaaS multi-tenant para operaciones de call center y BPO que transforma archivos Excel/CSV en datasets versionados, modelos semánticos gobernados, KPIs auditables, dashboards interactivos y análisis asistidos por IA.

Implementación del monorepo modular descrito en `design.md` e `implementation.md`, con todas las fases funcionales del MVP completadas y operativas bajo aislamiento estricto por organización.

## Módulos y capacidades disponibles

- **Identidad, Autenticación y Control de Acceso:**
  - Autenticación por email y contraseña con algoritmo scrypt y sal aleatoria.
  - Segundo factor MFA (TOTP) obligatorio para administradores antes de conceder acceso a datos.
  - Sesiones rotadas de 8 horas representadas mediante tokens criptográficos de 256 bits (hash SHA-256).
  - Gestión integral de usuarios, perfiles (nombre, contraseña), y membresías con PostgreSQL Row-Level Security (`atlas_auth` / `atlas_app`).
  - Control de acceso por cuenta (`identity.membership_account_access`) y asignación granular de permisos a miembros.
- **Account Portal y Aislamiento por Cuenta (ATLAS v3):**
  - **Portal central de cuentas (`/portal/accounts`):** selección post-login de cuentas operacionales con métricas en vivo (datasets, KPIs, dashboards, semana activa y estado del roster).
  - **Aislamiento en profundidad (Composite RLS):** consultas acotadas mediante contexto doble `(atlas.tenant_id, atlas.account_id)`, aislando datasets, KPIs, dashboards y personal entre cuentas de una misma organización.
  - **Ciclo de vida dual de cuentas:** Hard Delete definitivo para cuentas vacías sin histórico y archivo lógico (`archived_at`) protegido por triggers de PostgreSQL (`23514`) para cuentas con datos asociados.
  - **Rotación de tokens por cuenta:** cambio dinámico de contexto mediante `/api/v1/auth/switch-account` sin desconexión del usuario.
- **Ingesta Versionada y Ciclo de Vida Dual:**
  - Carga directa firmada a MinIO/S3 para archivos CSV UTF-8 y XLSX vinculados a `account_id`.
  - Procesamiento streaming en worker aislado mediante `ExcelJS` con límite de memoria.
  - Perfilado automático, configuración regional explícita (separadores y formatos de fecha) y detección de errores antes de publicar.
  - Estrategias de actualización idempotentes: replace (nuevo snapshot), append (adición con linaje) y upsert (fusión por clave natural).
  - **Ciclo de vida dual:**
    - *Borradores sin publicar:* eliminación definitiva (Hard Delete) con purga física de todas las versiones y delete markers en MinIO/S3 (`storage.purge`).
    - *Versiones publicadas:* inmutabilidad estricta bloqueada por triggers de PostgreSQL (`23514`); solo admiten archivo lógico (`archived_at`) o deprecación (`deprecated_at`), garantizando reproducibilidad histórica.
- **Capa Semántica y Lienzo Visual Interactivo (`/app/accounts/:accountId/kpis`):**
  - Grafo semántico acotado por cuenta con relaciones tipadas (`1:1`, `1:N`, `N:1`) y tipos de join (`INNER`, `LEFT`).
  - Resolución determinista de JOINs basada en algoritmo BFS que rechaza productos cartesianos y rutas ambiguas.
  - **Lienzo visual tipo Lucidchart (`@xyflow/react`):** vista dual (lienzo interactivo o lista clásica), tarjetas de datasets y KPIs, aristas con enrutamiento inteligente y halo de contraste en primer plano, simulador interactivo de rutas de consulta, constructor visual de fórmulas con autocompletado, detección de ciclos en tiempo real y exportación de diagramas a PNG/SVG.
- **KPI Structure, DSL Segura y Mapeo Dinámico:**
  - DSL tipada que se compila a SQL interno parametrizado con validación estricta de tipos y semántica de nulos.
  - Metas operacionales (objetivo, advertencia, crítico) y dirección de optimización (`higher_is_better`, `lower_is_better`, `target_match`).
  - Versionado inmutable de fórmulas: modificar una métrica genera automáticamente la versión `v{n+1}` preservando las versiones anteriores.
  - **Mapeo Dinámico de Workforce (`workforce_mapping`):** vincula automáticamente datasets operacionales con la estructura de personal (Supervisor, Floor Manager, Wave, Equipo) por código de agente o BMS ID sin duplicar almacenamiento.
  - **Caché LRU acotada (500 entradas):** invalidación automática por publicación y control estricto de capacidad de lectura de workforce (`workforce.read`).
- **Dashboards Gobernados de 12 Columnas (`/app/accounts/:accountId/dashboards`):**
  - Cuadrícula responsive de 12 columnas con reordenamiento visual Drag & Drop (`GripVertical`) y tiradores de redimensionamiento.
  - Catálogo de widgets: `kpi_card`, `line_chart`, `bar_chart`, `area_chart`, `table` y `text` renderizados con Apache ECharts y la paleta editorial de ATLAS.
  - **Accesibilidad WCAG 2.2 AA:** alternativa tabular accesible obligatoria en cada widget gráfico con un clic.
  - **Filtros operacionales inteligentes:** auto-detección y fallback de campos de fecha, y menús desplegables dinámicos para filtros de call center (Supervisor, Floor Manager, Wave).
  - Gobernanza de roles: administradores publican versiones oficiales inmutables; usuarios no administradores operan en estado efímero local de sesión con opción de restablecimiento.
- **Workforce / Agent Definer y Rosters Semanales (`/app/accounts/:accountId/workforce`):**
  - **Catálogos exclusivos por cuenta (`account_id`):** tipos de empleado, equipos y agentes pertenecen estrictamente a una cuenta, garantizando confidencialidad entre operaciones.
  - Directorio de agentes con código natural único, BMS ID, Wave, correo y atributos personalizados JSONB.
  - **Semanas Operativas (`workforce_weeks`):** estructura formal de Lunes a Domingo con código canónico ISO (`YYYY-Www`) y unicidad por cuenta.
  - **Rosters Semanales Versionados e Inmutables (`workforce_roster_versions` y `workforce_roster_entries`):**
    - Congelación de snapshots de personal asignado tras la importación masiva de Excel.
    - Publicación formal de versión oficial del roster por semana.
    - Clonación rápida de rosters hacia semanas operativas futuras para planificación sin fricción.
    - Vista dedicada por semana (`/app/accounts/:accountId/workforce/weeks/:weekId`) con selector de versiones históricas.
- **Asistente Operacional de Inteligencia / AI Chat (`/app/accounts/:accountId/chat`):**
  - Arquitectura multi-proveedor desacoplada (`AIProvider`): Google Gemini en producción y Mock Determinista offline para pruebas y entornos locales sin API keys.
  - 7 herramientas estrictamente de solo lectura (`search_kpis`, `get_kpi_definition`, `describe_dataset`, `describe_relationships`, `run_semantic_query`, `get_employee_structure`, `get_published_dashboard`).
  - Inyección obligatoria de `tenant_id` y `account_id` directamente desde la sesión del usuario, garantizando aislamiento total.
  - Respuestas con separación de hechos e interpretación, citas auditables con linaje (`grounding_context`) y **límite ampliado de 25 turnos por consulta**.

## Arquitectura y Stack

| Capa | Tecnologías |
|---|---|
| Monorepo | pnpm + Turborepo |
| Frontend | Next.js (App Router), React, Radix UI, Vanilla CSS con tokens ATLAS, Lucide Icons |
| Visualización | Apache ECharts, React Flow (`@xyflow/react`), Dagre Layout |
| API REST | NestJS, Fastify/Express, Node.js |
| Worker | NestJS, BullMQ |
| Base de Datos | PostgreSQL (Transaccional, Analítica y RLS forzada) |
| Caché y Colas | Redis |
| Almacenamiento | MinIO / S3-compatible object storage con URLs firmadas |
| Contratos | Zod, TypeScript en modo estricto |
| Lector Excel | ExcelJS (streaming en worker aislado e importador de rosters) |
| Pruebas | Vitest (unitarias e integración real con RLS), Playwright (E2E) |

## Ejecutar localmente

Requisitos: Node.js >=22.12, pnpm 11 (o via `npx pnpm`) y Docker Desktop con motor Linux en ejecución.

```sh
npx pnpm install --frozen-lockfile
node scripts/setup-local.mjs
npx pnpm infra:up
npx pnpm db:generate
npx pnpm build
npx pnpm db:migrate
npx pnpm dev
```

`setup-local.mjs` genera secretos criptográficos aleatorios en `.env` y no sobrescribe archivos existentes.

- **Web:** http://127.0.0.1:3000
- **API Health:** http://127.0.0.1:4000/api/v1/health
- **Consola MinIO:** http://127.0.0.1:9010

Los paquetes compartidos exportan su build TypeScript. Al editar contratos o migraciones, ejecuta `npx pnpm build` antes de reiniciar los servicios.

## Crear tu primer administrador

Para inicializar una organización local con credenciales de desarrollo:

En PowerShell:

```powershell
$env:ATLAS_ADMIN_EMAIL = Read-Host 'Correo del administrador'
$env:ATLAS_ORGANIZATION_NAME = Read-Host 'Nombre de la organización'
$atlasPassword = Read-Host 'Contraseña (mínimo 14 caracteres)' -AsSecureString
$atlasCredential = [PSCredential]::new('bootstrap', $atlasPassword)
$env:ATLAS_ADMIN_PASSWORD = $atlasCredential.GetNetworkCredential().Password
try {
    npx pnpm --filter @atlas/api bootstrap:admin
} finally {
    Remove-Item Env:ATLAS_ADMIN_PASSWORD
    Remove-Item Env:ATLAS_ADMIN_EMAIL
    Remove-Item Env:ATLAS_ORGANIZATION_NAME
    $atlasCredential = $null
    $atlasPassword.Dispose()
}
```

Luego abre `/login`. La primera entrada requerirá escanear o ingresar la clave TOTP generada para habilitar MFA.

## Navegación en la aplicación

Tras autenticarse en `/login`, la aplicación redirige al **Portal de Cuentas** (`/portal/accounts`), donde el usuario selecciona su operación activa. Dentro de cada cuenta, la barra de navegación unificada (`AppHeader`) brinda acceso contextual a:

- `/portal/accounts`: Portal central de cuentas y campañas operacionales, con métricas en vivo, estados de roster y administración.
- `/app/accounts/:accountId/datasets`: Gestión de datasets, carga CSV/XLSX y ciclo de vida dual (borrado/archivo).
- `/app/accounts/:accountId/kpis`: Capa Semántica, Lienzo Interactivo tipo Lucidchart y definición de KPIs gobernados.
- `/app/accounts/:accountId/dashboards`: Dashboards interactivos de 12 columnas, widgets ECharts y filtros operacionales.
- `/app/accounts/:accountId/workforce`: Directorio de agentes, equipos, roles, semanas operativas e importación de Roster Excel.
- `/app/accounts/:accountId/workforce/weeks/:weekId`: Vista detallada de semana operativa con rosters versionados inmutables (`v1`, `v2`...), publicación oficial y clonación.
- `/app/accounts/:accountId/chat`: Asistente analítico IA de solo lectura con evidencia y linaje auditable.

## Validación y pruebas

La suite de pruebas valida la arquitectura contra bases de datos PostgreSQL y buckets MinIO reales:

```sh
npx pnpm db:test:prepare
npx pnpm lint
npx pnpm typecheck
npx pnpm test
npx pnpm test:integration
npx pnpm exec playwright install chromium
npx pnpm test:e2e
npx pnpm audit --prod
```

- **Pruebas unitarias:** 45 pruebas pasando (`packages/kpi`, `packages/contracts`, `packages/ingestion`, `apps/web/components/semantic-canvas`, `apps/api/src/identity/crypto`).
- **Pruebas de integración real:** 54 pruebas pasando con PostgreSQL y RLS forzada (ingesta S3/BullMQ, ciclo dual de borrado y archivo, triggers PostgreSQL, compilación SQL multi-tabla, RLS cruzada entre organizaciones, linaje temporal de workforce y bucle de tools de AI Chat).
- **Aislamiento Composite RLS:** Certificación automatizada de 0 fugas de datos de personal, equipos, semanas y rosters entre cuentas de un mismo tenant.
- **Tipado estricto:** 0 errores en verificación de tipos Turborepo y `next build` en los 7 paquetes.
- **Migraciones canónicas:** 20 migraciones SQL aplicadas en base de datos (`001_foundations.sql` a `020_account_permissions_and_grants.sql`).

## Estado de implementación

Consulta [docs/status.md](docs/status.md) para el detalle del progreso técnico y el historial de cambios, y la carpeta [docs/decisions/](docs/decisions/) para las decisiones de arquitectura (ADRs 0001 a 0004).
