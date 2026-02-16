/**
 * @fileoverview Barrel file for all tool definitions.
 * This file re-exports all tool definitions for easy import and registration.
 * It also exports an array of all definitions for automated registration.
 * @module src/mcp-server/tools/definitions
 */

import { checkTypeScriptProjectProblemsTool } from './check-typescript-project-problems.tool.js';
import { stageSelectedFilesAndCreateAtomicCommitTool } from './stage-selected-files-and-create-atomic-commit.tool.js';

/**
 * An array containing all tool definitions for easy iteration and registration.
 */
export const allToolDefinitions = [
  checkTypeScriptProjectProblemsTool,
  stageSelectedFilesAndCreateAtomicCommitTool,
];
