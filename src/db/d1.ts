import { nowIso } from '../lib/time.ts';
import { SCHEMA_MIGRATIONS, SCHEMA_VERSION } from './schema.generated.ts';

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

  // 只执行尚未应用的迁移。历史迁移里的 ALTER TABLE 不是幂等的，
  // 不能像建表语句那样每次从头执行一遍。
  const pending = SCHEMA_MIGRATIONS.filter((migration) => migration.version > current);
  const columnsByTable = new Map<string, Set<string>>();
  const statements: string[] = [];

  for (const migration of pending) {
    for (const sql of migration.statements) {
      // 兼容“迁移执行到一半失败”的数据库：列已存在时跳过对应的 ADD COLUMN。
      const alter = /ALTER\s+TABLE\s+["`]?([A-Za-z0-9_]+)["`]?\s+ADD\s+COLUMN\s+["`]?([A-Za-z0-9_]+)["`]?/i.exec(
        sql,
      );
      if (alter) {
        const table = alter[1];
        let columns = columnsByTable.get(table);
        if (!columns) {
          columns = await existingColumns(db, table);
          columnsByTable.set(table, columns);
        }
        if (columns.has(alter[2].toLowerCase())) {
          continue;
        }
      }
      statements.push(sql);
    }
  }

  statements.push(
    `INSERT INTO meta (key, value, updated_at) VALUES ('schema_version', '${SCHEMA_VERSION}', '${nowIso()}')
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  await db.batch(statements.map((sql) => db.prepare(sql)));
}

async function existingColumns(db: D1Database, table: string): Promise<Set<string>> {
  try {
    const result = await db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all<{ name: string }>();
    return new Set((result.results ?? []).map((row) => String(row.name).toLowerCase()));
  } catch {
    // 表还不存在（例如全新数据库，后续迁移会 CREATE TABLE）
    return new Set();
  }
}
