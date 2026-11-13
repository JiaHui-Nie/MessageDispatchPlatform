import { firstRow, runStatement } from '../db/d1.ts';
import { decryptBytes, decryptString, encryptBytes, encryptString } from '../lib/crypto.ts';
import { DecryptionError, notFound, payloadTooLarge, badRequest } from '../lib/errors.ts';
import { randomHex } from '../lib/encoding.ts';
import { formatTime, nowIso } from '../lib/time.ts';
import type { AppContext } from '../env.ts';

/**
 * 文件存储（D1 分块）
 *
 * 文件先用 AES-256-GCM 整体加密（iv || 密文），再按 900 KB 切块写入 file_chunks，
 * 避免单行接近 D1 的 2 MB 上限。配额由 user_storage 维护，上传前通过条件 UPDATE 原子占用。
 */
export const CHUNK_SIZE = 900_000;
export const MAX_FILES_PER_USER = 1_000;
export const MAX_FILE_SIZE_MB = 20;

export interface FileRow {
  id: string;
  user_id: number;
  name_enc: string;
  size: number;
  chunk_count: number;
  content_type: string;
  private: number;
  downloads: number;
  created_at: string;
}

export interface FileView {
  id: string;
  name: string;
  size: number;
  content_type: string;
  private: boolean;
  downloads: number;
  created_at: string;
  created_at_display: string;
  url_path: string;
}

export interface StorageInfo {
  quota: number;
  used: number;
  remaining: number;
  percent: number;
  file_count: number;
}

function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    return new Uint8Array(value);
  }
  throw new DecryptionError('文件数据格式不正确');
}

/** D1 绑定 BLOB 时使用独立的 ArrayBuffer，避免把视图的整个底层缓冲区写进去。 */
function toBindable(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function splitBytes(bytes: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.subarray(offset, Math.min(offset + size, bytes.length)));
  }
  return chunks.length > 0 ? chunks : [new Uint8Array(0)];
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function getDefaultQuota(ctx: AppContext): Promise<number> {
  const row = await firstRow<{ value: string }>(ctx.db, `SELECT value FROM meta WHERE key = 'default_storage_quota'`);
  const parsed = row ? Number.parseInt(row.value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : ctx.defaultStorageQuotaBytes;
}

export async function setDefaultQuota(ctx: AppContext, quotaBytes: number): Promise<void> {
  await runStatement(
    ctx.db,
    `INSERT INTO meta (key, value, updated_at) VALUES ('default_storage_quota', ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [String(quotaBytes), nowIso()],
  );
}

async function ensureStorageRow(ctx: AppContext, userId: number): Promise<void> {
  const quota = await getDefaultQuota(ctx);
  await runStatement(
    ctx.db,
    `INSERT INTO user_storage (user_id, quota, used, updated_at) VALUES (?, ?, 0, ?)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, quota, nowIso()],
  );
}

export async function getStorageInfo(ctx: AppContext, userId: number): Promise<StorageInfo> {
  const [storage, counters] = await Promise.all([
    firstRow<{ quota: number; used: number }>(ctx.db, 'SELECT quota, used FROM user_storage WHERE user_id = ?', [userId]),
    firstRow<{ total: number }>(ctx.db, 'SELECT COUNT(*) AS total FROM files WHERE user_id = ?', [userId]),
  ]);
  const quota = storage ? Number(storage.quota) : await getDefaultQuota(ctx);
  const used = storage ? Number(storage.used) : 0;
  const fileCount = Number(counters?.total ?? 0);
  const percent = quota > 0 ? Math.min(100, Math.round((used / quota) * 1000) / 10) : used > 0 ? 100 : 0;
  return {
    quota,
    used,
    remaining: Math.max(0, quota - used),
    percent,
    file_count: fileCount,
  };
}

/** 原子占用配额；超出时抛出 413，并带上当前配额信息。 */
export async function claimStorage(ctx: AppContext, userId: number, size: number): Promise<void> {
  await ensureStorageRow(ctx, userId);
  const changes = await runStatement(
    ctx.db,
    'UPDATE user_storage SET used = used + ?, updated_at = ? WHERE user_id = ? AND used + ? <= quota',
    [size, nowIso(), userId, size],
  );
  if (changes !== 1) {
    const info = await getStorageInfo(ctx, userId);
    throw payloadTooLarge('storage_quota_exceeded', '存储空间不足，请删除部分文件或联系管理员调整配额', {
      quota: info.quota,
      used: info.used,
      required: size,
      remaining: info.remaining,
    });
  }
}

export async function releaseStorage(ctx: AppContext, userId: number, size: number): Promise<void> {
  await runStatement(
    ctx.db,
    'UPDATE user_storage SET used = MAX(used - ?, 0), updated_at = ? WHERE user_id = ?',
    [size, nowIso(), userId],
  );
}

export async function setUserQuota(ctx: AppContext, userId: number, quotaBytes: number): Promise<StorageInfo> {
  await ensureStorageRow(ctx, userId);
  await runStatement(ctx.db, 'UPDATE user_storage SET quota = ?, updated_at = ? WHERE user_id = ?', [
    quotaBytes,
    nowIso(),
    userId,
  ]);
  return getStorageInfo(ctx, userId);
}

export async function countFiles(db: D1Database, userId: number): Promise<number> {
  const row = await firstRow<{ total: number }>(db, 'SELECT COUNT(*) AS total FROM files WHERE user_id = ?', [userId]);
  return Number(row?.total ?? 0);
}

