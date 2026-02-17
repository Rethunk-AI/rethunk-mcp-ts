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
      'If true, returns only exit codes and success status per check, omitting stdout/stderr. Useful for reducing output verbosity.',
    ),
})

const CheckResultSchema = z.object({
  name: z.string(),
  command: z.string(),
  exitCode: z.number().int(),
  success: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  duration: z.number().int().min(0).describe('Execution time in milliseconds'),
})

const OutputSchema = z.object({
  hasProblems: z.boolean(),
  checks: z.array(CheckResultSchema),
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
 * Strips stdout and stderr from a check result, keeping only metadata and duration.
 */
function stripOutputFields(
  result: z.infer<typeof CheckResultSchema>,
): z.infer<typeof CheckResultSchema> {
  return {
    ...result,
    stdout: '',
    stderr: '',
  }
}

/**
 * Runs lint:fix sequentially before other checks to avoid file race conditions,
 * then runs remaining checks in parallel.
 */
async function executeChecksWithFileLocking(
  checks: ReadonlyArray<{ name: string; args: readonly string[] }>,
  appContext: RequestContext,
  sdkContext: SdkContext,
  summaryOnly?: boolean,
): Promise<Array<z.infer<typeof CheckResultSchema>>> {
  const results: Array<z.infer<typeof CheckResultSchema>> = []

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

    const lintResult: z.infer<typeof CheckResultSchema> = {
      name: lintCheck.name,
      command: `${pm} ${lintCheck.args.join(' ')}`,
      exitCode: result.exitCode,
      success: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: result.duration,
    }

    if (summaryOnly) {
      results.push(stripOutputFields(lintResult))
    } else {
      results.push(lintResult)
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

      const checkResult: z.infer<typeof CheckResultSchema> = {
        name: check.name,
        command: `${pm} ${check.args.join(' ')}`,
        exitCode: result.exitCode,
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        duration: result.duration,
      }

      return summaryOnly ? stripOutputFields(checkResult) : checkResult
    }),
  )

  results.push(...parallelResults)
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
    input.summaryOnly,
  )

  return {
    hasProblems: checks.some((check) => !check.success),
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
