import {
  claimStorage,
  countFiles,
  deleteStoredFile,
  fileObjectKey,
  findFileRow,
  getFileContent,
  getFileStorageStatus,
  getStorageInfo,
  listFiles,
  MAX_FILES_PER_USER,
  R2_MAX_SINGLE_UPLOAD,
  registerDirectUpload,
  releaseStorage,
  saveFile,
  setFileVisibility,
  toFileView,
} from '../data/storage.ts';
import { findApiKeyOwner } from '../data/apikeys.ts';
import { resolveActor } from '../auth/actor.ts';
import { currentUser, requireUser } from '../auth/session.ts';
import { rateLimit } from '../auth/ratelimit.ts';
import { hasDirectUploadCredentials, type AppContext } from '../env.ts';
import { decryptString } from '../lib/crypto.ts';
import { randomHex } from '../lib/encoding.ts';
import { ApiError, badRequest, forbidden, notFound, payloadTooLarge } from '../lib/errors.ts';
import { boolParam, intParam, ok, optionalString, stringParam, type Params } from '../lib/http.ts';
import { presignR2Put, R2_PRESIGN_EXPIRES_SECONDS } from '../lib/r2-presign.ts';
import { formatTime } from '../lib/time.ts';
import { runStatement } from '../db/d1.ts';

interface UploadBody {
  fields: Params;
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

function isFileLike(value: unknown): value is File {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as File).arrayBuffer === 'function' &&
    typeof (value as File).name === 'string'
  );
}

function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'file').slice(0, 180);
}

function sanitizeContentType(raw: string): string {
  const value = raw.split(';')[0]?.replace(/[\r\n]/g, '').trim() ?? '';
  return value && value.length <= 120 ? value : 'application/octet-stream';
}

function decodeHeaderFilename(raw: string | null): string {
  if (!raw) {
    return 'file';
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function readUploadBody(request: Request, query: Params): Promise<UploadBody> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.toLowerCase().includes('multipart/form-data')) {
    const form = await request.formData();
    const fields: Params = {};
    let file: File | null = null;
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') {
        fields[key] = value;
      } else if (!file && isFileLike(value)) {
        file = value;
      }
    }
    if (!file) {
      throw badRequest('missing_file', '请在 multipart/form-data 中提供 file 字段');
    }
    return {
      fields,
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name || 'file',
      contentType: sanitizeContentType(file.type || 'application/octet-stream'),
    };
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  return {
    fields: {},
    bytes,
    filename: decodeHeaderFilename(request.headers.get('x-file-name') ?? query.name ?? 'file'),
    contentType: sanitizeContentType(request.headers.get('content-type') ?? 'application/octet-stream'),
  };
}

/** /uploadfile：multipart（file 字段）或原始二进制（X-File-Name 头）均可。 */
export async function uploadFile(ctx: AppContext, request: Request, query: Params): Promise<Response> {
  const body = await readUploadBody(request, query);
  const params: Params = { ...query, ...body.fields };
  const userName = (params.user_name ?? '').trim();
  const actor = await resolveActor(ctx, request, params, userName ? { userName } : {});
  const isPrivate = boolParam(params, 'private', false);
  const displayName = sanitizeFilename((params.name ?? body.filename).trim());
  if (body.bytes.length === 0) {
    throw badRequest('empty_file', '文件内容为空');
  }
  if ((await countFiles(ctx.db, actor.user.id)) >= MAX_FILES_PER_USER) {
    throw badRequest('too_many_files', `每个账号最多保存 ${MAX_FILES_PER_USER} 个文件`);
  }
  await rateLimit(ctx, `files:upload:${actor.user.id}`, 60, 600);
  await claimStorage(ctx, actor.user.id, body.bytes.length);

  let fileId: string;
  let size: number;
  let contentType: string;
  let createdAt: string;
  let backend: 'd1' | 'r2' = 'd1';
  try {
    const row = await saveFile(ctx, actor.user.id, {
      name: displayName,
      contentType: body.contentType,
      bytes: body.bytes,
      private: isPrivate,
    });
    fileId = row.id;
    size = Number(row.size);
    contentType = row.content_type;
    createdAt = row.created_at;
    backend = row.storage === 'r2' ? 'r2' : 'd1';
  } catch (error) {
    await releaseStorage(ctx, actor.user.id, body.bytes.length);
    throw error;
  }

  const storage = await getStorageInfo(ctx, actor.user.id);
  const origin = new URL(request.url).origin;
  return ok({
    user_name: actor.user.username,
    file_id: fileId,
    name: displayName,
    size,
    content_type: contentType,
    private: isPrivate,
    backend,
    created_at: formatTime(createdAt, ctx.tz),
    url_path: `/api/downloadfile?id=${encodeURIComponent(fileId)}`,
    download_url: `${origin}/api/downloadfile?id=${encodeURIComponent(fileId)}`,
    storage,
  });
}

