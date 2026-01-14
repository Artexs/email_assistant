import { createClient, SupabaseClient } from "@supabase/supabase-js";

import { log } from "../../utils/log";
import { DatabaseRecord, IDatabaseProvider, QueryOptions } from "../interfaces/database.interface";

export class SupabaseAdapter implements IDatabaseProvider {
  private client: SupabaseClient;

  constructor(url: string, key: string) {
    this.client = createClient(url, key);
  }

  /**
   * Apply filters and options to a Supabase query
   */
  private applyQueryOptions(query: ReturnType<SupabaseClient["from"]>, options?: QueryOptions) {
    let modifiedQuery = query.select(options?.select || "*");

    // Apply filters
    if (options?.filters) {
      for (const filter of options.filters) {
        switch (filter.operator) {
          case "eq":
            modifiedQuery = modifiedQuery.eq(filter.column, filter.value);
            break;
          case "neq":
            modifiedQuery = modifiedQuery.neq(filter.column, filter.value);
            break;
          case "gt":
            modifiedQuery = modifiedQuery.gt(filter.column, filter.value);
            break;
          case "gte":
            modifiedQuery = modifiedQuery.gte(filter.column, filter.value);
            break;
          case "lt":
            modifiedQuery = modifiedQuery.lt(filter.column, filter.value);
            break;
          case "lte":
            modifiedQuery = modifiedQuery.lte(filter.column, filter.value);
            break;
          case "like":
            modifiedQuery = modifiedQuery.like(filter.column, filter.value as string);
            break;
          case "ilike":
            modifiedQuery = modifiedQuery.ilike(filter.column, filter.value as string);
            break;
          case "in":
            modifiedQuery = modifiedQuery.in(filter.column, filter.value as unknown[]);
            break;
          case "is":
            modifiedQuery = modifiedQuery.is(filter.column, filter.value);
            break;
        }
      }
    }

    // Apply ordering
    if (options?.orderBy) {
      modifiedQuery = modifiedQuery.order(options.orderBy.column, { ascending: options.orderBy.ascending ?? true });
    }

    // Apply pagination
    if (options?.limit !== undefined) {
      modifiedQuery = modifiedQuery.limit(options.limit);
    }

    if (options?.offset !== undefined) {
      modifiedQuery = modifiedQuery.range(options.offset, options.offset + (options.limit ?? 10) - 1);
    }

    return modifiedQuery;
  }

  async select<T = DatabaseRecord>(table: string, options?: QueryOptions): Promise<T[]> {
    try {
      const query = this.client.from(table);
      const modifiedQuery = this.applyQueryOptions(query, options);

      const { data, error } = await modifiedQuery;

      if (error) {
        log.error(`Error selecting from table ${table}:`, error);
        throw error;
      }

      return (data as T[]) || [];
    } catch (error) {
      log.error(`Error in select operation for table ${table}:`, error);
      throw error;
    }
  }

  async selectOne<T = DatabaseRecord>(table: string, options?: QueryOptions): Promise<T | null> {
    try {
      const query = this.client.from(table);
      const modifiedQuery = this.applyQueryOptions(query, { ...options, limit: 1 });

      const { data, error } = await modifiedQuery.single();

      if (error) {
        if (error.code === "PGRST116") {
          // No rows found
          return null;
        }
        log.error(`Error selecting one from table ${table}:`, error);
        throw error;
      }

      return (data as T) || null;
    } catch (error) {
      log.error(`Error in selectOne operation for table ${table}:`, error);
      throw error;
    }
  }

  async selectById<T = DatabaseRecord>(table: string, id: string | number): Promise<T | null> {
    try {
      const { data, error } = await this.client.from(table).select("*").eq("id", id).single();

      if (error) {
        if (error.code === "PGRST116") {
          // No rows found
          return null;
        }
        log.error(`Error selecting by id from table ${table}:`, error);
        throw error;
      }

      return (data as T) || null;
    } catch (error) {
      log.error(`Error in selectById operation for table ${table}:`, error);
      throw error;
    }
  }

  async insert<T = DatabaseRecord>(table: string, data: Partial<T> | Partial<T>[]): Promise<T[]> {
    try {
      const { data: insertedData, error } = await this.client.from(table).insert(data).select();

      if (error) {
        log.error(`Error inserting into table ${table}:`, error);
        throw error;
      }

      return (insertedData as T[]) || [];
    } catch (error) {
      log.error(`Error in insert operation for table ${table}:`, error);
      throw error;
    }
  }

