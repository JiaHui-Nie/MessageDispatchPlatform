import { firstRow, runStatement } from '../db/d1.ts';
import { decryptString, encryptString } from '../lib/crypto.ts';
import { badRequest, notFound, tooManyRequests } from '../lib/errors.ts';
import { randomHex } from '../lib/encoding.ts';
import { formatTime, nowIso } from '../lib/time.ts';
import { LIMITS } from '../lib/validate.ts';
import type { AppContext } from '../env.ts';
import type { UserRow } from './users.ts';

export type FeedbackType = 'feedback' | 'reply';
export type FeedbackAuthor = 'visitor' | 'owner';
export type FeedbackStatus = 'unread' | 'read';

export interface FeedbackSessionRow {
  id: number;
  session_id: string;
  user_id: number;
  title_enc: string;
  status: FeedbackStatus;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface FeedbackMessageRow {
  id: number;
  session_id: string;
  type: FeedbackType;
  author: FeedbackAuthor;
  body_enc: string;
  created_at: string;
}

export interface FeedbackMessageView {
  id: number;
  type: FeedbackType;
  author: FeedbackAuthor;
  time: string;
  information: string;
}

export interface FeedbackThreadView {
  session_id: string;
  user_name: string;
  title: string;
  status: FeedbackStatus;
  message_count: number;
  created_at: string;
  created_at_display: string;
  update_time: string;
  updated_at: string;
  chat: FeedbackMessageView[];
}

export interface FeedbackListView {
  session_id: string;
  title: string;
  status: FeedbackStatus;
  message_count: number;
  created_at: string;
  created_at_display: string;
  update_time: string;
  updated_at: string;
}

export function summarizeTitle(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > 60 ? `${singleLine.slice(0, 60)}…` : singleLine;
}

export async function countFeedbackSessions(db: D1Database, userId: number, status?: FeedbackStatus): Promise<number> {
  const row = status
    ? await firstRow<{ total: number }>(
        db,
        'SELECT COUNT(*) AS total FROM feedback_sessions WHERE user_id = ? AND status = ?',
        [userId, status],
      )
    : await firstRow<{ total: number }>(db, 'SELECT COUNT(*) AS total FROM feedback_sessions WHERE user_id = ?', [userId]);
  return Number(row?.total ?? 0);
}

export async function findFeedbackSession(db: D1Database, sessionId: string): Promise<FeedbackSessionRow | null> {
  return firstRow<FeedbackSessionRow>(db, 'SELECT * FROM feedback_sessions WHERE session_id = ?', [sessionId]);
}

export async function createFeedbackSession(
  ctx: AppContext,
  userId: number,
  title: string,
  body: string,
): Promise<{ sessionId: string; createdAt: string }> {
  const count = await countFeedbackSessions(ctx.db, userId);
  if (count >= LIMITS.feedbackSessionsPerUser) {
    throw tooManyRequests(3600, '该用户收到的反馈数量已达上限，请稍后再试');
  }
  const sessionId = randomHex(24);
  const now = nowIso();
  const titleEnc = await encryptString(ctx.secret, title);
  const bodyEnc = await encryptString(ctx.secret, body);
  await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO feedback_sessions (session_id, user_id, title_enc, status, message_count, created_at, updated_at)
         VALUES (?, ?, ?, 'unread', 1, ?, ?)`,
      )
      .bind(sessionId, userId, titleEnc, now, now),
    ctx.db
      .prepare(
        `INSERT INTO feedback_messages (session_id, type, author, body_enc, created_at)
         VALUES (?, 'feedback', 'visitor', ?, ?)`,
      )
      .bind(sessionId, bodyEnc, now),
  ]);
  return { sessionId, createdAt: now };
}

export async function appendFeedbackMessage(
  ctx: AppContext,
  session: FeedbackSessionRow,
  type: FeedbackType,
  author: FeedbackAuthor,
  body: string,
): Promise<FeedbackMessageRow> {
  if (session.message_count >= LIMITS.feedbackMessagesPerSession) {
    throw badRequest('feedback_thread_full', `单个反馈对话最多 ${LIMITS.feedbackMessagesPerSession} 条消息`);
  }
  const now = nowIso();
  const bodyEnc = await encryptString(ctx.secret, body);
  const status: FeedbackStatus = author === 'visitor' ? 'unread' : 'read';
  const inserted = await firstRow<FeedbackMessageRow>(
    ctx.db,
    `INSERT INTO feedback_messages (session_id, type, author, body_enc, created_at)
     VALUES (?, ?, ?, ?, ?) RETURNING *`,
    [session.session_id, type, author, bodyEnc, now],
  );
  await runStatement(
    ctx.db,
    `UPDATE feedback_sessions
     SET status = ?, message_count = message_count + 1, updated_at = ?
     WHERE session_id = ?`,
    [status, now, session.session_id],
  );
  if (!inserted) {
    throw new Error('写入反馈消息失败');
  }
  return inserted;
}

export async function listFeedbackMessages(ctx: AppContext, sessionId: string): Promise<FeedbackMessageView[]> {
  const result = await ctx.db
    .prepare('SELECT * FROM feedback_messages WHERE session_id = ? ORDER BY id ASC')
    .bind(sessionId)
    .all<FeedbackMessageRow>();
  const messages: FeedbackMessageView[] = [];
  for (const row of result.results ?? []) {
    messages.push({
      id: row.id,
      type: row.type,
      author: row.author,
      time: formatTime(row.created_at, ctx.tz),
      information: await decryptString(ctx.secret, row.body_enc),
    });
  }
  return messages;
}

export async function getFeedbackThread(
  ctx: AppContext,
  session: FeedbackSessionRow,
  owner: UserRow,
): Promise<FeedbackThreadView> {
  return {
    session_id: session.session_id,
    user_name: owner.username,
    title: await decryptString(ctx.secret, session.title_enc),
    status: session.status,
    message_count: session.message_count,
    created_at: session.created_at,
    created_at_display: formatTime(session.created_at, ctx.tz),
    update_time: formatTime(session.updated_at, ctx.tz),
    updated_at: session.updated_at,
    chat: await listFeedbackMessages(ctx, session.session_id),
  };
}

export async function listFeedbackSessions(
  ctx: AppContext,
  userId: number,
  options: { status?: FeedbackStatus; limit?: number; offset?: number } = {},
): Promise<FeedbackListView[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), LIMITS.feedbackListLimit);
  const offset = Math.max(options.offset ?? 0, 0);
  const statement = options.status
    ? ctx.db
        .prepare(
          `SELECT * FROM feedback_sessions WHERE user_id = ? AND status = ?
           ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
        )
        .bind(userId, options.status, limit, offset)
    : ctx.db
        .prepare(
          `SELECT * FROM feedback_sessions WHERE user_id = ?
           ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
        )
        .bind(userId, limit, offset);
  const result = await statement.all<FeedbackSessionRow>();
  const items: FeedbackListView[] = [];
  for (const row of result.results ?? []) {
    items.push({
      session_id: row.session_id,
      title: await decryptString(ctx.secret, row.title_enc),
      status: row.status,
      message_count: row.message_count,
      created_at: row.created_at,
      created_at_display: formatTime(row.created_at, ctx.tz),
      update_time: formatTime(row.updated_at, ctx.tz),
      updated_at: row.updated_at,
    });
  }
  return items;
}

export async function markFeedbackRead(db: D1Database, userId: number, sessionId: string): Promise<void> {
  const changes = await runStatement(
    db,
    `UPDATE feedback_sessions SET status = 'read' WHERE session_id = ? AND user_id = ? AND status = 'unread'`,
    [sessionId, userId],
  );
  if (changes === 0) {
    const session = await findFeedbackSession(db, sessionId);
    if (!session || session.user_id !== userId) {
      throw notFound('feedback_not_found', '反馈不存在');
    }
  }
}

export async function deleteFeedbackSession(db: D1Database, userId: number, sessionId: string): Promise<void> {
  const owned = await firstRow<{ session_id: string }>(
    db,
    'SELECT session_id FROM feedback_sessions WHERE session_id = ? AND user_id = ?',
    [sessionId, userId],
  );
  if (!owned) {
    throw notFound('feedback_not_found', '反馈不存在');
  }
  // 显式删除消息，不依赖外键级联是否开启。
  await db.batch([
    db.prepare('DELETE FROM feedback_messages WHERE session_id = ?').bind(sessionId),
    db.prepare('DELETE FROM feedback_sessions WHERE session_id = ? AND user_id = ?').bind(sessionId, userId),
  ]);
}

export async function updateFeedbackSettings(
  ctx: AppContext,
  userId: number,
  settings: { enabled?: boolean; intro?: string | null },
): Promise<{ enabled: boolean; intro: string }> {
  const current = await firstRow<UserRow>(ctx.db, 'SELECT * FROM users WHERE id = ?', [userId]);
  if (!current) {
    throw notFound('user_not_found', '用户不存在');
  }
  const enabled = settings.enabled ?? current.feedback_enabled === 1;
  let introEnc = current.feedback_intro_enc;
  if (settings.intro !== undefined) {
    const trimmed = (settings.intro ?? '').trim();
    introEnc = trimmed ? await encryptString(ctx.secret, trimmed) : null;
  }
  await runStatement(ctx.db, 'UPDATE users SET feedback_enabled = ?, feedback_intro_enc = ?, updated_at = ? WHERE id = ?', [
    enabled ? 1 : 0,
    introEnc,
    nowIso(),
    userId,
  ]);
  const intro = introEnc ? await decryptString(ctx.secret, introEnc) : '';
  return { enabled, intro };
}

export async function getFeedbackProfile(
  ctx: AppContext,
  user: UserRow,
): Promise<{ enabled: boolean; intro: string }> {
  return {
    enabled: user.feedback_enabled === 1,
    intro: user.feedback_intro_enc ? await decryptString(ctx.secret, user.feedback_intro_enc) : '',
  };
}
