import {
  appendFeedbackMessage,
  countFeedbackSessions,
  createFeedbackSession,
  deleteFeedbackSession,
  findFeedbackSession,
  getFeedbackProfile,
  getFeedbackThread,
  listFeedbackSessions,
  markFeedbackRead,
  summarizeTitle,
  updateFeedbackSettings,
  type FeedbackAuthor,
  type FeedbackSessionRow,
  type FeedbackStatus,
  type FeedbackType,
} from '../data/feedback.ts';
import { findApiKeyOwner } from '../data/apikeys.ts';
import { findUserById, findUserByUsername, type UserRow } from '../data/users.ts';
import { resolveActor } from '../auth/actor.ts';
import { requireUser } from '../auth/session.ts';
import { rateLimit } from '../auth/ratelimit.ts';
import type { AppContext } from '../env.ts';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.ts';
import { boolParam, clientIp, intParam, ok, optionalString, stringParam, type Params } from '../lib/http.ts';
import { formatTime } from '../lib/time.ts';
import { LIMITS, normalizeUsername } from '../lib/validate.ts';

function parseStatus(params: Params): FeedbackStatus | undefined {
  const raw = (params.status ?? '').trim().toLowerCase();
  if (!raw || raw === 'all') {
    return undefined;
  }
  if (raw === 'unread' || raw === 'read') {
    return raw;
  }
  throw badRequest('invalid_status', 'status 只能是 unread 或 read');
}

async function loadOwnedSession(
  ctx: AppContext,
  request: Request,
  params: Params,
): Promise<{ session: FeedbackSessionRow; user: UserRow }> {
  const current = await requireUser(ctx, request);
  const sessionId = stringParam(params, 'session_id', { min: 8, max: 128, label: 'session_id' });
  const row = await findFeedbackSession(ctx.db, sessionId);
  if (!row || row.user_id !== current.user.id) {
    throw notFound('feedback_not_found', '反馈不存在');
  }
  return { session: row, user: current.user };
}

/** ③ 任何人都可以提交反馈（接收者必须已开启反馈开关）。 */
export async function sendFeedback(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const userName = normalizeUsername(stringParam(params, 'user_name', { max: LIMITS.usernameMax, label: '用户名' }));
  const feedback = stringParam(params, 'feedback', { max: LIMITS.feedbackMax, label: '反馈内容' });
  const titleParam = optionalString(params, 'title', { max: LIMITS.feedbackTitleMax, label: '标题' });

  await rateLimit(ctx, `feedback:ip:${clientIp(request)}`, 20, 600);
  const owner = await findUserByUsername(ctx.db, userName);
  if (!owner) {
    throw notFound('user_not_found', '用户不存在');
  }
  if (owner.feedback_enabled !== 1) {
    throw forbidden('feedback_disabled', '该用户暂未开启反馈功能');
  }
  await rateLimit(ctx, `feedback:owner:${owner.id}`, 120, 3600);

  const title = titleParam ?? summarizeTitle(feedback);
  const session = await createFeedbackSession(ctx, owner.id, title, feedback);
  return ok({
    session_id: session.sessionId,
    user_name: owner.username,
    title,
    created_at: formatTime(session.createdAt, ctx.tz),
    update_time: formatTime(session.createdAt, ctx.tz),
  });
}

/** 追加回复：带 api_key 视为接收者回复，否则视为访客补充。 */
export async function sendFeedbackBySession(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const sessionId = stringParam(params, 'session_id', { min: 8, max: 128, label: 'session_id' });
  const feedback = stringParam(params, 'feedback', { max: LIMITS.feedbackMax, label: '反馈内容' });
  await rateLimit(ctx, `feedback:ip:${clientIp(request)}`, 30, 600);

  const session = await findFeedbackSession(ctx.db, sessionId);
  if (!session) {
    throw notFound('feedback_not_found', '反馈会话不存在或已被删除');
  }
  await rateLimit(ctx, `feedback:session:${sessionId}`, 60, 600);

  let type: FeedbackType = 'feedback';
  let author: FeedbackAuthor = 'visitor';
  const apiKey = (params.api_key ?? '').trim();
  if (apiKey) {
    const owner = await findApiKeyOwner(ctx, apiKey);
    if (!owner || owner.user.id !== session.user_id) {
      throw unauthorized('invalid_api_key', 'API Key 无效或不属于该反馈的接收者');
    }
    type = 'reply';
    author = 'owner';
  }

  const message = await appendFeedbackMessage(ctx, session, type, author, feedback);
  return ok({
    session_id: sessionId,
    type,
    time: formatTime(message.created_at, ctx.tz),
    message_id: message.id,
  });
}

/** ④ 通过 session_id 获取完整对话。 */
export async function getFeedbackBySession(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const sessionId = stringParam(params, 'session_id', { min: 8, max: 128, label: 'session_id' });
  await rateLimit(ctx, `feedback:read:${clientIp(request)}`, 120, 600);
  const session = await findFeedbackSession(ctx.db, sessionId);
  if (!session) {
    throw notFound('feedback_not_found', '反馈会话不存在或已被删除');
  }
  const owner = await findUserById(ctx.db, session.user_id);
  if (!owner) {
    throw notFound('feedback_not_found', '反馈会话的接收者已不存在');
  }
  return ok({ ...(await getFeedbackThread(ctx, session, owner)) });
}

