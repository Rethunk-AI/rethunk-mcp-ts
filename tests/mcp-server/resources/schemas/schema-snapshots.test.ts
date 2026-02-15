/**
 * @fileoverview Snapshot tests for resource JSON Schema output.
 * Guards against unintentional schema changes that could break MCP clients.
 * @module tests/mcp-server/resources/schemas/schema-snapshots
 */
import { describe, it, expect } from 'vitest';

import { allResourceDefinitions } from '@/mcp-server/resources/definitions/index.js';

describe('Resource Schema Snapshots', () => {
  it('should have no resource schemas to snapshot', () => {
    expect(allResourceDefinitions).toHaveLength(0);
  });
});
