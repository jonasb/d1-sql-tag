import type { D1Database, D1Response, D1Result } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import {
  createD1SqlTag,
  createMockSqlTag,
  type MockSqlTagHandler,
  type Primitive,
  type SqlQueryFragment,
} from "../src/sql-tag.js";

function mockTag() {
  return createD1SqlTag({ dummy: true } as unknown as D1Database);
}

function expectQueryEquals(
  fragment: SqlQueryFragment,
  expectedQuery: string,
  expectedValues: Primitive[],
) {
  const { query, values } = fragment.build();
  expect({ query, values }).toEqual({ query: expectedQuery, values: expectedValues });
}

describe("sql", () => {
  it("number value", () => {
    const sql = mockTag();
    expectQueryEquals(
      sql`SELECT * FROM users WHERE id = ${1}`,
      "SELECT * FROM users WHERE id = ?1",
      [1],
    );
  });

  it("duplicated values", () => {
    const sql = mockTag();
    expectQueryEquals(
      sql`SELECT * FROM users WHERE foo = ${"hello"} OR bar = ${"hello"}`,
      "SELECT * FROM users WHERE foo = ?1 OR bar = ?1",
      ["hello"],
    );
  });

  it("fragment", () => {
    const sql = mockTag();
    expectQueryEquals(
      sql`SELECT * FROM users WHERE ${sql`column`} IS NULL`,
      "SELECT * FROM users WHERE column IS NULL",
      [],
    );
  });

  it("fragment with values", () => {
    const sql = mockTag();
    expectQueryEquals(
      sql`SELECT * FROM users WHERE ${sql`column = ${123}`}`,
      "SELECT * FROM users WHERE column = ?1",
      [123],
    );
  });

  it("fragment with values used twice", () => {
    const sql = mockTag();
    const fragment = sql`= ${123}`;
    expectQueryEquals(
      sql`SELECT * FROM users WHERE foo ${fragment} OR bar ${fragment}`,
      "SELECT * FROM users WHERE foo = ?1 OR bar = ?1",
      [123],
    );
  });

  it("nested fragments", () => {
    const sql = mockTag();
    const innerFragment = sql`column`;
    const outerFragment = sql`${innerFragment} IS NULL`;
    expectQueryEquals(
      sql`SELECT * FROM users WHERE ${outerFragment}`,
      "SELECT * FROM users WHERE column IS NULL",
      [],
    );
  });

  it("nested fragments with values", () => {
    const sql = mockTag();
    const innerFragment = sql`column = ${123}`;
    const outerFragment = sql`${innerFragment} AND foo = ${"bar"}`;
    expectQueryEquals(
      sql`SELECT * FROM users WHERE ${outerFragment}`,
      "SELECT * FROM users WHERE column = ?1 AND foo = ?2",
      [123, "bar"],
    );
  });
});

