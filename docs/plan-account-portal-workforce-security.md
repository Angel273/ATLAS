# Plan de evolución: seguridad, Portal de Cuentas y Workforce semanal

## 1. Propósito

Este documento define el plan para:

- Corregir las vulnerabilidades identificadas en identidad, autorización, ingesta, consultas, IA y almacenamiento.
- Convertir las cuentas en instancias operativas completas de ATLAS, no únicamente en una lista administrativa.
- Incorporar un Portal de Cuentas después del inicio de sesión y limitar su contenido a las cuentas accesibles para cada usuario.
- Convertir las semanas operativas en el agregado central de Workforce.
- Implementar un cruce temporal, versionado y reproducible entre roster, datasets y KPIs.

Este es un documento de planificación. No implica cambios de código ni migraciones ejecutadas.

## 2. Dirección arquitectónica

La jerarquía objetivo es:

```text
Organización = límite tenant y de seguridad
└── Cuenta = instancia operativa completa de ATLAS
    ├── Datasets y versiones
    ├── Modelo semántico y KPIs
    ├── Dashboards
    ├── Conversaciones IA
    └── Workforce
        └── Semana operativa
            ├── Roster versionado
            ├── Equipos y jerarquías
            └── Cruces reproducibles con datasets
```

La organización continúa siendo el límite superior de aislamiento multi-tenant. La cuenta pasa a ser el contexto operativo y de autorización dentro de la organización. La semana pasa a ser el contexto temporal de Workforce dentro de una cuenta.

## 3. Diagnóstico del estado actual

### 3.1 Cuentas

- Ya existe un CRUD básico para crear, consultar, editar nombre y zona horaria, y eliminar cuentas.
- Actualmente todos los usuarios autenticados reciben todas las cuentas del tenant.
- Una cuenta no delimita datasets, KPIs, dashboards, conversaciones ni semanas.
- Solo equipos y algunas asignaciones poseen un `account_id`, y este es opcional.
- La eliminación actual desvincula equipos y elimina la cuenta. Este comportamiento no es válido si la cuenta se convierte en raíz del sistema analítico.
- El shell y la navegación usan rutas globales como `/app/datasets`, `/app/kpis` y `/app/workforce`, sin contexto de cuenta.

### 3.2 Workforce y semanas

- Las semanas pertenecen al tenant, no a una cuenta.
- La edición de semanas está limitada a estado y atributos JSON.
- No existe una página de detalle de semana que concentre roster, equipos, jerarquías, incidencias y analítica.
- Las asignaciones y relaciones permiten `week_id`, pero este es opcional.
- El directorio calcula el estado actual mediante `now()`, no a partir de la semana seleccionada.
- La importación puede asignar una semana, pero también permite una asignación general continua.
- La importación actual decodifica Base64 en el API, carga XLSX completo en memoria y solo procesa la primera hoja.

### 3.3 Cruce Workforce–dataset–KPI

- El mapping está almacenado en cada versión de KPI mediante `workforce_mapping`.
- El join se ejecuta dinámicamente contra empleados y relaciones vigentes en `now()`.
- No se resuelve la semana correspondiente a la fecha del registro del dataset.
- No se fija la versión de roster utilizada.
- No se mide ni gobierna la cobertura de coincidencias.
- Un registro sin coincidencia puede producir resultados incompletos o ambiguos sin una evidencia suficiente.
- Las dimensiones de Workforce pueden atravesar límites de capacidades porque el Query Engine exige `semantic.read`, pero no siempre `workforce.read`.

### 3.4 Seguridad

Los riesgos prioritarios son:

1. Un administrador de tenant puede vincular una identidad global existente y modificar contraseña, MFA, correo o estado global.
2. Las consultas KPI pueden exponer dimensiones personales de Workforce sin comprobar la capacidad correspondiente.
3. La importación de roster es vulnerable a agotamiento de memoria mediante XLSX comprimidos.
4. Los resultados enviados al proveedor de IA pueden contener nombres, códigos u otra PII.
5. MFA y cookies dependen de una interpretación insegura de `NODE_ENV`.
6. El cambio de contraseña no invalida todas las sesiones existentes.
7. El caché KPI no tiene límite y las llamadas de IA carecen de cuotas, timeout y control de concurrencia suficiente.
8. El borrado en almacenamiento versionado puede dejar versiones antiguas de archivos.
9. Los filtros desconocidos pueden ignorarse en lugar de rechazarse.

