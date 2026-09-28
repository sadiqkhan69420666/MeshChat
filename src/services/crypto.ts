/**
 * MeshChat WebCrypto Engine
 * Strictly adheres to WebCrypto API without external dependencies.
 */

// Constant-time string or buffer comparison to prevent timing attacks
export function constantTimeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const enc = new TextEncoder();
  const bufA = typeof a === 'string' ? enc.encode(a) : a;
  const bufB = typeof b === 'string' ? enc.encode(b) : b;

  if (bufA.length !== bufB.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

// Helpers for ArrayBuffer / Hex / Base64 conversion
export function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(uint8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const len = uint8.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

export function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Generate cryptographically secure random bytes
export function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

// Calculate SHA-256 hash of string or buffer
export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  let buf: Uint8Array;
  if (typeof data === 'string') {
    buf = new TextEncoder().encode(data);
  } else if (data instanceof Uint8Array) {
    buf = data;
  } else {
    buf = new Uint8Array(data);
  }
  const hashBuffer = await crypto.subtle.digest('SHA-256', buf as any);
  return bufferToHex(hashBuffer);
}

/**
 * PBKDF2 Password Hashing (310,000 iterations, SHA-256)
 */
const PBKDF2_ITERATIONS = 310000;

export async function hashPasswordWithSalt(password: string, salt: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    256 // 32 bytes
  );

  return bufferToHex(derivedBits);
}

/**
 * Derive AES-GCM 256-bit Key from Password and Salt for private key encryption
 */
export async function deriveKeyFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Generate User ECDSA P-256 Keypair
 */
export async function generateUserKeyPair(): Promise<{
  publicKeyJwk: JsonWebKey;
  publicKeyId: string;
  privateKey: CryptoKey;
  privateKeyJwk: JsonWebKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true, // extractable
    ['sign', 'verify']
  );

  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  // Canonical fingerprint of public key
  const canonicalPubKey = JSON.stringify({
    crv: publicKeyJwk.crv,
    kty: publicKeyJwk.kty,
    x: publicKeyJwk.x,
    y: publicKeyJwk.y,
  });
  const pubKeyHash = await sha256Hex(canonicalPubKey);
  const publicKeyId = pubKeyHash.slice(0, 16); // 16-char ID

  return {
    publicKeyJwk,
    publicKeyId,
    privateKey: keyPair.privateKey,
    privateKeyJwk,
  };
}

/**
 * Encrypt private key with derived AES-GCM key
 */
export async function encryptPrivateKey(
  privateKeyJwk: JsonWebKey,
  aesKey: CryptoKey
): Promise<{ ivHex: string; ciphertextBase64: string }> {
  const iv = getRandomBytes(12); // 96-bit standard AES-GCM IV
  const data = new TextEncoder().encode(JSON.stringify(privateKeyJwk));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as any },
    aesKey,
    data
  );

  return {
    ivHex: bufferToHex(iv),
    ciphertextBase64: bufferToBase64(encrypted),
  };
}

/**
 * Decrypt private key with derived AES-GCM key
 */
export async function decryptPrivateKey(
  encrypted: { ivHex: string; ciphertextBase64: string },
  aesKey: CryptoKey
): Promise<CryptoKey> {
  const iv = hexToBuffer(encrypted.ivHex);
  const ciphertext = base64ToBuffer(encrypted.ciphertextBase64);

  const decryptedBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as any },
    aesKey,
    ciphertext as any
  );

  const jwkStr = new TextDecoder().decode(decryptedBuf);
  const privateKeyJwk = JSON.parse(jwkStr);

  return await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

/**
 * Sign data string with ECDSA P-256 (SHA-256)
 */
export async function signData(data: string, privateKey: CryptoKey): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const signatureBuffer = await crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: { name: 'SHA-256' },
    },
    privateKey,
    encoded
  );
  return bufferToBase64(signatureBuffer);
}

// In-memory cache for imported public keys to speed up high-volume verification
const publicKeyCache = new Map<string, CryptoKey>();

export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  const cacheKey = `${jwk.x}-${jwk.y}`;
  const cached = publicKeyCache.get(cacheKey);
  if (cached) return cached;

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  publicKeyCache.set(cacheKey, key);
  return key;
}

/**
 * Verify ECDSA P-256 Signature
 */
export async function verifySignature(
  data: string,
  signatureBase64: string,
  publicKeyJwk: JsonWebKey
): Promise<boolean> {
  try {
    const key = await importPublicKey(publicKeyJwk);
    const signature = base64ToBuffer(signatureBase64);
    const encoded = new TextEncoder().encode(data);

    return await crypto.subtle.verify(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' },
      },
      key,
      signature as any,
      encoded
    );
  } catch (err) {
    console.error('Signature verification error:', err);
    return false;
  }
}

/**
 * Derive AES-GCM 256 Key for End-to-End Encrypted Groups
 */
const groupKeyCache = new Map<string, CryptoKey>();

export async function deriveGroupKey(passphrase: string, saltHex: string): Promise<CryptoKey> {
  const cacheKey = `${passphrase}:${saltHex}`;
  const cached = groupKeyCache.get(cacheKey);
  if (cached) return cached;

  const enc = new TextEncoder();
  const salt = hexToBuffer(saltHex);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  groupKeyCache.set(cacheKey, derivedKey);
  return derivedKey;
}

/**
 * Encrypt Group Payload (Text or Raw Buffer) using Group AES Key
 */
export async function encryptWithGroupKey(
  data: string | Uint8Array,
  groupKey: CryptoKey
): Promise<{ ivHex: string; ciphertextBase64: string }> {
  const iv = getRandomBytes(12);
  const encoded = typeof data === 'string' ? new TextEncoder().encode(data) : data;

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as any },
    groupKey,
    encoded as any
  );

  return {
    ivHex: bufferToHex(iv),
    ciphertextBase64: bufferToBase64(ciphertext),
  };
}

/**
 * Decrypt Group Payload using Group AES Key
 */
export async function decryptWithGroupKey(
  payload: { ivHex: string; ciphertextBase64: string },
  groupKey: CryptoKey,
  asBinary = false
): Promise<string | Uint8Array> {
  const iv = hexToBuffer(payload.ivHex);
  const ciphertext = base64ToBuffer(payload.ciphertextBase64);

  const decryptedBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as any },
    groupKey,
    ciphertext as any
  );

  if (asBinary) {
    return new Uint8Array(decryptedBuf);
  }
  return new TextDecoder().decode(decryptedBuf);
}
