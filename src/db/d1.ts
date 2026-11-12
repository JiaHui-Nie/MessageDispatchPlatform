import { nowIso } from '../lib/time.ts';
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema.generated.ts';

/** D1 通用查询工具。所有 SQL 都使用参数绑定，避免注入。 */

export type SqlParam = string | number | null;

export async function allRows<T>(db: D1Database, sql: string, params: SqlParam[] = []): Promise<T[]> {
  const statement = db.prepare(sql);
  const bound = params.length > 0 ? statement.bind(...params) : statement;
  const result = await bound.all<T>();
  return (result.results ?? []) as T[];
}

export async function firstRow<T>(db: D1Database, sql: string, params: SqlParam[] = []): Promise<T | null> {
  const statement = db.prepare(sql);
  const bound = params.length > 0 ? statement.bind(...params) : statement;
  const row = await bound.first<T>();
  return row ?? null;
}

export async function runStatement(db: D1Database, sql: string, params: SqlParam[] = []): Promise<number> {
  const statement = db.prepare(sql);
  const bound = params.length > 0 ? statement.bind(...params) : statement;
  const result = await bound.run();
  return Number(result.meta?.changes ?? 0);
}

const schemaReady = new WeakMap<D1Database, Promise<void>>();

/**
 * 保证表结构存在。
 *
 * 通过 `wrangler d1 migrations apply` 部署时表已经建好，这里只会多一次按 isolate 缓存的
 * SELECT；如果使用 “Deploy to Cloudflare” 一键部署而没有跑迁移，首次请求会自动建表，
 * 让新手也能直接用一个可用的实例。
 */
export function ensureSchema(db: D1Database): Promise<void> {
  const cached = schemaReady.get(db);
  if (cached) {
    return cached;
  }
  const pending = applySchemaIfNeeded(db);
  schemaReady.set(db, pending);
  pending.catch(() => schemaReady.delete(db));
  return pending;
}

async function readSchemaVersion(db: D1Database): Promise<number> {
  try {
    const row = await firstRow<{ value: string }>(db, `SELECT value FROM meta WHERE key = 'schema_version'`);
    return row ? Number.parseInt(row.value, 10) || 0 : 0;
  } catch {
    // meta 表还不存在
    return -1;
  }
}

async function applySchemaIfNeeded(db: D1Database): Promise<void> {
  const current = await readSchemaVersion(db);
  if (current >= SCHEMA_VERSION) {
    return;
  }
  const statements = [
    ...SCHEMA_STATEMENTS,
    `INSERT INTO meta (key, value, updated_at) VALUES ('schema_version', '${SCHEMA_VERSION}', '${nowIso()}')
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ];
  await db.batch(statements.map((sql) => db.prepare(sql)));
}
