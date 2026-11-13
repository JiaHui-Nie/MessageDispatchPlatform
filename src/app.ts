import type { AppContext, Env } from './env.ts';
import { createContext } from './env.ts';
import { ensureSchema } from './db/d1.ts';
import { ApiError } from './lib/errors.ts';
import { assertSameOrigin, errorResponse, jsonResponse, queryParams, readParams, type HttpMethod, type Params } from './lib/http.ts';
import { healthHandler, statusHandler } from './routes/system.ts';
import * as auth from './routes/auth.ts';
import * as apiKeys from './routes/apikeys.ts';
import * as information from './routes/information.ts';
import * as feedback from './routes/feedback.ts';
import * as admin from './routes/admin.ts';
import * as files from './routes/files.ts';
import { overview } from './routes/overview.ts';

export type Handler = (ctx: AppContext, request: Request, params: Params) => Promise<Response>;

interface RouteDef {
  method: HttpMethod;
  path: string;
  handler: Handler;
  /** 为 true 时不预读请求体，由 handler 自行解析（文件上传）。 */
  rawBody?: boolean;
}

interface DynamicRouteDef {
  method: HttpMethod;
  pattern: RegExp;
  handler: Handler;
}

const ROUTES: RouteDef[] = [
  { method: 'POST', path: '/api/auth/setup', handler: auth.setup },  { method: 'POST', path: '/api/auth/login', handler: auth.login },
  { method: 'POST', path: '/api/auth/logout', handler: auth.logout },
  { method: 'POST', path: '/api/auth/register', handler: auth.register },
  { method: 'POST', path: '/api/auth/me', handler: auth.me },
  { method: 'POST', path: '/api/auth/password', handler: auth.changePassword },
  { method: 'POST', path: '/api/auth/profile', handler: auth.updateProfile },

  { method: 'POST', path: '/api/apikeys/list', handler: apiKeys.listKeys },
  { method: 'POST', path: '/api/apikeys/create', handler: apiKeys.createKey },
  { method: 'POST', path: '/api/apikeys/delete', handler: apiKeys.removeKey },

  { method: 'POST', path: '/api/setinformation', handler: information.setInformation },
  { method: 'POST', path: '/api/getinformation', handler: information.getInformation },
  { method: 'POST', path: '/api/deleteinformation', handler: information.deleteInformationRoute },
  { method: 'POST', path: '/api/information/list', handler: information.listInformationRoute },
  { method: 'POST', path: '/api/information/visibility', handler: information.updateInformationVisibility },

  { method: 'POST', path: '/api/sendfeedback', handler: feedback.sendFeedback },
  { method: 'POST', path: '/api/sendfeedbackbysessionid', handler: feedback.sendFeedbackBySession },
  // 兼容文档中的拼写错误。
  { method: 'POST', path: '/api/sendfeefbackbysessionid', handler: feedback.sendFeedbackBySession },
  { method: 'POST', path: '/api/getfeedbackbysessionid', handler: feedback.getFeedbackBySession },
  { method: 'POST', path: '/api/getfeedbacklist', handler: feedback.getFeedbackList },
  { method: 'POST', path: '/api/deletefeedback', handler: feedback.deleteFeedbackRoute },
  { method: 'POST', path: '/api/feedback/list', handler: feedback.feedbackListUi },
  { method: 'POST', path: '/api/feedback/get', handler: feedback.feedbackGetUi },
  { method: 'POST', path: '/api/feedback/reply', handler: feedback.feedbackReplyUi },
  { method: 'POST', path: '/api/feedback/read', handler: feedback.feedbackReadUi },
  { method: 'POST', path: '/api/feedback/delete', handler: feedback.feedbackDeleteUi },
  { method: 'POST', path: '/api/feedback/settings', handler: feedback.feedbackSettingsUi },
  { method: 'POST', path: '/api/public/profile', handler: feedback.publicFeedbackProfile },

  { method: 'POST', path: '/api/admin/stats', handler: admin.stats },
  { method: 'POST', path: '/api/admin/codes/create', handler: admin.codesCreate },
  { method: 'POST', path: '/api/admin/codes/list', handler: admin.codesList },
  { method: 'POST', path: '/api/admin/codes/revoke', handler: admin.codesRevoke },
  { method: 'POST', path: '/api/admin/users/list', handler: admin.usersList },
  { method: 'POST', path: '/api/admin/users/delete', handler: admin.usersDelete },
  { method: 'POST', path: '/api/admin/users/reset-password', handler: admin.usersResetPassword },

  { method: 'POST', path: '/api/overview', handler: overview },

  { method: 'POST', path: '/api/uploadfile', handler: files.uploadFile, rawBody: true },
  { method: 'POST', path: '/api/downloadfile', handler: files.downloadFile },
  { method: 'GET', path: '/api/downloadfile', handler: files.downloadFile },
  { method: 'HEAD', path: '/api/downloadfile', handler: files.downloadFile },
  { method: 'POST', path: '/api/deletefile', handler: files.deleteFileRoute },
  { method: 'POST', path: '/api/files/list', handler: files.listFilesRoute },
  { method: 'POST', path: '/api/files/presign', handler: files.presignUpload },
  { method: 'POST', path: '/api/files/complete', handler: files.completeUpload },
  { method: 'POST', path: '/api/files/visibility', handler: files.updateFileVisibility },
  { method: 'POST', path: '/api/files/delete', handler: files.deleteFileUi },

  { method: 'POST', path: '/api/admin/storage', handler: admin.storageSettings },
  { method: 'POST', path: '/api/admin/users/storage', handler: admin.usersStorage },
];

