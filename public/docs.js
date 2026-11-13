/* API 文档页面（静态内容，按需渲染）。 */

const COPY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

const ALERT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function codeBlock(value) {
  return `<div class="code-block"><pre><code>${esc(value)}</code></pre><button class="icon-btn code-copy" type="button" data-copy-code aria-label="复制代码" title="复制">${COPY_ICON}</button></div>`;
}

function paramsTable(rows) {
  if (!rows || rows.length === 0) return '';
  return `<div class="table-wrap docs-table-wrap"><table class="docs-table">
    <thead><tr><th>参数</th><th>必填</th><th>说明</th></tr></thead>
    <tbody>${rows
      .map(
        ([name, required, desc]) =>
          `<tr><td><code>${esc(name)}</code></td><td>${required ? '<span class="badge badge-primary">是</span>' : '<span class="badge">否</span>'}</td><td>${desc}</td></tr>`,
      )
      .join('')}</tbody>
  </table></div>`;
}

function endpoint({ method = 'POST', path, desc, params = [], example, response, note = '' }) {
  return `<div class="endpoint">
    <div class="endpoint-head"><span class="http-method">${method}</span><code>${esc(path)}</code></div>
    <p class="endpoint-desc">${desc}</p>
    ${note ? `<div class="alert alert-info">${ALERT_ICON}<span>${note}</span></div>` : ''}
    ${paramsTable(params)}
    ${example ? `<h4>请求示例</h4>${codeBlock(example)}` : ''}
    ${response ? `<h4>响应示例</h4>${codeBlock(response)}` : ''}
  </div>`;
}

function section(id, title, body) {
  return `<section class="docs-section" id="docs-${id}"><h2>${title}</h2>${body}</section>`;
}

