import { badRequest } from './errors.ts';

/** 用户名统一小写存储，允许字母、数字、下划线、点、短横线。 */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
export const INFO_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

export const LIMITS = {
  usernameMin: 3,
  usernameMax: 32,
  passwordMin: 8,
  passwordMax: 128,
  infoKeyMax: 64,
  infoValueMax: 100_000,
  infoKeysPerUser: 500,
  apiKeysPerUser: 20,
  apiKeyNameMax: 32,
  feedbackMax: 10_000,
  feedbackTitleMax: 120,
  feedbackSessionsPerUser: 5_000,
  feedbackMessagesPerSession: 500,
  feedbackListLimit: 200,
  adminListLimit: 500,
  registrationCodeMaxUses: 100,
  registrationCodeExpireDays: 365,
  registrationCodeLabelMax: 40,
} as const;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): { username: string; displayName: string } {
  const displayName = raw.trim();
  const username = displayName.toLowerCase();
  if (username.length < LIMITS.usernameMin || username.length > LIMITS.usernameMax) {
    throw badRequest('invalid_username', `用户名长度需在 ${LIMITS.usernameMin}-${LIMITS.usernameMax} 个字符之间`);
  }
  if (!USERNAME_PATTERN.test(username)) {
    throw badRequest('invalid_username', '用户名只能包含字母、数字、下划线、点和短横线，且需以字母或数字开头');
  }
  return { username, displayName };
}

/** 密码策略：8-128 位，且至少包含一个字母与一个数字/符号。 */
export function validatePassword(password: string): void {
  if (password.length < LIMITS.passwordMin || password.length > LIMITS.passwordMax) {
    throw badRequest('weak_password', `密码长度需在 ${LIMITS.passwordMin}-${LIMITS.passwordMax} 位之间`);
  }
  if (!/[A-Za-z]/.test(password) || !/[^A-Za-z]/.test(password)) {
    throw badRequest('weak_password', '密码需同时包含字母与数字/符号');
  }
}

export function validateInfoKey(key: string): string {
  const value = key.trim();
  if (!INFO_KEY_PATTERN.test(value)) {
    throw badRequest('invalid_key', 'key 只能包含字母、数字、下划线、点、冒号和短横线，长度 1-64，且需以字母或数字开头');
  }
  return value;
}
