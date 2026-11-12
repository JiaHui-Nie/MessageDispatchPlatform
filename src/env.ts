import { ApiError } from './lib/errors.ts';
import { clampIterations } from './lib/crypto.ts';

/** Worker 运行环境绑定（与 wrangler.jsonc 中的绑定名称一致）。 */
export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** 必填密钥：同时用于签发 JWT 与派生 AES-256-GCM 数据加密密钥。 */
  JWT_SECRET?: string;
  APP_NAME?: string;
  DISPLAY_TZ?: string;
  SESSION_TTL_HOURS?: string;
  PASSWORD_ITERATIONS?: string;
  RATE_LIMIT_DISABLED?: string;
}

/** 每个请求的运行时上下文。 */
export interface AppContext {
  env: Env;
  db: D1Database;
  secret: string;
  appName: string;
  tz: string;
  passwordIterations: number;
  sessionTtlSeconds: number;
  rateLimitDisabled: boolean;
}

const MIN_SECRET_LENGTH = 16;

export function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

export function isSecretConfigured(env: Env): boolean {
  return (env.JWT_SECRET ?? '').trim().length >= MIN_SECRET_LENGTH;
}

export function createContext(env: Env): AppContext {
  const secret = (env.JWT_SECRET ?? '').trim();
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new ApiError(
      500,
      'missing_secret',
      `JWT_SECRET 未配置或长度不足 ${MIN_SECRET_LENGTH} 位。请在 Cloudflare 控制台或使用 ` +
        '`wrangler secret put JWT_SECRET` 设置一个足够长的随机字符串。',
    );
  }
  return {
    env,
    db: env.DB,
    secret,
    appName: (env.APP_NAME ?? '信息分发平台').trim() || '信息分发平台',
    tz: (env.DISPLAY_TZ ?? 'Asia/Shanghai').trim() || 'Asia/Shanghai',
    passwordIterations: clampIterations(parsePositiveInt(env.PASSWORD_ITERATIONS, 100_000, 10_000, 500_000)),
    sessionTtlSeconds: parsePositiveInt(env.SESSION_TTL_HOURS, 168, 1, 24 * 90) * 3600,
    rateLimitDisabled: (env.RATE_LIMIT_DISABLED ?? '').trim() === '1',
  };
}
