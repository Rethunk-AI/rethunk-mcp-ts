/**
 * @fileoverview Graph database service exports.
 * @module src/services/graph
 */

export { GraphService } from './core/GraphService.js'
export type { IGraphProvider } from './core/IGraphProvider.js'
export { SurrealGraphProvider } from './providers/surrealGraph.provider.js'
export type * from './types.js'
