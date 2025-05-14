import type {
  D1Database,
  D1Response,
  D1Result,
  D1DatabaseSession,
} from "@cloudflare/workers-types/experimental/index.js";

export type Primitive = string | number | boolean | null;

export type SqlTag = ((
  strings: TemplateStringsArray,
  ...values: (Primitive | SqlQueryFragment)[]
) => SqlQueryFragment) & {
  batch<T extends readonly PreparedStatementBase<object>[]>(
    statements: T,
  ): Promise<{
    -readonly [P in keyof T]: SqlResult<RowType<T[P]>>;
  }>;
};

export interface SqlQueryFragment {
  build<T extends object = Record<string, Primitive>>(): RawPreparedStatement<T>;
  all<T extends object = Record<string, Primitive>>(): Promise<D1Result<T>>;
  run(): Promise<D1Response>;
  templateStrings: TemplateStringsArray;
  templateValues: (Primitive | SqlQueryFragment)[];
}

interface PreparedStatementBase<T extends object> {
  query: string;
  values: Primitive[];
  all(): Promise<D1Result<T>>;
  run(): Promise<D1Response>;
  [rowTypeSymbol]: T;
}

interface MappedPreparedStatement<TRaw extends object, TMapped extends object>
  extends PreparedStatementBase<TMapped> {
  mapper: (row: TRaw) => TMapped;
}

interface RawPreparedStatement<T extends object> extends PreparedStatementBase<T> {
  map<TMapped extends object>(mapper: (row: T) => TMapped): MappedPreparedStatement<T, TMapped>;
}

type PreparedStatement<T extends object, U extends object = Record<string, Primitive>> =
  | RawPreparedStatement<T>
  | MappedPreparedStatement<U, T>;

export type RowType<
  T extends PreparedStatementBase<any> | ((...args: any) => PreparedStatementBase<any>),
> =
  T extends PreparedStatementBase<any>
    ? T[typeof rowTypeSymbol]
    : T extends (...args: any) => PreparedStatementBase<any>
      ? ReturnType<T>[typeof rowTypeSymbol]
      : never;

export interface SqlResult<T extends object = Record<string, Primitive>> extends D1Result<T> {}

interface SqlTagOptions {
  beforeQuery?: (id: number, queries: string[]) => void;
  afterQuery?: (id: number, queries: string[], results: SqlResult[], duration: number) => void;
}

let batchId = 0;
const rowTypeSymbol = Symbol("rowType");

export function createD1SqlTag(
  db: D1Database | D1DatabaseSession,
  options?: SqlTagOptions,
): SqlTag {
  const sqlTag: SqlTag = (strings, ...values): SqlQueryFragment => {
    const fragment: SqlQueryFragment = {
      build() {
        return buildPreparedStatement(db, options, strings, values);
      },
      all<T extends object>() {
        return buildPreparedStatement<T>(db, options, strings, values).all();
      },
      run() {
        return buildPreparedStatement(db, options, strings, values).run();
      },
      templateStrings: strings,
      templateValues: values,
    };
    return fragment;
  };
  sqlTag.batch = async (statements) => {
    const queries = statements.map((it) => it.query);

    const id = makeBatchId();
    options?.beforeQuery?.(id, queries);
    const start = Date.now();
    const result = (await db.batch(statements.map((it) => makeNativeStatement(db, it)))) as any;
    const duration = Date.now() - start;
    options?.afterQuery?.(id, queries, result, duration);

    for (let i = 0; i < result.length; i++) {
      const statement = statements[i];
      const statementResult = result[i];
      if ("mapper" in statement) {
        statementResult.results = statementResult.results.map(statement.mapper);
      }
    }

    return result;
  };
  return sqlTag;
}

function buildPreparedStatement<T extends object>(
  db: D1Database | D1DatabaseSession,
  options: SqlTagOptions | undefined,
  templateStrings: TemplateStringsArray,
  templateValues: (Primitive | SqlQueryFragment)[],
): RawPreparedStatement<T> {
  const { query, values } = expandTemplate(templateStrings, templateValues);

  const statement: RawPreparedStatement<T> = {
    all() {
      return executeAll(db, options, statement, null);
    },
    run() {
      return executeRun(db, options, statement);
    },
    map<U extends object>(mapper: (row: T) => U) {
      const mappedStatement: MappedPreparedStatement<T, U> = {
        all() {
          return executeAll(db, options, mappedStatement, mapper);
        },
        run() {
          return executeRun(db, options, mappedStatement);
        },
        query,
        values,
        mapper,
        [rowTypeSymbol]: null as any,
      };
      return mappedStatement;
    },
    query,
    values,
    [rowTypeSymbol]: null as any,
  };

  return statement;
}

function expandTemplate(
  rootTemplateStrings: TemplateStringsArray,
  rootTemplateValues: (Primitive | SqlQueryFragment)[],
) {
  let query = "";
  const values: Primitive[] = [];

  function expand(
    templateStrings: TemplateStringsArray,
    templateValues: (Primitive | SqlQueryFragment)[],
  ) {
    for (let i = 0; i < templateStrings.length; i++) {
      if (i > 0) {
        const value = templateValues[i - 1];
        const valueIsFragment =
          value &&
          typeof value === "object" &&
          "templateStrings" in value &&
          "templateValues" in value;

        if (valueIsFragment) {
          expand(value.templateStrings, value.templateValues);
        } else {
          let valueIndex = values.indexOf(value);
          if (valueIndex === -1) {
            valueIndex = values.push(value) - 1;
          }
          query += `?${valueIndex + 1}`;
        }
      }
      query += templateStrings[i];
    }
  }

  expand(rootTemplateStrings, rootTemplateValues);

  return { query, values };
}

async function executeAll<TRaw extends object, TMapped extends object>(
  db: D1Database | D1DatabaseSession,
  options: SqlTagOptions | undefined,
  statement: RawPreparedStatement<TRaw> | MappedPreparedStatement<TRaw, TMapped>,
  mapper: ((row: TRaw) => TMapped) | null,
) {
  const batchId = makeBatchId();
  options?.beforeQuery?.(batchId, [statement.query]);
  const start = Date.now();

  const result = (await makeNativeStatement(db, statement as any).all()) as SqlResult<TMapped>;

  const duration = Date.now() - start;
  options?.afterQuery?.(batchId, [statement.query], [result as SqlResult], duration);

  if (mapper) {
    result.results = result.results.map(mapper as any);
  }

  return result;
}

async function executeRun<T extends object, U extends object>(
  db: D1Database | D1DatabaseSession,
  options: SqlTagOptions | undefined,
  statement: PreparedStatement<T, U>,
) {
  const batchId = makeBatchId();
  options?.beforeQuery?.(batchId, [statement.query]);
  const start = Date.now();
  const result = await makeNativeStatement(db, statement).run();
  const duration = Date.now() - start;
  options?.afterQuery?.(batchId, [statement.query], [result as SqlResult], duration);
  return result;
}

function makeNativeStatement<T extends object>(
  db: D1Database | D1DatabaseSession,
  statement: PreparedStatementBase<T>,
) {
  let stmt = db.prepare(statement.query);
  if (statement.values.length > 0) {
    stmt = stmt.bind(...statement.values);
  }
  return stmt;
}

function makeBatchId() {
  batchId += 1;
  return batchId;
}