## 4. Cuenta como contexto operativo y de autorización

### 4.1 Modelo de acceso

- La identidad del usuario continúa siendo global.
- La membresía y el rol continúan perteneciendo a la organización durante el MVP.
- Se incorpora una relación explícita de acceso entre membresía y cuenta, por ejemplo `membership_account_access`.
- Los administradores con `tenant.manage` acceden a todas las cuentas de su organización.
- Los demás usuarios solo acceden a las cuentas asignadas explícitamente.
- Los roles siguen siendo organizacionales. No se incorporan roles diferentes por cuenta en esta fase.
- La revocación del acceso debe surtir efecto en la siguiente solicitud autenticada.

### 4.2 Contexto de sesión

- Después de autenticar contraseña y MFA, la sesión puede existir sin una cuenta activa para permitir el Portal de Cuentas.
- Seleccionar una cuenta valida la membresía y el acceso dentro del módulo de identidad.
- Una selección válida rota el token y guarda `active_account_id` en la sesión.
- Las solicitudes de negocio derivan `tenant_id` y `account_id` de la sesión.
- El `accountId` recibido mediante ruta, body, query o header nunca es una fuente de autorización.
- Los deep links deben comprobar que el ID de la ruta coincide con el contexto autorizado.

### 4.3 RLS y persistencia

Se debe incorporar un helper transaccional equivalente a `withAccount(pool, tenantId, accountId, action)` que configure ambos contextos en PostgreSQL.

Las políticas RLS deben comprobar:

```text
tenant_id = atlas.tenant_id
AND account_id = atlas.account_id
```

El scope de cuenta debe llegar a:

- Datasets, versiones, filas, publicaciones e incidencias.
- Modelos semánticos, relaciones y versiones de KPI.
- Dashboards, versiones y publicaciones.
- Conversaciones y ejecuciones de tools.
- Semanas, equipos, empleados operacionales, rosters y jerarquías.
- Eventos de auditoría asociados a una cuenta.

Los eventos puramente organizacionales pueden conservar `account_id` nulo.

También se deben incorporar claves foráneas compuestas que impidan asociar recursos de cuentas diferentes aunque exista un defecto en la capa de servicio.

### 4.4 Empleados

Para el MVP se recomienda que `Employee` sea un registro operacional de cuenta. Esto ofrece un límite claro de seguridad y permite códigos repetidos en cuentas diferentes.

Si una persona trabaja en dos cuentas, tendrá dos registros operacionales. Una identidad humana global o un directorio maestro organizacional puede incorporarse posteriormente como un módulo separado.

## 5. Portal y CRUD de cuentas

### 5.1 Flujo de entrada

1. El usuario completa login y MFA cuando corresponda.
2. Si posee varias organizaciones, selecciona primero la organización.
3. ATLAS abre `/portal/accounts`.
4. El usuario ve únicamente las cuentas a las que tiene acceso.
5. Al seleccionar una cuenta, el backend valida acceso, rota la sesión y abre el workspace correspondiente.

### 5.2 Rutas objetivo

```text
/portal/accounts
/app/accounts/:accountId
/app/accounts/:accountId/datasets
/app/accounts/:accountId/kpis
/app/accounts/:accountId/dashboards
/app/accounts/:accountId/workforce
/app/accounts/:accountId/workforce/weeks/:weekId
/app/accounts/:accountId/chat
/app/accounts/:accountId/settings
```

### 5.3 Experiencia del Portal

Cada cuenta debe mostrarse como una tarjeta accesible con:

- Nombre.
- Zona horaria.
- Estado.
- Semana actual.
- Conteo de datasets, KPIs y dashboards.
- Estado del roster más reciente.
- Acción principal “Entrar a la cuenta”.

El administrador también dispone de:

- Crear cuenta.
- Consultar detalle.
- Editar nombre, zona horaria y configuración permitida.
- Gestionar usuarios con acceso.
- Archivar y reactivar.
- Eliminar únicamente si la cuenta está vacía y nunca tuvo datos publicados.

Una cuenta poblada no se elimina ni desvincula silenciosamente. Se archiva preservando sus dependencias y su historial.

### 5.4 Navegación dentro de una cuenta

