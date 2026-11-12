import { firstRow, runStatement } from '../db/d1.ts';
import { tooManyRequests } from '../lib/errors.ts';
import type { AppContext } from '../env.ts';

/**
 * 基于 D1 的固定窗口限流。
 *
 * 同一窗口内使用 `INSERT ... ON CONFLICT DO UPDATE ... RETURNING hits` 原子自增，
 * 即使多个 isolate 并发也只会有一个请求拿到准确的计数。
 */
export async function rateLimit(
  ctx: AppContext,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  if (ctx.rateLimitDisabled) {
    return;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  const key = `${bucket}|${windowStart}`;
  const row = await firstRow<{ hits: number }>(
    ctx.db,
    `INSERT INTO rate_limits (bucket, hits, window_start) VALUES (?, 1, ?)
     ON CONFLICT (bucket) DO UPDATE SET hits = hits + 1, window_start = excluded.window_start
     RETURNING hits`,
    [key, windowStart],
  );
  const hits = Number(row?.hits ?? 1);
  if (hits > limit) {
    const retryAfter = Math.max(1, windowStart + windowSeconds - nowSeconds);
    throw tooManyRequests(retryAfter, `操作过于频繁，请 ${retryAfter} 秒后再试`);
  }
  // 低概率清理过期的窗口，避免 rate_limits 表无限增长。
  if (Math.random() < 0.03) {
    await runStatement(ctx.db, 'DELETE FROM rate_limits WHERE window_start < ?', [nowSeconds - 3600]);
  }
}
