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
  'Runs quick local quality checks and returns combined output from lint fix and type checking commands in machine-parseable formats.';

const TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  openWorldHint: false,
};

const InputSchema = z.object({});

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

const ALLOWED_COMMANDS = new Set(['yarn']);

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

export const checkRunner = {
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

async function checkTypeScriptProjectLogic(
  _input: z.infer<typeof InputSchema>,
  appContext: RequestContext,
  sdkContext: SdkContext,
): Promise<TypeScriptProjectCheckResponse> {
  logger.info('Running quick TypeScript project checks.', appContext);

  const checks = await Promise.all(
    QUICK_CHECKS.map(async (check) =>
      checkRunner.run(check.name, 'yarn', check.args, sdkContext, appContext),
    ),
  );

  return {
    hasProblems: checks.some((check) => !check.success),
    checks,
  };
}

function responseFormatter(result: TypeScriptProjectCheckResponse): ContentBlock[] {
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
