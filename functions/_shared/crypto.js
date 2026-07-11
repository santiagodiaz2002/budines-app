const encoder = new TextEncoder();

export function randomHex(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function sha256Hex(value) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToHex(new Uint8Array(hash));
}

export async function secureCompareText(a, b) {
  const aHash = await sha256Hex(String(a));
  const bHash = await sha256Hex(String(b));
  return constantTimeEqualHex(aHash, bHash);
}

export function constantTimeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const maxLength = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;

  for (let index = 0; index < maxLength; index += 1) {
    const aCode = index < a.length ? a.charCodeAt(index) : 0;
    const bCode = index < b.length ? b.charCodeAt(index) : 0;
    diff |= aCode ^ bCode;
  }

  return diff === 0;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
