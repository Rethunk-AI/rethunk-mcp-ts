/**
 * @fileoverview Barrel exports for SurrealDB storage provider.
 * @module src/storage/providers/surrealdb
 */

export type {
  AuthResult,
  AuthStrategy,
  JwtAccessConfig,
  JwtAlgorithm,
  RecordAccessConfig,
} from './auth/authManager.js'
// Authentication exports
export { AuthManager } from './auth/authManager.js'
export type {
  PermissionOp,
  PermissionRule,
  TablePermissions,
} from './auth/permissionHelpers.js'
export {
  PermissionBuilder,
  PermissionHelper,
} from './auth/permissionHelpers.js'
export {
  PermissionPatterns,
  ScopeDefinitions,
} from './auth/scopeDefinitions.js'
export { ConnectionManager } from './core/connectionManager.js'
export {
  SelectQueryBuilder,
  select,
  WhereBuilder,
  where,
} from './core/queryBuilder.js'
// Core exports
export { SurrealDbClient } from './core/surrealDbClient.js'
export { TransactionManager } from './core/transactionManager.js'
// Event exports
export { EventManager } from './events/eventManager.js'
export type {
  DefineEventResult,
  EventConfig,
  EventContext,
  EventInfo,
  EventTrigger,
} from './events/eventTypes.js'
export { TriggerBuilder } from './events/triggerBuilder.js'
export type {
  CustomFunctionConfig,
  DefineFunctionResult,
  FunctionParameter,
} from './functions/customFunctions.js'
// Function exports
export { CustomFunctions } from './functions/customFunctions.js'
export { FunctionRegistry } from './functions/functionRegistry.js'
// Graph exports
export { GraphOperations } from './graph/graphOperations.js'
export type {
  Edge,
  EdgeOptions,
  GraphQueryResult,
  Vertex,
} from './graph/graphTypes.js'
export type { Path, PathFindingOptions } from './graph/pathFinder.js'
export { PathFinder } from './graph/pathFinder.js'
export { RelationshipManager } from './graph/relationshipManager.js'
export type {
  DatabaseSchema,
  FieldInfo,
  IndexInfo,
  TableInfo,
} from './introspection/schemaIntrospector.js'
// Introspection exports
export { SchemaIntrospector } from './introspection/schemaIntrospector.js'
export { SurrealKvProvider } from './kv/surrealKvProvider.js'
// Migration exports
export { MigrationRunner } from './migrations/migrationRunner.js'
export type {
  Migration,
  MigrationDirection,
  MigrationHistory,
  MigrationPlan,
  MigrationResult,
  MigrationStatus,
} from './migrations/migrationTypes.js'
export type { ForLoopConfig } from './query/forLoopBuilder.js'
export { ForLoopBuilder, forLoop } from './query/forLoopBuilder.js'
export type { SubqueryContext } from './query/subqueryBuilder.js'
// Query exports
export { SubqueryBuilder, subquery } from './query/subqueryBuilder.js'
// Types
export type {
  HealthCheckResult,
  KvStoreInput,
  KvStoreRecord,
  QueryResult,
  SurrealDb,
  SurrealDbConfig,
  TransactionOptions,
} from './types.js'