export async function saveFile(
  ctx: AppContext,
  userId: number,
  input: { name: string; contentType: string; bytes: Uint8Array; private: boolean },
): Promise<FileRow> {
  const fileId = randomHex(24);
  const nameEnc = await encryptString(ctx.secret, input.name);
  const cipher = await encryptBytes(ctx.secret, input.bytes);
  const chunks = splitBytes(cipher, CHUNK_SIZE);
  const createdAt = nowIso();
  try {
    // 先写元数据行，再写分块：file_chunks.file_id 外键依赖 files(id)。
    const row = await firstRow<FileRow>(
      ctx.db,
      `INSERT INTO files (id, user_id, name_enc, size, chunk_count, content_type, private, downloads, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?) RETURNING *`,
      [fileId, userId, nameEnc, input.bytes.length, chunks.length, input.contentType, input.private ? 1 : 0, createdAt],
    );
    if (!row) {
      throw new Error('保存文件元数据失败');
    }
    for (let start = 0; start < chunks.length; start += 4) {
      const statements = chunks
        .slice(start, start + 4)
        .map((chunk, offset) =>
          ctx.db.prepare('INSERT INTO file_chunks (file_id, idx, data) VALUES (?, ?, ?)').bind(
            fileId,
            start + offset,
            toBindable(chunk),
          ),
        );
      await ctx.db.batch(statements);
    }
    return row;
  } catch (error) {
    await runStatement(ctx.db, 'DELETE FROM file_chunks WHERE file_id = ?', [fileId]).catch(() => 0);
    await runStatement(ctx.db, 'DELETE FROM files WHERE id = ?', [fileId]).catch(() => 0);
    throw error;
  }
}

export async function findFileRow(db: D1Database, fileId: string): Promise<FileRow | null> {
  return firstRow<FileRow>(db, 'SELECT * FROM files WHERE id = ?', [fileId]);
}

export async function toFileView(ctx: AppContext, row: FileRow): Promise<FileView> {
  return {
    id: row.id,
    name: await decryptString(ctx.secret, row.name_enc),
    size: Number(row.size),
    content_type: row.content_type,
    private: row.private === 1,
    downloads: Number(row.downloads),
    created_at: row.created_at,
    created_at_display: formatTime(row.created_at, ctx.tz),
    url_path: `/api/downloadfile?id=${encodeURIComponent(row.id)}`,
  };
}

export async function listFiles(ctx: AppContext, userId: number, limit = 200): Promise<FileView[]> {
  const result = await ctx.db
    .prepare('SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .bind(userId, Math.min(Math.max(limit, 1), 500))
    .all<FileRow>();
  const views: FileView[] = [];
  for (const row of result.results ?? []) {
    views.push(await toFileView(ctx, row));
  }
  return views;
}

export async function getFileContent(ctx: AppContext, row: FileRow): Promise<Uint8Array> {
  const result = await ctx.db
    .prepare('SELECT data FROM file_chunks WHERE file_id = ? ORDER BY idx ASC')
    .bind(row.id)
    .all<{ data: unknown }>();
  const chunks = result.results ?? [];
  if (chunks.length !== Number(row.chunk_count)) {
    throw new DecryptionError('文件数据不完整，请重新上传');
  }
  return decryptBytes(ctx.secret, concatBytes(chunks.map((chunk) => toUint8Array(chunk.data))));
}

export async function deleteStoredFile(ctx: AppContext, userId: number, fileId: string): Promise<FileRow> {
  const row = await findFileRow(ctx.db, fileId);
  if (!row || row.user_id !== userId) {
    throw notFound('file_not_found', '文件不存在或已被删除');
  }
  const changes = await runStatement(ctx.db, 'DELETE FROM files WHERE id = ? AND user_id = ?', [fileId, userId]);
  if (changes === 0) {
    throw notFound('file_not_found', '文件不存在或已被删除');
  }
  await runStatement(ctx.db, 'DELETE FROM file_chunks WHERE file_id = ?', [fileId]);
  await releaseStorage(ctx, userId, Number(row.size));
  return row;
}

export async function setFileVisibility(
  ctx: AppContext,
  userId: number,
  fileId: string,
  isPrivate: boolean,
): Promise<void> {
  const changes = await runStatement(ctx.db, 'UPDATE files SET private = ? WHERE id = ? AND user_id = ?', [
    isPrivate ? 1 : 0,
    fileId,
    userId,
  ]);
  if (changes === 0) {
    throw notFound('file_not_found', '文件不存在或已被删除');
  }
}

export async function getPlatformStorage(db: D1Database): Promise<{ files: number; used: number }> {
  const row = await firstRow<{ files: number; used: number }>(
    db,
    'SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS used FROM files',
  );
  return { files: Number(row?.files ?? 0), used: Number(row?.used ?? 0) };
}

export function fileDeletionStatements(db: D1Database, userId: number): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM file_chunks WHERE file_id IN (SELECT id FROM files WHERE user_id = ?)').bind(userId),
    db.prepare('DELETE FROM files WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM user_storage WHERE user_id = ?').bind(userId),
  ];
}

export function assertFileSizeLimit(ctx: AppContext, size: number): void {
  if (size <= 0) {
    throw badRequest('empty_file', '文件内容为空');
  }
  if (size > ctx.maxFileSizeBytes) {
    throw payloadTooLarge(
      'file_too_large',
      `单个文件不能超过 ${Math.round(ctx.maxFileSizeBytes / (1024 * 1024))} MB`,
      { max_size: ctx.maxFileSizeBytes, size },
    );
  }
}
