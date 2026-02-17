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
    expect(Object.keys(result.checks)).toEqual([
      'lint:fix',
      'typecheck',
      'typecheck:scripts',
    ])
    expect(result.checks['lint:fix']).toBeDefined()
    expect(result.checks['typecheck']).toBeDefined()
    expect(result.checks['typecheck:scripts']).toBeDefined()
  })

  it('formats output as machine-parseable JSON text', () => {
    const formatter = checkTypeScriptProjectProblemsTool.responseFormatter
    expect(formatter).toBeDefined()

    const formatted = formatter?.({
      hasProblems: false,
      checks: {
        'lint:fix': {
          success: true,
          exitCode: 0,
          duration: 100,
        },
      },
    })

    expect(formatted).toHaveLength(1)
    const first = formatted?.[0]
    expect(first?.type).toBe('text')
    if (first?.type !== 'text') {
      throw new Error('Expected text content block')
    }

    const parsed = JSON.parse(first.text)
    expect(parsed.hasProblems).toBe(false)
    expect(parsed.checks['lint:fix']).toBeDefined()
    expect(parsed.checks['lint:fix'].success).toBe(true)
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
    expect(Object.keys(result.checks)).toEqual([
      'typecheck',
      'typecheck:scripts',
    ])
    expect(result.checks.typecheck).toBeDefined()
    expect(result.checks['typecheck:scripts']).toBeDefined()
    expect(result.hasProblems).toBe(false)
  })

  it('includes stdout/stderr only for failed checks', async () => {
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
        stderr: 'TS error details',
        duration: 200,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: 150,
      })

    const context = requestContextService.createRequestContext()
    const input = checkTypeScriptProjectProblemsTool.inputSchema.parse({})
    const result = await checkTypeScriptProjectProblemsTool.logic(
      input,
      context,
      mockSdkContext,
    )

    // Successful check (lint:fix) should not have stdout/stderr fields
    const lintFix = result.checks['lint:fix']
    expect(lintFix).toBeDefined()
    expect(lintFix?.success).toBe(true)
    expect('stdout' in lintFix!).toBe(false)
    expect('stderr' in lintFix!).toBe(false)
    expect(lintFix?.duration).toBe(100)

    // Failed check (typecheck) should have stdout/stderr
    const typecheck = result.checks.typecheck
    expect(typecheck).toBeDefined()
    expect(typecheck?.success).toBe(false)
    if (typecheck?.success === false) {
      expect(typecheck.stdout).toBe(
        'error TS7006: Parameter x implicitly has type any',
      )
      expect(typecheck.stderr).toBe('TS error details')
      expect(typecheck.duration).toBe(200)
    }

    // Successful check (typecheck:scripts) should not have stdout/stderr fields
    const typecheckScripts = result.checks['typecheck:scripts']
    expect(typecheckScripts).toBeDefined()
    expect(typecheckScripts?.success).toBe(true)
    expect('stdout' in typecheckScripts!).toBe(false)
    expect('stderr' in typecheckScripts!).toBe(false)
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

    expect(result.checks['lint:fix']?.duration).toBe(123)
    expect(result.checks.typecheck?.duration).toBe(456)
    expect(result.checks['typecheck:scripts']?.duration).toBe(789)

    Object.values(result.checks).forEach((check) => {
      expect(check.duration).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(check.duration)).toBe(true)
    })
  })
})
