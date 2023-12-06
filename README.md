# `d1-sql-tag`

A template literal for working with [Cloudflare D1](https://developers.cloudflare.com/d1/)
database.

`npm install d1-sql-tag`

## Usage with Cloudflare Workers

If you have created a D1 database and configured it with the binding name `DB`,
in `wrangler.toml`, you can create a template literal tag with `createD1SqlTag()`.

We also set up a callback to log stats for each query, like so:

```
D1 batch: 286ms · 1 queries
1: SELECT ?1 AS message
   ↳ 0.3053ms · 0 changed · 0 read · 0 written
```

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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const sql = createSqlTag(env.DB);
    const result = await sql`SELECT ${"hello world"} AS message`.all<{
      message: string;
    }>();
    return new Response(`Message: ${result.results[0].message}`);
  },
};
```

## Usage with Hono on Cloudflare Workers

If you have created a D1 database and configured it with the binding name `DB`,
in `wrangler.toml`, you can create a template literal tag with `createD1SqlTag()`.

We also set up a callback to log stats for each query, like so:

```
D1 batch: 286ms · 1 queries
1: SELECT ?1 AS message
   ↳ 0.3053ms · 0 changed · 0 read · 0 written
```

Additionally, we use [`hono/timing`](https://hono.dev/middleware/builtin/timing)
to send [`Server-Timing`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server-Timing) headers for the total response time, how long we wait for each batch, and how
long each query takes. Open the network tab in your browser's devtools, select
the request and look at the "Timing" tab.

```ts
import { createD1SqlTag, logQueryResults } from "d1-sql-tag";
import { Hono, type Context } from "hono";
import { endTime, setMetric, startTime, timing } from "hono/timing";

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

function createSqlTag(c: Context<{ Bindings: Bindings }>) {
  return createD1SqlTag(c.env.DB, {
    beforeQuery(batchId, queries) {
      startTime(c, `db-${batchId}`);
    },
    afterQuery(batchId, queries, results, duration) {
      endTime(c, `db-${batchId}`);
      results.forEach((result, i) => {
        setMetric(c, `db-${batchId}-query-${i + 1}`, result.meta.duration);
      });
      logQueryResults(queries, results, duration);
    },
  });
}

app.use("*", timing());

app.get("/", async (c) => {
  const sql = createSqlTag(c);
  const result = await sql`SELECT ${"hello world"} AS message`.all<{
    message: string;
  }>();
  return c.text(`Message: ${result.results[0].message}`);
});

export default app;
```

## License

[MIT](./LICENSE.txt)
