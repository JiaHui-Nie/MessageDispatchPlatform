/** 时间工具：数据库统一存 UTC ISO 字符串，对外展示用 DISPLAY_TZ 指定的时区。 */

export function nowIso(): string {
  return new Date().toISOString();
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function addDaysIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** 输出 `YYYY-MM-DD HH:mm`（例如 2026-12-08 13:25），与接口文档示例一致。 */
export function formatTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const pick = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '';
    return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
  } catch {
    // 非法时区时退回 UTC，保证接口始终可用。
    return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}`;
  }
}

/** 相对时间（用于界面展示），例如“3 分钟前”。 */
export function relativeTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) {
    return '';
  }
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) {
    return '';
  }
  const diffSeconds = Math.round((Date.now() - timestamp) / 1000);
  if (diffSeconds < 60) {
    return '刚刚';
  }
  if (diffSeconds < 3600) {
    return `${Math.floor(diffSeconds / 60)} 分钟前`;
  }
  if (diffSeconds < 86400) {
    return `${Math.floor(diffSeconds / 3600)} 小时前`;
  }
  if (diffSeconds < 86400 * 7) {
    return `${Math.floor(diffSeconds / 86400)} 天前`;
  }
  return formatTime(iso, timeZone);
}
