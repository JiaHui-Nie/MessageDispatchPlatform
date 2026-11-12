# 信息分发平台（Message Dispatch Platform）

一个运行在 **Cloudflare Workers + D1** 上的信息分发与反馈回复平台：用固定的 `key / value` 向第三方系统分发信息，也可以让任何人通过公开页面或 API 提交反馈，并在后台以对话形式查看和回复。

界面为现代化扁平化设计，原生 HTML/CSS/JS，无构建步骤；所有数据存于 D1，敏感字段使用 `JWT_SECRET` 派生的密钥进行 AES-256-GCM 加密。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_GITHUB_USERNAME/message-dispatch-platform)

> 把上面按钮链接中的 `YOUR_GITHUB_USERNAME` 替换成你的 GitHub 用户名后，即可在 README 中直接一键部署。

---

## 目录

- [功能特性](#功能特性)
- [架构](#架构)
- [一键部署（推荐）](#一键部署推荐)
- [手动部署（CLI）](#手动部署cli)
- [本地开发](#本地开发)
- [界面说明](#界面说明)
- [API 文档](#api-文档)
- [安全设计](#安全设计)
- [数据模型](#数据模型)
- [环境变量](#环境变量)
- [项目结构](#项目结构)
- [测试](#测试)
- [常见问题](#常见问题)
- [对原始需求的处理与调整](#对原始需求的处理与调整)
- [License](#license)

---

## 功能特性

- **固定信息分发**：按 `key` 读写信息，公开信息可直接读取，私有信息需要 API Key。
- **反馈对话**：访客无需注册即可提交反馈，拿到 `session_id` 后可持续追加消息；接收者在后台回复，支持未读/已读、筛选、删除。
- **多用户 + 注册码**：管理员生成一次性/限次注册码，用户凭码注册；管理员拥有普通用户的全部能力。
- **API Key 管理**：每个账号最多 20 个 Key，名称备注、默认隐藏、可显示/复制/删除，Key 在数据库中只保存哈希与密文。
- **安全加固**：JWT 会话、PBKDF2 密码哈希、AES-256-GCM 字段级加密、CSRF 同源校验、D1 限流、密码强度校验、登录态失效控制。
- **一键部署友好**：`wrangler deploy` 自动创建 D1；首次请求自动建表，部署后只需补一个 `JWT_SECRET` 就能用。
- **现代化响应式界面**：总览、安全、发布信息、获取反馈、管理后台、公开反馈页；自动适配深色模式与移动端。

## 架构

```text
浏览器 ──HTTPS──▶ Cloudflare Worker (src/index.ts)
                    ├── /api/*  ──▶ 路由 / 鉴权 / 限流 / 加解密
                    │                 └── D1 (SQLite) ── 密文、哈希、索引
                    └── 其它路径 ──▶ 静态资源 (public/，SPA 回退)
```

- 运行时：Cloudflare Workers（ES Module Worker，TypeScript）
- 数据库：D1（通过 `DB` binding）
- 前端：原生 ES Module SPA（`public/app.js`），hash 路由，无需打包
- 密码学：WebCrypto（HKDF / AES-GCM / PBKDF2 / HMAC）

## 一键部署（推荐）

1. 登录 GitHub，把本仓库 fork 或推送到你的账号下。
2. 修改 README 顶部按钮链接里的 `YOUR_GITHUB_USERNAME`，然后点击 **Deploy to Cloudflare**。
3. Cloudflare 会引导你创建 Worker 并自动创建/绑定名为 `message-dispatch-platform` 的 D1 数据库。
4. 部署完成后，在 **Worker → Settings → Variables and Secrets** 中添加一个 **Secret**：

   | 名称 | 值 |
   | --- | --- |
   | `JWT_SECRET` | 一段至少 32 位的高强度随机字符串（生成方式见下） |

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

5. 打开 `https://<你的-worker>.workers.dev`，首次访问会要求为 `admin` 设置密码，完成后即可使用。

> 如果忘记设置 `JWT_SECRET`，页面会显示明确的配置提示，而不会以不安全的方式启动。
>
> 首次请求会自动建表；也可以手动执行 `wrangler d1 migrations apply DB --remote`（见下一节）。

## 手动部署（CLI）

前置条件：Node.js ≥ 24、pnpm、一个 Cloudflare 账号。

```bash
# 1. 安装依赖
pnpm install

# 2. 登录 Cloudflare
pnpm wrangler login

# 3.（可选）创建 D1 并填写 database_id
pnpm db:create
#   把输出的 database_id 填进 wrangler.jsonc；不填则 deploy 时自动创建

# 4. 设置生产密钥（不要把密钥写进仓库）
pnpm wrangler secret put JWT_SECRET

# 5. 部署
pnpm deploy
```

部署后按需执行远程迁移（未执行也没关系，首次请求会自动建表）：

```bash
pnpm db:migrate:remote
```

> **重要**：`JWT_SECRET` 同时用于签发 JWT 和派生数据加密密钥。部署后请勿更换，否则已加密的信息、反馈内容和 API Key 将无法解密（会返回 `decryption_failed`）。如需轮换密钥，请先导出并重新写入数据。

## 本地开发

```bash
pnpm install
cp .dev.vars.example .dev.vars      # Windows: Copy-Item .dev.vars.example .dev.vars
pnpm dev                            # http://localhost:8787
```

`.dev.vars` 已被 `.gitignore` 忽略；仓库中预先放了一个随机生成的本地开发密钥时也不要把真实密钥提交上去。

首次打开会自动建表；也可以手动执行：

```bash
pnpm db:migrate:local
```

常用命令：

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动本地 workerd + 本地 D1 |
| `pnpm deploy` | 部署到 Cloudflare |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm test` | 运行集成测试 |
| `pnpm check` | 类型检查 + 测试 |
| `pnpm gen:schema` | 修改 `migrations/*.sql` 后重新生成内置建表语句 |
| `pnpm db:migrate:local` | 对本地 D1 执行迁移 |
| `pnpm db:migrate:remote` | 对线上 D1 执行迁移 |

> **Free 计划提示**：密码哈希使用 PBKDF2，默认 10 万次迭代，登录/注册请求的 CPU 时间可能超过 Free 计划 10ms 的限制。生产环境建议使用 Workers Paid；如果必须用 Free 计划，可在 `wrangler.jsonc` 的 `vars` 中把 `PASSWORD_ITERATIONS` 调到 `10000`～`20000`（会降低暴力破解成本，但仍然是加盐哈希）。

## 界面说明

| 页面 | 路由 | 说明 |
| --- | --- | --- |
| 初始化 | 自动 | 首次部署设置 `admin` 密码（仅一次） |
| 登录 | `#/login` | 用户名、密码、注册入口 |
| 注册 | `#/register` | 用户名、密码、注册码（必填） |
| 总览 | `#/overview` | 统计卡片、最近反馈、反馈公开链接、API 基地址 |
| 安全 | `#/security` | 修改密码、创建/查看/复制/删除 API Key |
| 发布信息 | `#/publish` | 发布、编辑、删除 `key/value`，切换公开/私有 |
| 获取反馈 | `#/feedback` | 反馈开关、公开页说明、未读/已读筛选、对话式回复 |
| 管理后台 | `#/admin` | 平台统计、注册码生成/吊销、用户列表/重置密码/删除 |
| 公开反馈页 | `#/f/<用户名>` | 任何人可访问，无需登录；提交后显示 `session_id` 并支持继续对话 |

管理员账号拥有普通用户的全部功能，另外多出「管理后台」入口。

## API 文档

### 约定

- 基地址：`https://<你的-worker>.workers.dev`
- **所有平台接口都使用 `POST`**（只有 `GET /api/health` 是健康检查）。
- 请求体为 JSON：`Content-Type: application/json`；也兼容查询字符串与 `application/x-www-form-urlencoded`，方便 curl / 脚本调用。
- 成功响应统一包含 `"status": 200`；出错时 HTTP 状态码与 `status` 一致，并带 `error`、`message`：

  ```json
  { "status": 400, "error": "invalid_key", "message": "key 只能包含字母、数字、下划线、点、冒号和短横线……" }
  ```

- 鉴权方式：
  - **第三方脚本**：在参数中传 `api_key`（在「安全」页面创建）。
  - **网页后台**：使用 `HttpOnly` 会话 Cookie，无需 `api_key`。
  - 部分只读接口允许匿名访问（公开信息、反馈提交/查询）。
- 时间字段统一格式化为 `YYYY-MM-DD HH:mm`，时区由 `DISPLAY_TZ` 决定（默认 `Asia/Shanghai`）；数据库内部存 UTC ISO 字符串。

### 平台接口

#### ① 写入/更新固定信息

```http
POST /api/setinformation
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `user_name` | 是* | 信息所属用户名（`api_key` 调用时可省略，自动取 Key 的归属用户） |
| `api_key` | 是* | 第三方调用必填；网页后台使用会话 Cookie |
| `key` | 是 | 1–64 位，字母/数字/`_`/`.`/`:`/`-` |
| `value` | 是 | 最多 100,000 字符 |
| `visible` | 否 | 是否允许匿名读取，默认 `true` |

也支持把用户名放在路径里：`POST /api/setinformation/alice`。

```json
{ "status": 200, "user_name": "alice", "key": "notice", "value": "v1 已发布",
  "visible": true, "created": true, "count": 1, "updated_at": "2026-11-12 14:05" }
```

#### ② 读取固定信息

```http
POST /api/getinformation
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `user_name` | 是 | 目标用户 |
| `key` | 是 | 信息 key |
| `api_key` | 否 | 仅当该信息为私有（`visible: false`）时需要 |

返回 `value`、`visible`、`updated_at`。私有信息缺少凭据时返回 `403 api_key_required`。

#### ③ 提交反馈

```http
POST /api/sendfeedback
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `user_name` | 是 | 接收者用户名（需已开启反馈） |
| `feedback` | 是 | 最多 10,000 字符 |
| `title` | 否 | 最多 120 字符；省略时自动截取前 60 字 |

```json
{ "status": 200, "session_id": "9f2c…（48 位十六进制）", "title": "访问异常",
  "created_at": "2026-11-12 14:05", "update_time": "2026-11-12 14:05" }
```

接收者未开启反馈时返回 `403 feedback_disabled`；`session_id` 是查看/追加对话的凭据，请提示提交者保存。

#### ④ 通过 session_id 获取对话

```http
POST /api/getfeedbackbysessionid   { "session_id": "…" }
```

```json
{
  "status": 200,
  "session_id": "…",
  "user_name": "alice",
  "title": "访问异常",
  "status": "unread",
  "message_count": 2,
  "created_at": "2026-11-12 14:05",
  "update_time": "2026-11-12 14:08",
  "chat": [
    { "id": 1, "time": "2026-11-12 14:05", "type": "feedback", "author": "visitor", "information": "页面打不开" },
    { "id": 2, "time": "2026-11-12 14:08", "type": "reply",    "author": "owner",   "information": "已修复，请重试" }
  ]
}
```

#### ⑤ 追加回复

```http
POST /api/sendfeedbackbysessionid
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `session_id` | 是 | 会话编号 |
| `feedback` | 是 | 最多 10,000 字符 |
| `api_key` | 否 | 传了则标记为 `reply`（接收者回复）；不传则为 `feedback`（访客追加） |

> 兼容原始需求中的拼写 `POST /api/sendfeefbackbysessionid`。

返回 `{ "status": 200, "session_id": "…", "type": "reply", "time": "…", "message_id": 2 }`。

#### ⑥ 获取反馈清单

```http
POST /api/getfeedbacklist
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `user_name` | 是 | 目标用户 |
| `api_key` | 是* | 第三方调用必填；网页后台使用会话 Cookie |
| `status` | 否 | `unread` / `read` / `all` |

```json
{ "status": 200, "user_name": "alice", "count": 1,
  "feedback": [ { "session_id": "…", "title": "访问异常", "status": "unread",
                  "message_count": 2, "update_time": "2026-11-12 14:08" } ] }
```

#### ⑦ 删除固定信息

```http
POST /api/deleteinformation   { "user_name": "alice", "api_key": "mdp_…", "key": "notice" }
```

返回 `{ "status": 200, "user_name": "alice", "key": "notice", "deleted": true }`。

#### ⑧ 删除反馈

```http
POST /api/deletefeedback
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `user_name` | 是 | 接收者用户名 |
| `api_key` | 是* | 或使用网页登录态 |
| `session_id` | 是 | 会话编号（兼容原始文档中的 `key` 字段） |

删除会话会级联删除全部消息。

### 网页后台接口（Cookie 会话）

| 接口 | 参数 | 说明 |
| --- | --- | --- |
| `POST /api/auth/status` | — | 是否已初始化、是否已登录、应用名/版本 |
| `POST /api/auth/setup` | `password` | 首次创建 `admin`，仅可执行一次 |
| `POST /api/auth/login` | `username`、`password` | 登录并写入 HttpOnly Cookie |
| `POST /api/auth/logout` | — | 退出并清除 Cookie |
| `POST /api/auth/register` | `username`、`password`、`code` | 凭注册码注册并自动登录 |
| `POST /api/auth/me` | — | 当前用户 |
| `POST /api/auth/password` | `current_password`、`new_password` | 修改密码，其他设备登录态失效 |
| `POST /api/auth/profile` | `display_name` | 修改显示名称 |
| `POST /api/apikeys/list` | — | 列出 API Key（含可回显的 Key，仅本人可见） |
| `POST /api/apikeys/create` | `name` | 创建 API Key（每人最多 20 个） |
| `POST /api/apikeys/delete` | `id` | 删除 API Key |
| `POST /api/information/list` | — | 自己的全部固定信息 |
| `POST /api/information/visibility` | `key`、`visible` | 切换公开/私有 |
| `POST /api/feedback/list` | `status`、`limit`、`offset` | 反馈清单 + 计数 + 反馈开关状态 |
| `POST /api/feedback/get` | `session_id`、`mark_read` | 会话详情（默认标记已读） |
| `POST /api/feedback/reply` | `session_id`、`message` | 接收者回复 |
| `POST /api/feedback/read` | `session_id` | 标记已读 |
| `POST /api/feedback/delete` | `session_id` | 删除会话 |
| `POST /api/feedback/settings` | `enabled`、`intro` | 开启/关闭反馈、设置公开页说明 |
| `POST /api/public/profile` | `user_name` | 公开页资料（是否开放、显示名、说明） |
| `POST /api/overview` | — | 总览统计与最近反馈 |

### 管理接口（需要 `admin` 角色）

| 接口 | 参数 | 说明 |
| --- | --- | --- |
| `POST /api/admin/stats` | — | 用户/信息/反馈/注册码统计 |
| `POST /api/admin/codes/create` | `label`、`max_uses`、`expires_in_days` | 生成注册码（明文只返回一次） |
| `POST /api/admin/codes/list` | — | 注册码列表与状态 |
| `POST /api/admin/codes/revoke` | `id` | 吊销注册码 |
| `POST /api/admin/users/list` | — | 用户列表与数据计数 |
| `POST /api/admin/users/reset-password` | `id`、`new_password` | 重置任意用户密码 |
| `POST /api/admin/users/delete` | `id` | 删除用户（级联删除其数据） |

### 健康检查

```http
GET /api/health
```

```json
{ "status": 200, "app": "信息分发平台", "version": "1.0.0", "secret_configured": true,
  "database": "ok", "schema_version": 1, "needs_setup": false, "time": "2026-11-12T06:00:00.000Z" }
```

未配置 `JWT_SECRET` 或数据库异常时返回 `503`，便于监控告警。

### 错误码

| HTTP | error | 含义 |
| --- | --- | --- |
| 400 | `missing_*` / `invalid_*` | 参数缺失或格式不正确 |
| 400 | `invalid_code` / `expired_code` | 注册码无效、已用完、已吊销或已过期 |
| 400 | `weak_password` | 密码不满足强度要求 |
| 401 | `auth_required` | 未登录 |
| 401 | `invalid_credentials` | 用户名或密码错误 |
| 401 | `invalid_api_key` | API Key 无效 |
| 403 | `feedback_disabled` | 接收者未开启反馈 |
| 403 | `api_key_required` | 私有信息需要 API Key |
| 403 | `user_mismatch` | 凭据与 `user_name` 不匹配 |
| 403 | `admin_required` | 需要管理员权限 |
| 403 | `cross_origin_denied` | 跨站请求被拒绝 |
| 404 | `not_found` / `feedback_not_found` | 资源不存在 |
| 409 | `already_setup` / `username_taken` | 已初始化 / 用户名被占用 |
| 429 | `rate_limited` | 触发限流，响应带 `Retry-After` |
| 500 | `missing_secret` / `decryption_failed` | 服务端密钥缺失或密钥不一致 |

### curl 示例

```bash
BASE="https://your-worker.workers.dev"
KEY="mdp_xxxxxxxx"

# 写入信息
curl -X POST "$BASE/api/setinformation" \
  -H 'content-type: application/json' \
  -d "{\"user_name\":\"alice\",\"api_key\":\"$KEY\",\"key\":\"notice\",\"value\":\"v1 已发布\"}"

# 匿名读取公开信息
curl -X POST "$BASE/api/getinformation" \
  -H 'content-type: application/json' \
  -d '{"user_name":"alice","key":"notice"}'

# 提交反馈
curl -X POST "$BASE/api/sendfeedback" \
  -H 'content-type: application/json' \
  -d '{"user_name":"alice","feedback":"页面打不开"}'
```

## 安全设计

| 项目 | 实现 |
| --- | --- |
| 登录凭据 | HS256 JWT，`HttpOnly` + `SameSite=Strict` + `Secure`（https）Cookie，默认 7 天 |
| 登录态失效 | 用户表 `token_version`，修改/重置密码后旧 Token 立即失效 |
| 密码存储 | PBKDF2-SHA256，每用户 16 字节随机盐，默认 100,000 次迭代（可配置） |
| 数据加密 | AES-256-GCM，密钥 = HKDF-SHA256(`JWT_SECRET`)，每条数据随机 12 字节 IV |
| 加密字段 | 信息 `value`、反馈标题与正文、反馈简介、API Key 明文 |
| API Key | 数据库只存 SHA-256 摘要（查找）与 AES-GCM 密文（本人回显），格式 `mdp_` + 48 位十六进制 |
| 注册码 | 80 bit 随机、去除易混淆字符，只存 SHA-256 摘要；支持限次、过期、吊销；注册失败自动回滚次数 |
| CSRF | `SameSite=Strict` Cookie + 校验 `Origin` 与请求 Host 一致 |
| XSS | 前端所有动态内容经 `escapeHtml`；严格 CSP（`public/_headers`），无内联脚本/样式 |
| 限流 | 基于 D1 的固定窗口计数：登录、注册、初始化、反馈提交/回复、信息读写等 |
| 越权 | `api_key` 必须属于 `user_name` 对应用户；后台接口强制校验资源归属 |
| 用户枚举 | 未知用户也执行一次等价的 PBKDF2 运算；登录错误信息不区分用户名/密码 |
| 会话编号 | `session_id` 为 192 bit 随机值，等同 bearer token，无法枚举 |
| 响应头 | `X-Frame-Options: DENY`、`nosniff`、`no-referrer`、CSP、`Permissions-Policy` |

**部署注意**

- `JWT_SECRET` 至少 16 位（建议 32 位以上随机字符串）。它是唯一主密钥，丢失/更换会导致密文无法解密。
- 平台不提供“忘记密码”，这是按需求刻意省略的；管理员可在「管理后台 → 用户」中重置任意用户密码。
- 如需额外防护，可在 Cloudflare 侧叠加 Access / WAF / Turnstile。

## 数据模型

| 表 | 用途 |
| --- | --- |
| `meta` | schema 版本等元信息（用于自动建表判断） |
| `users` | 账号、密码哈希、角色、反馈开关、反馈说明密文、`token_version` |
| `api_keys` | API Key 摘要、密文、名称、最近使用时间 |
| `information` | 固定信息：`user_id` + `info_key` 唯一，值为密文，带公开/私有标记 |
| `feedback_sessions` | 反馈会话：随机 `session_id`、标题密文、未读/已读、消息数 |
| `feedback_messages` | 会话消息：`feedback` / `reply`，正文密文，按 id 排序 |
| `registration_codes` | 注册码哈希、备注、次数、过期时间、吊销标记 |
| `rate_limits` | 限流固定窗口计数 |

所有表由 `migrations/0001_init.sql` 定义；`src/db/schema.generated.ts` 由脚本生成，用于 Worker 首次请求时自动建表。

## 环境变量

在 `wrangler.jsonc` 的 `vars` 中配置普通变量，通过 `wrangler secret put` 配置密钥：

| 名称 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `JWT_SECRET` | **是** | — | 唯一主密钥（Secret），同时用于 JWT 与数据加密 |
| `APP_NAME` | 否 | `信息分发平台` | 页面标题与品牌名 |
| `DISPLAY_TZ` | 否 | `Asia/Shanghai` | 时间展示时区（IANA） |
| `SESSION_TTL_HOURS` | 否 | `168` | 登录有效期（1–2160 小时） |
| `PASSWORD_ITERATIONS` | 否 | `100000` | PBKDF2 迭代次数（10000–500000） |
| `RATE_LIMIT_DISABLED` | 否 | — | 设为 `1` 关闭限流（仅用于自动化测试） |

## 项目结构

```text
.
├── migrations/0001_init.sql      # D1 表结构（唯一来源）
├── public/                       # 静态资源（SPA）
│   ├── index.html
│   ├── app.js                    # 前端路由与页面
│   ├── styles.css                # 设计系统与响应式布局
│   ├── favicon.svg
│   ├── _headers                  # 安全响应头 / CSP
│   └── robots.txt
├── scripts/gen-schema.mjs        # 由迁移 SQL 生成 src/db/schema.generated.ts
├── src/
│   ├── index.ts                  # Worker 入口
│   ├── app.ts                    # 路由表与错误处理
│   ├── env.ts                    # 绑定与运行时上下文
│   ├── auth/                     # 会话、API Key/会话身份解析、限流
│   ├── data/                     # 用户、信息、反馈、注册码、统计
│   ├── db/                       # D1 查询工具与 schema
│   ├── lib/                      # 加密、编码、时间、HTTP、校验
│   └── routes/                   # 各接口处理器
├── tests/                        # node:test 集成测试 + D1 兼容层
├── wrangler.jsonc
└── package.json
```

## 测试

```bash
pnpm test        # 19 个集成测试，覆盖认证、注册码、API Key、信息、反馈、越权、限流、管理后台
pnpm typecheck
pnpm check       # 以上两项
```

测试使用 Node 24 内置的 `node:sqlite` 模拟 D1（真实 SQL、外键与事务），直接调用 Worker 的 `handleRequest`，并监听真实 HTTP 端口做端到端校验。已额外通过 `wrangler dev`（真实 workerd + 本地 D1）与 `wrangler deploy --dry-run` 验证。

## 常见问题

**Q：部署后页面提示“服务端缺少 JWT_SECRET”？**
按提示在 Cloudflare 控制台添加 Secret（或执行 `wrangler secret put JWT_SECRET`）后刷新。这是刻意设计的失败保护，不会用弱默认密钥启动。

**Q：修改 `JWT_SECRET` 后旧数据打不开？**
是的。加密密钥由 `JWT_SECRET` 派生，密钥变化会导致 `decryption_failed`。请保持密钥稳定。

**Q：能不能不用 `api_key` 发布信息？**
可以。网页后台通过会话 Cookie 调用同一接口；第三方脚本需要 `api_key`。

**Q：公开的信息安全吗？**
公开信息（`visible: true`，默认）任何拿到 `user_name` + `key` 的人都能读取。请把敏感内容设为私有（`visible: false`）。

**Q：注册码在哪里查看？**
注册码只保存哈希，生成时展示一次；丢失后请吊销并重新生成。

**Q：Free 计划登录报 1102（CPU 超时）？**
降低 `PASSWORD_ITERATIONS`（如 10000）或升级 Workers Paid。

## 对原始需求的处理与调整

需求文档中的接口与界面基本保留，以下是不合理或含糊之处所做的补充修改（均向后兼容或已注明）：

1. **`JWT_TOKEN` → `JWT_SECRET`**：需求同时出现两个名称。统一为一个 `JWT_SECRET`：既签 JWT，又派生数据加密密钥，README 明确要求首次部署时设置。
2. **`/setinformation?/{username}?` 路径不成形**：改为标准 `POST /api/setinformation`，同时兼容 `POST /api/setinformation/{username}`。
3. **重复的 ⑤ 编号**：重新编号为「追加回复」「获取清单」两节（功能不变）。
4. **`deletefeedback` 要求传 `key`**：语义应是 `session_id`，已改为 `session_id`，并兼容 `key` 别名，避免旧脚本失效。
5. **`sendfeefbackbysessionid` 拼写错误**：新增正确拼写 `/api/sendfeedbackbysessionid`，旧路径保留为别名。
6. **`getinformation` 无需 api_key 的安全隐患**：保留默认公开读取以符合需求，但为每条信息增加 `visible` 开关；关闭后必须提供该用户的 API Key。默认值仍为公开，敏感数据建议设为私有。
7. **“反馈已读/未读”缺少接口**：补充 `feedback/read`、`feedback/list` 筛选与未读计数，并在后台回复/查看时自动标记已读。
8. **“获取反馈”缺少标题与分页**：补充可选 `title`、`limit`/`offset` 与自动摘要标题。
9. **管理员缺少用户管理**：补充用户列表、重置密码、删除用户（级联清理数据），并禁止删除最后一个管理员/自己。
10. **缺少公开反馈入口**：补充 `#/f/<用户名>` 公开页面，访客无需注册即可提交并继续对话（记录保存在浏览器本地）。
11. **一键部署无法预设密钥**：`wrangler deploy` 自动创建 D1；首次请求自动建表；密钥未配置时给出可操作的错误页。
12. **安全加固**：统一为 POST + JSON、API Key 哈希存储、全部敏感字段加密、PBKDF2 密码哈希、CSRF 校验、限流、密码强度校验、安全响应头。
13. **工程化**：TypeScript 严格模式、集成测试、CI、schema 生成脚本、迁移与自动建表一致性测试。

## License

[MIT](./LICENSE)
