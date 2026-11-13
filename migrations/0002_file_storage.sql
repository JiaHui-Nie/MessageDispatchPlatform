-- Migration number: 0002 	 file storage
-- 文件内容以 AES-256-GCM 加密后按块存入 D1（单块 900 KB，避免接近 2 MB 行上限），
-- 每个用户的配额记录在 user_storage，files 保存元数据，file_chunks 保存密文分块。

CREATE TABLE IF NOT EXISTS user_storage (
  user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  quota INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name_enc TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  private INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_files_user ON files (user_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS file_chunks (
  file_id TEXT NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (file_id, idx)
);
--> statement-breakpoint
-- 为迁移前已存在的用户补一条 50 MB 的默认配额记录。
INSERT INTO user_storage (user_id, quota, used, updated_at)
SELECT id, 52428800, 0, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now') FROM users
WHERE id NOT IN (SELECT user_id FROM user_storage);
--> statement-breakpoint
INSERT INTO meta (key, value, updated_at) VALUES ('schema_version', '2', STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