- `AppHeader` muestra organización y cuenta activa.
- Debe existir un selector de cuenta que regrese al Portal o cambie el contexto mediante rotación de sesión.
- Todos los enlaces deben conservar el prefijo de la cuenta.
- Los breadcrumbs muestran organización, cuenta y módulo.
- Si el acceso fue revocado, la aplicación limpia el contexto y regresa al Portal con un mensaje seguro.

## 6. Semana como agregado central de Workforce

### 6.1 Modelo de semana

Cada semana pertenece obligatoriamente a una cuenta y conserva:

- Código ISO `YYYY-Www`.
- Año y número.
- Fecha inicial en lunes.
- Fecha final en domingo.
- Estado.
- Atributos adicionales gobernados.
- Versión publicada del roster.
- Auditoría de creación, edición, publicación, cierre y reapertura.

Restricciones requeridas:

- Código único por cuenta.
- Una sola semana `current` por cuenta mediante índice parcial.
- Sin rangos de fechas superpuestos dentro de la misma cuenta.
- Coherencia entre código, número, inicio y fin.
- No permitir cambios de código o fechas después de publicar un roster o crear bindings analíticos.

### 6.2 Ciclo de vida

- Una semana abierta admite edición de metadata y roster en borrador.
- Una semana puede marcarse como actual si no existe otra actual en la cuenta.
- Cerrar una semana exige que el roster no tenga errores bloqueantes.
- Una semana cerrada conserva sus snapshots publicados.
- Una corrección genera una versión nueva del roster.
- Una semana vacía puede eliminarse.
- Una semana con datos publicados solo puede cerrarse, reabrirse con auditoría o archivarse.

### 6.3 Nueva experiencia de Workforce

La entrada de `/workforce` debe mostrar las semanas de la cuenta. La semana actual aparece destacada.

Al abrir una semana se muestran las siguientes áreas:

- **Resumen:** estado, fechas, versión del roster y calidad del cruce.
- **Roster:** empleados, equipo, rol, wave y estado durante esa semana.
- **Importaciones:** archivo, versiones, mapping, incidencias y publicación.
- **Jerarquía:** supervisor, Floor Manager y manager de la semana.
- **Excepciones:** duplicados, empleados sin equipo, claves ambiguas y supervisores inexistentes.
- **Analítica:** datasets y KPIs relacionados con la semana.
- **Historial:** cambios y auditoría.

Crear o transferir empleados modifica el borrador de la semana seleccionada, no una asignación global calculada con `now()`.

Al crear una semana se debe poder:

- Empezar vacía.
- Clonar el roster publicado de la semana anterior.
- Importar un roster nuevo.

## 7. Roster semanal versionado

### 7.1 Entidades propuestas

#### `workforce_roster_versions`

- `tenant_id`.
- `account_id`.
- `week_id`.
- Número de versión.
- Estado: `uploaded`, `validating`, `ready`, `published`, `failed`.
- Archivo original y versión concreta del objeto S3.
- SHA-256.
- Mapping utilizado.
- Conteos de filas, incidencias, coincidencias y duplicados.
- Actor y timestamps.

#### `workforce_roster_entries`

- Versión de roster.
- Empleado y claves operacionales.
- Equipo y tipo de empleado.
- Supervisor, Floor Manager y demás relaciones.
- Wave y atributos analíticos congelados.
- Lineage de hoja, fila y columnas de origen.

La semana mantiene un `current_roster_version_id`. Publicar una versión no altera las anteriores.

### 7.2 Importación segura

- Retirar Base64 y procesamiento de Excel del request HTTP.
- Cargar el archivo mediante una URL firmada a almacenamiento S3-compatible.
- Procesarlo en BullMQ y worker aislado.
- Reutilizar validación ZIP, límites de expansión, rechazo de macros y lectura streaming.
- Persistir el resultado de la vista previa; no analizar dos veces el mismo archivo.
- Hacer mapping explícito entre hoja y semana. No inferirlo silenciosamente.
- Limitar bytes, expansión, hojas, filas, columnas, longitud de celdas, memoria y tiempo.
- Hacer carga, validación y publicación idempotentes.
- No actualizar empleados ni asignaciones definitivas antes de publicar el roster.

### 7.3 Identificación de empleados

Prioridad recomendada:

1. Código de empleado.
2. BMS ID cuando sea único.

Nombre normalizado y correo no deben utilizarse como claves automáticas predeterminadas. Si se habilitan, deben exigir unicidad y aprobación explícita del administrador.

