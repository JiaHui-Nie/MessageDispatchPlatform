// 从 migrations/0001_init.sql 生成 src/db/schema.generated.ts。
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

const statements = [];
let schemaVersion = 0;

for (const fileName of migrationFiles) {
  schemaVersion = Math.max(schemaVersion, Number.parseInt(fileName.slice(0, 4), 10));
  const sql = readFileSync(join(migrationsDir, fileName), 'utf8');
  const parts = sql
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^(--[^\n]*\n?)+$/.test(part));
  statements.push(...parts);
}

const quoted = statements
  .map((statement) => `  \`${statement.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\`,`)
  .join('\n');

const output = `// 此文件由 scripts/gen-schema.mjs 自动生成，请勿手动修改。
// 来源：migrations/0001_init.sql（修改后运行 pnpm run gen:schema）。
export const SCHEMA_VERSION = ${schemaVersion};

export const SCHEMA_STATEMENTS: readonly string[] = [
${quoted}
];
`;

writeFileSync(outputFile, output, 'utf8');
console.log(`已生成 ${outputFile}（schema v${schemaVersion}，${statements.length} 条语句）`);
