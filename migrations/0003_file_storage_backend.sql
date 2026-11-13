-- Migration number: 0003 	 file storage backend
-- 记录每个文件实际使用的存储后端：'d1'（默认）或 'r2'。
-- 切换后端只影响新上传的文件，旧文件继续按各自记录读取。

ALTER TABLE files ADD COLUMN storage TEXT NOT NULL DEFAULT 'd1';
--> statement-breakpoint
INSERT INTO meta (key, value, updated_at) VALUES ('schema_version', '3', STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
