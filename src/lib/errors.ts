/** 带 HTTP 状态码的业务错误，统一由 app.ts 转换成 JSON 响应。 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly retryAfter?: number;

  constructor(status: number, code: string, message: string, options: { details?: Record<string, unknown>; retryAfter?: number } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.retryAfter = options.retryAfter;
  }
}

/** 使用错误的 JWT_SECRET 解密 D1 数据时抛出，提示运维人员密钥不一致。 */
export class DecryptionError extends Error {
  constructor(message = '数据解密失败，JWT_SECRET 可能与写入数据时不一致') {
    super(message);
    this.name = 'DecryptionError';
  }
}

/** D1 / SQLite 的唯一约束冲突。 */
export function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(message);
}

export function badRequest(code: string, message: string): ApiError {
  return new ApiError(400, code, message);
}

export function unauthorized(code = 'auth_required', message = '请先登录'): ApiError {
  return new ApiError(401, code, message);
}

export function forbidden(code = 'forbidden', message = '无权执行该操作'): ApiError {
  return new ApiError(403, code, message);
}

export function notFound(code = 'not_found', message = '资源不存在'): ApiError {
  return new ApiError(404, code, message);
}

export function conflict(code: string, message: string): ApiError {
  return new ApiError(409, code, message);
}

export function tooManyRequests(retryAfter: number, message = '操作过于频繁，请稍后再试'): ApiError {
  return new ApiError(429, 'rate_limited', message, { retryAfter });
}

export function payloadTooLarge(code: string, message: string, details?: Record<string, unknown>): ApiError {
  return new ApiError(413, code, message, { details });
}
