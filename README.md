# `d1-sql-tag`

[![npm version](https://badge.fury.io/js/d1-sql-tag.svg)](https://badge.fury.io/js/d1-sql-tag)

A template literal for working with [Cloudflare D1](https://developers.cloudflare.com/d1/)
database.

`npm install d1-sql-tag`

- [Changelog](./CHANGELOG.md)

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

## Testing with Mock SQL Tag

For testing, you can use `createMockSqlTag` to create a sql tag that properly builds
queries but delegates execution to your mock implementation. This allows you to:

- Verify that correct SQL queries are generated
- Mock responses for different queries
- Test without a real D1 database

The function is generic and preserves your mock types via `sql.handler`, so you can
use vitest/jest mock methods without type casting.

### Example with Vitest

```ts
import { createMockSqlTag } from "d1-sql-tag";
import { vi, expect, test } from "vitest";

test("queries user by id", async () => {
  const sql = createMockSqlTag({
    all: vi.fn().mockResolvedValue({ results: [], success: true, meta: {} }),
    run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
    batch: vi.fn().mockResolvedValue([]),
  });

  // Mock specific response - no type casting needed!
  sql.handler.all.mockResolvedValueOnce({
    results: [{ id: 1, name: "Alice" }],
    success: true,
    meta: {},
  });

  const result = await sql`SELECT * FROM users WHERE id = ${1}`.all<{
    id: number;
    name: string;
  }>();

  // Verify the query was built correctly
  expect(sql.handler.all).toHaveBeenCalledWith("SELECT * FROM users WHERE id = ?1", [1]);

  // Verify the response
  expect(result.results[0].name).toBe("Alice");
});
```

### MockSqlTagHandler Interface

```ts
interface MockSqlTagHandler {
  all<T extends object>(query: string, values: Primitive[]): Promise<D1Result<T>>;
  run(query: string, values: Primitive[]): Promise<D1Response>;
  batch(statements: Array<{ query: string; values: Primitive[] }>): Promise<D1Result<object>[]>;
}
```

## License

[MIT](./LICENSE.txt)