## 8. Cruce reproducible Dataset–Workforce–KPI

### 8.1 Binding semántico versionado

El mapping debe dejar de pertenecer exclusivamente a cada KPI. Debe convertirse en una definición semántica reutilizable por todos los KPIs del mismo dataset.

El binding debe almacenar:

- Cuenta.
- Versión de dataset.
- Campo del identificador del empleado.
- Tipo de clave: `employee_code` o `bms_id` inicialmente.
- Estrategia temporal.
- Campo de fecha del evento o semana fija.
- Dimensiones Workforce expuestas.
- Política de coincidencias faltantes o ambiguas.
- Versiones de roster fijadas.
- Estado, versión, cobertura y timestamps de publicación.

Estrategias temporales:

- **`event_date`:** la fecha del registro determina la semana.
- **`fixed_week`:** el dataset completo pertenece a una semana concreta.

Un dataset que contenga varias semanas debe declarar un campo temporal válido. No se debe elegir automáticamente una fecha arbitraria.

### 8.2 Puente materializado

Se recomienda materializar un puente liviano en worker:

```text
fila de dataset
  → fecha local de la cuenta
  → semana operativa
  → versión publicada del roster
  → entrada de roster
```

El puente almacena identificadores y lineage, no copias de las métricas:

- Versión del binding.
- Versión y número de fila del dataset.
- Semana.
- Versión del roster.
- Entrada del roster.
- Método y estado de coincidencia.

Ventajas:

- Resultados reproducibles.
- Cobertura auditable.
- Consultas más rápidas.
- Ambigüedades detectadas antes de publicar.
- El cambio posterior de supervisor no altera un KPI histórico.

### 8.3 Validación y publicación

La publicación del binding se bloquea cuando:

- El campo identificador no existe.
- La estrategia temporal no puede resolverse determinísticamente.
- Hay semanas superpuestas.
- Falta un roster publicado.
- La clave seleccionada no es única.
- Existen coincidencias ambiguas.
- La cobertura queda por debajo del umbral aprobado.

Los registros sin match no se eliminan. Se conservan bajo una categoría “Sin coincidencia Workforce” y producen una advertencia cuantificada.

### 8.4 Query Engine

- Los joins de Workforce utilizan el binding y las versiones de roster fijadas, nunca `now()`.
- Cualquier dimensión laboral exige `workforce.read`.
- Nombres, correos y códigos personales pueden exigir una capacidad adicional como `workforce.pii.read`.
- Solo se aceptan dimensiones incluidas en la lista publicada del binding/KPI.
- Los filtros desconocidos producen error; no se ignoran.
- El contexto de respuesta incluye cuenta, binding, semanas, roster versions y porcentaje de match.
- La clave de caché incluye cuenta, binding y versiones de roster.

## 9. Remediación de seguridad

### 9.1 Identidad y cuentas globales

- Reemplazar la creación directa de usuarios por invitaciones con token, expiración y aceptación.
- Un administrador de tenant solo modifica membresía, rol, estado dentro del tenant y acceso a cuentas.
- Contraseña, correo, MFA y estado global solo pueden ser modificados por el propio usuario o una función administrativa global confiable.
- Mover la suspensión organizacional a la membresía.
- Añadir pruebas con una misma identidad presente en dos tenants.

### 9.2 Sesiones y MFA

- Invalidar todas las sesiones al cambiar contraseña y emitir una nueva sesión rotada.
- No omitir MFA en función únicamente de `NODE_ENV`.
- Usar una bandera local explícita, limitada a loopback, si se necesita un modo de desarrollo inseguro.
- Cookies seguras por defecto y validación fail-closed de configuración.
- Rotar sesión al cambiar organización o cuenta.

### 9.3 Workforce y PII

- Exigir `workforce.read` para cualquier acceso a dimensiones laborales.
- Separar dimensiones agregadas de PII.
- Aplicar minimización y enmascaramiento en listados.
- Impedir que `selectedColumns` pueda ignorarse mediante aliases internos.

### 9.4 IA

- Enviar únicamente agregados y campos autorizados al proveedor.
- Eliminar nombres, correos, códigos y muestras personales de prompts y resúmenes de tools.
- Validar herramientas con contratos Zod propios.
- Añadir cuota por usuario, cuenta y tenant.
- Añadir timeout, cancelación y límite de concurrencia.
- Ejecutar llamadas externas fuera de transacciones PostgreSQL.
- No registrar cuerpos completos de error del proveedor.
- Enviar claves mediante headers seguros, no en URLs.

