# Estado de ATLAS — Acceso Rápido

El documento canónico y detallado del estado de implementación se encuentra en:

👉 [docs/status.md](docs/status.md)

## Resumen Ejecutivo — Versión v3 Activa

- **Módulos Operativos:**
  - **Account Portal (`/portal/accounts`):** Portal central post-login con selección de cuentas operacionales, métricas en vivo (datasets, KPIs, dashboards, semana activa, estado de roster), ciclo de vida dual (Hard Delete para vacías vs. Archivo protegido por triggers `23514`) y control de acceso por miembro.
  - **Aislamiento por Cuenta (Composite RLS):** Aislamiento estricto multinivel mediante `(atlas.tenant_id, atlas.account_id)` en todas las tablas de datasets, KPIs, dashboards, workforce y conversaciones.
  - **Workforce con Catálogos Exclusivos y Rosters Semanales:** Catálogos de roles, equipos y personal exclusivos por cuenta. Semanas operativas ISO (`YYYY-Www`) con rosters versionados inmutables (`workforce_roster_versions` / `workforce_roster_entries`), publicación oficial, clonación entre semanas y vista dedicada (`/app/accounts/:accountId/workforce/weeks/:weekId`).
  - **Identidad, Autenticación y Rotación de Sesión:** Scrypt, TOTP obligatorio para administradores, tokens de sesión rotados con cambio seguro de cuenta activa (`/api/v1/auth/switch-account`).
  - **Ingesta Versionada y Ciclo de Vida Dual:** Streaming `ExcelJS`, purga física total de objetos S3 en drafts (`storage.purge`), e inmutabilidad garantizada por triggers.
  - **Capa Semántica y Lienzo Interactivo (`@xyflow/react`):** Grafo BFS sin ciclos ni ambigüedades, constructor visual de fórmulas y caché LRU acotada (500 entradas).
  - **Dashboards Gobernados de 12 Columnas:** Alternativas WCAG 2.2 AA, widgets ECharts interactivos, filtros de call center dinámicos y publicación inmutable.
  - **AI Chat Multi-Proveedor:** Asistente de solo lectura con 7 tools acotadas por tenant y cuenta activa, evidencia y linaje auditable.
- **Esquema de Base de Datos:** 20 migraciones SQL canónicas (`001_foundations.sql` a `020_account_permissions_and_grants.sql`).
- **Validación Automatizada:**
  - 45 pruebas unitarias pasando (`pnpm test`).
  - 54 pruebas de integración real con PostgreSQL y RLS forzada (`pnpm test:integration`).
  - Aislamiento Composite RLS verificado (0 fugas de datos entre cuentas).
  - 0 errores de compilación TypeScript y Turborepo en los 7 paquetes (`pnpm build`).
- **Próximos Pasos:** Hardening, pruebas de volumen masivo (250 MB / 20M filas), observabilidad OpenTelemetry / Prometheus y piloto multi-tenant con datos sintéticos.
