import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkTypeScriptProjectProblemsTool } from '../../../../src/mcp-server/tools/definitions/check-typescript-project-problems.tool.js'
import { processRunner } from '../../../../src/mcp-server/tools/utils/process-runner.js'
import { requestContextService } from '../../../../src/utils/index.js'
import 'reflect-metadata'

describe('checkTypeScriptProjectProblemsTool', () => {
  const mockSdkContext = {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs all quick checks', async () => {
    const runnerSpy = vi
      .spyOn(processRunner, 'run')
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '[]',
        stderr: '',
        duration: 100,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: 200,
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'error TS2304',
        duration: 150,
      })

    const context = requestContextService.createRequestContext()
    const input = checkTypeScriptProjectProblemsTool.inputSchema.parse({})
    const result = await checkTypeScriptProjectProblemsTool.logic(
      input,
      context,
      mockSdkContext,
    )

    expect(runnerSpy).toHaveBeenCalledTimes(3)
    expect(result.hasProblems).toBe(true)
    expect(result.checks).toHaveLength(3)
    expect(result.checks[0]?.name).toBe('lint:fix')
    expect(result.checks[1]?.name).toBe('typecheck')
    expect(result.checks[2]?.name).toBe('typecheck:scripts')
  })

  it('formats output as machine-parseable JSON text', () => {
    const formatter = checkTypeScriptProjectProblemsTool.responseFormatter
    expect(formatter).toBeDefined()

    const formatted = formatter?.({
      hasProblems: false,
      checks: [
        {
          name: 'lint:fix',
          command: 'yarn lint',
          exitCode: 0,
          success: true,
          stdout: '[]',
          stderr: '',
          duration: 100,
        },
      ],
    })

    expect(formatted).toHaveLength(1)
    const first = formatted?.[0]
    expect(first?.type).toBe('text')
    if (first?.type !== 'text') {
      throw new Error('Expected text content block')
    }

    const parsed = JSON.parse(first.text)
    expect(parsed.hasProblems).toBe(false)
    expect(parsed.checks[0]?.name).toBe('lint:fix')
  })

  it('runs only selected checks when checks parameter is provided', async () => {
    const runnerSpy = vi
      .spyOn(processRunner, 'run')
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: 200,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: 150,
      })

    const context = requestContextService.createRequestContext()
    const input = checkTypeScriptProjectProblemsTool.inputSchema.parse({
      checks: ['typecheck', 'typecheck:scripts'],
    })
    const result = await checkTypeScriptProjectProblemsTool.logic(
      input,
      context,
      mockSdkContext,
    )

    // Should run only 2 checks (not lint:fix)
    expect(runnerSpy).toHaveBeenCalledTimes(2)
    expect(result.checks).toHaveLength(2)
    expect(result.checks[0]?.name).toBe('typecheck')
    expect(result.checks[1]?.name).toBe('typecheck:scripts')
    expect(result.hasProblems).toBe(false)
  })

  it('strips stdout/stderr when summaryOnly is true', async () => {
    vi.spyOn(processRunner, 'run')
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '["file1.ts", "file2.ts"]',
        stderr: '',
        duration: 100,
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: 'error TS7006: Parameter x implicitly has type any',
        stderr: '',
        duration: 200,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: 150,
      })

    const context = requestContextService.createRequestContext()
    const input = checkTypeScriptProjectProblemsTool.inputSchema.parse({
      summaryOnly: true,
    })
    const result = await checkTypeScriptProjectProblemsTool.logic(
      input,
      context,
      mockSdkContext,
    )

    // stdout/stderr should be stripped
    expect(result.checks[0]?.stdout).toBe('')
    expect(result.checks[0]?.stderr).toBe('')
    expect(result.checks[1]?.stdout).toBe('')
    expect(result.checks[1]?.stderr).toBe('')
    // Duration and success should remain
    expect(result.checks[0]?.duration).toBe(100)
    expect(result.checks[1]?.duration).toBe(200)
    expect(result.checks[1]?.success).toBe(false)
  })

  it('captures execution duration for each check', async () => {
    vi.spyOn(processRunner, 'run')
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '[]',
        stderr: '',
        duration: 123,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: 456,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: 789,
      })

    const context = requestContextService.createRequestContext()
    const input = checkTypeScriptProjectProblemsTool.inputSchema.parse({})
    const result = await checkTypeScriptProjectProblemsTool.logic(
      input,
      context,
      mockSdkContext,
    )

    expect(result.checks[0]?.duration).toBe(123)
    expect(result.checks[1]?.duration).toBe(456)
    expect(result.checks[2]?.duration).toBe(789)
    result.checks.forEach((check) => {
      expect(check.duration).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(check.duration)).toBe(true)
    })
  })
})
