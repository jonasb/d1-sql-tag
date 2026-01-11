import type { D1Database } from "@cloudflare/workers-types";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
  }
}
