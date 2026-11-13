import { hasDirectUploadCredentials, type Env } from '../env.ts';
import { ApiError } from './errors.ts';
import { encodeObjectKey, presignS3Url } from './sigv4.ts';

export const R2_PRESIGN_EXPIRES_SECONDS = 900;
export const R2_DOWNLOAD_URL_EXPIRES_SECONDS = 3600;

interface R2Credentials {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function credentials(env: Env): R2Credentials {
  if (!hasDirectUploadCredentials(env)) {
    throw new ApiError(
      503,
      'direct_upload_unavailable',
      'R2 直传未配置。请设置 R2_ACCOUNT_ID、R2_BUCKET_NAME、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY。',
    );
  }
  return {
    accountId: (env.R2_ACCOUNT_ID ?? '').trim(),
    bucket: (env.R2_BUCKET_NAME ?? '').trim(),
    accessKeyId: (env.R2_ACCESS_KEY_ID ?? '').trim(),
    secretAccessKey: (env.R2_SECRET_ACCESS_KEY ?? '').trim(),
  };
}

function objectUrl(env: Env, objectKey: string): URL {
  const { accountId, bucket } = credentials(env);
  return new URL(`https://${bucket}.${accountId}.r2.cloudflarestorage.com/${encodeObjectKey(objectKey)}`);
}

/**
 * 生成 R2 预签名 PUT URL（S3 API）。
 * 浏览器可直接 PUT 到 R2，不经过 Worker，因此不受 Worker 请求体/内存限制。
 */
export async function presignR2Put(
  env: Env,
  objectKey: string,
  contentType: string,
  expiresSeconds: number = R2_PRESIGN_EXPIRES_SECONDS,
): Promise<string> {
  const { accessKeyId, secretAccessKey } = credentials(env);
  return presignS3Url({
    method: 'PUT',
    url: objectUrl(env, objectKey),
    headers: { 'content-type': contentType },
    accessKeyId,
    secretAccessKey,
    region: 'auto',
    service: 's3',
    expiresSeconds,
  });
}

/**
 * 生成 R2 预签名 GET URL（S3 API），用于直传文件直接下载。
 * response-content-type / response-content-disposition 会被签名，R2 按签名值返回响应头。
 */
export async function presignR2Get(
  env: Env,
  objectKey: string,
  contentType: string,
  contentDisposition: string,
  expiresSeconds: number = R2_DOWNLOAD_URL_EXPIRES_SECONDS,
): Promise<string> {
  const { accessKeyId, secretAccessKey } = credentials(env);
  const url = objectUrl(env, objectKey);
  url.searchParams.set('response-content-type', contentType);
  url.searchParams.set('response-content-disposition', contentDisposition);
  return presignS3Url({
    method: 'GET',
    url,
    accessKeyId,
    secretAccessKey,
    region: 'auto',
    service: 's3',
    expiresSeconds,
  });
}
