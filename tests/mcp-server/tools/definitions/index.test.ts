/**
 * @fileoverview Tests for tool definitions barrel export.
 * Validates that all registered tools have required metadata and unique names.
 * @module tests/mcp-server/tools/definitions/index
 */
import { describe, it, expect } from 'vitest';

import { allToolDefinitions } from '@/mcp-server/tools/definitions/index.js';
import { stageSelectedFilesAndCreateAtomicCommitTool } from '@/mcp-server/tools/definitions/stage-selected-files-and-create-atomic-commit.tool.js';

describe('Tool Definitions Barrel Export', () => {
  it('should export a non-empty array of tool definitions', () => {
    expect(allToolDefinitions).toBeInstanceOf(Array);
    expect(allToolDefinitions.length).toBeGreaterThan(0);
  });

  it('should expose only the stage-and-commit tool', () => {
    expect(allToolDefinitions).toHaveLength(1);
    expect(allToolDefinitions[0]).toBe(
      stageSelectedFilesAndCreateAtomicCommitTool,
    );
    expect(allToolDefinitions[0]?.name).toBe(
      'stage_selected_specs_and_create_atomic_commit',
    );
  });

  it('should have unique tool names', () => {
    const names = allToolDefinitions.map((t) => t.name);
    const uniqueNames = new Set(names);

    expect(uniqueNames.size).toBe(names.length);
  });

  for (const tool of allToolDefinitions) {
    describe(`Tool: ${tool.name}`, () => {
      it('should have required metadata', () => {
        expect(tool.name).toBeTruthy();
        expect(typeof tool.name).toBe('string');
        expect(tool.description).toBeTruthy();
        expect(typeof tool.description).toBe('string');
      });

      it('should have valid inputSchema', () => {
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema.parse).toBe('function');
      });

      it('should have logic or taskHandlers', () => {
        // Regular tools have `logic`, task tools have `taskHandlers`
        const def = tool as unknown as Record<string, unknown>;
        const hasLogic = typeof def.logic === 'function';
        const hasTaskHandlers =
          'taskHandlers' in def &&
          def.taskHandlers !== null &&
          typeof def.taskHandlers === 'object';

        expect(hasLogic || hasTaskHandlers).toBe(true);
      });
    });
  }
});
