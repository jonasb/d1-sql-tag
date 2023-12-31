import type { D1Database } from "@cloudflare/workers-types";
import assert from "node:assert";
import { describe, it } from "node:test";
import { createD1SqlTag, type Primitive, type SqlQueryFragment } from "../src/sql-tag.js";

function mockTag() {
  return createD1SqlTag({ dummy: true } as unknown as D1Database);
}

function expectQueryEquals(
  fragment: SqlQueryFragment,
  expectedQuery: string,
  expectedValues: Primitive[],
) {
  const { query, values } = fragment.build();
  assert.deepEqual({ query, values }, { query: expectedQuery, values: expectedValues });
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
