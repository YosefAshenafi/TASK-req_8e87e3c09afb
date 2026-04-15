/**
 * PBKDF2-SHA-256 password hashing using Web Crypto.
 * This is a LOCAL, UX-only safeguard — not a server-side security boundary.
 * Data can be cleared by wiping the browser's storage.
 */

const ITERATIONS = 100_000;
const KEY_LENGTH = 32; // 256-bit output

function bufToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToBuf(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

/** Generate a cryptographically random 16-byte salt, base64-encoded. */
export function generateSalt(): string {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return bufToBase64(salt.buffer as ArrayBuffer);
}

/** Derive a PBKDF2 hash from password + salt. Returns base64 string. */
export async function hashPassword(password: string, saltB64: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: base64ToBuf(saltB64).buffer as ArrayBuffer,
      iterations: ITERATIONS,
    },
    keyMaterial,
    KEY_LENGTH * 8,
  );

  return bufToBase64(bits);
}

/** Constant-time comparison of two base64-encoded hashes. */
export async function verifyPassword(
  password: string,
  saltB64: string,
  storedHash: string,
): Promise<boolean> {
  const derived = await hashPassword(password, saltB64);
  // Use SubtleCrypto for constant-time comparison by signing with HMAC
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode('secureroom-compare'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign('HMAC', key, enc.encode(derived)),
    crypto.subtle.sign('HMAC', key, enc.encode(storedHash)),
  ]);
  const a = new Uint8Array(sigA);
  const b = new Uint8Array(sigB);
  let equal = a.length === b.length;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) equal = false;
  }
  return equal;
}