### 9.5 Caché y consultas

- Sustituir el `Map` sin límite por una caché LRU limitada por entradas y memoria.
- Podar entradas vencidas.
- Añadir rate limiting al Query API.
- Resolver rutas mediante BFS acotado, sin enumerar todos los caminos simples.
- Aplicar límites de nodos, relaciones, profundidad y complejidad antes de ejecutar SQL.
- Rechazar filtros y campos temporales desconocidos.

### 9.6 Almacenamiento

- No usar credenciales root de MinIO como fallback fuera de desarrollo local.
- Utilizar un principal de mínimo privilegio limitado al bucket de ATLAS.
- Al eliminar un borrador, enumerar y purgar todas las versiones y delete markers del objeto.
- Confirmar la purga antes de perder el lineage de almacenamiento.
- Registrar fallos de purga sin incluir nombres de archivos ni PII.

### 9.7 Frontend y calidad

- Añadir Content Security Policy compatible con Next.js.
- Mantener cookies fuera de JavaScript.
- Eliminar `any` no justificados y bloques `catch` vacíos en rutas sensibles.
- Hacer que lint sea un gate obligatorio de CI.

## 10. Estrategia de migración

La incorporación de cuenta como scope no debe inferir asociaciones críticas.

1. Añadir columnas `account_id` inicialmente nullable.
2. Inventariar datos existentes por tenant.
3. Si un tenant tiene una sola cuenta inequívoca, permitir backfill automático.
4. Si existen varias cuentas, generar un reporte y una pantalla administrativa de clasificación.
5. Bloquear nuevas escrituras sin cuenta.
6. Mantener datos ambiguos en estado de migración no publicable.
7. Añadir claves foráneas compuestas, índices y RLS.
8. Convertir `account_id` en obligatorio cuando no existan pendientes.

Si la migración `016_workforce_weeks_and_dynamic_mapping.sql` ya fue aplicada en cualquier entorno compartido, no se debe reescribir. Los cambios deben incorporarse mediante migraciones nuevas hacia adelante.

## 11. Plan de ejecución por fases

### Fase 0 — Contratos y decisiones

- Documentar cuenta como scope operacional.
- Documentar snapshots semanales y bindings Workforce.
- Corregir discrepancias entre documentación y código actual.
- Definir la matriz de ownership de entidades.
- Inventariar y clasificar datos existentes.

**Salida:** decisiones aprobadas, modelo de migración y criterios de aceptación definidos.

### Fase 1 — Identidad segura

- Implementar invitaciones.
- Separar identidad global de administración tenant.
- Corregir revocación de sesiones y MFA fail-closed.
- Incorporar selección segura de organización y cuenta.
- Añadir pruebas de toma de cuenta cross-tenant.

**Salida:** una identidad no puede ser controlada desde otro tenant y la sesión puede transportar un contexto de cuenta validado.

### Fase 2 — Scope de cuenta

- Crear acceso membresía–cuenta.
- Añadir `active_account_id` a sesiones.
- Añadir `account_id` a recursos operacionales.
- Ejecutar backfill gobernado.
- Añadir FKs compuestas y RLS de cuenta.
- Incorporar `withAccount` y exigirlo en servicios de negocio.

**Salida:** dos cuentas del mismo tenant están aisladas en base de datos y servicios.

### Fase 3 — Portal y CRUD

- Crear `/portal/accounts`.
- Filtrar cuentas por acceso.
- Implementar selección y cambio seguro de cuenta.
- Cambiar eliminación por ciclo hard-delete vacío / archivo poblado.
- Añadir gestión de usuarios por cuenta.
- Actualizar shell, navegación y breadcrumbs.

**Salida:** login → Portal → workspace de cuenta funciona para admin y usuarios restringidos.

### Fase 4 — Semanas y roster versionado

- Hacer las semanas account-scoped.
- Añadir restricciones de semana actual y solapamiento.
- Implementar página de detalle y ciclo de edición.
- Crear versiones y entradas de roster.
- Migrar el directorio y las jerarquías al contexto semanal.
- Permitir clonar semana anterior.

**Salida:** Workforce funciona desde una semana y conserva snapshots históricos.

### Fase 5 — Importación segura

