import { firstRow, runStatement } from '../db/d1.ts';
import { decryptString, encryptString, sha256Hex } from '../lib/crypto.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { randomHex } from '../lib/encoding.ts';
import { formatTime, nowIso } from '../lib/time.ts';
import type { AppContext } from '../env.ts';
import { findUserById, mapUser, type UserRow } from './users.ts';
import { LIMITS } from '../lib/validate.ts';

export const API_KEY_PREFIX = 'mdp_';

export interface ApiKeyRow {
  id: number;
  user_id: number;
  name: string;
  key_hash: string;
  key_enc: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiKeyView {
  id: number;
  name: string;
  key: string;
  created_at: string;
  created_at_display: string;
  last_used_at: string | null;
  last_used_display: string;
}

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomHex(24)}`;
}

export async function countApiKeys(db: D1Database, userId: number): Promise<number> {
  const row = await firstRow<{ total: number }>(db, 'SELECT COUNT(*) AS total FROM api_keys WHERE user_id = ?', [userId]);
  return Number(row?.total ?? 0);
}

export async function listApiKeys(ctx: AppContext, userId: number): Promise<ApiKeyView[]> {
  const result = await ctx.db
    .prepare('SELECT * FROM api_keys WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .bind(userId, LIMITS.apiKeysPerUser)
    .all<ApiKeyRow>();
  const views: ApiKeyView[] = [];
  for (const row of result.results ?? []) {
    views.push({
      id: row.id,
      name: row.name,
      key: await decryptString(ctx.secret, row.key_enc),
      created_at: row.created_at,
      created_at_display: formatTime(row.created_at, ctx.tz),
      last_used_at: row.last_used_at,
      last_used_display: row.last_used_at ? formatTime(row.last_used_at, ctx.tz) : '',
    });
  }
  return views;
}

export async function createApiKey(ctx: AppContext, userId: number, name: string): Promise<ApiKeyView> {
  const count = await countApiKeys(ctx.db, userId);
  if (count >= LIMITS.apiKeysPerUser) {
    throw badRequest('too_many_api_keys', `每个账号最多创建 ${LIMITS.apiKeysPerUser} 个 API Key`);
  }
  const plain = generateApiKey();
  const keyHash = await sha256Hex(plain);
  const keyEnc = await encryptString(ctx.secret, plain);
  const createdAt = nowIso();
  const row = await firstRow<ApiKeyRow>(
    ctx.db,
    `INSERT INTO api_keys (user_id, name, key_hash, key_enc, created_at)
     VALUES (?, ?, ?, ?, ?) RETURNING *`,
    [userId, name, keyHash, keyEnc, createdAt],
  );
  if (!row) {
    throw new Error('创建 API Key 失败');
  }
  return {
    id: row.id,
    name: row.name,
    key: plain,
    created_at: createdAt,
    created_at_display: formatTime(createdAt, ctx.tz),
    last_used_at: null,
    last_used_display: '',
  };
}

export async function deleteApiKey(db: D1Database, userId: number, id: number): Promise<void> {
  const changes = await runStatement(db, 'DELETE FROM api_keys WHERE id = ? AND user_id = ?', [id, userId]);
  if (changes === 0) {
    throw notFound('api_key_not_found', 'API Key 不存在');
  }
}

/**
 * 用明文 API Key 找到所属用户。
 * 数据库只保存 SHA-256 摘要（用于查找）和 AES-GCM 密文（用于在界面中回显）。
 */
export async function findApiKeyOwner(ctx: AppContext, plainKey: string): Promise<{ user: UserRow; keyId: number } | null> {
  const normalized = plainKey.trim();
  if (!normalized.startsWith(API_KEY_PREFIX) || normalized.length < API_KEY_PREFIX.length + 16) {
    return null;
  }
  const keyHash = await sha256Hex(normalized);
  const row = await firstRow<ApiKeyRow>(ctx.db, 'SELECT * FROM api_keys WHERE key_hash = ?', [keyHash]);
  if (!row) {
    return null;
  }
  const user = await findUserById(ctx.db, row.user_id);
  if (!user) {
    return null;
  }
  await runStatement(ctx.db, 'UPDATE api_keys SET last_used_at = ? WHERE id = ?', [nowIso(), row.id]);
  return { user: mapUser(user), keyId: row.id };
}
