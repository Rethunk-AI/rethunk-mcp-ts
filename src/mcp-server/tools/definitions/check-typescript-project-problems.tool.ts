/**
 * @fileoverview MCP tool for checking TypeScript projects for code quality issues.
 * Runs lint:fix and typecheck commands to validate project health.
 * @module src/mcp-server/tools/definitions/check-typescript-project-problems
 */

import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import type {
  SdkContext,
  ToolAnnotations,
  ToolDefinition,
} from '@/mcp-server/tools/utils/index.js'
import {
  processRunner,
  type SpawnConfig,
} from '@/mcp-server/tools/utils/process-runner.js'
import {
  detectProjectPackageManager,
  mapScriptArgsToRunner,
} from '@/mcp-server/tools/utils/signal.js'
import { withToolAuth } from '@/mcp-server/transports/auth/lib/withAuth.js'
import { logger, type RequestContext } from '@/utils/index.js'

const TOOL_NAME = 'check_typescript_project_for_problems'
const TOOL_TITLE = 'Check TypeScript Project for Problems'
const TOOL_DESCRIPTION =
  'Runs quick local quality checks including lint fixing (which modifies files) and type checking. Optionally scopes checks to specific files or overrides timeout. Runs lint:fix first to avoid file race conditions. Returns combined output in machine-parseable JSON format.'
const ALLOWED_COMMANDS = new Set(['yarn', 'bun', 'pnpm'])

const TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  openWorldHint: false,
}

const InputSchema = z.object({
  files: z
    .array(z.string().describe('File path to check'))
    .optional()
    .describe(
      'Specific files to check. If provided, scopes the linting and type checking to these files only.',
    ),
  timeout: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Override timeout in milliseconds. Defaults to SDK context timeout. Use this for longer operations like running comprehensive tests.',
    ),
  checks: z
    .array(z.enum(['lint:fix', 'typecheck', 'typecheck:scripts']))
    .optional()
    .describe(
      'Specific checks to run. If not provided, runs all checks: lint:fix (which modifies files), typecheck, and typecheck:scripts.',
    ),
  summaryOnly: z
    .boolean()
    .optional()
    .describe(
      'If true, returns only exit codes, success status, and duration per check, omitting command and output fields. Useful for reducing output verbosity.',
    ),
  maxOutputLength: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Maximum length in characters for stdout and stderr fields. If output exceeds this, it will be truncated with a [...truncated] indicator. Ignored when summaryOnly=true.',
    ),
})

/**
 * Check result schema for successful checks (minimal footprint).
 * Omits stdout/stderr to reduce token usage.
 */
const SuccessfulCheckSchema = z.object({
  success: z.literal(true),
  exitCode: z.literal(0),
  duration: z.number().int().min(0).describe('Execution time in milliseconds'),
})

/**
 * Check result schema for failed checks (includes diagnostics).
 * Includes stdout/stderr for error diagnosis.
 */
const FailedCheckSchema = z.object({
  success: z.literal(false),
  exitCode: z.number().int().gt(0),
  stdout: z.string().describe('Standard output from the check'),
  stderr: z.string().describe('Standard error output from the check'),
  duration: z.number().int().min(0).describe('Execution time in milliseconds'),
})

/**
 * Discriminated union for check results - varies based on success/failure.
 */
const CheckResultSchema = z.union([SuccessfulCheckSchema, FailedCheckSchema])

const OutputSchema = z.object({
  hasProblems: z.boolean().describe('True if any check failed'),
  checks: z
    .record(z.string(), CheckResultSchema)
    .describe(
      'Map of check results keyed by check name (lint:fix, typecheck, or typecheck:scripts). Each result includes success status, exit code, and duration. Failures include stdout/stderr for diagnostics.',
    ),
})

type TypeScriptProjectCheckResponse = z.infer<typeof OutputSchema>

const QUICK_CHECKS = [
  {
    name: 'lint:fix',
    args: ['-s', 'lint:fix', '--format', 'json'],
  },
  {
    name: 'typecheck',
    args: ['-s', 'typecheck', '--pretty', 'false'],
  },
  {
    name: 'typecheck:scripts',
    args: ['-s', 'typecheck:scripts', '--pretty', 'false'],
  },
] as const

/**
 * Truncates output to maximum length with indicator if truncated.
 */
function truncateOutput(output: string, maxLength?: number): string {
  if (!maxLength || output.length <= maxLength) {
    return output
  }
  return `${output.substring(0, maxLength)}\n[...output truncated]`
}

/**
 * Builds a check result object for successful checks (minimal footprint).
 */
function buildSuccessfulCheck(
  duration: number,
): z.infer<typeof SuccessfulCheckSchema> {
  return {
    success: true,
    exitCode: 0,
    duration,
  }
}

/**
 * Builds a check result object for failed checks (includes diagnostics).
 */
function buildFailedCheck(
  exitCode: number,
  stdout: string,
  stderr: string,
  duration: number,
  maxOutputLength?: number,
): z.infer<typeof FailedCheckSchema> {
  return {
    success: false,
    exitCode,
    stdout: truncateOutput(stdout, maxOutputLength),
    stderr: truncateOutput(stderr, maxOutputLength),
    duration,
  }
}

