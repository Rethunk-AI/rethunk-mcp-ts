import 'reflect-metadata';

import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  checkRunner,
  checkTypeScriptProjectProblemsTool,
} from '../../../../src/mcp-server/tools/definitions/check-typescript-project-problems.tool.js';
import {
  JsonRpcErrorCode,
  McpError,
} from '../../../../src/types-global/errors.js';
import { requestContextService } from '../../../../src/utils/index.js';

describe('checkTypeScriptProjectProblemsTool', () => {
  const mockSdkContext = {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs all quick checks with non-color and low-verbosity flags', async () => {
    const runnerSpy = vi
      .spyOn(checkRunner, 'run')
      .mockResolvedValueOnce({
        name: 'lint:fix',
        command: 'yarn -s lint:fix --format json',
        exitCode: 0,
        success: true,
        stdout: '[]',
        stderr: '',
      })
      .mockResolvedValueOnce({
        name: 'typecheck',
        command: 'yarn -s typecheck --pretty false',
        exitCode: 0,
        success: true,
        stdout: '',
        stderr: '',
      })
      .mockResolvedValueOnce({
        name: 'typecheck:scripts',
        command: 'yarn -s typecheck:scripts --pretty false',
        exitCode: 1,
        success: false,
        stdout: '',
        stderr: 'error TS2304: Cannot find name',
      });

    const context = requestContextService.createRequestContext();
    const input = checkTypeScriptProjectProblemsTool.inputSchema.parse({});
    const result = await checkTypeScriptProjectProblemsTool.logic(
      input,
      context,
      mockSdkContext,
    );

    expect(runnerSpy).toHaveBeenCalledTimes(3);
    expect(runnerSpy.mock.calls[0]?.[2]).toEqual([
      '-s',
      'lint:fix',
      '--format',
      'json',
    ]);
    expect(runnerSpy.mock.calls[1]?.[2]).toEqual([
      '-s',
      'typecheck',
      '--pretty',
      'false',
    ]);
    expect(runnerSpy.mock.calls[2]?.[2]).toEqual([
      '-s',
      'typecheck:scripts',
      '--pretty',
      'false',
    ]);
    expect(result.hasProblems).toBe(true);
    expect(result.checks).toHaveLength(3);
  });

  it('formats output as machine-parseable JSON text', () => {
    const formatter = checkTypeScriptProjectProblemsTool.responseFormatter;
    expect(formatter).toBeDefined();

    const formatted = formatter!({
      hasProblems: false,
      checks: [
        {
          name: 'lint:fix',
          command: 'yarn -s lint:fix --format json',
          exitCode: 0,
          success: true,
          stdout: '[]',
          stderr: '',
        },
      ],
    });

    expect(formatted).toHaveLength(1);
    const first = formatted[0];
    expect(first).toBeDefined();
    if (!first || first.type !== 'text') {
      throw new Error('Expected text content block');
    }

    expect(JSON.parse(first.text)).toEqual({
      hasProblems: false,
      checks: [
        {
          name: 'lint:fix',
          command: 'yarn -s lint:fix --format json',
          exitCode: 0,
          success: true,
          stdout: '[]',
          stderr: '',
        },
      ],
    });
  });

  it('rejects disallowed command execution', async () => {
    const context = requestContextService.createRequestContext();

    let thrown: unknown;
    try {
      await checkRunner.run(
        'lint:fix',
        'npm',
        ['run', 'lint'],
        mockSdkContext,
        context,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(McpError);
    const mcpError = thrown as McpError;
    expect(mcpError.code).toBe(JsonRpcErrorCode.ValidationError);
    expect(mcpError.message).toContain('Command not allowed: npm');
  });
});
