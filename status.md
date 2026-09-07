# Estado de ATLAS — Acceso Rápido

El documento canónico y detallado del estado de implementación se encuentra en:

👉 [docs/status.md](docs/status.md)

## Resumen Ejecutivo

- **Módulos Operativos:** Fundaciones, Identidad y Usuarios (con MFA y RLS), Ingesta Versionada (CSV/XLSX) con Ciclo de Vida Dual (Hard Delete de borradores vs Soft Delete/Archivo con triggers PostgreSQL), Capa Semántica Multi-tabla y Lienzo Visual Interactivo (Lucidchart style con `@xyflow/react`), Motor KPI con versionado inmutable y Mapeo Dinámico de Workforce, Dashboards Gobernados de 12 Columnas (con alternativas accesibles WCAG 2.2 AA y filtros operacionales dinámicos), Workforce y Semanas Operativas (`workforce_weeks`) con importador de Rosters Excel multi-hoja, y Asistente IA (AI Chat multi-proveedor de solo lectura con 7 tools y aislamiento estricto).
- **Esquema de Base de Datos:** 16 migraciones SQL canónicas (`001_foundations.sql` a `016_workforce_weeks_and_dynamic_mapping.sql`).
- **Validación Automatizada:**
  - 45 pruebas unitarias pasando (`pnpm test`).
  - 54 pruebas de integración real pasando con PostgreSQL y RLS forzada (`pnpm test:integration`).
  - 0 errores de tipado TypeScript en Turborepo en los 7 paquetes (`turbo run typecheck`).
- **Próximos Pasos (Fase 6):** Hardening, pruebas de volumen masivo (250 MB / 20M filas), observabilidad OpenTelemetry / Prometheus y piloto multi-tenant con datos sintéticos.
