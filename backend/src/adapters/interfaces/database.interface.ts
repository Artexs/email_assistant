export type DatabaseRecord = Record<string, unknown>;

export interface QueryOptions {
  select?: string;
  limit?: number;
  offset?: number;
  orderBy?: { column: string; ascending?: boolean };
  filters?: {
    column: string;
    operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "in" | "is";
    value: unknown;
  }[];
}

export interface IDatabaseProvider {
  // Read operations
  select<T = DatabaseRecord>(table: string, options?: QueryOptions): Promise<T[]>;
  selectOne<T = DatabaseRecord>(table: string, options?: QueryOptions): Promise<T | null>;
  selectById<T = DatabaseRecord>(table: string, id: string | number): Promise<T | null>;

  // Write operations
  insert<T = DatabaseRecord>(table: string, data: Partial<T> | Partial<T>[]): Promise<T[]>;
  update<T = DatabaseRecord>(table: string, data: Partial<T>, options?: QueryOptions): Promise<T[]>;
  updateById<T = DatabaseRecord>(table: string, id: string | number, data: Partial<T>): Promise<T | null>;
  delete(table: string, options?: QueryOptions): Promise<void>;
  deleteById(table: string, id: string | number): Promise<void>;

  // Utility operations
  count(table: string, options?: QueryOptions): Promise<number>;
  upsert<T = DatabaseRecord>(
    table: string,
    data: Partial<T> | Partial<T>[],
    options?: { onConflict?: string }
  ): Promise<T[]>;
}
