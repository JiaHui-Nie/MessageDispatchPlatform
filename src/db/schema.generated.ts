// 此文件由 scripts/gen-schema.mjs 自动生成，请勿手动修改。
// 来源：migrations/0001_init.sql（修改后运行 pnpm run gen:schema）。
export const SCHEMA_VERSION = 2;

export const SCHEMA_STATEMENTS: readonly string[] = [
  `-- Migration number: 0001 	 init schema
-- 所有敏感内容（信息值、反馈标题与正文、API Key、反馈简介）均以 AES-256-GCM 加密后存储，
-- 密钥由 JWT_SECRET 经 HKDF 派生；密码使用 PBKDF2-SHA256 加盐哈希。

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  feedback_enabled INTEGER NOT NULL DEFAULT 0,
  feedback_intro_enc TEXT,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);`,
  `CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);`,
  `CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_enc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys (user_id);`,
  `CREATE TABLE IF NOT EXISTS information (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  info_key TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, info_key)
);`,
  `CREATE INDEX IF NOT EXISTS idx_information_user_id ON information (user_id);`,
  `CREATE TABLE IF NOT EXISTS feedback_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read')),
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_sessions_user ON feedback_sessions (user_id, updated_at DESC);`,
  `CREATE TABLE IF NOT EXISTS feedback_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES feedback_sessions (session_id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('feedback', 'reply')),
  author TEXT NOT NULL CHECK (author IN ('visitor', 'owner')),
  body_enc TEXT NOT NULL,
  created_at TEXT NOT NULL
);`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_messages_session ON feedback_messages (session_id, id);`,
  `CREATE TABLE IF NOT EXISTS registration_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  last_used_by TEXT
);`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);`,
  `CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);`,
  `-- Migration number: 0002 	 file storage
-- 文件内容以 AES-256-GCM 加密后按块存入 D1（单块 900 KB，避免接近 2 MB 行上限），
-- 每个用户的配额记录在 user_storage，files 保存元数据，file_chunks 保存密文分块。

CREATE TABLE IF NOT EXISTS user_storage (
  user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  quota INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);`,
  `CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name_enc TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  private INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);`,
  `CREATE INDEX IF NOT EXISTS idx_files_user ON files (user_id, created_at DESC);`,
  `CREATE TABLE IF NOT EXISTS file_chunks (
  file_id TEXT NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (file_id, idx)
);`,
  `-- 为迁移前已存在的用户补一条 50 MB 的默认配额记录。
INSERT INTO user_storage (user_id, quota, used, updated_at)
SELECT id, 52428800, 0, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now') FROM users
WHERE id NOT IN (SELECT user_id FROM user_storage);`,
  `INSERT INTO meta (key, value, updated_at) VALUES ('schema_version', '2', STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
];