describe("createMockSqlTag", () => {
  const defaultResult = { results: [], success: true, meta: { duration: 0 } };

  function createMockHandler(impl?: Partial<MockSqlTagHandler>) {
    return {
      all: vi.fn(impl?.all ?? (async () => defaultResult as D1Result<any>)),
      run: vi.fn(impl?.run ?? (async () => defaultResult as D1Response)),
      batch: vi.fn(impl?.batch ?? (async (stmts: any[]) => stmts.map(() => defaultResult))),
    };
  }

  it("builds query correctly and calls handler.all", async () => {
    const sql = createMockSqlTag(createMockHandler());

    await sql`SELECT * FROM users WHERE id = ${1}`.all();

    expect(sql.handler.all).toHaveBeenCalledTimes(1);
    expect(sql.handler.all).toHaveBeenCalledWith("SELECT * FROM users WHERE id = ?1", [1]);
  });

  it("builds query correctly and calls handler.run", async () => {
    const sql = createMockSqlTag(createMockHandler());

    await sql`INSERT INTO users (name) VALUES (${"Alice"})`.run();

    expect(sql.handler.run).toHaveBeenCalledTimes(1);
    expect(sql.handler.run).toHaveBeenCalledWith("INSERT INTO users (name) VALUES (?1)", ["Alice"]);
  });

  it("handles fragments in mock sql tag", async () => {
    const sql = createMockSqlTag(createMockHandler());

    const whereClause = sql`id = ${42}`;
    await sql`SELECT * FROM users WHERE ${whereClause}`.all();

    expect(sql.handler.all).toHaveBeenCalledWith("SELECT * FROM users WHERE id = ?1", [42]);
  });

  it("supports .build() to get query without executing", () => {
    const sql = createMockSqlTag(createMockHandler());

    const statement = sql`SELECT * FROM users WHERE id = ${1}`.build();

    expect(statement.query).toBe("SELECT * FROM users WHERE id = ?1");
    expect(statement.values).toEqual([1]);
    expect(sql.handler.all).not.toHaveBeenCalled();
    expect(sql.handler.run).not.toHaveBeenCalled();
  });

  it("supports .map() for result transformation", async () => {
    const sql = createMockSqlTag(
      createMockHandler({
        all: async () => ({
          results: [{ id: 1, name: "alice" }],
          success: true,
          meta: { duration: 0 },
        }),
      }),
    );

    const result = await sql`SELECT * FROM users`
      .build<{ id: number; name: string }>()
      .map((row) => ({ ...row, name: row.name.toUpperCase() }))
      .all();

    expect(result.results).toEqual([{ id: 1, name: "ALICE" }]);
  });

  it("supports batch execution", async () => {
    const sql = createMockSqlTag(createMockHandler());

    await sql.batch([
      sql`INSERT INTO users (name) VALUES (${"Alice"})`.build(),
      sql`INSERT INTO users (name) VALUES (${"Bob"})`.build(),
    ]);

    expect(sql.handler.batch).toHaveBeenCalledTimes(1);
    expect(sql.handler.batch).toHaveBeenCalledWith([
      { query: "INSERT INTO users (name) VALUES (?1)", values: ["Alice"] },
      { query: "INSERT INTO users (name) VALUES (?1)", values: ["Bob"] },
    ]);
  });

  it("applies mappers in batch execution", async () => {
    const sql = createMockSqlTag(
      createMockHandler({
        batch: async () => [
          { results: [{ id: 1, name: "alice" }], success: true, meta: { duration: 0 } },
          { results: [{ id: 2, name: "bob" }], success: true, meta: { duration: 0 } },
        ],
      }),
    );

    const [result1, result2] = await sql.batch([
      sql`SELECT * FROM users WHERE id = ${1}`
        .build<{ id: number; name: string }>()
        .map((row) => ({ ...row, name: row.name.toUpperCase() })),
      sql`SELECT * FROM users WHERE id = ${2}`
        .build<{ id: number; name: string }>()
        .map((row) => ({ ...row, name: row.name.toUpperCase() })),
    ]);

    expect(result1.results).toEqual([{ id: 1, name: "ALICE" }]);
    expect(result2.results).toEqual([{ id: 2, name: "BOB" }]);
  });
});

describe("sql.join()", () => {
  it("expands array into comma-separated placeholders", () => {
    const sql = mockTag();
    expectQueryEquals(
      sql`SELECT * FROM users WHERE id IN (${sql.join([1, 2, 3])})`,
      "SELECT * FROM users WHERE id IN (?1, ?2, ?3)",
      [1, 2, 3],
    );
  });

  it("handles single-element arrays", () => {
    const sql = mockTag();
    expectQueryEquals(
      sql`SELECT * FROM users WHERE id IN (${sql.join([42])})`,
      "SELECT * FROM users WHERE id IN (?1)",
      [42],
    );
  });

  it("handles empty arrays with NULL", () => {
    const sql = mockTag();
    expectQueryEquals(
      sql`SELECT * FROM users WHERE id IN (${sql.join([])})`,
      "SELECT * FROM users WHERE id IN (NULL)",
      [],
    );
  });

  it("deduplicates values across join and regular params", () => {
    const sql = mockTag();
    expectQueryEquals(
      sql`SELECT * FROM users WHERE id IN (${sql.join([1, 2])}) AND name = ${"Alice"} AND code = ${1}`,
      "SELECT * FROM users WHERE id IN (?1, ?2) AND name = ?3 AND code = ?1",
      [1, 2, "Alice"],
    );
  });

  it("works with string arrays", () => {
    const sql = mockTag();
    expectQueryEquals(
      sql`SELECT * FROM users WHERE name IN (${sql.join(["Alice", "Bob"])})`,
      "SELECT * FROM users WHERE name IN (?1, ?2)",
      ["Alice", "Bob"],
    );
  });
});