/** ⑤ 获取某个用户收到的反馈清单，第三方调用需要 api_key。 */
export async function getFeedbackList(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const userName = normalizeUsername(stringParam(params, 'user_name', { max: LIMITS.usernameMax, label: '用户名' }));
  const actor = await resolveActor(ctx, request, params, { userName });
  await rateLimit(ctx, `feedback:list:${actor.user.id}`, 120, 600);
  const items = await listFeedbackSessions(ctx, actor.user.id, { status: parseStatus(params), limit: 100 });
  return ok({ user_name: actor.user.username, feedback: items, count: items.length });
}

/** ⑦ 删除反馈。文档中写的是 key，实际语义是 session_id，这里两者都兼容。 */
export async function deleteFeedbackRoute(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const userName = normalizeUsername(stringParam(params, 'user_name', { max: LIMITS.usernameMax, label: '用户名' }));
  const actor = await resolveActor(ctx, request, params, { userName });
  const sessionId = (params.session_id ?? params.key ?? '').trim();
  if (!sessionId) {
    throw badRequest('missing_session_id', '缺少参数 session_id');
  }
  await rateLimit(ctx, `feedback:delete:${actor.user.id}`, 120, 600);
  await deleteFeedbackSession(ctx.db, actor.user.id, sessionId);
  return ok({ session_id: sessionId, deleted: true });
}

/** 网页后台：反馈清单 + 数量统计。 */
export async function feedbackListUi(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const current = await requireUser(ctx, request);
  const status = parseStatus(params);
  const limit = intParam(params, 'limit', { min: 1, max: LIMITS.feedbackListLimit, fallback: 100 });
  const offset = intParam(params, 'offset', { min: 0, max: 100_000, fallback: 0 });
  const [items, all, unread, read, settings] = await Promise.all([
    listFeedbackSessions(ctx, current.user.id, { status, limit, offset }),
    countFeedbackSessions(ctx.db, current.user.id),
    countFeedbackSessions(ctx.db, current.user.id, 'unread'),
    countFeedbackSessions(ctx.db, current.user.id, 'read'),
    getFeedbackProfile(ctx, current.user),
  ]);
  return ok({ feedback: items, counts: { all, unread, read }, settings });
}

/** 网页后台：读取单个会话详情（默认同时标为已读）。 */
export async function feedbackGetUi(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const { session: row, user } = await loadOwnedSession(ctx, request, params);
  const markRead = boolParam(params, 'mark_read', true);
  if (markRead && row.status === 'unread') {
    await markFeedbackRead(ctx.db, user.id, row.session_id);
    row.status = 'read';
  }
  return ok({ ...(await getFeedbackThread(ctx, row, user)) });
}

/** 网页后台：接收者回复。 */
export async function feedbackReplyUi(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const { session: row, user } = await loadOwnedSession(ctx, request, params);
  const message = stringParam(params, 'message', { max: LIMITS.feedbackMax, label: '回复内容' });
  await rateLimit(ctx, `feedback:reply:${user.id}`, 300, 600);
  const saved = await appendFeedbackMessage(ctx, row, 'reply', 'owner', message);
  return ok({
    session_id: row.session_id,
    message_id: saved.id,
    time: formatTime(saved.created_at, ctx.tz),
    status: 'read',
  });
}

export async function feedbackReadUi(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const { session: row, user } = await loadOwnedSession(ctx, request, params);
  await markFeedbackRead(ctx.db, user.id, row.session_id);
  return ok({ session_id: row.session_id, status: 'read' });
}

export async function feedbackDeleteUi(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const { session: row, user } = await loadOwnedSession(ctx, request, params);
  await deleteFeedbackSession(ctx.db, user.id, row.session_id);
  return ok({ session_id: row.session_id, deleted: true });
}

/** 网页后台：开启/关闭反馈，并设置公开页面上的说明文字。 */
export async function feedbackSettingsUi(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const current = await requireUser(ctx, request);
  const enabled = params.enabled === undefined ? undefined : boolParam(params, 'enabled', false);
  let intro: string | null | undefined;
  if (params.intro !== undefined) {
    const raw = params.intro.trim();
    intro = raw === '' ? null : stringParam(params, 'intro', { max: 500, label: '反馈说明' });
  }
  if (enabled === undefined && intro === undefined) {
    throw badRequest('nothing_to_update', '请提供 enabled 或 intro');
  }
  const settings = await updateFeedbackSettings(ctx, current.user.id, { enabled, intro });
  return ok({ enabled: settings.enabled, intro: settings.intro });
}

/** 公开页面：查询某个用户是否开放反馈，以及展示名称/说明。 */
export async function publicFeedbackProfile(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const userName = normalizeUsername(stringParam(params, 'user_name', { max: LIMITS.usernameMax, label: '用户名' }));
  await rateLimit(ctx, `feedback:profile:${clientIp(request)}`, 60, 600);
  const owner = await findUserByUsername(ctx.db, userName);
  if (!owner) {
    return ok({ exists: false, enabled: false, user_name: userName, display_name: '', intro: '' });
  }
  const profile = await getFeedbackProfile(ctx, owner);
  return ok({
    exists: true,
    user_name: owner.username,
    display_name: owner.display_name,
    enabled: profile.enabled,
    intro: profile.intro,
  });
}
