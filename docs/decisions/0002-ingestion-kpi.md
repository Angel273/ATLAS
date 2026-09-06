# Ingesta y KPI — contratos de ejecución

El usuario solicitó admitir números y fechas regionales. Cada carga selecciona explícitamente separador decimal, separador de miles, orden de fecha y zona horaria. No se infiere un formato ambiguo. Las normalizaciones inválidas bloquean la publicación y no redondean silenciosamente decimales.

Los originales se conservan en almacenamiento S3 con versionado habilitado. La confirmación vincula una versión concreta del objeto, y el worker calcula SHA-256 por streaming. Volver a utilizar una URL de carga no modifica el original ya vinculado.

Las versiones publicadas son snapshots inmutables. Replace produce un snapshot nuevo; append añade filas al snapshot base; upsert sustituye por clave explícita. Se rechazan claves duplicadas/nulas. La publicación comprueba que la versión base no cambió durante la carga. Restaurar publica una referencia histórica y añade un evento, sin modificar las filas originales.

Para cumplir el procesamiento de archivos grandes sin cargar libros completos, el lector XLSX será ExcelJS en modo streaming dentro de un worker aislado y con límite de memoria. Esta decisión sustituye la elección inicial de SheetJS para lectura XLSX. Se validará el ZIP antes de procesar: cantidad de entradas, tamaño descomprimido, razón de compresión, rutas, macros y vínculos externos. La primera entrada real admite CSV UTF-8 y XLSX; los formatos binarios XLS y archivos con macros se rechazan explícitamente.

El modelo inicial de cada versión publicada contiene sus campos tipados. El motor conserva texto y AST de cada KPI, ligado a ese modelo/version de datos. SQL es un detalle interno parametrizado. Los números decimales se retornan como cadenas para mantener precisión.