export function renderDocs(origin) {
  const base = origin || 'https://your-worker.workers.dev';

  const quickstart = section(
    'quickstart',
    '快速开始',
    `<p>所有平台接口使用 <code>POST</code> + JSON 请求体（文件下载支持 <code>GET</code> / <code>POST</code> / <code>HEAD</code> 与单段 <code>Range</code>）。成功响应一定包含 <code>"status": 200</code>，错误响应的 HTTP 状态码与 <code>status</code> 一致。</p>
     <div class="docs-meta-grid">
       <div><span>API 基地址</span><code>${esc(base)}/api</code></div>
       <div><span>请求类型</span><code>application/json</code>（上传用 multipart）</div>
       <div><span>鉴权</span>API Key 或登录 Cookie</div>
       <div><span>时间格式</span><code>YYYY-MM-DD HH:mm</code></div>
     </div>
     <h3>健康检查</h3>
     ${endpoint({
       method: 'GET',
       path: '/api/health',
       desc: '无需鉴权，用于监控与部署自检。',
       response: `{
  "status": 200,
  "app": "信息分发平台",
  "version": "1.5.0",
  "secret_configured": true,
  "database": "ok",
  "schema_version": 4,
  "needs_setup": false
}`,
     })}
     <h3>第一个请求</h3>
     ${codeBlock(`curl -X POST '${base}/api/getinformation' \\
  -H 'content-type: application/json' \\
  -d '{"user_name":"alice","key":"notice"}'`)}`,
  );

  const auth = section(
    'auth',
    '认证方式',
    `<p>平台支持两种凭据，第三方脚本用 API Key，网页后台用登录 Cookie。</p>
     <div class="docs-cards">
       <div class="docs-card"><h4>API Key</h4><p>在「安全 → API Key」创建，格式为 <code>mdp_</code> 开头。可以放在请求体、查询字符串或 <code>X-API-Key</code> 请求头。</p></div>
       <div class="docs-card"><h4>会话 Cookie</h4><p>登录成功后由服务端写入 <code>HttpOnly</code> Cookie，网页后台的请求自动携带，无需 <code>api_key</code>。</p></div>
     </div>
     <h3>传递 API Key</h3>
     ${codeBlock(`# 请求体
curl -X POST '${base}/api/setinformation' \\
  -H 'content-type: application/json' \\
  -d '{"user_name":"alice","api_key":"mdp_xxx","key":"notice","value":"hello"}'

# 查询字符串
curl -X POST '${base}/api/setinformation?api_key=mdp_xxx' ...
`)}
     <div class="alert alert-warning">${ALERT_ICON}<span>API Key 等同于账号写权限，请勿提交到公开仓库或前端代码。私有文件下载可以使用 <code>X-API-Key</code> 请求头，避免密钥出现在 URL 和访问日志中。</span></div>`,
  );

  const information = section(
    'information',
    '信息分发',
    `<p>用固定的 <code>key</code> 分发文本或配置。每条信息可以设置为公开（默认）或私有，私有信息读取时需要该用户的 API Key。</p>
     ${endpoint({
       path: '/api/setinformation',
       desc: '写入或更新一条固定信息。',
       params: [
         ['user_name', true, '信息所属用户名；只传 api_key 时可省略'],
         ['api_key', true, '第三方调用必填；网页后台使用登录态'],
         ['key', true, '1-64 位，字母/数字/<code>_ . : -</code>'],
         ['value', true, '最多 100,000 字符'],
         ['visible', false, '是否允许匿名读取，默认 <code>true</code>'],
       ],
       example: `curl -X POST '${base}/api/setinformation' \\
  -H 'content-type: application/json' \\
  -d '{"user_name":"alice","api_key":"mdp_xxx","key":"notice","value":"v1 已发布"}'`,
       response: `{
  "status": 200,
  "user_name": "alice",
  "key": "notice",
  "value": "v1 已发布",
  "visible": true,
  "created": true,
  "count": 1,
  "updated_at": "2026-11-13 09:30"
}`,
     })}
     ${endpoint({
       path: '/api/getinformation',
       desc: '读取固定信息。',
       params: [
         ['user_name', true, '目标用户名'],
         ['key', true, '信息 key'],
         ['api_key', false, '读取私有信息时必填'],
       ],
       response: `{
  "status": 200,
  "user_name": "alice",
  "key": "notice",
  "value": "v1 已发布",
  "visible": true,
  "updated_at": "2026-11-13 09:30"
}`,
     })}
     ${endpoint({
       path: '/api/deleteinformation',
       desc: '删除固定信息。',
       params: [
         ['user_name', true, '目标用户名'],
         ['api_key', true, '或使用网页登录态'],
         ['key', true, '要删除的 key'],
       ],
       response: `{ "status": 200, "user_name": "alice", "key": "notice", "deleted": true }`,
     })}`,
  );

  const feedback = section(
    'feedback',
    '反馈',
    `<p>访客无需注册即可提交反馈，提交后拿到 <code>session_id</code>，凭此继续对话。接收者可以在网页后台查看、回复、标记已读或删除。</p>
     ${endpoint({
       path: '/api/sendfeedback',
       desc: '提交一条新反馈（接收者需已开启反馈）。',
       params: [
         ['user_name', true, '接收者用户名'],
         ['feedback', true, '最多 10,000 字符'],
         ['title', false, '标题，最多 120 字符；省略时自动摘要'],
       ],
       example: `curl -X POST '${base}/api/sendfeedback' \\
  -H 'content-type: application/json' \\
  -d '{"user_name":"alice","feedback":"页面打不开"}'`,
       response: `{
  "status": 200,
  "session_id": "9f2c…（48 位十六进制）",
  "title": "页面打不开",
  "created_at": "2026-11-13 09:31",
  "update_time": "2026-11-13 09:31"
}`,
     })}
     ${endpoint({
       path: '/api/getfeedbackbysessionid',
       desc: '按 session_id 读取完整对话。',
       params: [['session_id', true, '会话编号']],
       response: `{
  "status": 200,
  "session_id": "9f2c…",
  "title": "页面打不开",
  "status": "unread",
  "update_time": "2026-11-13 09:35",
  "chat": [
    { "id": 1, "time": "2026-11-13 09:31", "type": "feedback", "author": "visitor", "information": "页面打不开" },
    { "id": 2, "time": "2026-11-13 09:35", "type": "reply", "author": "owner", "information": "已修复" }
  ]
}`,
     })}
     ${endpoint({
       path: '/api/sendfeedbackbysessionid',
       desc: '在已有会话中追加消息；带 api_key 时标记为接收者回复，否则为访客补充。',
       params: [
         ['session_id', true, '会话编号'],
         ['feedback', true, '最多 10,000 字符'],
         ['api_key', false, '传了则 type = reply，否则 type = feedback'],
       ],
       response: `{ "status": 200, "session_id": "9f2c…", "type": "reply", "time": "2026-11-13 09:35", "message_id": 2 }`,
     })}
     ${endpoint({
       path: '/api/getfeedbacklist',
       desc: '获取某个用户收到的反馈清单。',
       params: [
         ['user_name', true, '目标用户'],
         ['api_key', true, '第三方调用必填；网页后台使用登录态'],
         ['status', false, '<code>unread</code> / <code>read</code> / <code>all</code>'],
       ],
       response: `{
  "status": 200,
  "user_name": "alice",
  "count": 1,
  "feedback": [
    { "session_id": "9f2c…", "title": "页面打不开", "status": "unread", "message_count": 2, "update_time": "2026-11-13 09:35" }
  ]
}`,
     })}
     ${endpoint({
       path: '/api/deletefeedback',
       desc: '删除反馈会话（级联删除消息）。',
       params: [
         ['user_name', true, '接收者用户名'],
         ['api_key', true, '或使用网页登录态'],
         ['session_id', true, '会话编号；兼容旧字段名 <code>key</code>'],
       ],
       response: `{ "status": 200, "session_id": "9f2c…", "deleted": true }`,
     })}`,
  );

  const files = section(
    'files',
    '文件存储',
    `<div class="docs-cards">
       <div class="docs-card"><h4>加密存储</h4><p>Worker 上传的文件以 AES-256-GCM 加密后按 900 KB 分块存入 D1 或写入 R2；文件名同样加密。</p></div>
       <div class="docs-card"><h4>大文件直传</h4><p>超过阈值的文件由浏览器直接 PUT 到 R2，不经过 Worker，支持上传进度；单次上限约 4.995 GiB。</p></div>
       <div class="docs-card"><h4>可选 R2</h4><p>默认使用 D1；绑定 R2 后可在管理后台切换后端，新文件使用所选后端，旧文件仍可正常下载。</p></div>
       <div class="docs-card"><h4>配额</h4><p>每个用户有独立空间，默认 50 MB，管理员可以单独调整。</p></div>
       <div class="docs-card"><h4>访问控制</h4><p>每个文件可单独设置“私有”，私有文件必须提供所有者的 API Key 或登录态才能下载。</p></div>
     </div>
     <h3>两条上传通道</h3>
     <div class="table-wrap docs-table-wrap"><table class="docs-table">
       <thead><tr><th>通道</th><th>适用大小</th><th>加密</th><th>认证</th><th>进度 / 续传</th></tr></thead>
       <tbody>
         <tr><td>Worker 上传<br><code>/api/uploadfile</code></td><td>≤ 阈值（默认 20 MB）</td><td>AES-256-GCM（<code>JWT_SECRET</code>）</td><td>API Key 或登录态</td><td>网页有进度；无续传</td></tr>
         <tr><td>R2 直传<br><code>presign</code> → PUT → <code>complete</code></td><td>&gt; 阈值，最高约 4.995 GiB</td><td>仅 R2 服务端加密</td><td>仅登录态</td><td>网页有进度；单次 PUT，无续传</td></tr>
       </tbody>
     </table></div>
     ${endpoint({
       path: '/api/uploadfile',
       desc: '上传文件并返回下载链接。支持 <code>multipart/form-data</code>（字段名 <code>file</code>）或直接发送二进制体。',
       params: [
         ['file', true, 'multipart 中的文件字段；原始二进制上传时省略'],
         ['user_name', false, '文件所有者；只传 api_key 时可省略'],
         ['api_key', false, '第三方调用使用；网页后台使用登录态'],
         ['private', false, '是否需要 API Key 才能下载，默认 <code>false</code>'],
         ['name', false, '覆盖文件名（最多 180 字符）'],
       ],
       note: '/api/uploadfile 只走 Worker，受请求体与内存限制；网页端超过 <code>DIRECT_UPLOAD_THRESHOLD_MB</code> 的文件会自动改用下面的 R2 直传接口，第三方 API Key 不能使用直传。',
       example: `# multipart
curl -X POST '${base}/api/uploadfile?api_key=mdp_xxx' \\
  -F 'file=@./report.pdf' \\
  -F 'private=true'

# 原始二进制（文件名放请求头，非 ASCII 建议 URL 编码）
curl -X POST '${base}/api/uploadfile?api_key=mdp_xxx' \\
  -H 'content-type: application/octet-stream' \\
  -H 'x-file-name: report.pdf' \\
  --data-binary '@./report.pdf'`,
       response: `{
  "status": 200,
  "file_id": "8b1f…（48 位十六进制）",
  "name": "report.pdf",
  "size": 20480,
  "content_type": "application/pdf",
  "private": true,
  "backend": "d1",
  "download_url": "${base}/api/downloadfile?id=8b1f…",
  "storage": { "quota": 52428800, "used": 20480, "remaining": 52408320, "percent": 0, "file_count": 1 }
}`,
     })}
     <h3>下载接口详解</h3>
     ${endpoint({
       method: 'GET',
       path: '/api/downloadfile?id=…',
       desc: '下载文件。支持 GET、POST 和 HEAD；公开文件可直接访问，私有文件需所有者 api_key、X-API-Key 头或登录态。',
       params: [
         ['id', true, '文件 ID（兼容 <code>file_id</code>）'],
         ['api_key', false, '私有文件必填（也可用 <code>X-API-Key</code> 请求头）'],
       ],
       note: '公开文件无需鉴权；私有文件只允许文件所有者。下载是二进制响应，<code>status</code> 用响应头 <code>x-api-status</code> 表示（200 / 206 / 416）。',
       example: `# 公开文件
curl -L '${base}/api/downloadfile?id=8b1f…' -o report.pdf

# 私有文件（推荐请求头）
curl -L '${base}/api/downloadfile?id=8b1f…' \\
  -H 'x-api-key: mdp_xxx' -o report.pdf

# HEAD：只取元数据
curl -I '${base}/api/downloadfile?id=8b1f…'

# Range：直传 R2 文件可分段下载（0–1 MiB）
curl -L '${base}/api/downloadfile?id=8b1f…' \\
  -H 'Range: bytes=0-1048575' -o part1.bin

# 断点续传（curl 自动发送 Range）
curl -C - -L '${base}/api/downloadfile?id=8b1f…' -o report.pdf`,
       response: `HTTP/1.1 206 Partial Content
content-type: application/octet-stream
content-length: 1048576
content-range: bytes 0-1048575/314572800
accept-ranges: bytes
content-disposition: attachment; filename="report.pdf"
x-api-status: 206

<对应字节>`,
     })}
     <div class="table-wrap docs-table-wrap"><table class="docs-table">
       <thead><tr><th>响应头</th><th>说明</th></tr></thead>
       <tbody>
         <tr><td><code>content-type</code></td><td>上传时记录的文件类型</td></tr>
         <tr><td><code>content-length</code></td><td>本次响应字节数；Range 响应为片段长度</td></tr>
         <tr><td><code>content-range</code></td><td>仅 206，如 <code>bytes 0-1048575/314572800</code></td></tr>
         <tr><td><code>accept-ranges</code></td><td>直传 R2 文件为 <code>bytes</code>；应用加密文件为 <code>none</code></td></tr>
         <tr><td><code>content-disposition</code></td><td>附件下载，包含 UTF-8 文件名</td></tr>
         <tr><td><code>x-api-status</code></td><td>二进制响应的状态码：200 / 206 / 416</td></tr>
       </tbody>
     </table></div>
     <h4>Range 与下载计数规则</h4>
     <ul>
       <li>只有浏览器直传的 R2 文件（列表标注「R2 直传」）支持单段 <code>Range</code>，返回 <code>206</code>；</li>
       <li>应用层加密文件必须整体解密，会忽略 Range 并返回 <code>200</code> 完整内容，且 <code>accept-ranges: none</code>；</li>
       <li>多段 Range 会按完整文件返回 <code>200</code>；范围越界返回 <code>416</code>，并带 <code>content-range: bytes */总大小</code>；</li>
       <li><code>HEAD</code> 只返回元数据，不返回正文，也不增加下载次数；</li>
       <li>只有完整 GET 计入 <code>downloads</code>，Range 和 HEAD 不计数。</li>
     </ul>
     <h4>下载权限</h4>
     <div class="table-wrap docs-table-wrap"><table class="docs-table">
       <thead><tr><th>文件可见性</th><th>所需凭据</th><th>说明</th></tr></thead>
       <tbody>
         <tr><td>公开</td><td>无</td><td>任何人拿到链接即可下载</td></tr>
         <tr><td>私有</td><td>所有者 <code>api_key</code> 或所有者登录态</td><td>无效 Key 返回 <code>403 invalid_api_key</code>；未提供凭据返回 <code>403 api_key_required</code></td></tr>
       </tbody>
     </table></div>
     <h3>预签名下载直链</h3>
     ${endpoint({
       path: '/api/files/download-url',
       desc: '为 R2 直传文件生成短期 GET 直链；支持 API Key 或登录态，下载不经过 Worker。',
       params: [
         ['file_id', true, '文件 ID（兼容 <code>id</code>）'],
         ['api_key', false, '私有文件需要所有者 API Key；也可用 <code>X-API-Key</code> 请求头'],
       ],
       note: '仅 <code>encrypted: false</code> 的 R2 直传文件可用；应用加密文件返回 <code>400 presigned_download_unavailable</code>。公开文件无需鉴权，私有文件需所有者。URL 是 bearer token，默认 60 分钟；直链下载不计入 <code>downloads</code>。',
       example: `curl -X POST '${base}/api/files/download-url' \\
  -H 'content-type: application/json' \\
  -H 'x-api-key: mdp_xxx' \\
  -d '{"file_id":"8b1f…"}'`,
       response: `{
  "status": 200,
  "file_id": "8b1f…",
  "name": "report.pdf",
  "size": 314572800,
  "private": true,
  "encrypted": false,
  "backend": "r2",
  "method": "GET",
  "download_url": "https://<bucket>.<account>.r2.cloudflarestorage.com/files/1/8b1f…?X-Amz-…",
  "expires_in": 3600,
  "expires_at": "2026-11-13T16:00:00.000Z",
  "range_supported": true,
  "download_counted": false
}`,
     })}
     <p>与 <code>/api/downloadfile</code> 相比：预签名 URL 直接连 R2，速度更快、Worker 不承载下载流量；但 URL 在有效期内是 bearer token，无法单独撤销，且不能使用自定义域名。</p>
     <p><strong>CORS：</strong>浏览器顶层打开链接下载不需要 CORS；如果用 <code>fetch</code> 读取直链，需要在 R2 桶 CORS 中允许 <code>GET</code>、<code>Range</code>，并暴露 <code>content-range</code>、<code>content-length</code>、<code>content-disposition</code>。</p>
     ${endpoint({
       path: '/api/deletefile',
       desc: '删除文件并释放配额。',
       params: [
         ['file_id', true, '文件 ID（兼容 <code>id</code>）'],
         ['user_name', false, '文件所有者；只传 api_key 时可省略'],
         ['api_key', false, '或使用网页登录态'],
       ],
       response: `{ "status": 200, "file_id": "8b1f…", "deleted": true, "size": 20480, "storage": { "used": 0 } }`,
     })}
     <h3>大文件直传完整流程</h3>
     <ol>
       <li>网页带登录 Cookie 请求 <code>POST /api/files/presign</code>，拿到 <code>file_id</code>、<code>upload_url</code> 和 <code>headers</code>；</li>
       <li>浏览器用 <code>PUT</code> 把文件直接发到 <code>upload_url</code>，<code>Content-Type</code> 必须与 presign 时一致；</li>
       <li>PUT 成功后请求 <code>POST /api/files/complete</code>，Worker 用 <code>HEAD</code> 读取真实大小、占用配额并写入文件列表。</li>
     </ol>
     ${codeBlock(`// 1. 预签名（同源，自动带登录 Cookie）
const presign = await fetch('/api/files/presign', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    name: file.name,
    size: file.size,
    content_type: file.type || 'application/octet-stream',
    private: true,
  }),
}).then((response) => response.json());

