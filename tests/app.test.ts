import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createHarness, createUser, ORIGIN, setupAdmin, TestClient, TEST_SECRET } from './helpers/harness.ts';
import { ShimD1 } from './helpers/d1.ts';
import { handleRequest } from '../src/app.ts';
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from '../src/db/schema.generated.ts';

const MB = 1024 * 1024;

function textFile(content: string | Uint8Array, name = 'hello.txt', type = 'text/plain'): FormData {
  const form = new FormData();
  form.append('file', new File([content], name, { type }));
  return form;
}

function byteFile(size: number, name = 'blob.bin'): FormData {
  return textFile(new Uint8Array(size).fill(97), name, 'application/octet-stream');
}

const TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

function assertTimeFormat(value: unknown, label = 'time'): void {
  assert.equal(typeof value, 'string', `${label} 应该是字符串`);
  assert.match(String(value), TIME_PATTERN, `${label} 格式应为 YYYY-MM-DD HH:mm，实际为 ${String(value)}`);
}

describe('健康检查与初始化', () => {
  it('首次访问报告未初始化，并自动创建表结构', async () => {
    const harness = createHarness();
    const health = await harness.client.get<Record<string, unknown>>('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.data.secret_configured, true);
    assert.equal(health.data.database, 'ok');
    assert.equal(health.data.needs_setup, true);

    const status = await harness.client.post<Record<string, unknown>>('/api/auth/status');
    assert.equal(status.status, 200);
    assert.equal(status.data.needs_setup, true);
    assert.equal(status.data.authenticated, false);
    assert.equal(status.data.configured, true);

    // 首次请求后表已自动创建
    const table = harness.db.raw
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
      .get() as { name?: string } | undefined;
    assert.equal(table?.name, 'users');
  });

  it('管理员初始化：校验密码强度、只能执行一次、登录可用', async () => {
    const harness = createHarness();

    const weak = await harness.client.post('/api/auth/setup', { password: '12345678' });
    assert.equal(weak.status, 400);
    assert.equal(weak.data.error, 'weak_password');

    const missing = await harness.client.post('/api/auth/setup', {});
    assert.equal(missing.status, 400);

    const setup = await harness.client.post<{ user: Record<string, unknown> }>('/api/auth/setup', {
      password: 'AdminPass123',
    });
    assert.equal(setup.status, 200);
    assert.equal(setup.data.user.username, 'admin');
    assert.equal(setup.data.user.role, 'admin');

    const cookie = setup.headers.get('set-cookie') ?? '';
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//);

    const again = await harness.client.post('/api/auth/setup', { password: 'AnotherPass123' });
    assert.equal(again.status, 409);
    assert.equal(again.data.error, 'already_setup');

    const fresh = new TestClient(harness.env);
    const wrong = await fresh.post('/api/auth/login', { username: 'admin', password: 'WrongPass123' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.data.error, 'invalid_credentials');

    const login = await fresh.post<{ user: Record<string, unknown> }>('/api/auth/login', {
      username: 'ADMIN',
      password: 'AdminPass123',
    });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.username, 'admin');

    const me = await fresh.post<{ user: Record<string, unknown> }>('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.data.user.username, 'admin');

    const status = await fresh.post<Record<string, unknown>>('/api/auth/status');
    assert.equal(status.data.needs_setup, false);
    assert.equal(status.data.authenticated, true);
  });

  it('缺少 JWT_SECRET 时给出明确错误而不是崩溃', async () => {
    const harness = createHarness({ JWT_SECRET: '' });
    const status = await harness.client.post<Record<string, unknown>>('/api/auth/status');
    assert.equal(status.status, 200);
    assert.equal(status.data.configured, false);
    assert.match(String(status.data.message), /JWT_SECRET/);

    const login = await harness.client.post('/api/auth/login', { username: 'admin', password: 'AdminPass123' });
    assert.equal(login.status, 500);
    assert.equal(login.data.error, 'missing_secret');
  });
});

describe('注册码与注册', () => {
  it('管理员生成注册码，用户凭注册码注册；注册码只存哈希且不可复用', async () => {
    const harness = createHarness();
    await setupAdmin(harness);

    const created = await harness.client.post<{ code: string; registration_code: Record<string, unknown> }>(
      '/api/admin/codes/create',
      { label: '给 alice', max_uses: 1, expires_in_days: 7 },
    );
    assert.equal(created.status, 200);
    assert.match(created.data.code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    assert.equal(created.data.registration_code.max_uses, 1);
    assertTimeFormat(created.data.registration_code.created_at_display);

    const stored = harness.db.raw.prepare('SELECT code_hash, label FROM registration_codes').get() as {
      code_hash: string;
      label: string;
    };
    assert.match(stored.code_hash, /^[0-9a-f]{64}$/);
    assert.ok(!stored.code_hash.includes(created.data.code.replace(/-/g, '')));
    assert.equal(stored.label, '给 alice');

    const alice = new TestClient(harness.env);
    const registered = await alice.post<{ user: Record<string, unknown> }>('/api/auth/register', {
      username: 'Alice',
      password: 'AlicePass123',
      code: created.data.code,
    });
    assert.equal(registered.status, 200);
    assert.equal(registered.data.user.username, 'alice');
    assert.equal(registered.data.user.role, 'user');

    const reuse = await new TestClient(harness.env).post('/api/auth/register', {
      username: 'bob',
      password: 'BobPass1234',
      code: created.data.code,
    });
    assert.equal(reuse.status, 400);
    assert.equal(reuse.data.error, 'invalid_code');

    // 用户名重复时不应浪费注册码
    const code2 = await harness.client.post<{ code: string }>('/api/admin/codes/create', {});
    const duplicate = await new TestClient(harness.env).post('/api/auth/register', {
      username: 'alice',
      password: 'AlicePass456',
      code: code2.data.code,
    });
    assert.equal(duplicate.status, 409);
    const codeRow = harness.db.raw.prepare('SELECT used_count FROM registration_codes WHERE id = 2').get() as {
      used_count: number;
    };
    assert.equal(Number(codeRow.used_count), 0, '注册失败后注册码次数应回滚');

    const invalid = await new TestClient(harness.env).post('/api/auth/register', {
      username: 'carol',
      password: 'CarolPass123',
      code: 'AAAA-BBBB-CCCC-DDDD',
    });
    assert.equal(invalid.status, 400);
  });

  it('吊销与过期的注册码不可用', async () => {
    const harness = createHarness();
    await setupAdmin(harness);

    const created = await harness.client.post<{ code: string; registration_code: { id: number } }>(
      '/api/admin/codes/create',
      { max_uses: 1, expires_in_days: 7 },
    );
    const revoke = await harness.client.post('/api/admin/codes/revoke', { id: created.data.registration_code.id });
    assert.equal(revoke.status, 200);

    const blocked = await new TestClient(harness.env).post('/api/auth/register', {
      username: 'dave',
      password: 'DavePass1234',
      code: created.data.code,
    });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.data.error, 'invalid_code');

    // 手动把注册码改成已过期
    const expiredCode = await harness.client.post<{ code: string; registration_code: { id: number } }>(
      '/api/admin/codes/create',
      {},
    );
    harness.db.raw
      .prepare('UPDATE registration_codes SET expires_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', expiredCode.data.registration_code.id);
    const expired = await new TestClient(harness.env).post('/api/auth/register', {
      username: 'erin',
      password: 'ErinPass1234',
      code: expiredCode.data.code,
    });
    assert.equal(expired.status, 400);
    assert.equal(expired.data.error, 'expired_code');
  });
});

describe('API Key 与固定信息', () => {
  it('创建/列出/删除 API Key，密钥只存哈希与密文', async () => {
    const harness = createHarness();
    await setupAdmin(harness);
    const { client } = await createUser(harness, { username: 'alice' });

    const created = await client.post<{ api_key: Record<string, unknown> }>('/api/apikeys/create', { name: '监控脚本' });
    assert.equal(created.status, 200);
    const plain = String(created.data.api_key.key);
    assert.match(plain, /^mdp_[0-9a-f]{48}$/);

    const listed = await client.post<{ api_keys: Array<Record<string, unknown>> }>('/api/apikeys/list');
    assert.equal(listed.data.api_keys.length, 1);
    assert.equal(listed.data.api_keys[0]?.name, '监控脚本');
    assert.equal(listed.data.api_keys[0]?.key, plain);

    const raw = harness.db.raw.prepare('SELECT key_hash, key_enc FROM api_keys').get() as {
      key_hash: string;
      key_enc: string;
    };
    assert.match(raw.key_hash, /^[0-9a-f]{64}$/);
    assert.ok(raw.key_enc.startsWith('v1.'), 'API Key 应加密存储');
    assert.ok(!raw.key_enc.includes(plain));

    const removed = await client.post('/api/apikeys/delete', { id: created.data.api_key.id });
    assert.equal(removed.status, 200);
    const empty = await client.post<{ api_keys: unknown[] }>('/api/apikeys/list');
    assert.equal(empty.data.api_keys.length, 0);
  });

  it('setinformation / getinformation / deleteinformation 全流程，值在数据库中加密', async () => {
    const harness = createHarness();
    await setupAdmin(harness);
    const { client } = await createUser(harness, { username: 'alice' });
    const keyResponse = await client.post<{ api_key: { key: string } }>('/api/apikeys/create', { name: 'script' });
    const apiKey = keyResponse.data.api_key.key;

    const apiClient = new TestClient(harness.env);
    const set = await apiClient.post<Record<string, unknown>>('/api/setinformation', {
      user_name: 'alice',
      api_key: apiKey,
      key: 'notice',
      value: 'hello world',
    });
    assert.equal(set.status, 200);
    assert.equal(set.data.status, 200);
    assert.equal(set.data.created, true);

    const row = harness.db.raw.prepare('SELECT value_enc FROM information WHERE info_key = ?').get('notice') as {
      value_enc: string;
    };
    assert.ok(row.value_enc.startsWith('v1.'), 'value 必须以 AES-GCM 密文存储');
    assert.ok(!row.value_enc.includes('hello world'));

    // 公开信息无需 api_key
    const got = await new TestClient(harness.env).post<Record<string, unknown>>('/api/getinformation', {
      user_name: 'alice',
      key: 'notice',
    });
    assert.equal(got.status, 200);
    assert.equal(got.data.value, 'hello world');
    assertTimeFormat(got.data.updated_at);

    // 再次写入是更新而不是新增
    const updated = await apiClient.post<Record<string, unknown>>('/api/setinformation', {
      user_name: 'alice',
      api_key: apiKey,
      key: 'notice',
      value: 'hello again',
    });
    assert.equal(updated.data.created, false);
    const count = harness.db.raw.prepare('SELECT COUNT(*) AS total FROM information').get() as { total: number };
    assert.equal(Number(count.total), 1);

    // 路径写法 /api/setinformation/:username
    const byPath = await apiClient.post('/api/setinformation/alice', {
      api_key: apiKey,
      key: 'path-key',
      value: 'from path',
    });
    assert.equal(byPath.status, 200);

    // 私有信息必须带正确的 api_key
    const privateSet = await apiClient.post('/api/setinformation', {
      user_name: 'alice',
      api_key: apiKey,
      key: 'secret',
      value: 'top secret',
      visible: false,
    });
    assert.equal(privateSet.status, 200);

    const denied = await new TestClient(harness.env).post('/api/getinformation', { user_name: 'alice', key: 'secret' });
    assert.equal(denied.status, 403);
    assert.equal(denied.data.error, 'api_key_required');

    const allowed = await apiClient.post<Record<string, unknown>>('/api/getinformation', {
      user_name: 'alice',
      key: 'secret',
      api_key: apiKey,
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.data.value, 'top secret');

    // 未登录用户不能删除
    const anonymousDelete = await new TestClient(harness.env).post('/api/deleteinformation', {
      user_name: 'alice',
      key: 'notice',
    });
    assert.equal(anonymousDelete.status, 401);

    const deleted = await apiClient.post('/api/deleteinformation', {
      user_name: 'alice',
      api_key: apiKey,
      key: 'notice',
    });
    assert.equal(deleted.status, 200);
    const gone = await new TestClient(harness.env).post('/api/getinformation', { user_name: 'alice', key: 'notice' });
    assert.equal(gone.status, 404);
  });

  it('越权：他人 api_key 不能操作用户的数据', async () => {
    const harness = createHarness();
    await setupAdmin(harness);
    const alice = await createUser(harness, { username: 'alice' });
    const bob = await createUser(harness, { username: 'bob' });
    const bobKey = await bob.client.post<{ api_key: { key: string } }>('/api/apikeys/create', { name: 'bob' });

    const aliceSet = await alice.client.post('/api/setinformation', { key: 'notice', value: 'alice data' });
    assert.equal(aliceSet.status, 200);

    const mismatch = await new TestClient(harness.env).post('/api/setinformation', {
      user_name: 'alice',
      api_key: bobKey.data.api_key.key,
      key: 'notice',
      value: 'hijacked',
    });
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.data.error, 'user_mismatch');

    const cannotDelete = await new TestClient(harness.env).post('/api/deleteinformation', {
      user_name: 'alice',
      api_key: bobKey.data.api_key.key,
      key: 'notice',
    });
    assert.equal(cannotDelete.status, 403);

    const stillThere = await new TestClient(harness.env).post<{ value: string }>('/api/getinformation', {
      user_name: 'alice',
      key: 'notice',
    });
    assert.equal(stillThere.data.value, 'alice data');

    const bobList = await bob.client.post<{ information: unknown[] }>('/api/information/list');
    assert.equal(bobList.data.information.length, 0);
  });
});

describe('反馈', () => {
  it('反馈全流程：开关、提交、会话对话、回复、清单、删除', async () => {
    const harness = createHarness();
    await setupAdmin(harness);
    const alice = await createUser(harness, { username: 'alice' });
    const keyResponse = await alice.client.post<{ api_key: { key: string } }>('/api/apikeys/create', { name: 'reply' });
    const apiKey = keyResponse.data.api_key.key;

    // 默认关闭
    const disabled = await new TestClient(harness.env).post('/api/sendfeedback', {
      user_name: 'alice',
      feedback: '你好',
    });
    assert.equal(disabled.status, 403);
    assert.equal(disabled.data.error, 'feedback_disabled');

    const enabled = await alice.client.post<Record<string, unknown>>('/api/feedback/settings', {
      enabled: true,
      intro: '欢迎留言',
    });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.data.enabled, true);

    const visitor = new TestClient(harness.env);
    const submitted = await visitor.post<Record<string, unknown>>('/api/sendfeedback', {
      user_name: 'alice',
      feedback: '这是第一条反馈',
    });
    assert.equal(submitted.status, 200);
    const sessionId = String(submitted.data.session_id);
    assert.match(sessionId, /^[0-9a-f]{48}$/);
    assertTimeFormat(submitted.data.created_at);

    const sessionRow = harness.db.raw
      .prepare('SELECT title_enc FROM feedback_sessions WHERE session_id = ?')
      .get(sessionId) as { title_enc: string };
    assert.ok(sessionRow.title_enc.startsWith('v1.'));

    const messageRow = harness.db.raw
      .prepare('SELECT body_enc FROM feedback_messages WHERE session_id = ?')
      .get(sessionId) as { body_enc: string };
    assert.ok(messageRow.body_enc.startsWith('v1.'));
    assert.ok(!messageRow.body_enc.includes('这是第一条反馈'));

    const thread = await visitor.post<Record<string, any>>('/api/getfeedbackbysessionid', { session_id: sessionId });
    assert.equal(thread.status, 200);
    assert.equal(thread.data.title, '这是第一条反馈');
    assert.equal(thread.data.status, 'unread');
    assert.equal(thread.data.chat.length, 1);
    assert.equal(thread.data.chat[0].type, 'feedback');
    assert.equal(thread.data.chat[0].information, '这是第一条反馈');
    assertTimeFormat(thread.data.chat[0].time);

    // 访客追加
    const followUp = await visitor.post<Record<string, unknown>>('/api/sendfeedbackbysessionid', {
      session_id: sessionId,
      feedback: '补充一下',
    });
    assert.equal(followUp.status, 200);
    assert.equal(followUp.data.type, 'feedback');

    // 所有者用 api_key 回复
    const reply = await new TestClient(harness.env).post<Record<string, unknown>>('/api/sendfeedbackbysessionid', {
      session_id: sessionId,
      feedback: '收到，谢谢反馈',
      api_key: apiKey,
    });
    assert.equal(reply.status, 200);
    assert.equal(reply.data.type, 'reply');

    // 他人的 api_key 不能回复
    const bob = await createUser(harness, { username: 'bob' });
    const bobKey = await bob.client.post<{ api_key: { key: string } }>('/api/apikeys/create', { name: 'bob' });
    const hijack = await new TestClient(harness.env).post('/api/sendfeedbackbysessionid', {
      session_id: sessionId,
      feedback: '越权回复',
      api_key: bobKey.data.api_key.key,
    });
    assert.equal(hijack.status, 401);

    const detail = await visitor.post<Record<string, any>>('/api/getfeedbackbysessionid', { session_id: sessionId });
    assert.equal(detail.data.chat.length, 3);
    assert.equal(detail.data.chat[2].type, 'reply');
    assert.equal(detail.data.chat[2].information, '收到，谢谢反馈');

    const list = await new TestClient(harness.env).post<Record<string, any>>('/api/getfeedbacklist', {
      user_name: 'alice',
      api_key: apiKey,
    });
    assert.equal(list.status, 200);
    assert.equal(list.data.feedback.length, 1);
    assert.equal(list.data.feedback[0].session_id, sessionId);
    assertTimeFormat(list.data.feedback[0].update_time);

    // 未授权获取清单
    const anonymousList = await new TestClient(harness.env).post('/api/getfeedbacklist', { user_name: 'alice' });
    assert.equal(anonymousList.status, 401);

    // 后台：未读 -> 已读 -> 回复 -> 删除
    const uiList = await alice.client.post<Record<string, any>>('/api/feedback/list');
    assert.equal(uiList.data.counts.all, 1);
    assert.equal(uiList.data.counts.unread, 0, '所有者回复后应自动标记为已读');
    assert.equal(uiList.data.settings.enabled, true);
    assert.equal(uiList.data.settings.intro, '欢迎留言');

    const uiThread = await alice.client.post<Record<string, any>>('/api/feedback/get', { session_id: sessionId });
    assert.equal(uiThread.status, 200);
    assert.equal(uiThread.data.status, 'read');

    const uiReply = await alice.client.post('/api/feedback/reply', { session_id: sessionId, message: '已经处理' });
    assert.equal(uiReply.status, 200);

    const afterReply = await alice.client.post<Record<string, any>>('/api/feedback/list');
    assert.equal(afterReply.data.feedback[0].message_count, 4);

    // 别人不能读取该会话
    const notOwner = await bob.client.post('/api/feedback/get', { session_id: sessionId });
    assert.equal(notOwner.status, 404);

    // 文档中的 deletefeedback 使用 key（实际是 session_id）
    const deleted = await new TestClient(harness.env).post('/api/deletefeedback', {
      user_name: 'alice',
      api_key: apiKey,
      key: sessionId,
    });
    assert.equal(deleted.status, 200);
    const gone = await visitor.post('/api/getfeedbackbysessionid', { session_id: sessionId });
    assert.equal(gone.status, 404);
    const messages = harness.db.raw
      .prepare('SELECT COUNT(*) AS total FROM feedback_messages WHERE session_id = ?')
      .get(sessionId) as { total: number };
    assert.equal(Number(messages.total), 0, '删除反馈应级联删除消息');
  });

  it('支持自定义标题、状态筛选与公开资料查询', async () => {
    const harness = createHarness();
    await setupAdmin(harness);
    const alice = await createUser(harness, { username: 'alice' });
    await alice.client.post('/api/feedback/settings', { enabled: true });

    const profile = await new TestClient(harness.env).post<Record<string, unknown>>('/api/public/profile', {
      user_name: 'alice',
    });
    assert.equal(profile.data.exists, true);
    assert.equal(profile.data.enabled, true);
    assert.equal(profile.data.display_name, 'alice');

    const missing = await new TestClient(harness.env).post<Record<string, unknown>>('/api/public/profile', {
      user_name: 'nobody',
    });
    assert.equal(missing.data.exists, false);

    const created = await new TestClient(harness.env).post<Record<string, unknown>>('/api/sendfeedback', {
      user_name: 'alice',
      feedback: '标题自定义的反馈',
      title: '登录异常',
    });
    assert.equal(created.data.title, '登录异常');

    const unread = await alice.client.post<Record<string, any>>('/api/feedback/list', { status: 'unread' });
    assert.equal(unread.data.feedback.length, 1);
    const read = await alice.client.post<Record<string, any>>('/api/feedback/list', { status: 'read' });
    assert.equal(read.data.feedback.length, 0);

    const readIt = await alice.client.post('/api/feedback/read', { session_id: created.data.session_id });
    assert.equal(readIt.status, 200);
    const afterRead = await alice.client.post<Record<string, any>>('/api/feedback/list', { status: 'read' });
    assert.equal(afterRead.data.feedback.length, 1);
    assert.equal(afterRead.data.counts.unread, 0);
  });
});

describe('安全与鉴权', () => {
  it('被篡改或过期的 JWT 会被拒绝', async () => {
    const harness = createHarness();
    await setupAdmin(harness);
    await createUser(harness, { username: 'alice' });

    const tampered = new TestClient(harness.env);
    const cookie = harness.client.cookie;
    assert.ok(cookie);
    const token = cookie.slice('mdp_session='.length);
    const parts = token.split('.');
    const signature = parts[2] ?? '';
    parts[2] = `${signature.slice(0, -2)}${signature.slice(-2) === 'AA' ? 'BB' : 'AA'}`;
    tampered.cookie = `mdp_session=${parts.join('.')}`;
    const denied = await tampered.post('/api/auth/me');
    assert.equal(denied.status, 401);

    // 过期 token：用同一密钥签发一个 exp 已过期的 JWT
    const { signSessionToken } = await import('../src/lib/crypto.ts');
    const expired = await signSessionToken(TEST_SECRET, {
      sub: 1,
      name: 'admin',
      role: 'admin',
      ver: 0,
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
    });
    const expiredClient = new TestClient(harness.env);
    expiredClient.cookie = `mdp_session=${expired}`;
    const expiredResponse = await expiredClient.post('/api/auth/me');
    assert.equal(expiredResponse.status, 401);
  });

  it('修改密码后旧 token 失效，新密码可登录', async () => {
    const harness = createHarness();
    await setupAdmin(harness);
    const alice = await createUser(harness, { username: 'alice' });
    const oldCookie = alice.client.cookie;

    const changed = await alice.client.post('/api/auth/password', {
      current_password: 'UserPass123',
      new_password: 'NewPass456',
    });
    assert.equal(changed.status, 200);

    const stale = new TestClient(harness.env);
    stale.cookie = oldCookie;
    const denied = await stale.post('/api/auth/me');
    assert.equal(denied.status, 401);

    const oldLogin = await new TestClient(harness.env).post('/api/auth/login', {
      username: 'alice',
      password: 'UserPass123',
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await new TestClient(harness.env).post('/api/auth/login', {
      username: 'alice',
      password: 'NewPass456',
    });
    assert.equal(newLogin.status, 200);

    const wrongCurrent = await alice.client.post('/api/auth/password', {
      current_password: 'Nope12345',
      new_password: 'Another789',
    });
    assert.equal(wrongCurrent.status, 400);
  });

  it('普通用户不能访问管理接口', async () => {
    const harness = createHarness();
    await setupAdmin(harness);
    const alice = await createUser(harness, { username: 'alice' });

    for (const path of ['/api/admin/stats', '/api/admin/codes/list', '/api/admin/users/list']) {
      const response = await alice.client.post(path);
      assert.equal(response.status, 403, path);
      assert.equal(response.data.error, 'admin_required');
    }
    const codeCreate = await alice.client.post('/api/admin/codes/create', {});
    assert.equal(codeCreate.status, 403);
  });

  it('拒绝跨站请求与非法请求体', async () => {
    const harness = createHarness();
    await setupAdmin(harness);

    const crossSite = await harness.client.request('POST', '/api/auth/status', {}, { origin: 'https://evil.example.com' });
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.data.error, 'cross_origin_denied');

    const badJson = await harness.client.postRaw('/api/auth/login', 'not-json{');
    assert.equal(badJson.status, 400);
    assert.equal(badJson.data.error, 'invalid_json');

    const missingRoute = await harness.client.post('/api/does-not-exist');
    assert.equal(missingRoute.status, 404);

    const wrongMethod = await harness.client.request('GET', '/api/setinformation');
    assert.equal(wrongMethod.status, 405);

    const missingParam = await harness.client.post('/api/sendfeedback', {});
    assert.equal(missingParam.status, 400);
    assert.equal(missingParam.data.error, 'missing_user_name');
  });

  it('登录失败次数过多会触发限流', async () => {
    const harness = createHarness({ RATE_LIMIT_DISABLED: undefined });
    await setupAdmin(harness);
    const client = new TestClient(harness.env);

    let last: { status: number; data: Record<string, unknown> } | null = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      last = await client.post('/api/auth/login', { username: 'admin', password: 'WrongPass123' });
      if (last.status === 429) break;
    }
    assert.ok(last);
    assert.equal(last.status, 429);
    assert.equal(last.data.error, 'rate_limited');
  });
});

describe('管理后台', () => {
  it('统计、用户列表、重置密码与删除用户', async () => {
    const harness = createHarness();
    await setupAdmin(harness);
    const alice = await createUser(harness, { username: 'alice' });
    await alice.client.post('/api/setinformation', { key: 'notice', value: 'hi' });
    await alice.client.post('/api/feedback/settings', { enabled: true });
    await new TestClient(harness.env).post('/api/sendfeedback', { user_name: 'alice', feedback: '反馈内容' });

    const stats = await harness.client.post<{ stats: Record<string, number> }>('/api/admin/stats');
    assert.equal(stats.status, 200);
    assert.equal(stats.data.stats.users, 2);
    assert.equal(stats.data.stats.admins, 1);
    assert.equal(stats.data.stats.information, 1);
    assert.equal(stats.data.stats.feedback, 1);
    assert.equal(stats.data.stats.unread, 1);

    const users = await harness.client.post<{ users: Array<Record<string, unknown>> }>('/api/admin/users/list');
    assert.equal(users.data.users.length, 2);
    const aliceRow = users.data.users.find((user) => user.username === 'alice');
    assert.ok(aliceRow);
    assert.equal(aliceRow.info_count, 1);
    assert.equal(aliceRow.feedback_count, 1);
    assertTimeFormat(aliceRow.created_at_display);

    const reset = await harness.client.post('/api/admin/users/reset-password', {
      id: aliceRow.id,
      new_password: 'ResetPass789',
    });
    assert.equal(reset.status, 200);

    const oldLogin = await new TestClient(harness.env).post('/api/auth/login', {
      username: 'alice',
      password: 'UserPass123',
    });
    assert.equal(oldLogin.status, 401);
    const newLogin = await new TestClient(harness.env).post('/api/auth/login', {
      username: 'alice',
      password: 'ResetPass789',
    });
    assert.equal(newLogin.status, 200);

    const selfDelete = await harness.client.post('/api/admin/users/delete', { id: 1 });
    assert.equal(selfDelete.status, 400);
    assert.equal(selfDelete.data.error, 'cannot_delete_self');

    const deleted = await harness.client.post('/api/admin/users/delete', { id: aliceRow.id });
    assert.equal(deleted.status, 200);
    const remaining = harness.db.raw.prepare('SELECT COUNT(*) AS total FROM users').get() as { total: number };
    assert.equal(Number(remaining.total), 1);
    const orphanInfo = harness.db.raw.prepare('SELECT COUNT(*) AS total FROM information').get() as { total: number };
    assert.equal(Number(orphanInfo.total), 0, '删除用户应级联删除其数据');
  });
});

describe('文件存储', () => {
  it('上传文件后分块加密存储，可下载、列出并删除', async () => {
    const harness = createHarness();
    await setupAdmin(harness);
    const alice = await createUser(harness, { username: 'alice' });
    const content = `hello 文件存储 ${'x'.repeat(200)}`;

    const upload = await alice.client.upload<Record<string, any>>('/api/uploadfile', textFile(content));
    assert.equal(upload.status, 200);
    assert.equal(upload.data.status, 200);
    const fileId = String(upload.data.file_id);
    assert.match(fileId, /^[0-9a-f]{48}$/);
    assert.equal(upload.data.name, 'hello.txt');
    assert.equal(upload.data.size, Buffer.byteLength(content));
    assert.equal(upload.data.private, false);
    assert.match(String(upload.data.download_url), /\/api\/downloadfile\?id=/);

    const row = harness.db.raw.prepare('SELECT name_enc, size, chunk_count FROM files WHERE id = ?').get(fileId) as {
      name_enc: string;
      size: number;
      chunk_count: number;
    };
    assert.ok(row.name_enc.startsWith('v1.'));
    assert.ok(!row.name_enc.includes('hello'));
    assert.equal(Number(row.size), Buffer.byteLength(content));
    assert.equal(Number(row.chunk_count), 1);

    const chunk = harness.db.raw.prepare('SELECT data FROM file_chunks WHERE file_id = ?').get(fileId) as {
      data: Uint8Array;
    };
    const chunkText = Buffer.from(chunk.data).toString('utf8');
    assert.ok(!chunkText.includes('hello'));
    assert.ok(!chunkText.includes('文件存储'));

    const response = await new TestClient(harness.env).download(String(upload.data.url_path));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-api-status'), '200');
    assert.match(response.headers.get('content-disposition') ?? '', /^attachment;/);
    assert.match(response.headers.get('content-disposition') ?? '', /filename\*=UTF-8''/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(Buffer.from(bytes).toString('utf8'), content);

    const head = await handleRequest(
      new Request(`${ORIGIN}${upload.data.url_path}`, { method: 'HEAD' }),
      harness.env,
    );
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(content)));

    const list = await alice.client.post<Record<string, any>>('/api/files/list');
    assert.equal(list.data.files.length, 1);
    assert.equal(list.data.files[0].name, 'hello.txt');
    assert.equal(list.data.storage.used, Buffer.byteLength(content));
    assert.equal(list.data.storage.quota, 50 * MB);
    assert.equal(list.data.storage.file_count, 1);
    assert.equal(list.data.limits.max_file_size, 10 * MB);

    const deleted = await alice.client.post<Record<string, any>>('/api/deletefile', { file_id: fileId });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.data.storage.used, 0);
    const chunks = harness.db.raw.prepare('SELECT COUNT(*) AS total FROM file_chunks WHERE file_id = ?').get(fileId) as {
      total: number;
    };
    assert.equal(Number(chunks.total), 0);
    const gone = await new TestClient(harness.env).download(String(upload.data.url_path));
    assert.equal(gone.status, 404);
  });

  it('私有文件需要所有者 api_key 或登录态才能下载', async () => {
    const harness = createHarness();
    await setupAdmin(harness);
    const alice = await createUser(harness, { username: 'alice' });
    const bob = await createUser(harness, { username: 'bob' });
    const keyResponse = await alice.client.post<{ api_key: { key: string } }>('/api/apikeys/create', { name: 'download' });
    const aliceKey = keyResponse.data.api_key.key;
    const bobKey = await bob.client.post<{ api_key: { key: string } }>('/api/apikeys/create', { name: 'bob' });

    const form = textFile('private secret', 'secret.txt');
    form.append('private', 'true');
    const upload = await new TestClient(harness.env).upload<Record<string, any>>(
      `/api/uploadfile?api_key=${aliceKey}`,
      form,
    );
    assert.equal(upload.status, 200);
    assert.equal(upload.data.private, true);
    const urlPath = String(upload.data.url_path);

    const anonymous = await new TestClient(harness.env).download(urlPath);
    assert.equal(anonymous.status, 403);
    const anonymousBody = (await anonymous.json()) as Record<string, unknown>;
    assert.equal(anonymousBody.error, 'api_key_required');

    const wrongKey = await new TestClient(harness.env).download(`${urlPath}&api_key=${bobKey.data.api_key.key}`);
    assert.equal(wrongKey.status, 403);
    assert.equal(((await wrongKey.json()) as Record<string, unknown>).error, 'invalid_api_key');

    const ownerKey = await new TestClient(harness.env).download(`${urlPath}&api_key=${aliceKey}`);
    assert.equal(ownerKey.status, 200);
    assert.equal(Buffer.from(await ownerKey.arrayBuffer()).toString('utf8'), 'private secret');

    const headerKey = await new TestClient(harness.env).download(urlPath, { 'x-api-key': aliceKey });
    assert.equal(headerKey.status, 200);

    const ownerSession = await alice.client.download(urlPath);
    assert.equal(ownerSession.status, 200);

    const otherSession = await bob.client.download(urlPath);
    assert.equal(otherSession.status, 403);

    const makePublic = await alice.client.post('/api/files/visibility', { id: upload.data.file_id, private: false });
    assert.equal(makePublic.status, 200);
    const publicDownload = await new TestClient(harness.env).download(urlPath);
    assert.equal(publicDownload.status, 200);

    const makePrivate = await alice.client.post('/api/files/visibility', { id: upload.data.file_id, private: true });
    assert.equal(makePrivate.status, 200);
    const deniedAgain = await new TestClient(harness.env).download(urlPath);
    assert.equal(deniedAgain.status, 403);
  });

  it('管理员可设置新用户默认配额与单用户配额，超额上传被拒绝', async () => {
    const harness = createHarness();
    await setupAdmin(harness);
    await createUser(harness, { username: 'alice' });

    const settings = await harness.client.post<Record<string, any>>('/api/admin/storage', { default_quota_mb: 1 });
    assert.equal(settings.status, 200);
    assert.equal(settings.data.default_quota, 1 * MB);
    assert.equal(settings.data.default_quota_mb, 1);

    const bob = await createUser(harness, { username: 'bob' });
    const users = await harness.client.post<Record<string, any>>('/api/admin/users/list');
    assert.equal(users.data.default_quota, 1 * MB);
    const aliceRow = users.data.users.find((user: Record<string, unknown>) => user.username === 'alice');
    const bobRow = users.data.users.find((user: Record<string, unknown>) => user.username === 'bob');
    assert.equal(aliceRow.storage_quota, 50 * MB, '默认配额只影响新用户');
    assert.equal(bobRow.storage_quota, 1 * MB);
    assert.equal(bobRow.storage_used, 0);
    assert.equal(bobRow.file_count, 0);

    const tooBig = await bob.client.upload('/api/uploadfile', byteFile(Math.round(1.2 * MB)));
    assert.equal(tooBig.status, 413);
    assert.equal(tooBig.data.error, 'storage_quota_exceeded');

    const first = await bob.client.upload<Record<string, any>>('/api/uploadfile', byteFile(400 * 1024, 'a.bin'));
    assert.equal(first.status, 200);
    const exceed = await bob.client.upload('/api/uploadfile', byteFile(700 * 1024, 'b.bin'));
    assert.equal(exceed.status, 413);

    const deleted = await bob.client.post('/api/deletefile', { file_id: first.data.file_id });
    assert.equal(deleted.status, 200);
    const second = await bob.client.upload('/api/uploadfile', byteFile(700 * 1024, 'b.bin'));
    assert.equal(second.status, 200);

    const raised = await harness.client.post<Record<string, any>>('/api/admin/users/storage', {
      id: bobRow.id,
      quota_mb: 3,
    });
    assert.equal(raised.status, 200);
    assert.equal(raised.data.storage.quota, 3 * MB);
    assert.equal(raised.data.storage.used, 700 * 1024);

    const bigger = await bob.client.upload('/api/uploadfile', byteFile(1.5 * MB, 'c.bin'));
    assert.equal(bigger.status, 200);

    const zero = await harness.client.post('/api/admin/users/storage', { id: bobRow.id, quota_mb: 0 });
    assert.equal(zero.status, 200);
    const blocked = await bob.client.upload('/api/uploadfile', byteFile(1, 'd.bin'));
    assert.equal(blocked.status, 413);

    const denied = await bob.client.post('/api/admin/storage', { default_quota_mb: 5 });
    assert.equal(denied.status, 403);
    assert.equal(denied.data.error, 'admin_required');
  });

  it('支持原始二进制上传、中文文件名与大小校验', async () => {
    const harness = createHarness();
    await setupAdmin(harness);
    const alice = await createUser(harness, { username: 'alice' });
    const keyResponse = await alice.client.post<{ api_key: { key: string } }>('/api/apikeys/create', { name: 'raw' });
    const apiKey = keyResponse.data.api_key.key;
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 250]);

    const raw = await new TestClient(harness.env).uploadRaw<Record<string, any>>(
      `/api/uploadfile?api_key=${apiKey}`,
      bytes,
      {
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent('数据.bin'),
      },
    );
    assert.equal(raw.status, 200);
    assert.equal(raw.data.name, '数据.bin');
    const download = await new TestClient(harness.env).download(String(raw.data.url_path));
    assert.equal(download.status, 200);
    assert.equal(Buffer.from(await download.arrayBuffer()).toString('hex'), Buffer.from(bytes).toString('hex'));

    const empty = await alice.client.upload('/api/uploadfile', textFile(''));
    assert.equal(empty.status, 400);
    assert.equal(empty.data.error, 'empty_file');

    const noFile = await alice.client.upload('/api/uploadfile', new FormData());
    assert.equal(noFile.status, 400);
    assert.equal(noFile.data.error, 'missing_file');

    const small = createHarness({ MAX_FILE_SIZE_MB: '1' });
    await setupAdmin(small);
    const smallUser = await createUser(small, { username: 'alice' });
    const oversize = await smallUser.client.upload('/api/uploadfile', byteFile(MB + 10));
    assert.equal(oversize.status, 413);
    assert.equal(oversize.data.error, 'file_too_large');
  });

  it('删除用户会清理文件、分块与配额记录', async () => {
    const harness = createHarness();
    await setupAdmin(harness);
    const alice = await createUser(harness, { username: 'alice' });
    const upload = await alice.client.upload<Record<string, any>>('/api/uploadfile', byteFile(2048, 'x.bin'));
    assert.equal(upload.status, 200);

    const before = await harness.client.post<Record<string, any>>('/api/admin/stats');
    assert.equal(before.data.stats.files, 1);
    assert.equal(before.data.stats.storage_used, 2048);

    const users = await harness.client.post<Record<string, any>>('/api/admin/users/list');
    const aliceRow = users.data.users.find((user: Record<string, unknown>) => user.username === 'alice');
    const removed = await harness.client.post('/api/admin/users/delete', { id: aliceRow.id });
    assert.equal(removed.status, 200);

    for (const table of ['files', 'file_chunks']) {
      const row = harness.db.raw.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number };
      assert.equal(Number(row.total), 0, `${table} 应被清空`);
    }
    const storageRow = harness.db.raw
      .prepare('SELECT COUNT(*) AS total FROM user_storage WHERE user_id = ?')
      .get(aliceRow.id) as { total: number };
    assert.equal(Number(storageRow.total), 0, 'user_storage 应被清空');
    const after = await harness.client.post<Record<string, any>>('/api/admin/stats');
    assert.equal(after.data.stats.files, 0);
    assert.equal(after.data.stats.storage_used, 0);
  });
});

