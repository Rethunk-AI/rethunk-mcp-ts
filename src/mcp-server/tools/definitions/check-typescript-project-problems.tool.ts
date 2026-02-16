/**
 * @fileoverview MCP tool for checking TypeScript projects for code quality issues.
 * Runs lint:fix and typecheck commands to validate project health.
 * @module src/mcp-server/tools/definitions/check-typescript-project-problems
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type {
  SdkContext,
  ToolAnnotations,
  ToolDefinition,
} from '@/mcp-server/tools/utils/index.js';
import { detectProjectPackageManager, mapScriptArgsToRunner, type PackageManager } from '@/mcp-server/tools/utils/signal.js';
import { withToolAuth } from '@/mcp-server/transports/auth/lib/withAuth.js';
import { JsonRpcErrorCode, McpError } from '@/types-global/errors.js';
import { type RequestContext, logger } from '@/utils/index.js';

// Centralized AbortSignal shim lives in application startup; tools must
// use the shared `sanitizeSdkContext` helper to avoid cross-realm signal
// leakage into Node internals.

const TOOL_NAME = 'check_typescript_project_for_problems';
const TOOL_TITLE = 'Check TypeScript Project for Problems';
const TOOL_DESCRIPTION =
  'Runs quick local quality checks including lint fixing (which modifies files) and type checking. Optionally scopes checks to specific files or overrides timeout. Runs lint:fix first to avoid file race conditions. Returns combined output in machine-parseable JSON format.';
const ALLOWED_COMMANDS = new Set(['yarn', 'bun', 'pnpm']);

// package manager detection is handled via detectProjectPackageManager()

const TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  openWorldHint: false,
};

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
});

const CheckResultSchema = z.object({
  name: z.string(),
  command: z.string(),
  exitCode: z.number().int(),
  success: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
  duration: z.number().int().min(0).describe('Execution time in milliseconds'),
});

const OutputSchema = z.object({
  hasProblems: z.boolean(),
  checks: z.array(CheckResultSchema),
});

type TypeScriptProjectCheckResponse = z.infer<typeof OutputSchema>;

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
] as const;

/**
 * Strips stdout and stderr from a check result, keeping only metadata and duration.
 * @param result - The full check result.
 * @returns Check result with empty stdout/stderr for summary mode.
 */
function stripOutputFields(
  result: z.infer<typeof CheckResultSchema>,
): z.infer<typeof CheckResultSchema> {
  return {
    ...result,
    stdout: '',
    stderr: '',
  };
}

/**
 * Runs lint:fix sequentially before other checks to avoid file race conditions,
 * then runs remaining checks in parallel.
 * @param checks - Array of check definitions to execute.
 * @param appContext - Application context for logging.
 * @param sdkContext - SDK context containing abort signal.
 * @param summaryOnly - If true, omit stdout/stderr from results.
 * @returns Array of check results with lint:fix executed first.
 */
async function executeChecksWithFileLocking(
  checks: ReadonlyArray<{ name: string; args: readonly string[] }>,
  appContext: RequestContext,
  sdkContext: SdkContext,
  summaryOnly?: boolean,
): Promise<Array<z.infer<typeof CheckResultSchema>>> {
  const results: Array<z.infer<typeof CheckResultSchema>> = [];

  // Separate lint:fix from other checks
  const lintCheck = checks.find((c) => c.name === 'lint:fix');
  const otherChecks = checks.filter((c) => c.name !== 'lint:fix');

  // Run lint:fix first to avoid file modifications affecting other checks
  if (lintCheck) {
    const pm = detectProjectPackageManager(process.cwd());
    let lintResult = await checkRunner.run(
      lintCheck.name,
      pm,
      lintCheck.args,
      sdkContext,
      appContext,
    );
    if (summaryOnly) {
      lintResult = stripOutputFields(lintResult);
    }
    results.push(lintResult);
  }

  // Run remaining checks in parallel
  const pm = detectProjectPackageManager(process.cwd());
  const remainingResults = await Promise.all(
    otherChecks.map((check) => checkRunner.run(check.name, pm, check.args, sdkContext, appContext)),
  );

  let finalResults = remainingResults;
  if (summaryOnly) {
    finalResults = remainingResults.map((result) => stripOutputFields(result));
  }
  results.push(...finalResults);

  return results;
}

/**
 * Creates a sanitized environment for executing child processes.
 * Filters process.env to only include safe, non-sensitive variables needed for command execution.
 * @returns A record of safe environment variables with color output disabled.
 */
function createSafeCommandEnv(): Record<string, string> {
  const safeKeys = [
    'PATH',
    'HOME',
    'USERPROFILE',
    'TMPDIR',
    'TMP',
    'TEMP',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
  ] as const;
  const env: Record<string, string> = {
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };

  for (const key of safeKeys) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }

  return env;
}

/**
 * Utility object for running validation checks via spawned child processes.
 * Handles command validation, process execution, and output capture for TypeScript project checks.
 * Measures execution time and returns duration metrics.
 */
