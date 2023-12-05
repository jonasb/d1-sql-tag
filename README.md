# `d1-sql-tag`

A template literal for working with [Cloudflare D1](https://developers.cloudflare.com/d1/)
database.

`npm install d1-sql-tag`

## Usage with Cloudflare Workers

If you have created a D1 database and configured it with the binding name `DB`,
in `wrangler.toml`, you can create a template literal tag with `createD1SqlTag()`.

```ts
import { createD1SqlTag, logQueryResults } from "d1-sql-tag";

export interface Env {
  DB: D1Database;
}

function createSqlTag(db: D1Database) {
  return createD1SqlTag(db, {
    afterQuery(batchId, queries, results, duration) {
      logQueryResults(queries, results, duration);
    },
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const sql = createSqlTag(env.DB);
    const result = await sql`SELECT ${"hello world"} AS message`.all<{
      message: string;
    }>();
    return new Response(`Message: ${result.results[0].message}`);
  },
};
```

## License

[MIT](./LICENSE.txt)
