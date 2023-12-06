import type { SqlResult } from "./sql-tag.js";

export function logQueryResults(queries: string[], results: SqlResult[], duration?: number) {
  console.log(
    `D1 batch: ${typeof duration === "number" ? `${duration}ms · ` : ""}${queries.length} queries`,
  );
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    const result = results[i];

    console.log(`${i + 1}: ${cleanupSqlQuery(query)}`);

    const logSuffix =
      "rows_read" in result.meta
        ? ` · ${result.meta.rows_read} read · ${result.meta.rows_written} written`
        : "";
    console.log(`   ↳ ${result.meta.duration}ms · ${result.meta.changes} changed` + logSuffix);
  }
}

function cleanupSqlQuery(query: string) {
  return query.replace(/\n/g, " ").replace(/\s+/g, " ");
}
