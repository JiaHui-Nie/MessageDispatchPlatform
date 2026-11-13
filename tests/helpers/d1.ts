/**
 * 测试用 D1 兼容层：用 Node 内置的 node:sqlite 执行真实 SQL，
 * 让 Worker 的查询、约束、事务与 D1 行为保持一致。
 */
import { DatabaseSync } from 'node:sqlite';

type Row = Record<string, unknown>;
type BindValue = string | number | Uint8Array | null;

function normalize(value: unknown): BindValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function meta(changes = 0, lastRowId = 0, rowsRead = 0) {
  return {
    duration: 0,
    changes,
    last_row_id: lastRowId,
    rows_read: rowsRead,
    rows_written: changes,
  };
}

export class ShimStatement {
  private readonly db: DatabaseSync;
  readonly sql: string;
  private readonly params: BindValue[];

  constructor(db: DatabaseSync, sql: string, params: BindValue[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params: unknown[]): ShimStatement {
    return new ShimStatement(this.db, this.sql, params.map(normalize));
  }

  async first<T = Row>(columnName?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Row | undefined;
    if (!row) return null;
    if (columnName) return (row[columnName] ?? null) as T;
    return row as T;
  }

  async all<T = Row>(): Promise<{ success: true; results: T[]; meta: ReturnType<typeof meta> }> {
    const rows = this.db.prepare(this.sql).all(...this.params) as T[];
    return { success: true, results: rows, meta: meta(0, 0, rows.length) };
  }

  async run(): Promise<{ success: true; results: never[]; meta: ReturnType<typeof meta> }> {
    const result = this.db.prepare(this.sql).run(...this.params) as {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
    return {
      success: true,
      results: [],
      meta: meta(Number(result.changes), Number(result.lastInsertRowid)),
    };
  }
}

export class ShimD1 {
  readonly raw: DatabaseSync;

  constructor() {
    this.raw = new DatabaseSync(':memory:');
    this.raw.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql: string): ShimStatement {
    return new ShimStatement(this.raw, sql);
  }

  async batch(statements: ShimStatement[]): Promise<Array<{ success: true; results: never[] }>> {
    this.raw.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.raw.exec('COMMIT');
      return results;
    } catch (error) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw error;
    }
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.raw.exec(sql);
    return { count: 0, duration: 0 };
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }
}
