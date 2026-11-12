import { firstRow, runStatement } from '../db/d1.ts';
import { sha256Hex } from '../lib/crypto.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { addDaysIso, formatTime, nowIso } from '../lib/time.ts';
import { LIMITS } from '../lib/validate.ts';
import type { AppContext } from '../env.ts';

/** 去掉容易混淆的 I / O / 0 / 1，共 32 个字符，每字符 5 bit 熵。 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 16;

export interface RegistrationCodeRow {
  id: number;
  code_hash: string;
  label: string;
  created_by: number | null;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  revoked: number;
  created_at: string;
  last_used_at: string | null;
  last_used_by: string | null;
}

export type RegistrationCodeStatus = 'active' | 'used' | 'expired' | 'revoked';

export interface RegistrationCodeView {
  id: number;
  label: string;
  max_uses: number;
  used_count: number;
  status: RegistrationCodeStatus;
  created_at: string;
  created_at_display: string;
  expires_at: string | null;
  expires_at_display: string;
  last_used_at: string | null;
  last_used_by: string | null;
}

export function generateRegistrationCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let raw = '';
  for (const byte of bytes) {
    raw += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return raw;
}

export function formatRegistrationCode(raw: string): string {
  return raw.replace(/(.{4})(?=.)/g, '$1-');
}

export function normalizeRegistrationCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export async function hashRegistrationCode(code: string): Promise<string> {
  return sha256Hex(`registration-code:${normalizeRegistrationCode(code)}`);
}

export function registrationCodeStatus(row: RegistrationCodeRow, now = Date.now()): RegistrationCodeStatus {
  if (row.revoked === 1) {
    return 'revoked';
  }
  if (row.used_count >= row.max_uses) {
    return 'used';
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) {
    return 'expired';
  }
  return 'active';
}

function toView(row: RegistrationCodeRow, timeZone: string): RegistrationCodeView {
  return {
    id: row.id,
    label: row.label,
    max_uses: row.max_uses,
    used_count: row.used_count,
    status: registrationCodeStatus(row),
    created_at: row.created_at,
    created_at_display: formatTime(row.created_at, timeZone),
    expires_at: row.expires_at,
    expires_at_display: row.expires_at ? formatTime(row.expires_at, timeZone) : '',
    last_used_at: row.last_used_at,
    last_used_by: row.last_used_by,
  };
}

export async function createRegistrationCode(
  ctx: AppContext,
  adminId: number,
  options: { label?: string; maxUses?: number; expiresInDays?: number },
): Promise<{ code: string; view: RegistrationCodeView }> {
  const raw = generateRegistrationCode();
  const codeHash = await hashRegistrationCode(raw);
  const createdAt = nowIso();
  const expiresAt = options.expiresInDays && options.expiresInDays > 0 ? addDaysIso(options.expiresInDays) : null;
  const label = (options.label ?? '').trim().slice(0, LIMITS.registrationCodeLabelMax);
  const row = await firstRow<RegistrationCodeRow>(
    ctx.db,
    `INSERT INTO registration_codes (code_hash, label, created_by, max_uses, used_count, expires_at, revoked, created_at)
     VALUES (?, ?, ?, ?, 0, ?, 0, ?) RETURNING *`,
    [codeHash, label, adminId, options.maxUses ?? 1, expiresAt, createdAt],
  );
  if (!row) {
    throw new Error('创建注册码失败');
  }
  return { code: formatRegistrationCode(raw), view: toView(row, ctx.tz) };
}

export async function listRegistrationCodes(ctx: AppContext): Promise<RegistrationCodeView[]> {
  const result = await ctx.db
    .prepare('SELECT * FROM registration_codes ORDER BY id DESC LIMIT ?')
    .bind(LIMITS.adminListLimit)
    .all<RegistrationCodeRow>();
  return (result.results ?? []).map((row) => toView(row, ctx.tz));
}

export async function revokeRegistrationCode(db: D1Database, id: number): Promise<void> {
  const changes = await runStatement(db, 'UPDATE registration_codes SET revoked = 1 WHERE id = ?', [id]);
  if (changes === 0) {
    throw notFound('registration_code_not_found', '注册码不存在');
  }
}

/**
 * 原子地占用一次注册码。并发注册时只有一个请求能把 used_count 加一，
 * 失败的请求会收到 400，避免同一注册码被超发。
 */
export async function claimRegistrationCode(ctx: AppContext, code: string, username: string): Promise<RegistrationCodeRow> {
  const normalized = normalizeRegistrationCode(code);
  if (normalized.length !== CODE_LENGTH) {
    throw badRequest('invalid_code', '注册码无效');
  }
  const codeHash = await hashRegistrationCode(normalized);
  const row = await firstRow<RegistrationCodeRow>(ctx.db, 'SELECT * FROM registration_codes WHERE code_hash = ?', [codeHash]);
  if (!row) {
    throw badRequest('invalid_code', '注册码无效');
  }
  if (row.revoked === 1) {
    throw badRequest('invalid_code', '注册码已被吊销');
  }
  if (row.used_count >= row.max_uses) {
    throw badRequest('invalid_code', '注册码已被使用完');
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    throw badRequest('expired_code', '注册码已过期');
  }
  const now = nowIso();
  const changes = await runStatement(
    ctx.db,
    `UPDATE registration_codes
     SET used_count = used_count + 1, last_used_at = ?, last_used_by = ?
     WHERE id = ? AND revoked = 0 AND used_count < max_uses
       AND (expires_at IS NULL OR expires_at > ?)`,
    [now, username, row.id, now],
  );
  if (changes !== 1) {
    throw badRequest('invalid_code', '注册码无效或已被使用');
  }
  return row;
}

/** 注册流程失败时把占用的次数还回去。 */
export async function releaseRegistrationCode(db: D1Database, id: number): Promise<void> {
  await runStatement(
    db,
    'UPDATE registration_codes SET used_count = MAX(used_count - 1, 0), last_used_at = NULL WHERE id = ?',
    [id],
  );
}

export async function countActiveRegistrationCodes(db: D1Database): Promise<number> {
  const now = nowIso();
  const row = await firstRow<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM registration_codes
     WHERE revoked = 0 AND used_count < max_uses AND (expires_at IS NULL OR expires_at > ?)`,
    [now],
  );
  return Number(row?.total ?? 0);
}
