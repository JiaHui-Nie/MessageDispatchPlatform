import { getUserStats } from '../data/stats.ts';
import { listFeedbackSessions } from '../data/feedback.ts';
import { toPublicUser } from '../data/users.ts';
import { getFeedbackProfile } from '../data/feedback.ts';
import { requireUser } from '../auth/session.ts';
import type { AppContext } from '../env.ts';
import { ok } from '../lib/http.ts';

/** 个人主页“总览”：账号信息 + 统计 + 最近收到的反馈。 */
export async function overview(ctx: AppContext, request: Request): Promise<Response> {
  const session = await requireUser(ctx, request);
  const [stats, recent, feedbackProfile] = await Promise.all([
    getUserStats(ctx, session.user.id),
    listFeedbackSessions(ctx, session.user.id, { limit: 5 }),
    getFeedbackProfile(ctx, session.user),
  ]);
  return ok({
    user: toPublicUser(session.user, ctx.tz),
    stats,
    recent,
    feedback: feedbackProfile,
    feedback_link: `/#/f/${encodeURIComponent(session.user.username)}`,
    api_base: new URL(request.url).origin,
  });
}
