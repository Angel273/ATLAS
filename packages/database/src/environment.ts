/**
 * @file packages/database/src/environment.ts
 * @description Configuración de variables de entorno para el paquete de base de datos.
 * Carga de forma segura el archivo .env raíz para migraciones y scripts de infraestructura.
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

