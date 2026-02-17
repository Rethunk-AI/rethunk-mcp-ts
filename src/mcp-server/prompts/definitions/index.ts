/**
 * @fileoverview Barrel file for prompt definitions.
 * Prompt definitions are intentionally not exported in the current configuration.
 * @module src/mcp-server/prompts/definitions
 */

import type { ZodObject, ZodRawShape } from 'zod'
import type { PromptDefinition } from '../utils/promptDefinition.js'

export const allPromptDefinitions: PromptDefinition<
  ZodObject<ZodRawShape> | undefined
>[] = []
