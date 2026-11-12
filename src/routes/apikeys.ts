import { createApiKey, deleteApiKey, listApiKeys } from '../data/apikeys.ts';
import { requireUser } from '../auth/session.ts';
import { rateLimit } from '../auth/ratelimit.ts';
import type { AppContext } from '../env.ts';
import { intParam, ok, stringParam, type Params } from '../lib/http.ts';
import { LIMITS } from '../lib/validate.ts';

export async function listKeys(ctx: AppContext, request: Request): Promise<Response> {
  const session = await requireUser(ctx, request);
  return ok({ api_keys: await listApiKeys(ctx, session.user.id) });
}

export async function createKey(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const session = await requireUser(ctx, request);
  await rateLimit(ctx, `apikey:create:${session.user.id}`, 20, 3600);
  const name = stringParam(params, 'name', { max: LIMITS.apiKeyNameMax, label: 'API Key 名称' });
  return ok({ api_key: await createApiKey(ctx, session.user.id, name) });
}

export async function removeKey(ctx: AppContext, request: Request, params: Params): Promise<Response> {
  const session = await requireUser(ctx, request);
  const id = intParam(params, 'id', { min: 1, label: 'API Key ID' });
  await deleteApiKey(ctx.db, session.user.id, id);
  return ok({ deleted: true });
}
