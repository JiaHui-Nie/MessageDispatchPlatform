import { handleRequest } from './app.ts';
import type { Env } from './env.ts';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
