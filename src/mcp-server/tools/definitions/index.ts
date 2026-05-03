/**
 * @fileoverview Barrel file for all tool definitions.
 * This file re-exports all tool definitions for easy import and registration.
 * It also exports an array of all definitions for automated registration.
 * @module src/mcp-server/tools/definitions
 */

import type { ZodObject, ZodRawShape } from 'zod'
import type { ToolDefinition } from '../utils/toolDefinition.js'
import { checkTypeScriptProjectProblemsTool } from './check-typescript-project-problems.tool.js'
import { stageSelectedFilesAndCreateAtomicCommitTool } from './stage-selected-files-and-create-atomic-commit.tool.js'

/**
 * An array containing all tool definitions for easy iteration and registration.
 */
export const allToolDefinitions: Array<
  ToolDefinition<ZodObject<ZodRawShape>, ZodObject<ZodRawShape>>
> = [
  checkTypeScriptProjectProblemsTool,
  stageSelectedFilesAndCreateAtomicCommitTool,
]
