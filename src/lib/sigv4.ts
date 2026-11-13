import { encodeUtf8, toHex } from './encoding.ts';

/**
 * AWS Signature Version 4 查询字符串预签名（S3 兼容，用于 Cloudflare R2）。
 * 只实现本平台需要的单次 PUT/GET 预签名，不依赖外部 SDK。
 */

type HttpMethod = 'GET' | 'PUT' | 'HEAD' | 'DELETE';

export interface PresignS3Options {
  method: HttpMethod;
  url: URL;
  headers?: Record<string, string>;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  service?: string;
  expiresSeconds?: number;
  now?: Date;
  /** 'UNSIGNED-PAYLOAD' 时把该值加入查询参数；传 null 则不添加。默认按方法：PUT 添加。 */
  payloadHash?: string | null;
}

const ALGORITHM = 'AWS4-HMAC-SHA256';

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function amzDateString(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encodeUtf8(data)));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encodeUtf8(value));
  return toHex(new Uint8Array(digest));
}

export async function presignS3Url(options: PresignS3Options): Promise<string> {
  const {
    method,
    url,
    headers = {},
    accessKeyId,
    secretAccessKey,
    region = 'auto',
    service = 's3',
    expiresSeconds = 900,
    now = new Date(),
    payloadHash = method === 'PUT' ? 'UNSIGNED-PAYLOAD' : null,
  } = options;

  const amzDate = amzDateString(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const headerMap = new Map<string, string>();
  headerMap.set('host', url.host);
  for (const [name, value] of Object.entries(headers)) {
    headerMap.set(name.toLowerCase(), canonicalHeaderValue(value));
  }
  const signedHeaderNames = [...headerMap.keys()].sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headerMap.get(name) ?? ''}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');

  const query: Array<[string, string]> = [
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(Math.max(1, Math.trunc(expiresSeconds)))],
    ['X-Amz-SignedHeaders', signedHeaders],
  ];
  if (payloadHash) {
    query.push(['X-Amz-Content-Sha256', payloadHash]);
  }
  for (const [name, value] of url.searchParams.entries()) {
    query.push([name, value]);
  }
  query.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const canonicalQuery = query.map(([name, value]) => `${rfc3986(name)}=${rfc3986(value)}`).join('&');
  const canonicalUri = url.pathname || '/';
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash ?? 'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [ALGORITHM, amzDate, credentialScope, await sha256Hex(canonicalRequest)].join('\n');

  let signingKey = await hmacSha256(encodeUtf8(`AWS4${secretAccessKey}`), dateStamp);
  signingKey = await hmacSha256(signingKey, region);
  signingKey = await hmacSha256(signingKey, service);
  signingKey = await hmacSha256(signingKey, 'aws4_request');
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  const finalQuery = `${canonicalQuery}&X-Amz-Signature=${signature}`;
  return `${url.origin}${canonicalUri}?${finalQuery}`;
}

/** 按段编码对象 key，避免 `/` 被编码。 */
export function encodeObjectKey(key: string): string {
  return key
    .split('/')
    .map((segment) => rfc3986(segment))
    .join('/');
}
