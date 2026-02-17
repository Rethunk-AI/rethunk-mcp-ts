/**
 * @fileoverview Barrel file for resource definitions.
 * Resource definitions are intentionally not exported in the current configuration.
 * @module src/mcp-server/resources/definitions
 */

import type { ZodObject, ZodRawShape } from 'zod'
import type { ResourceDefinition } from '../utils/resourceDefinition.js'

export const allResourceDefinitions: ResourceDefinition<
  ZodObject<ZodRawShape>,
  ZodObject<ZodRawShape> | undefined
>[] = []