export const checkRunner = {
  /**
   * Executes a check command (e.g., yarn lint:fix, yarn typecheck) and captures output.
   * Uses the SDK context's abort signal for cancellation (respects framework timeout settings).
   * Measures execution time in milliseconds.
   * @param checkName - Human-readable name of the check (e.g., "lint:fix").
   * @param command - The command to execute (must be in ALLOWED_COMMANDS).
   * @param args - Arguments to pass to the command.
   * @param sdkContext - SDK context containing abort signal for cancellation.
   * @param appContext - Application context for logging and request tracking.
   * @returns Promise resolving to the check result with exit code, success status, duration, and captured output.
   */
  run: (
    checkName: string,
    command: string,
    args: readonly string[],
    sdkContext: SdkContext,
    appContext: RequestContext,
  ): Promise<z.infer<typeof CheckResultSchema>> =>
    new Promise((resolve, reject) => {
      if (!ALLOWED_COMMANDS.has(command)) {
        reject(
          new McpError(
            JsonRpcErrorCode.ValidationError,
            `Command not allowed: ${command}`,
            { requestId: appContext.requestId, command },
          ),
        );
        return;
      }

      const startTime = performance.now();
      const spawnOptions: Parameters<typeof spawn>[2] = {
        cwd: process.cwd(),
        env: createSafeCommandEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      };

      const pkgManager = command as PackageManager;
      const effectiveArgs = mapScriptArgsToRunner(pkgManager, args);

      const child: ChildProcess = spawn(pkgManager, effectiveArgs, spawnOptions);

      let stdout = '';
      let stderr = '';

      if (child.stdout) {
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });
      }
      if (child.stderr) {
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
      }

      child.on('error', (error) => {
        reject(
          new McpError(
            JsonRpcErrorCode.InternalError,
            `Failed to execute ${command}: ${error.message}`,
            { requestId: appContext.requestId, command, args },
          ),
        );
      });

      if (sdkContext?.signal && typeof (sdkContext.signal as EventTarget).addEventListener === 'function') {
        const onAbort = () => {
          try {
            child.kill?.('SIGTERM');
          } catch {
            // ignore
          }
        };

        try {
          (sdkContext.signal as EventTarget).addEventListener('abort', onAbort, { once: true } as AddEventListenerOptions);
        } catch {
          // ignore
        }
      }

      child.on('close', (exitCode) => {
        const duration = Math.round(performance.now() - startTime);
        resolve({
          name: checkName,
          command: `${command} ${args.join(' ')}`,
          exitCode: exitCode ?? -1,
          success: exitCode === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          duration,
        });
      });
    }),
};

/**
 * Core logic for executing TypeScript project quality checks.
 * Runs lint:fix first (sequentially) to avoid file modifications, then other checks in parallel.
 * Optionally scopes checks to specific files or selects specific checks to run.
 * @param input - Tool input with optional files, timeout, checks selection, and summaryOnly mode.
 * @param appContext - Application context for logging and request tracking.
 * @param sdkContext - SDK context containing abort signal for cancellation.
 * @returns Promise resolving to combined check results with overall problem status.
 */
async function checkTypeScriptProjectLogic(
  input: z.infer<typeof InputSchema>,
  appContext: RequestContext,
  sdkContext: SdkContext,
): Promise<TypeScriptProjectCheckResponse> {
  logger.info('Running quick TypeScript project checks.', appContext);

  // Determine which checks to run (default to all)
  const checksToUse =
    input.checks && input.checks.length > 0
      ? QUICK_CHECKS.filter((check) =>
        (input.checks as string[]).includes(check.name),
      )
      : QUICK_CHECKS;

  // Build check configurations, optionally scoped to specific files
  const scopedFiles =
    input.files && input.files.length > 0 ? input.files : null;
  const checksToRun: Array<{ name: string; args: readonly string[] }> =
    scopedFiles
      ? checksToUse.map((check) => ({
        name: check.name,
        args: [...check.args, ...scopedFiles] as readonly string[],
      }))
      : [...checksToUse];

  if (checksToUse.length < QUICK_CHECKS.length) {
    logger.info(
      `Running ${checksToUse.length} of ${QUICK_CHECKS.length} available checks`,
      appContext,
    );
  }

  if (scopedFiles) {
    logger.info(`Scoping checks to ${scopedFiles.length} file(s)`, appContext);
  }

  // Note: pass the original sdkContext through to runners so callers
  // that assert object identity (tests, instrumentation) receive the
  // same object. Runners may sanitize signals internally if needed.
  const checks = await executeChecksWithFileLocking(checksToRun, appContext, sdkContext, input.summaryOnly);

  return {
    hasProblems: checks.some((check) => !check.success),
    checks,
  };
}

/**
 * Formats check results into ContentBlock array for MCP response.
 * Converts the structured result object to pretty-printed JSON.
 * @param result - The combined check results from checkTypeScriptProjectLogic.
 * @returns Array containing a single text ContentBlock with JSON-formatted results.
 */
function responseFormatter(
  result: TypeScriptProjectCheckResponse,
): ContentBlock[] {
  return [
    {
      type: 'text',
      text: JSON.stringify(result, null, 2),
    },
  ];
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
  logic: withToolAuth(['tool:typescript-project:check'], async (input, ctx, sdk) => {
    // Pass the original sdkContext through to runners so tests that assert
    // the exact object identity receive the same object. Runners may
    // choose to sanitize signals internally if needed.
    return checkTypeScriptProjectLogic(input, ctx, sdk);
  }),
  responseFormatter,
};

/**
 * Create a safe SdkContext where `signal` is a native AbortSignal controlled
 * by a local AbortController. If the incoming sdkContext exposes a cross-realm
 * signal with addEventListener, we proxy its abort event to the native signal
 * without directly reading `aborted` to avoid getter errors.
 */
// Local sanitize removed; using shared sanitizeSdkContext from tools/utils/signal
