import { firstRow } from '../db/d1.ts';
import type { AppContext } from '../env.ts';
import { countApiKeys } from './apikeys.ts';
import { countFeedbackSessions } from './feedback.ts';
import { countInformation } from './information.ts';
import { countActiveRegistrationCodes } from './registration.ts';
import { countAdmins, countUsers } from './users.ts';

export interface UserStats {
  information: number;
  feedback: number;
  unread: number;
  api_keys: number;
}

export async function getUserStats(ctx: AppContext, userId: number): Promise<UserStats> {
  const [information, feedback, unread, apiKeys] = await Promise.all([
    countInformation(ctx.db, userId),
    countFeedbackSessions(ctx.db, userId),
    countFeedbackSessions(ctx.db, userId, 'unread'),
    countApiKeys(ctx.db, userId),
  ]);
  return { information, feedback, unread, api_keys: apiKeys };
}

export interface AdminStats {
  users: number;
  admins: number;
  information: number;
  feedback: number;
  unread: number;
  messages: number;
  api_keys: number;
  active_codes: number;
}

export async function getAdminStats(ctx: AppContext): Promise<AdminStats> {
  const count = async (sql: string): Promise<number> => {
    const row = await firstRow<{ total: number }>(ctx.db, sql);
    return Number(row?.total ?? 0);
  };
  const [users, admins, information, feedback, unread, messages, apiKeys, activeCodes] = await Promise.all([
    countUsers(ctx.db),
    countAdmins(ctx.db),
    count('SELECT COUNT(*) AS total FROM information'),
    count('SELECT COUNT(*) AS total FROM feedback_sessions'),
    count(`SELECT COUNT(*) AS total FROM feedback_sessions WHERE status = 'unread'`),
    count('SELECT COUNT(*) AS total FROM feedback_messages'),
    count('SELECT COUNT(*) AS total FROM api_keys'),
    countActiveRegistrationCodes(ctx.db),
  ]);
  return {
    users,
    admins,
    information,
    feedback,
    unread,
    messages,
    api_keys: apiKeys,
    active_codes: activeCodes,
  };
}
