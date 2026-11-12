import { deleteInformation, findInformationRow, listInformation, upsertInformation } from '../data/information.ts';
import { findUserByUsername, type UserRow } from '../data/users.ts';
import { resolveActor } from '../auth/actor.ts';
import { requireUser, currentUser } from '../auth/session.ts';
import { rateLimit } from '../auth/ratelimit.ts';
import type { AppContext } from '../env.ts';
import { decryptString } from '../lib/crypto.ts';
import { forbidden, notFound } from '../lib/errors.ts';
import { boolParam, clientIp, ok, stringParam, type Params } from '../lib/http.ts';
import { formatTime } from '../lib/time.ts';
import { LIMITS, normalizeUsername, validateInfoKey } from '../lib/validate.ts';

/**
 * 解析要操作的目标用户。
 * 接口文档要求传 user_name（第三方调用），网页后台则直接使用登录态；
 * 只提供 api_key 时同样可以定位到 Key 的归属用户。
 */
async function resolveTargetUser(ctx: AppContext, request: Request, params: Params): Promise<UserRow> {
  const rawUserName = (params.user_name ?? '').trim();
  const hasApiKey = (params.api_key ?? '').trim().length > 0;
  if (rawUserName || hasApiKey) {
    const actor = await resolveActor(ctx, request, params, { userName: rawUserName || null });
    return actor.user;
  }
  const session = await requireUser(ctx, request);
  return session.user;
}

/** ① 固定信息分发：写入/更新 key 对应的 value。 */
export async function setInformation(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const user = await resolveTargetUser(ctx, request, params);
  const key = validateInfoKey(stringParam(params, 'key', { max: LIMITS.infoKeyMax + 8, label: 'key' }));
  const value = stringParam(params, 'value', { max: LIMITS.infoValueMax, trim: false, label: 'value' });
  const visible = boolParam(params, 'visible', true);
  await rateLimit(ctx, `information:write:${user.id}`, 200, 600);
  const result = await upsertInformation(ctx, user.id, key, value, visible);
  return ok({
    user_name: user.username,
    key,
    value,
    visible,
    created: result.created,
    count: result.count,
    updated_at: formatTime(result.updatedAt, ctx.tz),
  });
}

/** ② 获取固定信息。visible = 0 的私有信息需要 api_key 或所有者本人登录。 */
export async function getInformation(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const userName = normalizeUsername(stringParam(params, 'user_name', { max: LIMITS.usernameMax, label: '用户名' }));
  const key = validateInfoKey(stringParam(params, 'key', { max: LIMITS.infoKeyMax + 8, label: 'key' }));
  await rateLimit(ctx, `information:read:${clientIp(request)}`, 300, 60);

  const owner = await findUserByUsername(ctx.db, userName);
  if (!owner) {
    throw notFound('user_not_found', '用户不存在');
  }
  const row = await findInformationRow(ctx.db, owner.id, key);
  if (!row) {
    throw notFound('information_not_found', '该 key 对应的信息不存在');
  }
  if (row.visible !== 1) {
    const hasApiKey = (params.api_key ?? '').trim().length > 0;
    const session = await currentUser(ctx, request);
    if (!hasApiKey && !session) {
      throw forbidden('api_key_required', '该信息为私有信息，需要提供该用户的 api_key');
    }
    const actor = await resolveActor(ctx, request, params, { userName });
    if (actor.user.id !== owner.id) {
      throw forbidden('api_key_required', '该信息为私有信息，需要提供该用户的 api_key');
    }
  }
  return ok({
    user_name: owner.username,
    key: row.info_key,
    value: await decryptString(ctx.secret, row.value_enc),
    visible: row.visible === 1,
    updated_at: formatTime(row.updated_at, ctx.tz),
  });
}

/** ⑥ 删除固定信息。 */
export async function deleteInformationRoute(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const user = await resolveTargetUser(ctx, request, params);
  const key = validateInfoKey(stringParam(params, 'key', { max: LIMITS.infoKeyMax + 8, label: 'key' }));
  await deleteInformation(ctx.db, user.id, key);
  return ok({ user_name: user.username, key, deleted: true });
}

/** 网页后台：列出当前用户全部固定信息。 */
export async function listInformationRoute(ctx: AppContext, request: Request): Promise<Response> {
  const session = await requireUser(ctx, request);
  return ok({ information: await listInformation(ctx, session.user.id) });
}

/** 网页后台：更新信息的可见性（等价于 setinformation，保留原 value）。 */
export async function updateInformationVisibility(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const session = await requireUser(ctx, request);
  const key = validateInfoKey(stringParam(params, 'key', { max: LIMITS.infoKeyMax + 8, label: 'key' }));
  const visible = boolParam(params, 'visible', true);
  const row = await findInformationRow(ctx.db, session.user.id, key);
  if (!row) {
    throw notFound('information_not_found', '信息不存在');
  }
  const value = await decryptString(ctx.secret, row.value_enc);
  const result = await upsertInformation(ctx, session.user.id, key, value, visible);
  return ok({ key, visible, updated_at: formatTime(result.updatedAt, ctx.tz) });
}
