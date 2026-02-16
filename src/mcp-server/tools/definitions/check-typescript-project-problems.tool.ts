/**
 * @fileoverview MCP tool for checking TypeScript projects for code quality issues.
 * Runs lint:fix and typecheck commands to validate project health.
 * @module src/mcp-server/tools/definitions/check-typescript-project-problems
 */

import { spawn } from 'node:child_process';
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type {
  SdkContext,
  ToolAnnotations,
  ToolDefinition,
} from '@/mcp-server/tools/utils/index.js';
import { withToolAuth } from '@/mcp-server/transports/auth/lib/withAuth.js';
import { JsonRpcErrorCode, McpError } from '@/types-global/errors.js';
import { type RequestContext, logger } from '@/utils/index.js';

const TOOL_NAME = 'check_typescript_project_for_problems';
const TOOL_TITLE = 'Check TypeScript Project for Problems';
const TOOL_DESCRIPTION =
  'Runs quick local quality checks including lint fixing (which modifies files) and type checking. Optionally scopes checks to specific files or overrides timeout. Runs lint:fix first to avoid file race conditions. Returns combined output in machine-parseable JSON format.';

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
});

const CheckResultSchema = z.object({
  name: z.string(),
  command: z.string(),
  exitCode: z.number().int(),
  success: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
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
 * Runs lint:fix sequentially before other checks to avoid file race conditions,
 * then runs remaining checks in parallel.
 * @param checks - Array of check definitions to execute.
 * @param appContext - Application context for logging.
 * @param sdkContext - SDK context containing abort signal.
 * @returns Array of check results with lint:fix executed first.
 */
async function executeChecksWithFileLocking(
  checks: ReadonlyArray<{ name: string; args: readonly string[] }>,
  appContext: RequestContext,
  sdkContext: SdkContext,
): Promise<Array<z.infer<typeof CheckResultSchema>>> {
  const results: Array<z.infer<typeof CheckResultSchema>> = [];

  // Separate lint:fix from other checks
  const lintCheck = checks.find((c) => c.name === 'lint:fix');
  const otherChecks = checks.filter((c) => c.name !== 'lint:fix');

  // Run lint:fix first to avoid file modifications affecting other checks
  if (lintCheck) {
    const lintResult = await checkRunner.run(
      lintCheck.name,
      'yarn',
      lintCheck.args,
      sdkContext,
      appContext,
    );
    results.push(lintResult);
  }

  // Run remaining checks in parallel
  const remainingResults = await Promise.all(
    otherChecks.map((check) =>
      checkRunner.run(check.name, 'yarn', check.args, sdkContext, appContext),
    ),
  );
  results.push(...remainingResults);

  return results;
}

const ALLOWED_COMMANDS = new Set(['yarn']);

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
 */
export const checkRunner = {
  /**
   * Executes a check command (e.g., yarn lint:fix, yarn typecheck) and captures output.
   * Uses the SDK context's abort signal for cancellation (respects framework timeout settings).
   * @param checkName - Human-readable name of the check (e.g., "lint:fix").
   * @param command - The command to execute (must be in ALLOWED_COMMANDS).
   * @param args - Arguments to pass to the command.
   * @param sdkContext - SDK context containing abort signal for cancellation.
   * @param appContext - Application context for logging and request tracking.
   * @returns Promise resolving to the check result with exit code, success status, and captured output.
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

      const child = spawn(command, args, {
        cwd: process.cwd(),
        env: createSafeCommandEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: sdkContext.signal,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        reject(
          new McpError(
            JsonRpcErrorCode.InternalError,
            `Failed to execute ${command}: ${error.message}`,
            { requestId: appContext.requestId, command, args },
          ),
        );
      });

      child.on('close', (exitCode) => {
        resolve({
          name: checkName,
          command: `${command} ${args.join(' ')}`,
          exitCode: exitCode ?? -1,
          success: exitCode === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });
    }),
};

/**
 * Core logic for executing TypeScript project quality checks.
 * Runs lint:fix first (sequentially) to avoid file modifications, then other checks in parallel.
 * Optionally scopes checks to specific files.
 * @param input - Tool input with optional files and timeout overrides.
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

  // Build check configurations, optionally scoped to specific files
  const scopedFiles =
    input.files && input.files.length > 0 ? input.files : null;
  const checksToRun: Array<{ name: string; args: readonly string[] }> =
    scopedFiles
      ? QUICK_CHECKS.map((check) => ({
          name: check.name,
          args: [...check.args, ...scopedFiles] as readonly string[],
        }))
      : [...QUICK_CHECKS];

  if (scopedFiles) {
    logger.info(`Scoping checks to ${scopedFiles.length} file(s)`, appContext);
  }

  const checks = await executeChecksWithFileLocking(
    checksToRun,
    appContext,
    sdkContext,
  );

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
  logic: withToolAuth(
    ['tool:typescript-project:check'],
    checkTypeScriptProjectLogic,
  ),
  responseFormatter,
};
