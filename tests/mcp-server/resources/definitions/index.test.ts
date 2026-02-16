/**
 * @fileoverview Tests for resource definitions barrel export.
 * Validates that all registered resources have required metadata and unique names.
 * @module tests/mcp-server/resources/definitions/index
 */
import { describe, it, expect } from 'vitest';

import { allResourceDefinitions } from '@/mcp-server/resources/definitions/index.js';

describe('Resource Definitions Barrel Export', () => {
  it('should export an empty array of resource definitions', () => {
    expect(allResourceDefinitions).toBeInstanceOf(Array);
    expect(allResourceDefinitions).toHaveLength(0);
  });

  it('should have unique resource names', () => {
    const names = allResourceDefinitions.map((r) => r.name);
    const uniqueNames = new Set(names);

    expect(uniqueNames.size).toBe(names.length);
  });

  // Note: The following test suites are dynamically generated from allResourceDefinitions.
  // Since the array is intentionally empty in current config, these suites do not execute.
  for (const resource of allResourceDefinitions) {
    describe(`Resource: ${resource.name}`, () => {
      it('should have required metadata', () => {
        expect(resource.name).toBeTruthy();
        expect(typeof resource.name).toBe('string');
        expect(resource.description).toBeTruthy();
        expect(typeof resource.description).toBe('string');
        expect(resource.uriTemplate).toBeTruthy();
        expect(typeof resource.uriTemplate).toBe('string');
      });

      it('should have valid paramsSchema', () => {
        expect(resource.paramsSchema).toBeDefined();
        expect(typeof resource.paramsSchema.parse).toBe('function');
      });

      it('should have a logic function', () => {
        expect(typeof resource.logic).toBe('function');
      });
    });
  }
});
