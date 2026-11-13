-- Migration number: 0004 	 direct R2 upload
-- object_key：记录 R2 对象键（历史数据为空时按 files/<id> 推断）。
-- encrypted：1 = Worker 端 AES-GCM 加密后存储；0 = 浏览器直传，仅依赖 R2 服务端加密。

ALTER TABLE files ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE files ADD COLUMN object_key TEXT;
--> statement-breakpoint
INSERT INTO meta (key, value, updated_at) VALUES ('schema_version', '4', STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
