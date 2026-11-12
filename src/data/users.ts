import { allRows, firstRow, runStatement } from '../db/d1.ts';
import { hashPassword, verifyPassword, getDummyPasswordHash } from '../lib/crypto.ts';
import { badRequest, conflict, unauthorized } from '../lib/errors.ts';
import { formatTime, nowIso } from '../lib/time.ts';
import { normalizeUsername, validatePassword, validateUsername, LIMITS } from '../lib/validate.ts';

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: 'admin' | 'user';
  feedback_enabled: number;
  feedback_intro_enc: string | null;
  token_version: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface PublicUser {
  id: number;
  username: string;
  display_name: string;
  role: 'admin' | 'user';
  feedback_enabled: boolean;
  created_at: string;
  created_at_display: string;
  last_login_at: string | null;
}

export interface UserWithStats extends PublicUser {
  info_count: number;
  feedback_count: number;
  api_key_count: number;
}

export function mapUser(row: UserRow): UserRow {
  return { ...row, role: row.role === 'admin' ? 'admin' : 'user' };
}

export function toPublicUser(row: UserRow, timeZone: string): PublicUser {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role === 'admin' ? 'admin' : 'user',
    feedback_enabled: row.feedback_enabled === 1,
    created_at: row.created_at,
    created_at_display: formatTime(row.created_at, timeZone),
    last_login_at: row.last_login_at,
  };
}

export async function findUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  return firstRow<UserRow>(db, 'SELECT * FROM users WHERE username = ?', [normalizeUsername(username)]);
}

export async function findUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return firstRow<UserRow>(db, 'SELECT * FROM users WHERE id = ?', [id]);
}

export async function countAdmins(db: D1Database): Promise<number> {
  const row = await firstRow<{ total: number }>(db, `SELECT COUNT(*) AS total FROM users WHERE role = 'admin'`);
  return Number(row?.total ?? 0);
}

export async function countUsers(db: D1Database): Promise<number> {
  const row = await firstRow<{ total: number }>(db, 'SELECT COUNT(*) AS total FROM users');
  return Number(row?.total ?? 0);
}

export async function createUser(
  db: D1Database,
  input: { username: string; displayName: string; passwordHash: string; role: 'admin' | 'user' },
): Promise<UserRow> {
  const now = nowIso();
  const row = await firstRow<UserRow>(
    db,
    `INSERT INTO users (username, display_name, password_hash, role, feedback_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?) RETURNING *`,
    [normalizeUsername(input.username), input.displayName, input.passwordHash, input.role, now, now],
  );
  if (!row) {
    throw new Error('创建用户失败');
  }
  return mapUser(row);
}

export async function updateUserPassword(db: D1Database, userId: number, passwordHash: string): Promise<void> {
  await runStatement(
    db,
    'UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?',
    [passwordHash, nowIso(), userId],
  );
}

export async function touchLastLogin(db: D1Database, userId: number): Promise<void> {
  await runStatement(db, 'UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), userId]);
}

export async function deleteUser(db: D1Database, userId: number): Promise<boolean> {
  // 显式级联删除，不依赖 D1 的 foreign_keys 设置是否开启。
  const sessions = await allRows<{ session_id: string }>(db, 'SELECT session_id FROM feedback_sessions WHERE user_id = ?', [
    userId,
  ]);
  const statements = [
    ...sessions.map((session) => db.prepare('DELETE FROM feedback_messages WHERE session_id = ?').bind(session.session_id)),
    db.prepare('DELETE FROM feedback_sessions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM information WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM api_keys WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ];
  const results = await db.batch(statements);
  const lastResult = results[results.length - 1];
  return Number(lastResult?.meta?.changes ?? 0) > 0;
}

export async function listUsersWithStats(db: D1Database, timeZone: string): Promise<UserWithStats[]> {
  const result = await db
    .prepare(
      `SELECT u.*,
              (SELECT COUNT(*) FROM information i WHERE i.user_id = u.id) AS info_count,
              (SELECT COUNT(*) FROM feedback_sessions f WHERE f.user_id = u.id) AS feedback_count,
              (SELECT COUNT(*) FROM api_keys k WHERE k.user_id = u.id) AS api_key_count
       FROM users u
       ORDER BY u.id ASC
       LIMIT ?`,
    )
    .bind(LIMITS.adminListLimit)
    .all<UserRow & { info_count: number; feedback_count: number; api_key_count: number }>();
  return (result.results ?? []).map((row) => ({
    ...toPublicUser(mapUser(row), timeZone),
    info_count: Number(row.info_count ?? 0),
    feedback_count: Number(row.feedback_count ?? 0),
    api_key_count: Number(row.api_key_count ?? 0),
  }));
}

export interface LoginResult {
  user: UserRow;
  token: string;
}

/**
 * 校验用户名密码并签发会话。
 * 用户不存在时也会执行一次等价的 PBKDF2 运算，避免通过响应时间枚举用户名。
 */
export async function authenticate(
  db: D1Database,
  input: { username: string; password: string; iterations: number },
  issueToken: (user: UserRow) => Promise<string>,
): Promise<LoginResult> {
  const row = await findUserByUsername(db, input.username);
  if (!row) {
    await verifyPassword(input.password, await getDummyPasswordHash(input.iterations));
    throw unauthorized('invalid_credentials', '用户名或密码错误');
  }
  const valid = await verifyPassword(input.password, row.password_hash);
  if (!valid) {
    throw unauthorized('invalid_credentials', '用户名或密码错误');
  }
  await touchLastLogin(db, row.id);
  const refreshed = (await findUserById(db, row.id)) ?? row;
  return { user: refreshed, token: await issueToken(refreshed) };
}

/** 首次部署创建 admin，或普通用户注册时复用。 */
export async function requireNewUsername(db: D1Database, username: string): Promise<{ username: string; displayName: string }> {
  const parsed = validateUsername(username);
  const existing = await findUserByUsername(db, parsed.username);
  if (existing) {
    throw conflict('username_taken', '该用户名已被注册');
  }
  return parsed;
}

export async function createUserWithPassword(
  db: D1Database,
  input: { username: string; password: string; role: 'admin' | 'user'; iterations: number },
): Promise<UserRow> {
  validatePassword(input.password);
  const { username, displayName } = await requireNewUsername(db, input.username);
  const passwordHash = await hashPassword(input.password, input.iterations);
  try {
    return await createUser(db, { username, displayName, passwordHash, role: input.role });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
      throw conflict('username_taken', '该用户名已被注册');
    }
    throw error;
  }
}

export function assertPasswordChangeAllowed(currentPassword: string, newPassword: string): void {
  validatePassword(newPassword);
  if (currentPassword === newPassword) {
    throw badRequest('same_password', '新密码不能与当前密码相同');
  }
}
