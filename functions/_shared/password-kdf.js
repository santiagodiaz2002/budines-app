import { PASSWORD_HASH_BYTES, PBKDF2_MAX_ITERATIONS_PER_DERIVE } from './constants.js';
import { bytesToHex, hexToBytes } from './crypto.js';

export async function derivePbkdf2PasswordHash(cryptoImpl, passwordBytes, saltHex, iterations) {
  const salt = hexToBytes(saltHex);
  let material = new Uint8Array(passwordBytes);

  // Cloudflare Workers caps one PBKDF2 deriveBits call at 100000 iterations.
  for (const chunkIterations of splitPbkdf2Iterations(iterations)) {
    const key = await cryptoImpl.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits']);
    const bits = await cryptoImpl.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt,
        iterations: chunkIterations
      },
      key,
      PASSWORD_HASH_BYTES * 8
    );
    material = new Uint8Array(bits);
  }

  return bytesToHex(material);
}

export function splitPbkdf2Iterations(iterations) {
  const total = Number(iterations);
  if (!Number.isInteger(total) || total < 1) {
    throw new TypeError('Invalid PBKDF2 iteration count.');
  }

  const chunks = [];
  let remaining = total;
  while (remaining > 0) {
    const chunk = Math.min(remaining, PBKDF2_MAX_ITERATIONS_PER_DERIVE);
    chunks.push(chunk);
    remaining -= chunk;
  }
  return chunks;
}
