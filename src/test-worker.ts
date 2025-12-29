import type { D1Database } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
}

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    return new Response("Test worker");
  },
};
