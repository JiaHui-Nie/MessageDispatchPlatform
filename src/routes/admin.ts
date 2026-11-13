import { getAdminStats } from '../data/stats.ts';
import { countAdmins, deleteUser, findUserById, listUsersWithStats, updateUserPassword } from '../data/users.ts';
import { createRegistrationCode, listRegistrationCodes, revokeRegistrationCode } from '../data/registration.ts';
import { getDefaultQuota, getPlatformStorage, setDefaultQuota, setUserQuota } from '../data/storage.ts';
import { requireAdmin } from '../auth/session.ts';
import { issueSessionToken, buildSessionCookie } from '../auth/session.ts';
import type { AppContext } from '../env.ts';
import { hashPassword } from '../lib/crypto.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { intParam, ok, optionalString, stringParam, type Params } from '../lib/http.ts';
import { LIMITS, validatePassword } from '../lib/validate.ts';

const MB = 1024 * 1024;

export async function stats(ctx: AppContext, request: Request): Promise<Response> {
  await requireAdmin(ctx, request);
  return ok({ stats: await getAdminStats(ctx) });
}

export async function codesCreate(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const admin = await requireAdmin(ctx, request);
  const label = optionalString(params, 'label', { max: LIMITS.registrationCodeLabelMax, label: '备注' }) ?? '';
  const maxUses = intParam(params, 'max_uses', { min: 1, max: LIMITS.registrationCodeMaxUses, fallback: 1 });
  const expiresInDays = intParam(params, 'expires_in_days', { min: 0, max: LIMITS.registrationCodeExpireDays, fallback: 7 });
  const created = await createRegistrationCode(ctx, admin.user.id, { label, maxUses, expiresInDays });
  return ok({ code: created.code, registration_code: created.view });
}

export async function codesList(ctx: AppContext, request: Request): Promise<Response> {
  await requireAdmin(ctx, request);
  return ok({ registration_codes: await listRegistrationCodes(ctx) });
}

export async function codesRevoke(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  await requireAdmin(ctx, request);
  const id = intParam(params, 'id', { min: 1, label: '注册码 ID' });
  await revokeRegistrationCode(ctx.db, id);
  return ok({ id, revoked: true });
}

export async function usersList(ctx: AppContext, request: Request): Promise<Response> {
  await requireAdmin(ctx, request);
  const defaultQuota = await getDefaultQuota(ctx);
  return ok({
    users: await listUsersWithStats(ctx.db, ctx.tz, defaultQuota),
    default_quota: defaultQuota,
  });
}

/** 平台默认存储空间与总用量（管理员）。 */
export async function storageSettings(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  await requireAdmin(ctx, request);
  if (params.default_quota_mb !== undefined) {
    const quotaMb = intParam(params, 'default_quota_mb', { min: 0, max: 10_240, label: '默认存储空间' });
    await setDefaultQuota(ctx, quotaMb * MB);
  }
  const [defaultQuota, platformStorage] = await Promise.all([getDefaultQuota(ctx), getPlatformStorage(ctx.db)]);
  return ok({
    default_quota: defaultQuota,
    default_quota_mb: Math.round((defaultQuota / MB) * 10) / 10,
    total_used: platformStorage.used,
    file_count: platformStorage.files,
    max_file_size: ctx.maxFileSizeBytes,
  });
}

/** 调整单个已注册用户的存储空间。 */
export async function usersStorage(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  await requireAdmin(ctx, request);
  const id = intParam(params, 'id', { min: 1, label: '用户 ID' });
  const quotaMb = intParam(params, 'quota_mb', { min: 0, max: 10_240, label: '存储空间' });
  const target = await findUserById(ctx.db, id);
  if (!target) {
    throw notFound('user_not_found', '用户不存在');
  }
  return ok({
    id,
    username: target.username,
    storage: await setUserQuota(ctx, id, quotaMb * MB),
    quota_mb: quotaMb,
  });
}

export async function usersDelete(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const admin = await requireAdmin(ctx, request);
  const id = intParam(params, 'id', { min: 1, label: '用户 ID' });
  if (id === admin.user.id) {
    throw badRequest('cannot_delete_self', '不能删除当前登录的管理员账号');
  }
  const target = await findUserById(ctx.db, id);
  if (!target) {
    throw notFound('user_not_found', '用户不存在');
  }
  if (target.role === 'admin' && (await countAdmins(ctx.db)) <= 1) {
    throw badRequest('last_admin', '至少需要保留一个管理员账号');
  }
  await deleteUser(ctx.db, id);
  return ok({ id, deleted: true, username: target.username });
}

export async function usersResetPassword(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const admin = await requireAdmin(ctx, request);
  const id = intParam(params, 'id', { min: 1, label: '用户 ID' });
  const newPassword = stringParam(params, 'new_password', { max: LIMITS.passwordMax, trim: false, label: '新密码' });
  validatePassword(newPassword);
  const target = await findUserById(ctx.db, id);
  if (!target) {
    throw notFound('user_not_found', '用户不存在');
  }
  const passwordHash = await hashPassword(newPassword, ctx.passwordIterations);
  await updateUserPassword(ctx.db, id, passwordHash);

  if (id === admin.user.id) {
    const refreshed = await findUserById(ctx.db, admin.user.id);
    if (!refreshed) {
      throw notFound('user_not_found', '用户不存在');
    }
    const token = await issueSessionToken(ctx, refreshed);
    return ok(
      { id, reset: true, self: true, message: '密码已重置，当前会话已刷新' },
      { 'set-cookie': buildSessionCookie(ctx, request, token) },
    );
  }
  return ok({ id, reset: true, self: false, message: '密码已重置，该用户需要使用新密码重新登录' });
}
