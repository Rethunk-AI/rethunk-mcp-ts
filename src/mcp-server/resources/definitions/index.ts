/**
 * @fileoverview Barrel file for resource definitions.
 * Resource definitions are intentionally not exported in the current configuration.
 * @module src/mcp-server/resources/definitions
 */
import type { ResourceDefinition } from "../utils/resourceDefinition.js";
import type { ZodObject, ZodRawShape } from "zod";

export const allResourceDefinitions: ResourceDefinition<
	ZodObject<ZodRawShape>,
	ZodObject<ZodRawShape> | undefined
>[] = [];