const DYNAMIC_ROUTES: DynamicRouteDef[] = [
  // 文档中的 `/setinformation?/{username}?`：兼容把用户名放在路径里的写法。
  { method: 'POST', pattern: /^\/api\/setinformation\/([^/]+)\/?$/, handler: information.setInformation },
];

const routeTable = new Map<string, Map<HttpMethod, Handler>>();
const rawBodyPaths = new Set<string>();
for (const route of ROUTES) {
  let methods = routeTable.get(route.path);
  if (!methods) {
    methods = new Map();
    routeTable.set(route.path, methods);
  }
  methods.set(route.method, route.handler);
  if (route.rawBody) {
    rawBodyPaths.add(route.path);
  }
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.replace(/\/+$/, '') || '/';
  }
  return pathname;
}

interface ResolvedRoute {
  handler: Handler;
  pathParams?: Params;
}

function resolveRoute(method: string, pathname: string): ResolvedRoute | { allowed: string[] } | null {
  const methods = routeTable.get(pathname);
  if (methods) {
    const handler = methods.get(method as HttpMethod);
    if (handler) {
      return { handler };
    }
    return { allowed: [...methods.keys()] };
  }
  for (const dynamic of DYNAMIC_ROUTES) {
    const match = dynamic.pattern.exec(pathname);
    if (match) {
      if (dynamic.method !== method) {
        return { allowed: [dynamic.method] };
      }
      let username = '';
      try {
        username = decodeURIComponent(match[1] ?? '');
      } catch {
        throw new ApiError(400, 'invalid_username', '路径中的用户名不合法');
      }
      return { handler: dynamic.handler, pathParams: { user_name: username } };
    }
  }
  return null;
}

/**
 * Worker 入口逻辑：
 * - `/api/*` 由 Worker 处理（静态资源通过 assets.run_worker_first 配置优先交给 Worker）；
 * - 其余路径交给静态资源（SPA 回退到 index.html）。
 */
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);

  if (!pathname.startsWith('/api/')) {
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  try {
    if (pathname === '/api/health') {
      if (request.method !== 'GET') {
        throw new ApiError(405, 'method_not_allowed', '该接口只支持 GET');
      }
      return await healthHandler(env);
    }

    // status 必须能在 JWT_SECRET 缺失时也正常返回，供前端展示配置指引。
    if (pathname === '/api/auth/status') {
      if (request.method !== 'POST') {
        return jsonResponse(
          { status: 405, error: 'method_not_allowed', message: '该接口仅支持 POST' },
          405,
          { allow: 'POST' },
        );
      }
      assertSameOrigin(request);
      return await statusHandler(env, request);
    }

    const ctx = createContext(env);
    await ensureSchema(ctx.db);
    assertSameOrigin(request);

    const resolved = resolveRoute(request.method, pathname);
    if (!resolved) {
      return jsonResponse({ status: 404, error: 'not_found', message: '接口不存在' }, 404);
    }
    if ('allowed' in resolved) {
      return jsonResponse(
        { status: 405, error: 'method_not_allowed', message: `该接口仅支持 ${resolved.allowed.join(' / ')}` },
        405,
        { allow: resolved.allowed.join(', ') },
      );
    }

    const params = rawBodyPaths.has(pathname) ? queryParams(request) : await readParams(request);
    if (resolved.pathParams) {
      for (const [key, value] of Object.entries(resolved.pathParams)) {
        if (!params[key]) {
          params[key] = value;
        }
      }
    }
    return await resolved.handler(ctx, request, params);
  } catch (error) {
    return errorResponse(error);
  }
}