describe('响应格式', () => {
  it('所有 JSON 接口都带 status，二进制下载带 x-api-status 头', async () => {
    const harness = createHarness();
    await setupAdmin(harness);
    const alice = await createUser(harness, { username: 'alice' });

    const responses = [
      await harness.client.get<Record<string, unknown>>('/api/health'),
      await harness.client.post<Record<string, unknown>>('/api/auth/status'),
      await harness.client.post<Record<string, unknown>>('/api/overview'),
      await alice.client.post<Record<string, unknown>>('/api/information/list'),
      await alice.client.post<Record<string, unknown>>('/api/feedback/list'),
      await alice.client.post<Record<string, unknown>>('/api/files/list'),
      await harness.client.post<Record<string, unknown>>('/api/admin/stats'),
    ];
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(response.data.status, 200);
    }

    const upload = await alice.client.upload<Record<string, any>>('/api/uploadfile', byteFile(16, 's.bin'));
    assert.equal(upload.data.status, 200);
    const download = await new TestClient(harness.env).download(String(upload.data.url_path));
    assert.equal(download.headers.get('x-api-status'), '200');

    const missing = await alice.client.post<Record<string, unknown>>('/api/does-not-exist');
    assert.equal(missing.status, 404);
    assert.equal(missing.data.status, 404);

    const badParam = await alice.client.post<Record<string, unknown>>('/api/setinformation');
    assert.equal(badParam.status, 400);
    assert.equal(badParam.data.status, 400);

    const errorDownload = await new TestClient(harness.env).download('/api/downloadfile?id=missing');
    assert.equal(errorDownload.status, 404);
    const errorBody = (await errorDownload.json()) as Record<string, unknown>;
    assert.equal(errorBody.status, 404);
  });
});

