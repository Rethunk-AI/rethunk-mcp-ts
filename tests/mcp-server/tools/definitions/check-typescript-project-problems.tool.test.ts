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
import 'reflect-metadata';

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
        duration: 100,
      })
      .mockResolvedValueOnce({
        name: 'typecheck',
        command: 'yarn -s typecheck --pretty false',
        exitCode: 0,
        success: true,
        stdout: '',
        stderr: '',
        duration: 200,
      })
      .mockResolvedValueOnce({
        name: 'typecheck:scripts',
        command: 'yarn -s typecheck:scripts --pretty false',
        exitCode: 1,
        success: false,
        stdout: '',
        stderr: 'error TS2304: Cannot find name',
        duration: 150,
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
    // Verify sdkContext is passed (4th parameter)
    expect(runnerSpy.mock.calls[0]?.[3]).toBe(mockSdkContext);
    expect(result.hasProblems).toBe(true);
    expect(result.checks).toHaveLength(3);
  });

  it('formats output as machine-parseable JSON text', () => {
    const formatter = checkTypeScriptProjectProblemsTool.responseFormatter;
    expect(formatter).toBeDefined();

    const formatted = formatter?.({
      hasProblems: false,
      checks: [
        {
          name: 'lint:fix',
          command: 'yarn -s lint:fix --format json',
          exitCode: 0,
          success: true,
          stdout: '[]',
          stderr: '',
          duration: 100,
        },
      ],
    });

    expect(formatted).toHaveLength(1);
    const first = formatted?.[0];
    expect(first?.type).toBe('text');
    if (first?.type !== 'text') {
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
          duration: 100,
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

  it('runs only selected checks when checks parameter is provided', async () => {
    const runnerSpy = vi
      .spyOn(checkRunner, 'run')
      .mockResolvedValueOnce({
        name: 'typecheck',
        command: 'yarn -s typecheck --pretty false',
        exitCode: 0,
        success: true,
        stdout: '',
        stderr: '',
        duration: 200,
      })
      .mockResolvedValueOnce({
        name: 'typecheck:scripts',
        command: 'yarn -s typecheck:scripts --pretty false',
        exitCode: 0,
        success: true,
        stdout: '',
        stderr: '',
        duration: 150,
      });

    const context = requestContextService.createRequestContext();
    const input = checkTypeScriptProjectProblemsTool.inputSchema.parse({
      checks: ['typecheck', 'typecheck:scripts'],
    });
    const result = await checkTypeScriptProjectProblemsTool.logic(
      input,
      context,
      mockSdkContext,
    );

    // Should run only 2 checks (not lint:fix)
    expect(runnerSpy).toHaveBeenCalledTimes(2);
    // First call should be typecheck (not lint:fix)
    expect(runnerSpy.mock.calls[0]?.[0]).toBe('typecheck');
    expect(runnerSpy.mock.calls[1]?.[0]).toBe('typecheck:scripts');
    expect(result.checks).toHaveLength(2);
    expect(result.hasProblems).toBe(false);
  });

  it('strips stdout/stderr when summaryOnly is true', async () => {
    const runnerSpy = vi
      .spyOn(checkRunner, 'run')
      .mockResolvedValueOnce({
        name: 'lint:fix',
        command: 'yarn -s lint:fix --format json',
        exitCode: 0,
        success: true,
        stdout: '["file1.ts", "file2.ts"]',
        stderr: '',
        duration: 100,
      })
      .mockResolvedValueOnce({
        name: 'typecheck',
        command: 'yarn -s typecheck --pretty false',
        exitCode: 1,
        success: false,
        stdout:
          'src/index.ts(5,3): error TS7006: Parameter x implicitly has type any',
        stderr: '',
        duration: 200,
      })
      .mockResolvedValueOnce({
        name: 'typecheck:scripts',
        command: 'yarn -s typecheck:scripts --pretty false',
        exitCode: 0,
        success: true,
        stdout: '',
        stderr: '',
        duration: 150,
      });

    const context = requestContextService.createRequestContext();
    const input = checkTypeScriptProjectProblemsTool.inputSchema.parse({
      summaryOnly: true,
    });
    const result = await checkTypeScriptProjectProblemsTool.logic(
      input,
      context,
      mockSdkContext,
    );

    // All checks should run
    expect(runnerSpy).toHaveBeenCalledTimes(3);
    // But stdout/stderr should be stripped
    expect(result.checks[0]?.stdout).toBe('');
    expect(result.checks[0]?.stderr).toBe('');
    expect(result.checks[1]?.stdout).toBe('');
    expect(result.checks[1]?.stderr).toBe('');
    // Duration should still be present
    expect(result.checks[0]?.duration).toBe(100);
    expect(result.checks[1]?.duration).toBe(200);
    // Exit codes and success status should remain
    expect(result.checks[1]?.success).toBe(false);
  });

  it('captures execution duration for each check', async () => {
    vi.spyOn(checkRunner, 'run')
      .mockResolvedValueOnce({
        name: 'lint:fix',
        command: 'yarn -s lint:fix --format json',
        exitCode: 0,
        success: true,
        stdout: '[]',
        stderr: '',
        duration: 123,
      })
      .mockResolvedValueOnce({
        name: 'typecheck',
        command: 'yarn -s typecheck --pretty false',
        exitCode: 0,
        success: true,
        stdout: '',
        stderr: '',
        duration: 456,
      })
      .mockResolvedValueOnce({
        name: 'typecheck:scripts',
        command: 'yarn -s typecheck:scripts --pretty false',
        exitCode: 0,
        success: true,
        stdout: '',
        stderr: '',
        duration: 789,
      });

    const context = requestContextService.createRequestContext();
    const input = checkTypeScriptProjectProblemsTool.inputSchema.parse({});
    const result = await checkTypeScriptProjectProblemsTool.logic(
      input,
      context,
      mockSdkContext,
    );

    // Verify duration is passed through correctly
    expect(result.checks[0]?.duration).toBe(123);
    expect(result.checks[1]?.duration).toBe(456);
    expect(result.checks[2]?.duration).toBe(789);
    // All durations should be non-negative integers
    result.checks.forEach((check) => {
      expect(check.duration).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(check.duration)).toBe(true);
    });
  });
});
