import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret, hashPassword, verifyPassword, newToken, tokenHash } from './crypto.js';
describe('Credentials and secrets', () => {
  it('salts password hashes and verifies without storing plaintext', async () => {
    const password = 'synthetic-test-password-only';
    const first = await hashPassword(password); const second = await hashPassword(password);
    expect(first).not.toBe(second); expect(first).not.toContain(password);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword('incorrect', first)).toBe(false);
    expect(await verifyPassword(password, 'invalid')).toBe(false);
  });
  it('authenticates encrypted MFA secrets and rejects tampering', () => {
    const key = randomBytes(32); const cipher = encryptSecret('test-secret', key);
    expect(decryptSecret(cipher, key)).toBe('test-secret');
    expect(() => decryptSecret(cipher, randomBytes(32))).toThrow();
    expect(() => decryptSecret(`${cipher.slice(0, -2)}00`, key)).toThrow();
  });
  it('issues opaque tokens with one-way storage hashes', () => {
    const token = newToken(); expect(token).toHaveLength(64);
    expect(tokenHash(token)).not.toBe(token); expect(newToken()).not.toBe(token);
  });
});
