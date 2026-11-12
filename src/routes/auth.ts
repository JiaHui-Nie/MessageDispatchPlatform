import { countAdmins, authenticate, createUserWithPassword, findUserById, requireNewUsername, toPublicUser, updateUserPassword, assertPasswordChangeAllowed } from '../data/users.ts';
import { claimRegistrationCode, releaseRegistrationCode } from '../data/registration.ts';
import { requireUser, buildClearSessionCookie, buildSessionCookie, issueSessionToken } from '../auth/session.ts';
import { rateLimit } from '../auth/ratelimit.ts';
import type { AppContext } from '../env.ts';
import { hashPassword, verifyPassword } from '../lib/crypto.ts';
import { badRequest, conflict } from '../lib/errors.ts';
import { clientIp, ok, stringParam, type Params } from '../lib/http.ts';
import { LIMITS, normalizeUsername, validatePassword, validateUsername } from '../lib/validate.ts';

export async function setup(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  await rateLimit(ctx, `setup:ip:${clientIp(request)}`, 10, 3600);
  const password = stringParam(params, 'password', { max: LIMITS.passwordMax, trim: false, label: '管理员密码' });
  validatePassword(password);
  if ((await countAdmins(ctx.db)) > 0) {
    throw conflict('already_setup', '管理员已初始化，请直接登录');
  }
  const user = await createUserWithPassword(ctx.db, {
    username: 'admin',
    password,
    role: 'admin',
    iterations: ctx.passwordIterations,
  });
  const token = await issueSessionToken(ctx, user);
  return ok({ user: toPublicUser(user, ctx.tz) }, { 'set-cookie': buildSessionCookie(ctx, request, token) });
}

export async function login(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const username = normalizeUsername(stringParam(params, 'username', { max: LIMITS.usernameMax, label: '用户名' }));
  const password = stringParam(params, 'password', { max: LIMITS.passwordMax, trim: false, label: '密码' });
  await rateLimit(ctx, `login:ip:${clientIp(request)}`, 30, 300);
  await rateLimit(ctx, `login:user:${username}`, 10, 300);
  const result = await authenticate(
    ctx.db,
    { username, password, iterations: ctx.passwordIterations },
    (user) => issueSessionToken(ctx, user),
  );
  return ok({ user: toPublicUser(result.user, ctx.tz) }, { 'set-cookie': buildSessionCookie(ctx, request, result.token) });
}

export async function logout(_ctx: AppContext, request: Request): Promise<Response> {
  return ok({ message: '已退出登录' }, { 'set-cookie': buildClearSessionCookie(request) });
}

export async function register(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const { username, displayName } = validateUsername(stringParam(params, 'username', { max: LIMITS.usernameMax }));
  const password = stringParam(params, 'password', { max: LIMITS.passwordMax, trim: false, label: '密码' });
  const code = stringParam(params, 'code', { max: 64, label: '注册码' });
  validatePassword(password);

  await rateLimit(ctx, `register:ip:${clientIp(request)}`, 20, 3600);
  await rateLimit(ctx, `register:name:${username}`, 10, 3600);
  await requireNewUsername(ctx.db, username);

  const claimed = await claimRegistrationCode(ctx, code, username);
  try {
    const user = await createUserWithPassword(ctx.db, {
      username,
      password,
      role: 'user',
      iterations: ctx.passwordIterations,
    });
    const token = await issueSessionToken(ctx, user);
    return ok(
      { user: toPublicUser(user, ctx.tz), display_name: displayName },
      { 'set-cookie': buildSessionCookie(ctx, request, token) },
    );
  } catch (error) {
    await releaseRegistrationCode(ctx.db, claimed.id);
    throw error;
  }
}

export async function me(ctx: AppContext, request: Request): Promise<Response> {
  const session = await requireUser(ctx, request);
  return ok({ user: toPublicUser(session.user, ctx.tz) });
}

export async function changePassword(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const session = await requireUser(ctx, request);
  const currentPassword = stringParam(params, 'current_password', { max: LIMITS.passwordMax, trim: false, label: '当前密码' });
  const newPassword = stringParam(params, 'new_password', { max: LIMITS.passwordMax, trim: false, label: '新密码' });
  assertPasswordChangeAllowed(currentPassword, newPassword);
  await rateLimit(ctx, `password:user:${session.user.id}`, 10, 3600);

  const valid = await verifyPassword(currentPassword, session.user.password_hash);
  if (!valid) {
    throw badRequest('invalid_password', '当前密码不正确');
  }
  const passwordHash = await hashPassword(newPassword, ctx.passwordIterations);
  await updateUserPassword(ctx.db, session.user.id, passwordHash);
  const refreshed = await findUserById(ctx.db, session.user.id);
  if (!refreshed) {
    throw badRequest('invalid_user', '用户不存在');
  }
  const token = await issueSessionToken(ctx, refreshed);
  return ok(
    { message: '密码已更新，其他设备的登录状态已失效' },
    { 'set-cookie': buildSessionCookie(ctx, request, token) },
  );
}

export async function updateProfile(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const session = await requireUser(ctx, request);
  const displayName = stringParam(params, 'display_name', { max: LIMITS.usernameMax, label: '显示名称' });
  await ctx.db.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').bind(displayName, new Date().toISOString(), session.user.id).run();
  return ok({ display_name: displayName });
}
