import {
  assertFileSizeLimit,
  claimStorage,
  countFiles,
  deleteStoredFile,
  findFileRow,
  getFileContent,
  getStorageInfo,
  listFiles,
  MAX_FILES_PER_USER,
  releaseStorage,
  saveFile,
  setFileVisibility,
} from '../data/storage.ts';
import { findApiKeyOwner } from '../data/apikeys.ts';
import { resolveActor } from '../auth/actor.ts';
import { currentUser, requireUser } from '../auth/session.ts';
import { rateLimit } from '../auth/ratelimit.ts';
import type { AppContext } from '../env.ts';
import { decryptString } from '../lib/crypto.ts';
import { badRequest, forbidden, notFound } from '../lib/errors.ts';
import { boolParam, ok, stringParam, type Params } from '../lib/http.ts';
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
  assertFileSizeLimit(ctx, body.bytes.length);
  if ((await countFiles(ctx.db, actor.user.id)) >= MAX_FILES_PER_USER) {
    throw badRequest('too_many_files', `每个账号最多保存 ${MAX_FILES_PER_USER} 个文件`);
  }
  await rateLimit(ctx, `files:upload:${actor.user.id}`, 60, 600);
  await claimStorage(ctx, actor.user.id, body.bytes.length);

  let fileId: string;
  let size: number;
  let contentType: string;
  let createdAt: string;
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
    created_at: formatTime(createdAt, ctx.tz),
    url_path: `/api/downloadfile?id=${encodeURIComponent(fileId)}`,
    download_url: `${origin}/api/downloadfile?id=${encodeURIComponent(fileId)}`,
    storage,
    limits: { max_file_size: ctx.maxFileSizeBytes, max_files: MAX_FILES_PER_USER },
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
  const bytes = await getFileContent(ctx, row);
  if (request.method !== 'HEAD') {
    await runStatement(ctx.db, 'UPDATE files SET downloads = downloads + 1 WHERE id = ?', [row.id]);
  }
  const filename = await decryptString(ctx.secret, row.name_enc);
  const headers: Record<string, string> = {
    'content-type': row.content_type,
    'content-length': String(bytes.length),
    'content-disposition': contentDisposition(filename),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'",
    // 二进制响应无法在 JSON 体内返回 status，用响应头给出同一信息。
    'x-api-status': '200',
  };
  return new Response(request.method === 'HEAD' ? null : bytes, { status: 200, headers });
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
  const [files, storage] = await Promise.all([
    listFiles(ctx, session.user.id),
    getStorageInfo(ctx, session.user.id),
  ]);
  return ok({
    files,
    storage,
    limits: { max_file_size: ctx.maxFileSizeBytes, max_files: MAX_FILES_PER_USER },
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
