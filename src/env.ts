import { ApiError } from './lib/errors.ts';
import { clampIterations } from './lib/crypto.ts';

/** 文件存储模式：auto = 绑定 R2 时优先 R2，否则 D1。 */
export type FileStorageMode = 'auto' | 'd1' | 'r2';

/** Worker 运行环境绑定（与 wrangler.jsonc 中的绑定名称一致）。 */
export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** 可选：R2 文件存储桶；绑定后可在管理后台切换文件后端。 */
  FILES?: R2Bucket;
  /** 必填密钥：同时用于签发 JWT 与派生 AES-256-GCM 数据加密密钥。 */
  JWT_SECRET?: string;
  APP_NAME?: string;
  DISPLAY_TZ?: string;
  SESSION_TTL_HOURS?: string;
  PASSWORD_ITERATIONS?: string;
  RATE_LIMIT_DISABLED?: string;
  /** 新用户默认存储空间（MB），默认 50，最大 10240。 */
  DEFAULT_STORAGE_QUOTA_MB?: string;
  /** 文件存储后端默认值：auto / d1 / r2，管理后台设置优先。 */
  FILE_STORAGE?: string;
  /** 大文件直传 R2 所需的 S3 API 配置（Worker Secret）。 */
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  /** 超过该大小（MB）的文件优先使用 R2 预签名直传，默认 20；0 表示全部直传。 */
  DIRECT_UPLOAD_THRESHOLD_MB?: string;
  /** 预签名下载 URL 有效期（分钟），默认 60，最大 1440。 */
  DOWNLOAD_URL_TTL_MINUTES?: string;
}

/** 每个请求的运行时上下文。 */
export interface AppContext {
  env: Env;
  db: D1Database;
  files?: R2Bucket;
  secret: string;
  appName: string;
  tz: string;
  passwordIterations: number;
  sessionTtlSeconds: number;
  rateLimitDisabled: boolean;
  defaultStorageQuotaBytes: number;
  fileStorage: FileStorageMode;
  directUploadThresholdBytes: number;
  downloadUrlTtlSeconds: number;
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
    files: env.FILES,
    secret,
    appName: (env.APP_NAME ?? '信息分发平台').trim() || '信息分发平台',
    tz: (env.DISPLAY_TZ ?? 'Asia/Shanghai').trim() || 'Asia/Shanghai',
    passwordIterations: clampIterations(parsePositiveInt(env.PASSWORD_ITERATIONS, 100_000, 10_000, 500_000)),
    sessionTtlSeconds: parsePositiveInt(env.SESSION_TTL_HOURS, 168, 1, 24 * 90) * 3600,
    rateLimitDisabled: (env.RATE_LIMIT_DISABLED ?? '').trim() === '1',
    defaultStorageQuotaBytes: parsePositiveInt(env.DEFAULT_STORAGE_QUOTA_MB, 50, 1, 10_240) * 1024 * 1024,
    fileStorage: parseFileStorageMode(env.FILE_STORAGE),
    directUploadThresholdBytes:
      parsePositiveInt(env.DIRECT_UPLOAD_THRESHOLD_MB, 20, 0, 10_240) * 1024 * 1024,
    downloadUrlTtlSeconds: parsePositiveInt(env.DOWNLOAD_URL_TTL_MINUTES, 60, 1, 1440) * 60,
  };
}

/** 是否具备 R2 预签名直传所需的全部配置。 */
export function hasDirectUploadCredentials(env: Env): boolean {
  return Boolean(
    (env.R2_ACCOUNT_ID ?? '').trim() &&
      (env.R2_BUCKET_NAME ?? '').trim() &&
      (env.R2_ACCESS_KEY_ID ?? '').trim() &&
      (env.R2_SECRET_ACCESS_KEY ?? '').trim(),
  );
}

export function parseFileStorageMode(raw: string | undefined): FileStorageMode {
  const value = (raw ?? '').trim().toLowerCase();
  return value === 'd1' || value === 'r2' ? value : 'auto';
}