// 2. 直接 PUT 到 R2（不经过 Worker，不携带 Cookie）
await fetch(presign.upload_url, {
  method: 'PUT',
  headers: presign.headers,
  body: file,
});

// 3. 登记元数据并占用配额
await fetch('/api/files/complete', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    file_id: presign.file_id,
    name: file.name,
    content_type: file.type || 'application/octet-stream',
    private: true,
  }),
});`)}
     <p class="field-hint">R2 桶 CORS 必须允许你的站点来源、<code>PUT</code> 方法和 <code>content-type</code> 请求头；否则浏览器会在预检阶段拦截。预签名 URL 是 bearer token，15 分钟内有效，请勿写入日志或公开分享。</p>
     <h3>API Key 支持范围</h3>
     <div class="table-wrap docs-table-wrap"><table class="docs-table">
       <thead><tr><th>接口</th><th>API Key</th><th>登录态</th><th>说明</th></tr></thead>
       <tbody>
         <tr><td><code>/api/uploadfile</code></td><td>✅</td><td>✅</td><td>小文件 / Worker 限额内</td></tr>
         <tr><td><code>/api/downloadfile</code></td><td>✅</td><td>✅</td><td>私有文件仅所有者</td></tr>
         <tr><td><code>/api/deletefile</code></td><td>✅</td><td>✅</td><td>删除并释放配额</td></tr>
         <tr><td><code>/api/files/list</code></td><td>❌</td><td>✅</td><td>网页后台文件列表</td></tr>
         <tr><td><code>/api/files/presign</code></td><td>❌</td><td>✅</td><td>大文件直传预签名</td></tr>
         <tr><td><code>/api/files/complete</code></td><td>❌</td><td>✅</td><td>直传完成登记</td></tr>
         <tr><td><code>/api/files/download-url</code></td><td>✅</td><td>✅</td><td>直传文件预签名下载直链</td></tr>
         <tr><td><code>/api/files/visibility</code></td><td>❌</td><td>✅</td><td>切换公开/私有</td></tr>
       </tbody>
     </table></div>
     <p class="field-hint">大文件直传目前只对网页登录态开放；第三方 API 客户端如需大文件，请先使用 <code>/api/uploadfile</code>（受 Worker 限制），或等待后续 multipart 接口。</p>
     <h3>网页后台接口</h3>
     ${endpoint({
       path: '/api/files/list',
       desc: '当前用户的文件列表、配额、当前存储后端与直传状态（需要登录）。',
       response: `{ "status": 200, "files": [ { "id": "8b1f…", "name": "report.pdf", "size": 20480, "private": true, "backend": "d1", "encrypted": true, "url_path": "/api/downloadfile?id=8b1f…" } ], "storage": { "quota": 52428800, "used": 20480 }, "storage_backend": "d1", "storage_setting": "auto", "r2_available": false, "direct_upload": { "available": false, "threshold": 20971520, "max_size": 5363449856 } }`,
     })}
     ${endpoint({
       path: '/api/files/presign',
       desc: '大文件直传：生成 R2 预签名 PUT URL（需要登录）。',
       params: [
         ['name', true, '文件名，最多 200 字符'],
         ['size', true, '文件字节数，用于提前检查剩余配额'],
         ['content_type', false, '默认 <code>application/octet-stream</code>，须与 PUT 一致'],
         ['private', false, '是否需要 API Key 才能下载'],
       ],
       note: '返回的 <code>upload_url</code> 15 分钟内有效；浏览器直接 PUT 到 R2，不经过 Worker。只支持登录态；R2 桶需配置 CORS（允许来源、PUT 和 <code>content-type</code>），且 <code>R2_BUCKET_NAME</code> 必须与 <code>FILES</code> 绑定桶一致。',
       response: `{ "status": 200, "file_id": "8b1f…", "upload_url": "https://<bucket>.<account>.r2.cloudflarestorage.com/files/1/8b1f…?X-Amz-…", "method": "PUT", "headers": { "content-type": "application/pdf" }, "expires_in": 900 }`,
     })}
     ${endpoint({
       path: '/api/files/complete',
       desc: '直传完成后登记文件，Worker 用 HEAD 校验实际大小并占用配额（需要登录）。',
       params: [
         ['file_id', true, 'presign 返回的 ID'],
         ['name', true, '文件名'],
         ['content_type', false, '与 PUT 时一致'],
         ['private', false, '是否私有'],
       ],
       note: '对象不存在返回 <code>404 upload_not_found</code>；实际大小超过剩余配额返回 <code>413 storage_quota_exceeded</code>，并自动删除 R2 对象。直传文件只依赖 R2 服务端加密（<code>encrypted: false</code>）。',
       response: `{ "status": 200, "file_id": "8b1f…", "name": "report.pdf", "size": 20480, "encrypted": false, "backend": "r2", "direct": true, "storage": { "used": 20480 } }`,
     })}
     ${endpoint({
       path: '/api/files/visibility',
       desc: '切换单个文件的私有/公开状态（需要登录）。',
       params: [
         ['id', true, '文件 ID'],
         ['private', true, '<code>true</code> 表示需要 API Key 才能下载'],
       ],
       response: `{ "status": 200, "file_id": "8b1f…", "private": true }`,
     })}`,
  );

  const admin = section(
    'admin',
    '管理接口',
    `<p>以下接口需要管理员登录态（普通用户返回 <code>403 admin_required</code>）。</p>
     ${endpoint({
       path: '/api/admin/stats',
       desc: '平台统计：用户、信息、反馈、文件与存储用量。',
       response: `{ "status": 200, "stats": { "users": 3, "information": 8, "feedback": 12, "files": 5, "storage_used": 204800, "default_storage_quota": 52428800 } }`,
     })}
     ${endpoint({
       path: '/api/admin/codes/create',
       desc: '生成注册码，明文只返回一次。',
       params: [
         ['label', false, '备注，最多 40 字符'],
         ['max_uses', false, '可用次数，默认 1，最大 100'],
         ['expires_in_days', false, '有效天数，0 表示永久，默认 7'],
       ],
       response: `{ "status": 200, "code": "AB3D-EFGH-JKLM-NPQR", "registration_code": { "id": 1, "max_uses": 1, "status": "active" } }`,
     })}
     ${endpoint({
       path: '/api/admin/storage',
       desc: '查看/设置新用户默认存储空间与文件存储后端（只影响之后注册的用户与新文件）。',
       params: [
         ['default_quota_mb', false, '默认空间（MB），0-10240；省略时只查询'],
         ['backend', false, '文件后端：<code>auto</code> / <code>d1</code> / <code>r2</code>；选 r2 前需绑定 FILES'],
       ],
       response: `{ "status": 200, "default_quota": 52428800, "default_quota_mb": 50, "total_used": 204800, "file_count": 5, "storage_setting": "auto", "storage_backend": "d1", "r2_available": false }`,
     })}
     ${endpoint({
       path: '/api/admin/users/storage',
       desc: '调整某个已注册用户的存储空间。',
       params: [
         ['id', true, '用户 ID'],
         ['quota_mb', true, '空间大小（MB），0 表示禁止上传'],
       ],
       response: `{ "status": 200, "id": 2, "username": "alice", "storage": { "quota": 104857600, "used": 204800, "file_count": 5 } }`,
     })}
     ${endpoint({
       path: '/api/admin/users/list',
       desc: '用户列表，包含信息数、反馈数、文件数与存储用量。',
     })}`,
  );

  const reference = section(
    'errors',
    '错误码与限制',
    `<div class="table-wrap docs-table-wrap"><table class="docs-table">
      <thead><tr><th>HTTP</th><th>error</th><th>说明</th></tr></thead>
      <tbody>
        <tr><td>400</td><td><code>missing_*</code> / <code>invalid_*</code></td><td>参数缺失或格式不正确</td></tr>
        <tr><td>400</td><td><code>invalid_code</code> / <code>expired_code</code></td><td>注册码无效、用完、吊销或过期</td></tr>
        <tr><td>400</td><td><code>presigned_download_unavailable</code></td><td>文件不是 R2 直传文件，不能生成预签名下载</td></tr>
        <tr><td>401</td><td><code>auth_required</code> / <code>invalid_api_key</code></td><td>未登录或 API Key 无效</td></tr>
        <tr><td>403</td><td><code>api_key_required</code></td><td>私有信息/文件需要所有者 API Key</td></tr>
        <tr><td>403</td><td><code>feedback_disabled</code> / <code>admin_required</code></td><td>反馈未开启 / 需要管理员</td></tr>
        <tr><td>404</td><td><code>not_found</code> / <code>file_not_found</code> / <code>upload_not_found</code></td><td>资源不存在</td></tr>
        <tr><td>413</td><td><code>storage_quota_exceeded</code></td><td>剩余存储空间不足</td></tr>
        <tr><td>416</td><td>—（无 JSON body）</td><td>Range 越界，响应头含 <code>content-range: bytes */总大小</code></td></tr>
        <tr><td>503</td><td><code>direct_upload_unavailable</code></td><td>未配置 R2 直传或后端不是 R2</td></tr>
        <tr><td>429</td><td><code>rate_limited</code></td><td>触发限流，响应带 <code>Retry-After</code></td></tr>
      </tbody>
    </table></div>
    <h3>配额与大小</h3>
    <ul class="docs-list">
      <li>默认存储空间：50 MB/用户（可通过 <code>DEFAULT_STORAGE_QUOTA_MB</code> 或管理后台调整）</li>
      <li>单文件大小：不设独立上限，只受用户剩余存储空间限制</li>
      <li>R2 直传：单次 PUT 上限约 4.995 GiB；超过 <code>DIRECT_UPLOAD_THRESHOLD_MB</code>（默认 20 MB）的文件自动走直传</li>
      <li>固定信息：最多 500 条/用户，单条 value 最多 100,000 字符</li>
      <li>反馈：单条消息最多 10,000 字符，每个会话最多 500 条消息</li>
      <li>API Key：最多 20 个/用户；注册码：最多 100 次使用</li>
    </ul>`,
  );

  return `<header class="page-header">
      <div>
        <h1 class="page-title">API 文档</h1>
        <p class="page-subtitle">面向脚本与第三方系统的接口说明；网页后台的请求会自动携带登录态。</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-secondary" href="https://github.com/JiaHui-Nie/MessageDispatchPlatform" target="_blank" rel="noopener noreferrer">GitHub 仓库</a>
      </div>
    </header>
    <div class="docs-layout">
      <aside class="docs-nav">
        <div class="docs-nav-group"><span>开始</span>
          <button type="button" data-doc="quickstart">快速开始</button>
          <button type="button" data-doc="auth">认证方式</button>
        </div>
        <div class="docs-nav-group"><span>接口</span>
          <button type="button" data-doc="information">信息分发</button>
          <button type="button" data-doc="feedback">反馈</button>
          <button type="button" data-doc="files">文件存储</button>
          <button type="button" data-doc="admin">管理接口</button>
        </div>
        <div class="docs-nav-group"><span>参考</span>
          <button type="button" data-doc="errors">错误码与限制</button>
        </div>
      </aside>
      <article class="docs-content">
        ${quickstart}
        ${auth}
        ${information}
        ${feedback}
        ${files}
        ${admin}
        ${reference}
      </article>
    </div>`;
}
