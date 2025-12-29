import { env } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createD1SqlTag } from "../src/sql-tag.js";

describe("D1 Integration", () => {
  const sql = createD1SqlTag(env.DB);

  beforeAll(async () => {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS test_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT,
        active INTEGER DEFAULT 1
      )
    `).run();
  });

  afterEach(async () => {
    await env.DB.prepare("DELETE FROM test_users").run();
  });

  describe("basic queries", () => {
    it("inserts and selects a row with .run() and .all()", async () => {
      await sql`INSERT INTO test_users (name, email) VALUES (${"Alice"}, ${"alice@example.com"})`.run();

      const result = await sql`SELECT * FROM test_users`.all<{
        id: number;
        name: string;
        email: string;
        active: number;
      }>();

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        name: "Alice",
        email: "alice@example.com",
        active: 1,
      });
    });

    it("updates a row", async () => {
      await sql`INSERT INTO test_users (name) VALUES (${"Bob"})`.run();
      await sql`UPDATE test_users SET name = ${"Robert"} WHERE name = ${"Bob"}`.run();

      const result = await sql`SELECT name FROM test_users`.all<{ name: string }>();

      expect(result.results[0].name).toBe("Robert");
    });

    it("deletes a row", async () => {
      await sql`INSERT INTO test_users (name) VALUES (${"Charlie"})`.run();
      await sql`DELETE FROM test_users WHERE name = ${"Charlie"}`.run();

      const result = await sql`SELECT * FROM test_users`.all();

      expect(result.results).toHaveLength(0);
    });
  });

  describe("parameter binding", () => {
    it("binds string values", async () => {
      await sql`INSERT INTO test_users (name, email) VALUES (${"Test"}, ${"test@test.com"})`.run();

      const result = await sql`SELECT * FROM test_users WHERE email = ${"test@test.com"}`.all<{
        name: string;
      }>();

      expect(result.results[0].name).toBe("Test");
    });

    it("binds number values", async () => {
      await sql`INSERT INTO test_users (name, active) VALUES (${"Inactive"}, ${0})`.run();

      const result = await sql`SELECT * FROM test_users WHERE active = ${0}`.all<{
        name: string;
      }>();

      expect(result.results[0].name).toBe("Inactive");
    });

    it("binds null values", async () => {
      await sql`INSERT INTO test_users (name, email) VALUES (${"NoEmail"}, ${null})`.run();

      const result = await sql`SELECT * FROM test_users WHERE email IS NULL`.all<{
        name: string;
      }>();

      expect(result.results[0].name).toBe("NoEmail");
    });
  });

  describe("parameter deduplication", () => {
    it("uses same parameter number for duplicate values", async () => {
      await sql`INSERT INTO test_users (name) VALUES (${"Alice"})`.run();
      await sql`INSERT INTO test_users (name) VALUES (${"Bob"})`.run();

      // The same value "Alice" should be deduplicated in the query
      const result = await sql`SELECT * FROM test_users WHERE name = ${"Alice"} OR name = ${"Alice"}`.all<{
        name: string;
      }>();

      expect(result.results).toHaveLength(1);
      expect(result.results[0].name).toBe("Alice");
    });
  });

  describe("SQL fragments", () => {
    it("uses fragments in queries", async () => {
      await sql`INSERT INTO test_users (name) VALUES (${"Alice"})`.run();
      await sql`INSERT INTO test_users (name) VALUES (${"Bob"})`.run();

      const whereClause = sql`name = ${"Alice"}`;
      const result = await sql`SELECT * FROM test_users WHERE ${whereClause}`.all<{
        name: string;
      }>();

      expect(result.results).toHaveLength(1);
      expect(result.results[0].name).toBe("Alice");
    });

    it("uses nested fragments", async () => {
      await sql`INSERT INTO test_users (name, active) VALUES (${"Alice"}, ${1})`.run();
      await sql`INSERT INTO test_users (name, active) VALUES (${"Bob"}, ${0})`.run();

      const nameCondition = sql`name = ${"Alice"}`;
      const activeCondition = sql`active = ${1}`;
      const combinedCondition = sql`${nameCondition} AND ${activeCondition}`;

      const result = await sql`SELECT * FROM test_users WHERE ${combinedCondition}`.all<{
        name: string;
      }>();

      expect(result.results).toHaveLength(1);
      expect(result.results[0].name).toBe("Alice");
    });

    it("reuses fragments with values", async () => {
      await sql`INSERT INTO test_users (name) VALUES (${"Alice"})`.run();

      const fragment = sql`= ${"Alice"}`;
      const result = await sql`SELECT * FROM test_users WHERE name ${fragment}`.all<{
        name: string;
      }>();

      expect(result.results).toHaveLength(1);
    });
  });

  describe(".map() transformation", () => {
    it("transforms results with .map()", async () => {
      await sql`INSERT INTO test_users (name) VALUES (${"alice"})`.run();

      const result = await sql`SELECT * FROM test_users`
        .build<{ id: number; name: string; email: string | null; active: number }>()
        .map((row) => ({ ...row, name: row.name.toUpperCase() }))
        .all();

      expect(result.results[0].name).toBe("ALICE");
    });

    it("transforms results with complex mapping", async () => {
      await sql`INSERT INTO test_users (name, email, active) VALUES (${"Test"}, ${"test@example.com"}, ${1})`.run();

      const result = await sql`SELECT * FROM test_users`
        .build<{ id: number; name: string; email: string | null; active: number }>()
        .map((row) => ({
          displayName: row.name,
          isActive: row.active === 1,
          contact: row.email ?? "No email",
        }))
        .all();

      expect(result.results[0]).toEqual({
        displayName: "Test",
        isActive: true,
        contact: "test@example.com",
      });
    });
  });

  describe(".batch() execution", () => {
    it("executes multiple statements in a batch", async () => {
      await sql.batch([
        sql`INSERT INTO test_users (name) VALUES (${"Alice"})`.build(),
        sql`INSERT INTO test_users (name) VALUES (${"Bob"})`.build(),
        sql`INSERT INTO test_users (name) VALUES (${"Charlie"})`.build(),
      ]);

      const result = await sql`SELECT COUNT(*) as count FROM test_users`.all<{
        count: number;
      }>();

      expect(result.results[0].count).toBe(3);
    });

    it("returns results from batch queries", async () => {
      await sql`INSERT INTO test_users (name) VALUES (${"Alice"})`.run();
      await sql`INSERT INTO test_users (name) VALUES (${"Bob"})`.run();

      const [result1, result2] = await sql.batch([
        sql`SELECT * FROM test_users WHERE name = ${"Alice"}`.build<{
          name: string;
        }>(),
        sql`SELECT * FROM test_users WHERE name = ${"Bob"}`.build<{ name: string }>(),
      ]);

      expect(result1.results[0].name).toBe("Alice");
      expect(result2.results[0].name).toBe("Bob");
    });

    it("applies mappers in batch execution", async () => {
      await sql`INSERT INTO test_users (name) VALUES (${"alice"})`.run();
      await sql`INSERT INTO test_users (name) VALUES (${"bob"})`.run();

      const [result1, result2] = await sql.batch([
        sql`SELECT * FROM test_users WHERE name = ${"alice"}`
          .build<{ id: number; name: string; email: string | null; active: number }>()
          .map((row) => ({ ...row, name: row.name.toUpperCase() })),
        sql`SELECT * FROM test_users WHERE name = ${"bob"}`
          .build<{ id: number; name: string; email: string | null; active: number }>()
          .map((row) => ({ ...row, name: row.name.toUpperCase() })),
      ]);

      expect(result1.results[0].name).toBe("ALICE");
      expect(result2.results[0].name).toBe("BOB");
    });
  });

  describe(".build() without execution", () => {
    it("builds query without executing", () => {
      const statement = sql`SELECT * FROM test_users WHERE id = ${123}`.build();

      expect(statement.query).toBe("SELECT * FROM test_users WHERE id = ?1");
      expect(statement.values).toEqual([123]);
    });
  });
});
