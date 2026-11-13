// 从 migrations/*.sql 生成 src/db/schema.generated.ts。
//
// 迁移 SQL 是唯一的表结构来源：D1 的 `wrangler d1 migrations apply` 直接执行它，
// 而 Worker 首次请求时的自动建表则使用生成的 TypeScript 常量。
// 修改表结构后请运行：pnpm run gen:schema
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'migrations');
const outputFile = join(root, 'src', 'db', 'schema.generated.ts');

const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

if (migrationFiles.length === 0) {
  throw new Error('migrations/ 目录中没有找到形如 0001_init.sql 的迁移文件');
}

const migrations = [];
let schemaVersion = 0;
let statementCount = 0;

for (const fileName of migrationFiles) {
  const version = Number.parseInt(fileName.slice(0, 4), 10);
  schemaVersion = Math.max(schemaVersion, version);
  const sql = readFileSync(join(migrationsDir, fileName), 'utf8');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^(--[^\n]*\n?)+$/.test(part));
  migrations.push({ version, statements });
  statementCount += statements.length;
}

function quoteStatement(statement, indent) {
  const escaped = statement.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return `${indent}\`${escaped}\`,`;
}

const migrationBlocks = migrations
  .map(({ version, statements }) => {
    const quoted = statements.map((statement) => quoteStatement(statement, '      ')).join('\n');
    return `  {
    version: ${version},
    statements: [
${quoted}
    ],
  },`;
  })
  .join('\n');

const output = `// 此文件由 scripts/gen-schema.mjs 自动生成，请勿手动修改。
// 来源：migrations/*.sql（修改后运行 pnpm run gen:schema）。
export interface SchemaMigration {
  version: number;
  statements: readonly string[];
}

export const SCHEMA_VERSION = ${schemaVersion};

export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
${migrationBlocks}
];

/** 扁平化后的全部语句，供测试与工具校验使用。 */
export const SCHEMA_STATEMENTS: readonly string[] = SCHEMA_MIGRATIONS.flatMap(
  (migration) => migration.statements,
);
`;

writeFileSync(outputFile, output, 'utf8');
console.log(`已生成 ${outputFile}（schema v${schemaVersion}，${migrations.length} 个迁移、${statementCount} 条语句）`);
