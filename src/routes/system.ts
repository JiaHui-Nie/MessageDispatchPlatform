import { ensureSchema } from '../db/d1.ts';
import { countAdmins, toPublicUser } from '../data/users.ts';
import { currentUser } from '../auth/session.ts';
import { createContext, isSecretConfigured, type Env } from '../env.ts';
import { jsonResponse, ok } from '../lib/http.ts';
import { APP_VERSION } from '../version.ts';

/** 健康检查：不要求 JWT_SECRET 已配置，方便部署后快速定位问题。 */
export async function healthHandler(env: Env): Promise<Response> {
  const secretConfigured = isSecretConfigured(env);
  let database: 'ok' | 'error' = 'error';
  let schemaVersion = 0;
  let needsSetup: boolean | null = null;
  try {
    await env.DB.prepare('SELECT 1 AS ok').first();
    database = 'ok';
  } catch {
    database = 'error';
  }
  if (database === 'ok') {
    try {
      const row = await env.DB.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).first<{ value: string }>();
      schemaVersion = row ? Number.parseInt(row.value, 10) || 0 : 0;
      const adminCount = await env.DB.prepare(`SELECT COUNT(*) AS total FROM users WHERE role = 'admin'`).first<{ total: number }>();
      needsSetup = Number(adminCount?.total ?? 0) === 0;
    } catch {
      // 表还没建立：首次请求会自动建表，这里只报告 schema_version = 0。
      schemaVersion = 0;
      needsSetup = true;
    }
  }
  const healthy = database === 'ok' && secretConfigured;
  return jsonResponse(
    {
      status: healthy ? 200 : 503,
      app: (env.APP_NAME ?? '信息分发平台').trim() || '信息分发平台',
      version: APP_VERSION,
      secret_configured: secretConfigured,
      database,
      schema_version: schemaVersion,
      needs_setup: needsSetup,
      time: new Date().toISOString(),
    },
    healthy ? 200 : 503,
  );
}

/**
 * 前端启动时调用：返回是否需要初始化管理员、当前是否已登录。
 * 即使 JWT_SECRET 未配置也返回 200 + configured:false，让界面能显示明确的修复指引。
 */
export async function statusHandler(env: Env, request: Request): Promise<Response> {
  const appName = (env.APP_NAME ?? '信息分发平台').trim() || '信息分发平台';
  if (!isSecretConfigured(env)) {
    return ok({
      app_name: appName,
      version: APP_VERSION,
      configured: false,
      needs_setup: false,
      authenticated: false,
      message: '服务端缺少 JWT_SECRET，请在 Cloudflare 控制台添加该密钥后重新部署。',
    });
  }
  const ctx = createContext(env);
  await ensureSchema(ctx.db);
  const [adminCount, session] = await Promise.all([countAdmins(ctx.db), currentUser(ctx, request)]);
  return ok({
    app_name: appName,
    version: APP_VERSION,
    configured: true,
    needs_setup: adminCount === 0,
    authenticated: Boolean(session),
    user: session ? toPublicUser(session.user, ctx.tz) : null,
    display_timezone: ctx.tz,
  });
}
