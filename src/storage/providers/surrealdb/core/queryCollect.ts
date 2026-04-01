/**
 * @fileoverview SurrealDB JS SDK v2 query helpers (per-statement tuple results).
 * @module src/storage/providers/surrealdb/core/queryCollect
 */

import type { Surreal } from 'surrealdb'

/**
 * Rows from the first SurrealQL statement (SDK v2+ `query()` resolves to a per-statement tuple).
 */
export async function queryFirstStatementRows<T>(
  client: Surreal,
  query: string,
  bindings?: Record<string, unknown>,
): Promise<T[]> {
  const [rows] = await client.query<[T[]]>(query, bindings ?? {})
  return Array.isArray(rows) ? rows : []
}
