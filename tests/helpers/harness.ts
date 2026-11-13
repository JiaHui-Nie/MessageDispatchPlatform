import { handleRequest } from '../../src/app.ts';
import type { Env } from '../../src/env.ts';
import { ShimD1 } from './d1.ts';

export const ORIGIN = 'https://test.example.com';
export const TEST_SECRET = 'unit-test-secret-0123456789-abcdefghijklmnop';

export interface TestHarness {
  env: Env;
  db: ShimD1;
  client: TestClient;
}

export function createHarness(overrides: Partial<Env> = {}): TestHarness {
  const db = new ShimD1();
  const env: Env = {
    DB: db as unknown as D1Database,
    JWT_SECRET: TEST_SECRET,
    APP_NAME: '测试平台',
    DISPLAY_TZ: 'Asia/Shanghai',
    SESSION_TTL_HOURS: '24',
    PASSWORD_ITERATIONS: '10000',
    RATE_LIMIT_DISABLED: '1',
    ...overrides,
  };
  return { env, db, client: new TestClient(env) };
}

export interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  data: T;
  headers: Headers;
}

export class TestClient {
  cookie: string | null = null;
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  async post<T = Record<string, unknown>>(path: string, body: unknown = {}): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body);
  }

  async postRaw<T = Record<string, unknown>>(path: string, raw: string): Promise<ApiResponse<T>> {
    const headers = new Headers({ 'content-type': 'application/json', origin: ORIGIN });
    if (this.cookie) headers.set('cookie', this.cookie);
    const response = await handleRequest(
      new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body: raw }),
      this.env,
    );
    this.captureCookie(response);
    return { status: response.status, data: (await response.json()) as T, headers: response.headers };
  }

  /** multipart/form-data 上传（不要手动设置 content-type，浏览器/undici 会自动加 boundary）。 */
  async upload<T = Record<string, unknown>>(path: string, form: FormData): Promise<ApiResponse<T>> {
    const headers = new Headers({ origin: ORIGIN });
    if (this.cookie) headers.set('cookie', this.cookie);
    const response = await handleRequest(new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body: form }), this.env);
    this.captureCookie(response);
    return { status: response.status, data: (await response.json()) as T, headers: response.headers };
  }

  /** 原始二进制上传。 */
  async uploadRaw<T = Record<string, unknown>>(
    path: string,
    bytes: Uint8Array,
    headers: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    const merged = new Headers({ origin: ORIGIN, ...headers });
    if (this.cookie) merged.set('cookie', this.cookie);
    const response = await handleRequest(
      new Request(`${ORIGIN}${path}`, { method: 'POST', headers: merged, body: bytes }),
      this.env,
    );
    this.captureCookie(response);
    return { status: response.status, data: (await response.json()) as T, headers: response.headers };
  }

  /** 下载文件，返回原始 Response 以便校验二进制内容与响应头。 */
  async download(path: string, headers: Record<string, string> = {}): Promise<Response> {
    const merged = new Headers({ origin: ORIGIN, ...headers });
    if (this.cookie) merged.set('cookie', this.cookie);
    return handleRequest(new Request(`${ORIGIN}${path}`, { method: 'GET', headers: merged }), this.env);
  }

  async get<T = Record<string, unknown>>(path: string): Promise<ApiResponse<T>> {
    const headers = new Headers({ origin: ORIGIN });
    if (this.cookie) headers.set('cookie', this.cookie);
    const response = await handleRequest(new Request(`${ORIGIN}${path}`, { method: 'GET', headers }), this.env);
    this.captureCookie(response);
    return { status: response.status, data: (await response.json()) as T, headers: response.headers };
  }

  async request<T>(
    method: 'POST' | 'GET',
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<ApiResponse<T>> {
    const headers = new Headers({ 'content-type': 'application/json', origin: ORIGIN, ...extraHeaders });
    if (this.cookie) headers.set('cookie', this.cookie);
    const response = await handleRequest(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers,
        ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
      }),
      this.env,
    );
    this.captureCookie(response);
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return { status: response.status, data: data as T, headers: response.headers };
  }

  private captureCookie(response: Response): void {
    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) return;
    const match = /mdp_session=([^;]*)/.exec(setCookie);
    this.cookie = match && match[1] ? `mdp_session=${match[1]}` : null;
  }
}

/** 常用：创建管理员并返回已登录的客户端。 */
export async function setupAdmin(harness: TestHarness, password = 'AdminPass123') {
  const response = await harness.client.post<{ user: Record<string, unknown> }>('/api/auth/setup', { password });
  if (response.status !== 200) {
    throw new Error(`setup failed: ${JSON.stringify(response.data)}`);
  }
  return response.data.user;
}

/** 常用：管理员生成注册码并注册一个普通用户。 */
export async function createUser(
  harness: TestHarness,
  input: { username: string; password?: string; maxUses?: number; expiresInDays?: number } ,
) {
  const codeResponse = await harness.client.post<{ code: string }>('/api/admin/codes/create', {
    label: input.username,
    max_uses: input.maxUses ?? 1,
    expires_in_days: input.expiresInDays ?? 7,
  });
  if (codeResponse.status !== 200) {
    throw new Error(`code create failed: ${JSON.stringify(codeResponse.data)}`);
  }
  const client = new TestClient(harness.env);
  const response = await client.post<{ user: Record<string, unknown> }>('/api/auth/register', {
    username: input.username,
    password: input.password ?? 'UserPass123',
    code: codeResponse.data.code,
  });
  if (response.status !== 200) {
    throw new Error(`register failed: ${JSON.stringify(response.data)}`);
  }
  return { client, user: response.data.user };
}
