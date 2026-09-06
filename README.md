# ATLAS Operational Intelligence

Implementación activa del monorepo descrito en `design.md` e `implementation.md`.
Esta entrega incluye Fundaciones, ingesta versionada y el primer motor KPI de una tabla. **El MVP completo todavía no está terminado.**

## Disponible

- Next.js con interfaz en español, tokens ATLAS, navegación responsive y accesibilidad comprobada automáticamente.
- Dashboard público de datos sintéticos: filtros de cuenta/equipo, CSV, definiciones ilustrativas y alternativa tabular del gráfico. No consulta datos reales.
- API NestJS `/api/v1`: email/contraseña, configuración y verificación TOTP, sesión, cierre y revocación de todas las sesiones.
- Creación y consulta de cuentas reales por organización, con permisos, auditoría e idempotencia.
- Consulta de miembros y gestión de roles según la matriz confirmada, con protección del último administrador.
- Administradores sin acceso a datos hasta completar MFA. Contraseñas con scrypt; secretos TOTP cifrados con AES-256-GCM; tokens aleatorios almacenados como hashes.
- Organizaciones y cuentas en PostgreSQL, RLS forzado, roles de conexión separados para identidad y aplicación, auditoría append-only para el rol de aplicación.
- Ingesta real CSV UTF-8/XLSX: originales versionados en MinIO, perfil, configuración regional, mapeo, validación en worker, replace/append/upsert, publicación, restauración y lineage.
- Motor KPI de una tabla con DSL segura, AST versionado, SQL interno parametrizado, Query API declarativa y trazabilidad hasta el hash del archivo.
- Pantallas autenticadas `/app/datasets` y `/app/kpis` para ejecutar el recorrido completo.
- Worker NestJS/BullMQ conectado a Redis y procesamiento aislado en threads con límite de memoria.
- PostgreSQL, Redis y MinIO en Docker Compose con puertos limitados a loopback.
- Contratos Zod, TypeScript estricto, build Turbo, pruebas unitarias, integración PostgreSQL y E2E Playwright.

## Ejecutar localmente

Requisitos: Node.js >=22.12, pnpm 11.19 y Docker Desktop con motor Linux en ejecución.

```sh
pnpm install --frozen-lockfile
node scripts/setup-local.mjs
pnpm infra:up
pnpm db:generate
pnpm build
pnpm db:migrate
pnpm dev
```

`setup-local.mjs` genera secretos aleatorios en `.env` y se niega a reemplazar un archivo existente.
Si `.env` ya existe, omite ese paso. No lo subas a Git ni compartas su contenido.

- Web: http://127.0.0.1:3000
- API: http://127.0.0.1:4000/api/v1/health
- Consola de almacenamiento local: http://127.0.0.1:9010

Los paquetes compartidos exportan su build. Tras editar contratos o base de datos, ejecuta `pnpm build` o el build del paquete correspondiente antes de reiniciar los consumidores.

## Crear tu primer administrador

Para probar en desarrollo sin usar datos personales: `pnpm --filter @atlas/api bootstrap:local` crea una organización local y guarda una contraseña aleatoria en `.local/admin-access.md` (ignorado por Git). Exige `NODE_ENV=development` y base `atlas` en loopback; no reemplaza cuentas ni contraseñas existentes. La primera entrada requiere MFA real.

No hay credenciales de producción predeterminadas ni registro público. El bootstrap crea una organización y un administrador, sin reemplazar usuarios existentes. El primer login requiere configurar TOTP.

En PowerShell, desde el repositorio:

```powershell
$env:ATLAS_ADMIN_EMAIL = Read-Host 'Correo del administrador'
$env:ATLAS_ORGANIZATION_NAME = Read-Host 'Nombre de la organización'
$atlasPassword = Read-Host 'Contraseña (mínimo 14 caracteres)' -AsSecureString
$atlasCredential = [PSCredential]::new('bootstrap', $atlasPassword)
$env:ATLAS_ADMIN_PASSWORD = $atlasCredential.GetNetworkCredential().Password
try {
    pnpm --filter @atlas/api bootstrap:admin
} finally {
    Remove-Item Env:ATLAS_ADMIN_PASSWORD
    Remove-Item Env:ATLAS_ADMIN_EMAIL
    Remove-Item Env:ATLAS_ORGANIZATION_NAME
    $atlasCredential = $null
    $atlasPassword.Dispose()
}
```

Después abre `/login`. Conserva la clave de configuración TOTP en un gestor seguro. Aún no existe flujo de recuperación por correo, códigos de recuperación ni invitaciones.

## Validación

```sh
pnpm db:test:prepare
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
pnpm audit --prod
```

Integración y E2E usan exclusivamente `atlas_test` en PostgreSQL local. No limpian ni reutilizan la base `atlas`.
E2E levanta procesos aislados en 3001/4001 y un administrador sintético en la base de pruebas. Sus credenciales no funcionan en la instancia normal.
Las comprobaciones automáticas de accesibilidad no sustituyen una revisión completa con lector de pantalla.

## Estado y límites

Ver [estado de implementación](docs/status.md), [decisiones de fundaciones](docs/decisions/0001-foundations.md) y [decisiones de ingesta/KPI](docs/decisions/0002-ingestion-kpi.md).
Las rutas de funcionalidades no construidas devuelven `FEATURE_UNAVAILABLE`; no hay chat simulado ni publicación de datos ficticia.

No desplegar con datos reales todavía: faltan recuperación/invitaciones, auditoría completa de identidad, observabilidad OpenTelemetry, políticas operativas y las fases funcionales del MVP.
