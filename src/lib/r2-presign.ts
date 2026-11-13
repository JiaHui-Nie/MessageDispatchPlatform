import { hasDirectUploadCredentials, type Env } from '../env.ts';
import { ApiError } from './errors.ts';
import { encodeObjectKey, presignS3Url } from './sigv4.ts';

export const R2_PRESIGN_EXPIRES_SECONDS = 900;

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
  if (!hasDirectUploadCredentials(env)) {
    throw new ApiError(
      503,
      'direct_upload_unavailable',
      'R2 直传未配置。请设置 R2_ACCOUNT_ID、R2_BUCKET_NAME、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY。',
    );
  }
  const accountId = (env.R2_ACCOUNT_ID ?? '').trim();
  const bucket = (env.R2_BUCKET_NAME ?? '').trim();
  const url = new URL(`https://${bucket}.${accountId}.r2.cloudflarestorage.com/${encodeObjectKey(objectKey)}`);
  return presignS3Url({
    method: 'PUT',
    url,
    headers: { 'content-type': contentType },
    accessKeyId: (env.R2_ACCESS_KEY_ID ?? '').trim(),
    secretAccessKey: (env.R2_SECRET_ACCESS_KEY ?? '').trim(),
    region: 'auto',
    service: 's3',
    expiresSeconds,
  });
}
