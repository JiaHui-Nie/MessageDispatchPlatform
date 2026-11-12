import { parseCookies, serializeCookie } from '../lib/cookies.ts';
import { signSessionToken, verifySessionToken, type SessionClaims } from '../lib/crypto.ts';
import { forbidden, unauthorized } from '../lib/errors.ts';
import { nowSeconds } from '../lib/time.ts';
import type { AppContext } from '../env.ts';
import { findUserById, mapUser, type UserRow } from '../data/users.ts';

export const SESSION_COOKIE = 'mdp_session';

export interface SessionUser {
  user: UserRow;
  claims: SessionClaims;
}

function readSessionToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization && /^bearer\s+/i.test(authorization)) {
    const token = authorization.replace(/^bearer\s+/i, '').trim();
    if (token) {
      return token;
    }
  }
  const cookie = parseCookies(request.headers.get('cookie')).get(SESSION_COOKIE);
  return cookie && cookie.length > 0 ? cookie : null;
}

/** 生产环境总是 https；本地 wrangler dev 是 http，此时不能加 Secure，否则浏览器不会保存 Cookie。 */
function useSecureCookie(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

export async function issueSessionToken(ctx: AppContext, user: UserRow): Promise<string> {
  const now = nowSeconds();
  const claims: SessionClaims = {
    sub: user.id,
    name: user.username,
    role: user.role,
    ver: user.token_version,
    iat: now,
    exp: now + ctx.sessionTtlSeconds,
  };
  return signSessionToken(ctx.secret, claims);
}

export function buildSessionCookie(ctx: AppContext, request: Request, token: string): string {
  return serializeCookie(SESSION_COOKIE, token, {
    maxAge: ctx.sessionTtlSeconds,
    path: '/',
    httpOnly: true,
    secure: useSecureCookie(request),
    sameSite: 'Strict',
  });
}

export function buildClearSessionCookie(request: Request): string {
  return serializeCookie(SESSION_COOKIE, '', {
    maxAge: 0,
    path: '/',
    httpOnly: true,
    secure: useSecureCookie(request),
    sameSite: 'Strict',
  });
}

/**
 * 解析当前登录用户。
 * JWT 只是凭据，真正的角色与 token_version 从 D1 读取：
 * 修改密码、删除用户后旧 token 立即失效。
 */
export async function currentUser(ctx: AppContext, request: Request): Promise<SessionUser | null> {
  const token = readSessionToken(request);
  if (!token) {
    return null;
  }
  const claims = await verifySessionToken(ctx.secret, token);
  if (!claims) {
    return null;
  }
  const row = await findUserById(ctx.db, claims.sub);
  if (!row) {
    return null;
  }
  if (row.token_version !== claims.ver) {
    return null;
  }
  return { user: mapUser(row), claims };
}

export async function requireUser(ctx: AppContext, request: Request): Promise<SessionUser> {
  const session = await currentUser(ctx, request);
  if (!session) {
    throw unauthorized('auth_required', '登录状态已失效，请重新登录');
  }
  return session;
}

export async function requireAdmin(ctx: AppContext, request: Request): Promise<SessionUser> {
  const session = await requireUser(ctx, request);
  if (session.user.role !== 'admin') {
    throw forbidden('admin_required', '该操作需要管理员权限');
  }
  return session;
}
