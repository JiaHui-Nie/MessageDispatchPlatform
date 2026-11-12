import {
  constantTimeEqual,
  decodeUtf8,
  encodeUtf8,
  fromBase64Url,
  randomBytes,
  toBase64Url,
  toHex,
} from './encoding.ts';
import { DecryptionError } from './errors.ts';

/**
 * 密码散列与数据加密。
 *
 * - 数据加密：AES-256-GCM，密钥 = HKDF-SHA256(JWT_SECRET)，每个值随机 12 字节 IV，
 *   存储格式 `v1.<base64url(iv)>.<base64url(ciphertext)>`，GCM tag 附在密文尾部。
 * - 密码：PBKDF2-SHA256 + 每用户随机盐，存储格式 `pbkdf2$<iterations>$<salt>$<hash>`。
 * - 盲索引：API Key / 注册码只存储 SHA-256 摘要，数据库泄露也无法直接冒用。
 */

const PBKDF2_HASH = 'SHA-256';
const PBKDF2_KEY_BITS = 256;
export const DEFAULT_PBKDF2_ITERATIONS = 100_000;

const aesKeyCache = new Map<string, Promise<CryptoKey>>();
const hmacKeyCache = new Map<string, Promise<CryptoKey>>();

function cacheDerivation(cache: Map<string, Promise<CryptoKey>>, secret: string, factory: () => Promise<CryptoKey>): Promise<CryptoKey> {
  const cached = cache.get(secret);
  if (cached) {
    return cached;
  }
  const pending = factory();
  cache.set(secret, pending);
  pending.catch(() => cache.delete(secret));
  return pending;
}

function getAesKey(secret: string): Promise<CryptoKey> {
  return cacheDerivation(aesKeyCache, secret, async () => {
    const material = await crypto.subtle.importKey('raw', encodeUtf8(secret), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: encodeUtf8('message-dispatch-platform/v1/data-salt'),
        info: encodeUtf8('message-dispatch-platform/v1/aes-256-gcm'),
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  });
}

function getHmacKey(secret: string): Promise<CryptoKey> {
  return cacheDerivation(hmacKeyCache, secret, () =>
    crypto.subtle.importKey('raw', encodeUtf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
  );
}

export async function encryptString(secret: string, plaintext: string): Promise<string> {
  const key = await getAesKey(secret);
  const iv = randomBytes(12);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, encodeUtf8(plaintext)),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
}

export function isEncryptedValue(value: string): boolean {
  return value.startsWith('v1.');
}

export async function decryptString(secret: string, stored: string): Promise<string> {
  // 兼容历史明文数据（例如手工导入的数据），新写入的数据一定是加密的。
  if (!isEncryptedValue(stored)) {
    return stored;
  }
  const parts = stored.split('.');
  if (parts.length !== 3) {
    throw new DecryptionError('密文格式不正确');
  }
  const iv = fromBase64Url(parts[1] ?? '');
  const ciphertext = fromBase64Url(parts[2] ?? '');
  try {
    const key = await getAesKey(secret);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, ciphertext);
    return decodeUtf8(new Uint8Array(plaintext));
  } catch {
    throw new DecryptionError();
  }
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', encodeUtf8(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: PBKDF2_HASH },
    material,
    PBKDF2_KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations: number = DEFAULT_PBKDF2_ITERATIONS): Promise<string> {
  const safeIterations = clampIterations(iterations);
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, safeIterations);
  return `pbkdf2$${safeIterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
    return false;
  }
  const iterations = Number.parseInt(parts[1] ?? '', 10);
  if (!Number.isFinite(iterations) || iterations < 1_000 || iterations > 2_000_000) {
    return false;
  }
  try {
    const salt = fromBase64Url(parts[2] ?? '');
    const expected = fromBase64Url(parts[3] ?? '');
    const actual = await pbkdf2(password, salt, iterations);
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function clampIterations(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PBKDF2_ITERATIONS;
  }
  return Math.min(Math.max(Math.trunc(value), 10_000), 500_000);
}

/** 用于对未知用户也执行一次等价耗时的密码校验，降低用户名枚举风险。 */
let dummyPasswordHash: Promise<string> | null = null;
export function getDummyPasswordHash(iterations: number): Promise<string> {
  if (!dummyPasswordHash) {
    dummyPasswordHash = hashPassword(toHex(randomBytes(16)), iterations);
  }
  return dummyPasswordHash;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encodeUtf8(value));
  return toHex(new Uint8Array(digest));
}

export async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await getHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encodeUtf8(data));
  return new Uint8Array(signature);
}

export interface SessionClaims {
  sub: number;
  name: string;
  role: 'admin' | 'user';
  ver: number;
  iat: number;
  exp: number;
}

const JWT_HEADER = toBase64Url(encodeUtf8(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));

export async function signSessionToken(secret: string, claims: SessionClaims): Promise<string> {
  const payload = toBase64Url(encodeUtf8(JSON.stringify(claims)));
  const signature = await hmacSha256(secret, `${JWT_HEADER}.${payload}`);
  return `${JWT_HEADER}.${payload}.${toBase64Url(signature)}`;
}

export async function verifySessionToken(secret: string, token: string): Promise<SessionClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  let header: unknown;
  try {
    header = JSON.parse(decodeUtf8(fromBase64Url(headerPart)));
  } catch {
    return null;
  }
  if (!header || typeof header !== 'object' || (header as { alg?: unknown }).alg !== 'HS256') {
    return null;
  }

  const expectedSignature = await hmacSha256(secret, `${headerPart}.${payloadPart}`);
  let actualSignature: Uint8Array;
  try {
    actualSignature = fromBase64Url(signaturePart);
  } catch {
    return null;
  }
  if (!constantTimeEqual(expectedSignature, actualSignature)) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decodeUtf8(fromBase64Url(payloadPart)));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const claims = payload as Partial<SessionClaims>;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    typeof claims.sub !== 'number' ||
    typeof claims.name !== 'string' ||
    (claims.role !== 'admin' && claims.role !== 'user') ||
    typeof claims.ver !== 'number' ||
    typeof claims.iat !== 'number' ||
    typeof claims.exp !== 'number'
  ) {
    return null;
  }
  if (claims.exp <= nowSeconds || claims.iat > nowSeconds + 60) {
    return null;
  }
  return claims as SessionClaims;
}