/**
 * Runs lint:fix sequentially before other checks to avoid file race conditions,
 * then runs remaining checks in parallel.
 * Returns results as a Record keyed by check name.
 */
async function executeChecksWithFileLocking(
  checks: ReadonlyArray<{ name: string; args: readonly string[] }>,
  appContext: RequestContext,
  sdkContext: SdkContext,
  maxOutputLength?: number,
): Promise<Record<string, z.infer<typeof CheckResultSchema>>> {
  const results: Record<string, z.infer<typeof CheckResultSchema>> = {}

  // Separate lint:fix from other checks
  const lintCheck = checks.find((c) => c.name === 'lint:fix')
  const otherChecks = checks.filter((c) => c.name !== 'lint:fix')

  // Run lint:fix first to avoid file modifications affecting other checks
  if (lintCheck) {
    const pm = detectProjectPackageManager(process.cwd())
    const effectiveArgs = mapScriptArgsToRunner(pm, lintCheck.args)

    const spawnConfig: SpawnConfig = {
      command: pm,
      args: effectiveArgs,
      allowedCommands: ALLOWED_COMMANDS,
      stdinMode: 'ignore',
    }

    const result = await processRunner.run(
      spawnConfig,
      sdkContext,
      appContext,
      lintCheck.name,
    )

    if (result.exitCode === 0) {
      results[lintCheck.name] = buildSuccessfulCheck(result.duration)
    } else {
      results[lintCheck.name] = buildFailedCheck(
        result.exitCode,
        result.stdout,
        result.stderr,
        result.duration,
        maxOutputLength,
      )
    }
  }

  // Run remaining checks in parallel
  const parallelResults = await Promise.all(
    otherChecks.map(async (check) => {
      const pm = detectProjectPackageManager(process.cwd())
      const effectiveArgs = mapScriptArgsToRunner(pm, check.args)

      const spawnConfig: SpawnConfig = {
        command: pm,
        args: effectiveArgs,
        allowedCommands: ALLOWED_COMMANDS,
        stdinMode: 'ignore',
      }

      const result = await processRunner.run(
        spawnConfig,
        sdkContext,
        appContext,
        check.name,
      )

      if (result.exitCode === 0) {
        return {
          name: check.name,
          result: buildSuccessfulCheck(result.duration),
        }
      } else {
        return {
          name: check.name,
          result: buildFailedCheck(
            result.exitCode,
            result.stdout,
            result.stderr,
            result.duration,
            maxOutputLength,
          ),
        }
      }
    }),
  )

  for (const { name, result } of parallelResults) {
    results[name] = result
  }

  return results
}

/**
 * Core logic for executing TypeScript project quality checks.
 */
async function checkTypeScriptProjectLogic(
  input: z.infer<typeof InputSchema>,
  appContext: RequestContext,
  sdkContext: SdkContext,
): Promise<TypeScriptProjectCheckResponse> {
  logger.info('Running quick TypeScript project checks.', appContext)

  // Determine which checks to run (default to all)
  const checksToUse =
    input.checks && input.checks.length > 0
      ? QUICK_CHECKS.filter((check) =>
          (input.checks as string[]).includes(check.name),
        )
      : QUICK_CHECKS

  // Build check configurations, optionally scoped to specific files
  const scopedFiles = input.files && input.files.length > 0 ? input.files : null
  const checksToRun: Array<{ name: string; args: readonly string[] }> =
    scopedFiles
      ? checksToUse.map((check) => ({
          name: check.name,
          args: [...check.args, ...scopedFiles] as readonly string[],
        }))
      : [...checksToUse]

  if (checksToUse.length < QUICK_CHECKS.length) {
    logger.info(
      `Running ${checksToUse.length} of ${QUICK_CHECKS.length} available checks`,
      appContext,
    )
  }

  if (scopedFiles) {
    logger.info(`Scoping checks to ${scopedFiles.length} file(s)`, appContext)
  }

  const checks = await executeChecksWithFileLocking(
    checksToRun,
    appContext,
    sdkContext,
    input.maxOutputLength,
  )

  // Compute hasProblems by checking if any check has success=false
  const hasProblems = Object.values(checks).some(
    (check) => check.success === false,
  )

  return {
    hasProblems,
    checks,
  }
}

/**
 * Formats check results into ContentBlock array for MCP response.
 */
function responseFormatter(
  result: TypeScriptProjectCheckResponse,
): ContentBlock[] {
  return [
    {
      type: 'text',
      text: JSON.stringify(result, null, 2),
    },
  ]
}

export const checkTypeScriptProjectProblemsTool: ToolDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  name: TOOL_NAME,
  title: TOOL_TITLE,
  description: TOOL_DESCRIPTION,
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: TOOL_ANNOTATIONS,
  logic: withToolAuth(
    ['tool:typescript-project:check'],
    async (input, ctx, sdk) => {
      return checkTypeScriptProjectLogic(input, ctx, sdk)
    },
  ),
  responseFormatter,
}