async function directUploadStatus(
  ctx: AppContext,
): Promise<{ available: boolean; threshold: number; max_size: number }> {
  const storage = await getFileStorageStatus(ctx);
  return {
    available: Boolean(ctx.files && storage.backend === 'r2' && hasDirectUploadCredentials(ctx.env)),
    threshold: ctx.directUploadThresholdBytes,
    max_size: R2_MAX_SINGLE_UPLOAD,
  };
}

/** /files/presign：为超过阈值的文件生成 R2 直传 URL（浏览器直接 PUT 到 R2）。 */
export async function presignUpload(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const session = await requireUser(ctx, request);
  const direct = await directUploadStatus(ctx);
  if (!direct.available) {
    throw new ApiError(
      503,
      'direct_upload_unavailable',
      'R2 直传未启用。请先在管理后台选择 R2 后端，并配置 R2 S3 API 凭据。',
    );
  }
  const name = sanitizeFilename(stringParam(params, 'name', { max: 200, label: '文件名' }));
  const size = intParam(params, 'size', { min: 1, max: R2_MAX_SINGLE_UPLOAD, label: '文件大小' });
  const contentType = sanitizeContentType(optionalString(params, 'content_type') ?? 'application/octet-stream');
  const isPrivate = boolParam(params, 'private', false);

  await rateLimit(ctx, `files:presign:${session.user.id}`, 60, 600);
  if ((await countFiles(ctx.db, session.user.id)) >= MAX_FILES_PER_USER) {
    throw badRequest('too_many_files', `每个账号最多保存 ${MAX_FILES_PER_USER} 个文件`);
  }
  const storage = await getStorageInfo(ctx, session.user.id);
  if (size > storage.remaining) {
    throw payloadTooLarge('storage_quota_exceeded', '剩余存储空间不足', {
      quota: storage.quota,
      used: storage.used,
      required: size,
      remaining: storage.remaining,
    });
  }

  const fileId = randomHex(24);
  const objectKey = `files/${session.user.id}/${fileId}`;
  const uploadUrl = await presignR2Put(ctx.env, objectKey, contentType);
  return ok({
    user_name: session.user.username,
    file_id: fileId,
    name,
    size,
    content_type: contentType,
    private: isPrivate,
    direct: true,
    upload_url: uploadUrl,
    method: 'PUT',
    headers: { 'content-type': contentType },
    expires_in: R2_PRESIGN_EXPIRES_SECONDS,
    max_size: Math.min(R2_MAX_SINGLE_UPLOAD, storage.remaining),
    threshold: direct.threshold,
    storage,
  });
}

/** /files/complete：直传完成后登记元数据、校验实际大小并占用配额。 */
export async function completeUpload(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const session = await requireUser(ctx, request);
  const fileId = stringParam(params, 'file_id', { max: 64, label: '文件 ID' });
  if (!/^[0-9a-f]{48}$/.test(fileId)) {
    throw badRequest('invalid_file_id', 'file_id 格式不正确');
  }
  const name = sanitizeFilename(stringParam(params, 'name', { max: 200, label: '文件名' }));
  const contentType = sanitizeContentType(optionalString(params, 'content_type') ?? 'application/octet-stream');
  const isPrivate = boolParam(params, 'private', false);

  await rateLimit(ctx, `files:complete:${session.user.id}`, 120, 600);
  const row = await registerDirectUpload(ctx, session.user.id, { fileId, name, contentType, private: isPrivate });
  const view = await toFileView(ctx, row);
  const origin = new URL(request.url).origin;
  return ok({
    user_name: session.user.username,
    file_id: view.id,
    name: view.name,
    size: view.size,
    content_type: view.content_type,
    private: view.private,
    encrypted: view.encrypted,
    backend: view.backend,
    direct: true,
    created_at: view.created_at_display,
    url_path: view.url_path,
    download_url: `${origin}${view.url_path}`,
    storage: await getStorageInfo(ctx, session.user.id),
  });
}

