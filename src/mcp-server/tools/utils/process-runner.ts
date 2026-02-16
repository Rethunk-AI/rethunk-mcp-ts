/**
 * @fileoverview Generic process execution runner for MCP tools.
 * Provides safe spawning of child processes with AbortSignal support and output capture.
 * @module src/mcp-server/tools/utils/process-runner
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import type { SdkContext } from './index.js';
import type { RequestContext } from '@/utils/index.js';
import { JsonRpcErrorCode, McpError } from '@/types-global/errors.js';

/**
 * Result from executing a child process.
 */
export type ProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
};

/**
 * Configuration for spawning a child process.
 */
export type SpawnConfig = {
  /** Command name to execute (e.g., 'bun', 'git', 'yarn') */
  command: string;
  /** Arguments to pass to the command */
  args: readonly string[];
  /** Optional stdin to write to the process */
  stdin?: string;
  /** Allowed commands for security (whitelist validation) */
  allowedCommands: Set<string>;
  /** Optional stdio configuration; defaults to ['pipe', 'pipe', 'pipe'] */
  stdinMode?: 'pipe' | 'ignore';
};

/**
 * Creates a sanitized environment for executing child processes.
 * Filters process.env to only include safe, non-sensitive variables needed for command execution.
 * @returns A record of safe environment variables with color output disabled.
 */
export function createSafeCommandEnv(): Record<string, string> {
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
 * Utility for running commands via spawned child processes.
 * Handles command validation, process execution, and output capture.
 * Measures execution time and respects AbortSignal for cancellation.
 */
export const processRunner = {
  /**
   * Executes a command via child process and captures output.
   * Uses the SDK context's abort signal for cancellation (respects framework timeout settings).
   * Measures execution time in milliseconds.
   * @param config - Spawn configuration (command, args, allowed commands, etc.)
   * @param sdkContext - SDK context containing abort signal for cancellation.
   * @param appContext - Application context for logging and request tracking.
   * @param operationName - Human-readable name of the operation for error messages.
   * @returns Promise resolving to the process result with exit code, duration, and captured output.
   */
  run: (
    config: SpawnConfig,
    sdkContext: SdkContext,
    appContext: RequestContext,
    operationName: string,
  ): Promise<ProcessResult> =>
    new Promise((resolve, reject) => {
      if (!config.allowedCommands.has(config.command)) {
        reject(
          new McpError(
            JsonRpcErrorCode.ValidationError,
            `Command not allowed: ${config.command}`,
            { requestId: appContext.requestId, command: config.command },
          ),
        );
        return;
      }

      const startTime = performance.now();
      const stdinMode = config.stdinMode ?? 'pipe';
      const stdio: Array<'pipe' | 'ignore'> =
        stdinMode === 'ignore'
          ? ['ignore', 'pipe', 'pipe']
          : ['pipe', 'pipe', 'pipe'];

      const spawnOptions: Parameters<typeof spawn>[2] = {
        cwd: process.cwd(),
        env: createSafeCommandEnv(),
        stdio,
      };

      const child: ChildProcess = spawn(
        config.command,
        config.args as string[],
        spawnOptions,
      );

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
            `Failed to execute ${config.command}: ${error.message}`,
            {
              requestId: appContext.requestId,
              command: config.command,
              args: config.args,
              operation: operationName,
            },
          ),
        );
      });

      // Handle AbortSignal for cancellation
      if (
        sdkContext?.signal &&
        typeof (sdkContext.signal as EventTarget).addEventListener ===
          'function'
      ) {
        const onAbort = () => {
          try {
            child.kill?.('SIGTERM');
          } catch {
            // ignore
          }
        };

        try {
          (sdkContext.signal as EventTarget).addEventListener(
            'abort',
            onAbort,
            { once: true } as AddEventListenerOptions,
          );
        } catch {
          // ignore if addEventListener unavailable
        }

        child.on('close', () => {
          try {
            (sdkContext.signal as EventTarget).removeEventListener(
              'abort',
              onAbort,
            );
          } catch {
            // ignore
          }
        });
      }

      if (child.stdin) {
        if (config.stdin) {
          child.stdin.write(config.stdin);
        }
        try {
          child.stdin.end();
        } catch {
          // ignore
        }
      }

      child.on('close', (exitCode: number | null) => {
        const duration = Math.round(performance.now() - startTime);
        resolve({
          exitCode: exitCode ?? -1,
          stdout,
          stderr,
          duration,
        });
      });
    }),
};
