# Fundaciones iniciales

Fecha: 2026-09-05.

## Identidad

El usuario confirmó autenticación propia de ATLAS. El primer flujo usa email y contraseña con scrypt (N=32768, r=8, p=3), sal aleatoria y verificación de tiempo constante. Admin requiere TOTP de seis dígitos/30 segundos, con una ventana de un paso por desajuste de reloj. Se cifra el secreto con AES-256-GCM y una clave externa al código.

Las sesiones preliminares de cinco minutos únicamente permiten completar MFA. La sesión completa dura ocho horas y se representa con un token aleatorio de 256 bits almacenado como hash SHA-256. La rotación al completar MFA y el consumo del paso TOTP son transaccionales. Logout y revocación eliminan las sesiones del servidor.

Usuarios y sesiones son registros internos globales del módulo de identidad. Las membresías sí son multi-tenant y tienen RLS por identidad verificada, para descubrir la organización después de verificar contraseña/sesión. Los datos de negocio usan otra conexión limitada por tenant. Ningún endpoint recibe una conexión de administrador.

El usuario confirmó esta matriz, centralizada en `roleCapabilities` de contratos:

| Rol | Capacidades |
| --- | --- |
| Admin | Todas las del catálogo |
| Supervisor / Jefe de piso / Calidad | dashboard.read, semantic.read, dataset.read, workforce.read, ai.use |
| Operations Manager | dashboard.read, semantic.read, workforce.read, ai.use |
| CEO | dashboard.read, semantic.read, ai.use |

La migración 003 elimina concesiones arbitrarias almacenadas por membresía. El rol resuelve capacidades en cada request. Solo Admin consulta miembros y cambia roles en su tenant; un lock transaccional preserva al último administrador ante cambios simultáneos. La auditoría guarda actor, membresía destino y roles anterior/nuevo, sin correo. Un usuario con múltiples organizaciones necesita un selector pendiente de implementación; se rechaza el login ambiguo.

Las solicitudes de escritura exigen el Origin configurado; producción exige HTTPS y usa cookie `__Host-atlas_session`. El servidor actual escucha loopback para desarrollo. Antes de despliegue deben definirse proxy de confianza, protección de borde y orígenes del entorno real.

## Persistencia y ejecución

PostgreSQL es la fuente de verdad. Las migraciones SQL son canónicas para RLS, roles y auditoría. Prisma 6.19.3 conserva el esquema inicial de organización/cuenta y genera su cliente; los repositorios iniciales usan `pg` para controlar expresamente la transacción y `set_config(..., true)`.

Se fija `@prisma/config>deepmerge-ts` en 8.0.2 por [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx). La generación Prisma y la suite comprueban la compatibilidad de este override. Revisarlo al actualizar Prisma.

El stack local conserva Next.js y NestJS, PostgreSQL, Redis y almacenamiento S3-compatible conforme a los documentos. No se adaptó a Sites/Cloudflare ni se publicó una demo como si fuera el SaaS completo.

## Demostración y pruebas

`/` es una demostración pública sin datos reales ni sesión de organización. `/app` obtiene la sesión y las cuentas de la API. El backend mantiene deshabilitadas las funcionalidades no implementadas.

Los porcentajes del fixture son valores de ejemplo; calidad se pondera por evaluaciones y AHT por llamadas atendidas. La serie temporal está identificada como ilustrativa global e independiente de filtros. Ninguna fórmula se ejecuta en el navegador.

La base `atlas_test` se utiliza para integración y E2E. Los scripts se niegan a preparar pruebas fuera de un PostgreSQL local. Los datos de prueba son sintéticos; no se capturan trazas de navegador con credenciales.