- Mover el importador a S3, BullMQ y worker.
- Reutilizar validación ZIP y streaming.
- Persistir preview, mapping e incidencias.
- Implementar multi-hoja explícita.
- Añadir idempotencia, límites y cancelación.

**Salida:** archivos grandes o maliciosos no bloquean el API y cada importación produce una versión auditable.

### Fase 6 — Binding y cruce analítico

- Crear bindings semánticos versionados.
- Implementar estrategia `event_date` y `fixed_week`.
- Materializar el puente dataset–roster.
- Medir cobertura y bloquear ambigüedades.
- Integrar el binding al Query Engine.
- Retirar progresivamente `workforce_mapping` de cada KPI.

**Salida:** un KPI usa el roster correcto para cada semana y puede reproducirse con las mismas versiones.

### Fase 7 — Dashboards e IA

- Incorporar cuenta y semana al contexto de dashboard.
- Sincronizar filtros de semana y rango temporal.
- Limitar las tools IA a la cuenta y semana activas.
- Aplicar minimización de PII, cuotas y timeout.
- Incluir lineage Workforce en fuentes y evidencia.

**Salida:** dashboards e IA respetan cuenta, semana, permisos y versiones de roster.

### Fase 8 — Hardening y piloto

- Caché acotada.
- Filtros estrictos.
- Resolución de relaciones acotada.
- Purga real de objetos versionados.
- CSP y configuración productiva fail-closed.
- Observabilidad, métricas y alertas.
- Pruebas de volumen, aislamiento y accesibilidad.

**Salida:** piloto multi-cuenta y multi-tenant con criterios de seguridad, rendimiento y trazabilidad cumplidos.

## 12. Pruebas de aceptación

### Identidad y cuentas

- Un administrador de tenant A no puede cambiar credenciales ni MFA de una identidad utilizada en tenant B.
- Un usuario solo ve cuentas asignadas.
- Un administrador ve todas las cuentas de su organización.
- Revocar acceso a una cuenta surte efecto en la siguiente solicitud.
- Un ID de cuenta ajeno en URL, body, query o header no concede acceso.
- Recursos con el mismo slug pueden existir en cuentas diferentes sin colisión.
- Una cuenta poblada no puede eliminarse físicamente.

### Workforce

- Solo existe una semana actual por cuenta bajo concurrencia.
- No se permiten semanas superpuestas.
- Una semana publicada no permite alterar silenciosamente sus fechas.
- Clonar una semana crea un borrador independiente.
- Publicar una corrección produce una versión nueva y conserva la anterior.
- Un XLSX corrupto, con macros o zip bomb se rechaza sin agotar la memoria del API.

### Cruce analítico

- Un empleado que cambia de supervisor entre dos semanas produce resultados diferentes por semana.
- Reejecutar el KPI con las mismas versiones devuelve el mismo resultado.
- La consulta informa versiones de dataset, binding y roster.
- Una clave duplicada bloquea la publicación del binding.
- Los registros sin match se reportan y no desaparecen silenciosamente.
- Los filtros desconocidos producen error.
- Un usuario sin `workforce.read` no puede obtener dimensiones Workforce.
- Un usuario sin permiso de PII no recibe nombres, correos ni códigos personales.

### IA y almacenamiento

- Los payloads enviados al proveedor no contienen PII no autorizada.
- Cuotas, timeout y cancelación funcionan bajo concurrencia.
- Los logs no contienen prompts completos, nombres, correos, claves ni errores crudos del proveedor.
- El hard delete de un borrador elimina todas las versiones del objeto S3.

### E2E

```text
login
→ Portal de Cuentas
→ selección de cuenta
→ semana operativa
→ roster
→ dataset
→ binding Workforce
→ KPI
→ dashboard
→ consulta IA con evidencia
```

## 13. Orden de prioridad

El orden recomendado es:

1. Identidad y toma de cuentas cross-tenant.
2. Contexto de cuenta, acceso y RLS.
3. Migración de recursos existentes.
4. Portal y navegación account-scoped.
5. Semanas y snapshots de roster.
6. Importación segura.
7. Binding dataset–Workforce y Query Engine.
8. Dashboards, IA y hardening restante.

No se debe construir únicamente el Portal visual manteniendo los recursos con scope exclusivo de tenant. El aislamiento de cuenta y el contexto de sesión son prerrequisitos de la experiencia de usuario.
