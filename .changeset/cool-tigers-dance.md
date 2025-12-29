---
"d1-sql-tag": minor
---

Add sql.join() helper for array expansion in IN clauses and createMockSqlTag() for testing

- `sql.join()`: Expands arrays into parameterized values for use in IN clauses. Handles empty arrays by returning NULL for valid always-false SQL.
- `createMockSqlTag()`: Creates a mock SQL tag for testing with vitest/jest. Includes MockSqlTagHandler interface and preserves handler types via sql.handler property.