  async update<T = DatabaseRecord>(table: string, data: Partial<T>, options?: QueryOptions): Promise<T[]> {
    try {
      let query = this.client.from(table).update(data);

      // Apply filters for targeted updates
      if (options?.filters) {
        for (const filter of options.filters) {
          switch (filter.operator) {
            case "eq":
              query = query.eq(filter.column, filter.value);
              break;
            case "neq":
              query = query.neq(filter.column, filter.value);
              break;
            case "gt":
              query = query.gt(filter.column, filter.value);
              break;
            case "gte":
              query = query.gte(filter.column, filter.value);
              break;
            case "lt":
              query = query.lt(filter.column, filter.value);
              break;
            case "lte":
              query = query.lte(filter.column, filter.value);
              break;
            case "in":
              query = query.in(filter.column, filter.value as unknown[]);
              break;
            case "is":
              query = query.is(filter.column, filter.value);
              break;
          }
        }
      }

      const { data: updatedData, error } = await query.select();

      if (error) {
        log.error(`Error updating table ${table}:`, error);
        throw error;
      }

      return (updatedData as T[]) || [];
    } catch (error) {
      log.error(`Error in update operation for table ${table}:`, error);
      throw error;
    }
  }

  async updateById<T = DatabaseRecord>(table: string, id: string | number, data: Partial<T>): Promise<T | null> {
    try {
      const { data: updatedData, error } = await this.client.from(table).update(data).eq("id", id).select().single();

      if (error) {
        if (error.code === "PGRST116") {
          // No rows found
          return null;
        }
        log.error(`Error updating by id in table ${table}:`, error);
        throw error;
      }

      return (updatedData as T) || null;
    } catch (error) {
      log.error(`Error in updateById operation for table ${table}:`, error);
      throw error;
    }
  }

  async delete(table: string, options?: QueryOptions): Promise<void> {
    try {
      let query = this.client.from(table).delete();

      // Apply filters for targeted deletes
      if (options?.filters) {
        for (const filter of options.filters) {
          switch (filter.operator) {
            case "eq":
              query = query.eq(filter.column, filter.value);
              break;
            case "neq":
              query = query.neq(filter.column, filter.value);
              break;
            case "gt":
              query = query.gt(filter.column, filter.value);
              break;
            case "gte":
              query = query.gte(filter.column, filter.value);
              break;
            case "lt":
              query = query.lt(filter.column, filter.value);
              break;
            case "lte":
              query = query.lte(filter.column, filter.value);
              break;
            case "in":
              query = query.in(filter.column, filter.value as unknown[]);
              break;
            case "is":
              query = query.is(filter.column, filter.value);
              break;
          }
        }
      }

      const { error } = await query;

      if (error) {
        log.error(`Error deleting from table ${table}:`, error);
        throw error;
      }
    } catch (error) {
      log.error(`Error in delete operation for table ${table}:`, error);
      throw error;
    }
  }

  async deleteById(table: string, id: string | number): Promise<void> {
    try {
      const { error } = await this.client.from(table).delete().eq("id", id);

      if (error) {
        log.error(`Error deleting by id from table ${table}:`, error);
        throw error;
      }
    } catch (error) {
      log.error(`Error in deleteById operation for table ${table}:`, error);
      throw error;
    }
  }

  async count(table: string, options?: QueryOptions): Promise<number> {
    try {
      let query = this.client.from(table).select("*", { count: "exact", head: true });

      // Apply filters
      if (options?.filters) {
        for (const filter of options.filters) {
          switch (filter.operator) {
            case "eq":
              query = query.eq(filter.column, filter.value);
              break;
            case "neq":
              query = query.neq(filter.column, filter.value);
              break;
            case "gt":
              query = query.gt(filter.column, filter.value);
              break;
            case "gte":
              query = query.gte(filter.column, filter.value);
              break;
            case "lt":
              query = query.lt(filter.column, filter.value);
              break;
            case "lte":
              query = query.lte(filter.column, filter.value);
              break;
            case "in":
              query = query.in(filter.column, filter.value as unknown[]);
              break;
            case "is":
              query = query.is(filter.column, filter.value);
              break;
          }
        }
      }

      const { count, error } = await query;

      if (error) {
        log.error(`Error counting rows in table ${table}:`, error);
        throw error;
      }

      return count || 0;
    } catch (error) {
      log.error(`Error in count operation for table ${table}:`, error);
      throw error;
    }
  }

  async upsert<T = DatabaseRecord>(
    table: string,
    data: Partial<T> | Partial<T>[],
    options?: { onConflict?: string }
  ): Promise<T[]> {
    try {
      const { data: upsertedData, error } = await this.client
        .from(table)
        .upsert(data, { onConflict: options?.onConflict })
        .select();

      if (error) {
        log.error(`Error upserting into table ${table}:`, error);
        throw error;
      }

      return (upsertedData as T[]) || [];
    } catch (error) {
      log.error(`Error in upsert operation for table ${table}:`, error);
      throw error;
    }
  }
}
