import type { Params } from '../lib/http.ts';
import type { AppContext } from '../env.ts';
import { findApiKeyOwner } from '../data/apikeys.ts';
import type { UserRow } from '../data/users.ts';
import { normalizeUsername } from '../lib/validate.ts';
import { forbidden, unauthorized } from '../lib/errors.ts';import { currentUser } from './session.ts';

export interface Actor {
  user: UserRow;
  via: 'session' | 'api_key';
}

export interface ActorOptions {
  /** 目标用户名，提供时会校验与凭据归属一致，防止越权操作他人数据。 */
  userName?: string | null;
  /** 只允许 API Key（部分接口按文档要求必须携带 api_key）。 */
  apiKeyOnly?: boolean;
}

/**
 * 解析调用者身份：优先 api_key，其次登录 Cookie。
 * 平台接口按文档要求“发布信息时需要 api_key”，但网页后台图形化操作不需要，
 * 因此这里允许两种凭据，并强制校验目标用户名属于调用者本人。
 */
export async function resolveActor(
  ctx: AppContext,
  request: Request,
  params: Params,
  options: ActorOptions = {},
): Promise<Actor> {
  const apiKey = (params.api_key ?? '').trim();
  if (apiKey) {
    const owner = await findApiKeyOwner(ctx, apiKey);
    if (!owner) {
      throw unauthorized('invalid_api_key', 'API Key 无效');
    }
    if (options.userName && owner.user.username !== normalizeUsername(options.userName)) {
      throw forbidden('user_mismatch', 'API Key 与 user_name 不匹配');
    }
    return { user: owner.user, via: 'api_key' };
  }

  if (options.apiKeyOnly) {
    throw unauthorized('api_key_required', '该接口需要提供 api_key');
  }

  const session = await currentUser(ctx, request);
  if (!session) {
    throw unauthorized('auth_required', '请先登录或提供 api_key');
  }
  if (options.userName && session.user.username !== normalizeUsername(options.userName)) {
    throw forbidden('user_mismatch', '无权操作其他用户的数据');
  }
  return { user: session.user, via: 'session' };
}
