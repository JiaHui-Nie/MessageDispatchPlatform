-- Migration number: 0001 	 init schema
-- 所有敏感内容（信息值、反馈标题与正文、API Key、反馈简介）均以 AES-256-GCM 加密后存储，
-- 密钥由 JWT_SECRET 经 HKDF 派生；密码使用 PBKDF2-SHA256 加盐哈希。

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS users (
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
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_enc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys (user_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS information (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  info_key TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, info_key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_information_user_id ON information (user_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS feedback_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read')),
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_feedback_sessions_user ON feedback_sessions (user_id, updated_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS feedback_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES feedback_sessions (session_id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('feedback', 'reply')),
  author TEXT NOT NULL CHECK (author IN ('visitor', 'owner')),
  body_enc TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_feedback_messages_session ON feedback_messages (session_id, id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS registration_codes (
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
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);
