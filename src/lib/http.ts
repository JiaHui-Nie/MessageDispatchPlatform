import { DecryptionError, ApiError, badRequest, tooManyRequests } from './errors.ts';

export type Params = Record<string, string>;
export type HttpMethod = 'GET' | 'POST';

const BASE_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...extraHeaders },
  });
}

/** 成功响应统一带 `status: 200`，与接口文档保持一致。 */
export function ok(data: Record<string, unknown> = {}, extraHeaders: Record<string, string> = {}): Response {
  return jsonResponse({ status: 200, ...data }, 200, extraHeaders);
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    const headers: Record<string, string> = {};
    if (error.retryAfter !== undefined) {
      headers['retry-after'] = String(Math.max(1, Math.ceil(error.retryAfter)));
    }
    return jsonResponse(
      {
        status: error.status,
        error: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      error.status,
      headers,
    );
  }
  if (error instanceof DecryptionError) {
    console.error('decryption failed:', error.message);
    return jsonResponse(
      { status: 500, error: 'decryption_failed', message: error.message },
      500,
    );
  }
  console.error('unhandled error:', error);
  return jsonResponse({ status: 500, error: 'internal_error', message: '服务器内部错误，请稍后重试' }, 500);
}

/**
 * 读取参数：查询字符串 + JSON 请求体 + 表单请求体。
 * 平台接口按要求统一使用 POST，但保留查询字符串以兼容 curl 式调用。
 */
export async function readParams(request: Request): Promise<Params> {
  const params: Params = {};
  const url = new URL(request.url);
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  if (request.method !== 'POST') {
    return params;
  }

  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
  const raw = await request.text();
  if (!raw.trim()) {
    return params;
  }

  if (contentType.includes('application/json') || raw.trimStart().startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw badRequest('invalid_json', '请求体不是合法的 JSON');
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (value === null || value === undefined) {
          continue;
        }
        if (typeof value === 'string') {
          params[key] = value;
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          params[key] = String(value);
        }
      }
    }
    return params;
  }

  const form = new URLSearchParams(raw);
  form.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

export interface StringParamOptions {
  min?: number;
  max?: number;
  trim?: boolean;
  pattern?: RegExp;
  patternHint?: string;
  label?: string;
}

/** 必填字符串参数；缺失或超长时抛出 400。 */
export function stringParam(params: Params, name: string, options: StringParamOptions = {}): string {
  const { min = 1, max = 10_000, trim = true, pattern, patternHint, label = name } = options;
  const raw = params[name];
  if (raw === undefined) {
    throw badRequest(`missing_${name}`, `缺少参数 ${name}`);
  }
  const value = trim ? raw.trim() : raw;
  if (value.length < min) {
    throw badRequest(`invalid_${name}`, `${label}不能为空（至少 ${min} 个字符）`);
  }
  if (value.length > max) {
    throw badRequest(`invalid_${name}`, `${label}长度不能超过 ${max} 个字符`);
  }
  if (pattern && !pattern.test(value)) {
    throw badRequest(`invalid_${name}`, `${label}格式不正确${patternHint ? `：${patternHint}` : ''}`);
  }
  return value;
}

/** 可选字符串参数：缺失或空串返回 null。 */
export function optionalString(params: Params, name: string, options: StringParamOptions = {}): string | null {
  const raw = params[name];
  if (raw === undefined || (options.trim !== false && raw.trim() === '')) {
    return null;
  }
  return stringParam(params, name, options);
}

export function intParam(params: Params, name: string, options: { min?: number; max?: number; fallback?: number; label?: string } = {}): number {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, fallback, label = name } = options;
  const raw = params[name];
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) {
      return fallback;
    }
    throw badRequest(`missing_${name}`, `缺少参数 ${name}`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`invalid_${name}`, `${label}必须是 ${min} 到 ${max} 之间的整数`);
  }
  return value;
}

export function boolParam(params: Params, name: string, fallback: boolean): boolean {
  const raw = params[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw badRequest(`invalid_${name}`, `${name} 必须是布尔值（true/false）`);
}

/** Cloudflare 会在 cf-connecting-ip 中提供真实客户端 IP。 */
export function clientIp(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) {
    return cfIp.trim();
  }
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0];
    if (first) {
      return first.trim();
    }
  }
  const realIp = request.headers.get('x-real-ip');
  return realIp ? realIp.trim() : '0.0.0.0';
}

/**
 * 同源校验：浏览器发起的跨站 POST 一定带 Origin，与请求 Host 不一致时拒绝。
 * 这为基于 Cookie 的登录态提供了额外的 CSRF 防护（Cookie 本身为 SameSite=Strict）。
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) {
    return;
  }
  const url = new URL(request.url);
  if (origin === url.origin) {
    return;
  }
  throw new ApiError(403, 'cross_origin_denied', '跨站请求被拒绝');
}

export { tooManyRequests };
