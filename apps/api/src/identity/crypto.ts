/**
 * @file apps/api/src/identity/crypto.ts
 * @description Utilidades criptográficas para autenticación, hash de contraseñas y cifrado de secretos en ATLAS.
 * Implementa derivación de claves con scrypt (N=32768, r=8, p=3), verificación en tiempo constante (`timingSafeEqual`),
 * hashing SHA-256 de tokens y cifrado simétrico autenticado AES-256-GCM para secretos TOTP/MFA.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

/**
 * Deriva una clave de 32 bytes a partir de contraseña y sal usando scrypt.
 */
const derive = (password: string, salt: string): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, salt, 32, parameters, (error, key) => { if (error) reject(error); else resolve(key); });
});

/**
 * Genera un hash seguro de contraseña formateado como `scrypt-v1:salt:hash`.
 *
 * @param password Contraseña en texto plano.
 * @returns Cadena con versión, sal e información de hash hexadecimal.
 */
export async function hashPassword(password: string): Promise<string> {

  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt);
  return `scrypt-v1:${salt}:${hash.toString('hex')}`;
}
/**
 * Verifica una contraseña en texto plano contra un hash almacenado scrypt en tiempo constante.
 *
 * @param password Contraseña proporcionada.
 * @param stored Hash previamente almacenado en base de datos.
 * @returns true si coincide exactamente, false en caso contrario.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [version, salt, encoded] = stored.split(':');
  if (version !== 'scrypt-v1' || !salt || !encoded || !/^[a-f0-9]{64}$/.test(encoded)) return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, Buffer.from(encoded, 'hex'));
}

/** Calcula el hash SHA-256 de un token de sesión opaco. */
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Genera un nuevo token criptográfico seguro de 32 bytes (64 hex). */
export const newToken = () => randomBytes(32).toString('hex');

/**
 * Cifra un secreto en texto plano usando AES-256-GCM.
 *
 * @param secret Texto a cifrar.
 * @param key Clave simétrica de 256 bits.
 * @returns Cadena con formato `iv:tag:ciphertext` en hexadecimal.
 */
export function encryptSecret(secret: string, key: Buffer): string {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':');
}

/**
 * Descifra una cadena cifrada con AES-256-GCM y valida el tag de autenticación.
 *
 * @param value Cadena formateada `iv:tag:ciphertext`.
 * @param key Clave simétrica de 256 bits.
 * @returns Texto plano original descifrado.
 */
export function decryptSecret(value: string, key: Buffer): string {
  const [iv, tag, data] = value.split(':');
  if (!iv || !tag || !data) throw new Error('INVALID_SECRET_ENCODING');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8');
}