async function assertDownloadAccess(
  ctx: AppContext,
  request: Request,
  params: Params,
  row: { user_id: number },
): Promise<void> {
  const apiKey = (params.api_key ?? request.headers.get('x-api-key') ?? '').trim();
  if (apiKey) {
    const owner = await findApiKeyOwner(ctx, apiKey);
    if (!owner || owner.user.id !== row.user_id) {
      throw forbidden('invalid_api_key', 'API Key 无效或不属于文件所有者');
    }
    return;
  }
  const session = await currentUser(ctx, request);
  if (!session) {
    throw forbidden('api_key_required', '该文件为私有文件，需要提供 api_key 或登录文件所有者账号');
  }
  if (session.user.id !== row.user_id) {
    throw forbidden('forbidden', '无权下载该文件');
  }
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'download';
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function downloadHeaders(row: { content_type: string }, filename: string, size: number): Record<string, string> {
  return {
    'content-type': row.content_type,
    'content-length': String(size),
    'content-disposition': contentDisposition(filename),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'",
    // 二进制响应无法在 JSON 体内返回 status，用响应头给出同一信息。
    'x-api-status': '200',
  };
}

/** /downloadfile：GET（浏览器链接）或 POST 均可；私有文件需 api_key / 所有者会话。 */
export async function downloadFile(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const fileId = (params.id ?? params.file_id ?? '').trim();
  if (!fileId) {
    throw badRequest('missing_id', '缺少参数 id');
  }
  const row = await findFileRow(ctx.db, fileId);
  if (!row) {
    throw notFound('file_not_found', '文件不存在或已被删除');
  }
  if (row.private === 1) {
    await assertDownloadAccess(ctx, request, params, row);
  }

  const filename = await decryptString(ctx.secret, row.name_enc);
  const plainR2 = row.storage === 'r2' && Number(row.encrypted ?? 1) === 0;

  // 浏览器直传的文件没有经过 Worker 端加密，直接流式返回，避免把大文件读进内存。
  if (plainR2) {
    if (!ctx.files) {
      throw new ApiError(503, 'storage_not_configured', '该文件存储在 R2，但当前 Worker 未绑定 FILES');
    }
    const objectKey = fileObjectKey(row);
    const object = request.method === 'HEAD' ? await ctx.files.head(objectKey) : await ctx.files.get(objectKey);
    if (!object) {
      throw notFound('file_not_found', '文件数据不存在或已被删除');
    }
    if (request.method !== 'HEAD') {
      await runStatement(ctx.db, 'UPDATE files SET downloads = downloads + 1 WHERE id = ?', [row.id]);
    }
    const headers = downloadHeaders(row, filename, Number(object.size));
    const body = request.method === 'HEAD' ? null : (object as R2ObjectBody).body;
    return new Response(body, { status: 200, headers });
  }

  const bytes = await getFileContent(ctx, row);
  if (request.method !== 'HEAD') {
    await runStatement(ctx.db, 'UPDATE files SET downloads = downloads + 1 WHERE id = ?', [row.id]);
  }
  return new Response(request.method === 'HEAD' ? null : bytes, {
    status: 200,
    headers: downloadHeaders(row, filename, bytes.length),
  });
}

/** /deletefile：api_key 或登录态均可。 */
export async function deleteFileRoute(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const userName = (params.user_name ?? '').trim();
  const actor = await resolveActor(ctx, request, params, userName ? { userName } : {});
  const fileId = (params.file_id ?? params.id ?? '').trim();
  if (!fileId) {
    throw badRequest('missing_file_id', '缺少参数 file_id');
  }
  await rateLimit(ctx, `files:delete:${actor.user.id}`, 120, 600);
  const row = await deleteStoredFile(ctx, actor.user.id, fileId);
  return ok({
    user_name: actor.user.username,
    file_id: row.id,
    size: Number(row.size),
    deleted: true,
    storage: await getStorageInfo(ctx, actor.user.id),
  });
}

export async function listFilesRoute(ctx: AppContext, request: Request): Promise<Response> {
  const session = await requireUser(ctx, request);
  const [files, storage, storageStatus] = await Promise.all([
    listFiles(ctx, session.user.id),
    getStorageInfo(ctx, session.user.id),
    getFileStorageStatus(ctx),
  ]);
  return ok({
    files,
    storage,
    storage_setting: storageStatus.setting,
    storage_backend: storageStatus.backend,
    r2_available: storageStatus.r2_available,
    direct_upload: {
      available: Boolean(ctx.files && storageStatus.backend === 'r2' && hasDirectUploadCredentials(ctx.env)),
      threshold: ctx.directUploadThresholdBytes,
      max_size: R2_MAX_SINGLE_UPLOAD,
    },
  });
}

export async function updateFileVisibility(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const session = await requireUser(ctx, request);
  const fileId = stringParam(params, 'id', { max: 64, label: '文件 ID' });
  const isPrivate = boolParam(params, 'private', true);
  await setFileVisibility(ctx, session.user.id, fileId, isPrivate);
  return ok({ file_id: fileId, private: isPrivate, storage: await getStorageInfo(ctx, session.user.id) });
}

export async function deleteFileUi(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const session = await requireUser(ctx, request);
  const fileId = stringParam(params, 'id', { max: 64, label: '文件 ID' });
  const row = await deleteStoredFile(ctx, session.user.id, fileId);
  return ok({ file_id: row.id, deleted: true, storage: await getStorageInfo(ctx, session.user.id) });
}
