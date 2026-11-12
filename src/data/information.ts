import { firstRow, runStatement } from '../db/d1.ts';
import { decryptString, encryptString } from '../lib/crypto.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { formatTime, nowIso } from '../lib/time.ts';
import { LIMITS } from '../lib/validate.ts';
import type { AppContext } from '../env.ts';

export interface InformationRow {
  id: number;
  user_id: number;
  info_key: string;
  value_enc: string;
  visible: number;
  created_at: string;
  updated_at: string;
}

export interface InformationView {
  key: string;
  value: string;
  visible: boolean;
  created_at: string;
  updated_at: string;
  updated_at_display: string;
}

export async function countInformation(db: D1Database, userId: number): Promise<number> {
  const row = await firstRow<{ total: number }>(db, 'SELECT COUNT(*) AS total FROM information WHERE user_id = ?', [userId]);
  return Number(row?.total ?? 0);
}

export async function findInformationRow(db: D1Database, userId: number, key: string): Promise<InformationRow | null> {
  return firstRow<InformationRow>(db, 'SELECT * FROM information WHERE user_id = ? AND info_key = ?', [userId, key]);
}

export async function upsertInformation(
  ctx: AppContext,
  userId: number,
  key: string,
  value: string,
  visible: boolean,
): Promise<{ created: boolean; updatedAt: string; count: number }> {
  const existing = await findInformationRow(ctx.db, userId, key);
  const count = await countInformation(ctx.db, userId);
  if (!existing && count >= LIMITS.infoKeysPerUser) {
    throw badRequest('too_many_information', `每个账号最多保存 ${LIMITS.infoKeysPerUser} 条信息，请先删除旧信息`);
  }
  const valueEnc = await encryptString(ctx.secret, value);
  const now = nowIso();
  await runStatement(
    ctx.db,
    `INSERT INTO information (user_id, info_key, value_enc, visible, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, info_key) DO UPDATE SET
       value_enc = excluded.value_enc,
       visible = excluded.visible,
       updated_at = excluded.updated_at`,
    [userId, key, valueEnc, visible ? 1 : 0, now, now],
  );
  return { created: !existing, updatedAt: now, count: existing ? count : count + 1 };
}

export async function getInformationValue(
  ctx: AppContext,
  userId: number,
  key: string,
): Promise<{ value: string; visible: boolean; updatedAt: string } | null> {
  const row = await findInformationRow(ctx.db, userId, key);
  if (!row) {
    return null;
  }
  return {
    value: await decryptString(ctx.secret, row.value_enc),
    visible: row.visible === 1,
    updatedAt: row.updated_at,
  };
}

export async function listInformation(ctx: AppContext, userId: number): Promise<InformationView[]> {
  const result = await ctx.db
    .prepare('SELECT * FROM information WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
    .bind(userId, LIMITS.infoKeysPerUser)
    .all<InformationRow>();
  const views: InformationView[] = [];
  for (const row of result.results ?? []) {
    views.push({
      key: row.info_key,
      value: await decryptString(ctx.secret, row.value_enc),
      visible: row.visible === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      updated_at_display: formatTime(row.updated_at, ctx.tz),
    });
  }
  return views;
}

export async function deleteInformation(db: D1Database, userId: number, key: string): Promise<void> {
  const changes = await runStatement(db, 'DELETE FROM information WHERE user_id = ? AND info_key = ?', [userId, key]);
  if (changes === 0) {
    throw notFound('information_not_found', '信息不存在');
  }
}