describe('数据库与接口一致性', () => {
  it('生成的 schema 与迁移 SQL 保持一致', () => {
    assert.equal(SCHEMA_VERSION, 2);
    const migrationsDir = new URL('../migrations/', import.meta.url);
    const files = readdirSync(migrationsDir)
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    assert.ok(files.length >= 2);

    const parts: string[] = [];
    for (const file of files) {
      const sql = readFileSync(new URL(file, migrationsDir), 'utf8');
      parts.push(
        ...sql
          .split('--> statement-breakpoint')
          .map((part) => part.trim())
          .filter((part) => part.length > 0 && !/^(--[^\n]*\n?)+$/.test(part)),
      );
    }
    assert.deepEqual([...SCHEMA_STATEMENTS], parts, '修改迁移后请运行 pnpm run gen:schema');
  });

  it('从 v1 数据库自动升级到 v2（不依赖 ALTER TABLE）', async () => {
    const db = new ShimD1();
    const migrationSql = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
    for (const statement of migrationSql.split('--> statement-breakpoint')) {
      const sql = statement.trim();
      if (sql && !/^(--[^\n]*\n?)+$/.test(sql)) {
        db.raw.exec(sql);
      }
    }
    const now = new Date().toISOString();
    db.raw.prepare(`INSERT INTO meta (key, value, updated_at) VALUES ('schema_version', '1', ?)`).run(now);
    db.raw
      .prepare(
        `INSERT INTO users (username, display_name, password_hash, role, feedback_enabled, created_at, updated_at)
         VALUES ('legacy', 'legacy', 'pbkdf2$10000$AAAA$BBBB', 'user', 0, ?, ?)`,
      )
      .run(now, now);

    const env = {
      DB: db as unknown as D1Database,
      JWT_SECRET: TEST_SECRET,
      APP_NAME: '升级测试',
      DISPLAY_TZ: 'Asia/Shanghai',
      PASSWORD_ITERATIONS: '10000',
      RATE_LIMIT_DISABLED: '1',
    };
    const status = await handleRequest(
      new Request(`${ORIGIN}/api/auth/status`, { method: 'POST', headers: { origin: ORIGIN } }),
      env,
    );
    assert.equal(status.status, 200);
    const body = (await status.json()) as Record<string, unknown>;
    assert.equal(body.needs_setup, true);

    const versionRow = db.raw.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as {
      value: string;
    };
    assert.equal(versionRow.value, '2');
    const filesTable = db.raw
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'files'`)
      .get() as { name?: string } | undefined;
    assert.equal(filesTable?.name, 'files');
    const storage = db.raw
      .prepare('SELECT quota, used FROM user_storage WHERE user_id = 1')
      .get() as { quota: number; used: number } | undefined;
    assert.ok(storage, '已有用户应补上配额记录');
    assert.equal(Number(storage?.quota), 50 * MB);
    assert.equal(Number(storage?.used), 0);

    // 第二次请求应跳过建表，不报重复表错误
    const again = await handleRequest(
      new Request(`${ORIGIN}/api/auth/status`, { method: 'POST', headers: { origin: ORIGIN } }),
      env,
    );
    assert.equal(again.status, 200);
  });

  it('概览接口返回统计与最近反馈', async () => {
    const harness = createHarness();
    await setupAdmin(harness);

    const overview = await harness.client.post<Record<string, any>>('/api/overview');
    assert.equal(overview.status, 200);
    assert.equal(overview.data.user.username, 'admin');
    assert.deepEqual(overview.data.stats, { information: 0, feedback: 0, unread: 0, api_keys: 0 });
    assert.equal(overview.data.feedback_link, '/#/f/admin');
    assert.equal(overview.data.feedback.enabled, false);
    assert.match(String(overview.data.api_base), /^https:\/\/test\.example\.com$/);

    const anonymous = await new TestClient(harness.env).post('/api/overview');
    assert.equal(anonymous.status, 401);
  });

  it('参数校验错误信息可读', async () => {
    const harness = createHarness();
    await setupAdmin(harness);
    const alice = await createUser(harness, { username: 'alice' });

    const badKey = await alice.client.post('/api/setinformation', { key: 'bad key!', value: 'x' });
    assert.equal(badKey.status, 400);
    assert.equal(badKey.data.error, 'invalid_key');

    const tooLong = await alice.client.post('/api/sendfeedback', { user_name: 'alice', feedback: 'x'.repeat(10_001) });
    assert.equal(tooLong.status, 400);
  });
});
