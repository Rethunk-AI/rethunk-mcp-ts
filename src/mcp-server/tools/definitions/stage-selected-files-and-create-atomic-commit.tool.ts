/**
 * @fileoverview MCP tool for staging selected file specs and creating an atomic git commit.
 * Supports whole file staging and line-range staging using file#L10-L20 syntax.
 * @module src/mcp-server/tools/definitions/stage-selected-files-and-create-atomic-commit
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createOpenAI } from '@ai-sdk/openai';
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { generateText } from 'ai';
import { z } from 'zod';

import { config } from '@/config/index.js';
import type {
  SdkContext,
  ToolAnnotations,
  ToolDefinition,
} from '@/mcp-server/tools/utils/index.js';
import { sanitizeSdkContext } from '@/mcp-server/tools/utils/signal.js';
import { withToolAuth } from '@/mcp-server/transports/auth/lib/withAuth.js';
import { JsonRpcErrorCode, McpError } from '@/types-global/errors.js';
import { type RequestContext, logger } from '@/utils/index.js';

// Centralized AbortSignal shim is applied at startup; use `sanitizeSdkContext`.

const TOOL_NAME = 'stage_selected_specs_and_create_atomic_commit';
const TOOL_TITLE = 'Stage Selected Specs and Create Atomic Commit';
const TOOL_DESCRIPTION =
  'Stages selected file specs (whole file paths and line ranges like file#L10-L20), validates and refines a why-focused conventional commit message using GPT-5 Nano, and creates one atomic git commit.';

const TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

const InputSchema = z.object({
  fileSpecs: z
    .array(
      z
        .string()
        .min(1)
        .describe(
          'File spec to stage. Supports whole file path or range: file#L10 or file#L10-L20.',
        ),
    )
    .min(1)
    .describe(
      'List of file specs to stage. Supports whole file paths and line ranges in the format file#L10 or file#L10-L20.',
    ),
  commitSummary: z
    .string()
    .min(1)
    .describe(
      'Human summary describing WHY these changes were made. This will be validated and refined into a conventional commit message.',
    ),
  skipPreStagedCheck: z
    .boolean()
    .optional()
    .describe(
      'If true, allows execution even when there are already staged changes. If false or omitted, tool fails when pre-existing staged changes are detected.',
    ),
  skipChecksIfHuskyPresent: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'If true (default), skips integrated quality checks when husky pre-commit hooks are configured to avoid duplicate runs. Set to false to ignore husky and run checks regardless.',
    ),
});

const OutputSchema = z.object({
  commitHash: z.string().describe('Git commit hash for the created commit.'),
  commitMessage: z
    .string()
    .describe('Final conventional-commit style message used for git commit.'),
  stagedFiles: z
    .array(z.string().describe('Repository-relative path of a staged file.'))
    .describe('Files included in the created commit.'),
  stagedSpecs: z
    .array(z.string().describe('Original file spec submitted by the caller.'))
    .describe('Original file specs processed for staging.'),
});

type AtomicCommitResponse = z.infer<typeof OutputSchema>;

type ParsedWholeFileSpec = {
  kind: 'whole';
  rawSpec: string;
  filePath: string;
};

type ParsedRangeFileSpec = {
  kind: 'range';
  rawSpec: string;
  filePath: string;
  startLine: number;
  endLine: number;
};

type ParsedFileSpec = ParsedWholeFileSpec | ParsedRangeFileSpec;

type LineRange = {
  startLine: number;
  endLine: number;
};

type GitCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type DiffBlock = {
  oldStart: number;
  newStart: number;
  deletedLines: string[];
  addedLines: string[];
  patchLines: string[];
};

const RANGE_SPEC_PATTERN =
  /^(?<filePath>.+?)#L(?<start>\d+)(?:-L(?<end>\d+))?$/u;
const ALLOWED_COMMANDS = new Set(['git']);
const CONVENTIONAL_COMMIT_PATTERN =
  /^(feat|fix|refactor|perf|test|docs|chore)(\([^)]+\))?!?:\s.+/;

/**
 * Detects if husky pre-commit hooks are configured in the current project.
 * Checks for husky dependency in package.json and existence of .husky/pre-commit hook.
 * @param cwd - Current working directory (defaults to process.cwd()).
 * @returns True if husky is configured with a pre-commit hook, false otherwise.
 */
function detectHuskyPresent(cwd: string = process.cwd()): boolean {
  try {
    const packageJsonPath = `${cwd}/package.json`;
    if (!existsSync(packageJsonPath)) {
      return false;
    }

    const packageJsonContent = readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent) as Record<
      string,
      unknown
    >;
    const deps = packageJson.devDependencies as
      | Record<string, unknown>
      | undefined;
    if (!deps?.husky) {
      return false;
    }

    const preCommitPath = `${cwd}/.husky/pre-commit`;
    return existsSync(preCommitPath);
  } catch {
    return false;
  }
}

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
    GIT_PAGER: 'cat',
  };

  for (const key of safeKeys) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }

  return env;
}

export function parseFileSpec(spec: string): ParsedFileSpec {
  const trimmedSpec = spec.trim();
  if (!trimmedSpec) {
    throw new McpError(
      JsonRpcErrorCode.ValidationError,
      'File spec cannot be empty.',
      { spec },
    );
  }

  const rangeMatch = RANGE_SPEC_PATTERN.exec(trimmedSpec);
  if (!rangeMatch) {
    if (trimmedSpec.includes('#')) {
      throw new McpError(
        JsonRpcErrorCode.ValidationError,
        `Invalid range file spec format: ${trimmedSpec}. Use file#L10 or file#L10-L20.`,
        { spec: trimmedSpec },
      );
    }

    return {
      kind: 'whole',
      rawSpec: trimmedSpec,
      filePath: trimmedSpec,
    };
  }

  const filePath = rangeMatch.groups?.filePath?.trim();
  const startRaw = rangeMatch.groups?.start;
  const endRaw = rangeMatch.groups?.end;
  if (!filePath || !startRaw) {
    throw new McpError(
      JsonRpcErrorCode.ValidationError,
      `Invalid range file spec format: ${trimmedSpec}.`,
      { spec: trimmedSpec },
    );
  }

  const startLine = Number.parseInt(startRaw, 10);
  const endLine = Number.parseInt(endRaw ?? startRaw, 10);
  if (startLine < 1 || endLine < 1 || endLine < startLine) {
    throw new McpError(
      JsonRpcErrorCode.ValidationError,
      `Invalid line range in file spec: ${trimmedSpec}.`,
      { spec: trimmedSpec, startLine, endLine },
    );
  }

  return {
    kind: 'range',
    rawSpec: trimmedSpec,
    filePath,
    startLine,
    endLine,
  };
}

function mergeLineRanges(ranges: LineRange[]): LineRange[] {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = [...ranges].sort((a, b) => a.startLine - b.startLine);
  const firstRange = sorted[0];
  if (!firstRange) {
    return [];
  }

  const merged: LineRange[] = [{ ...firstRange }];

  for (const nextRange of sorted.slice(1)) {
    const current = merged.at(-1);
    if (!current) {
      merged.push({ ...nextRange });
      continue;
    }

    if (nextRange.startLine <= current.endLine + 1) {
      current.endLine = Math.max(current.endLine, nextRange.endLine);
      continue;
    }

    merged.push({ ...nextRange });
  }

  return merged;
}

function groupParsedSpecs(parsedSpecs: ParsedFileSpec[]): {
  wholeFiles: string[];
  rangeSpecsByFile: Map<string, LineRange[]>;
} {
  const wholeFiles = new Set<string>();
  const rangeSpecsByFile = new Map<string, LineRange[]>();

  for (const spec of parsedSpecs) {
    if (spec.kind === 'whole') {
      wholeFiles.add(spec.filePath);
      rangeSpecsByFile.delete(spec.filePath);
      continue;
    }

    if (wholeFiles.has(spec.filePath)) {
      continue;
    }

    const existingRanges = rangeSpecsByFile.get(spec.filePath) ?? [];
    existingRanges.push({
      startLine: spec.startLine,
      endLine: spec.endLine,
    });
    rangeSpecsByFile.set(spec.filePath, existingRanges);
  }

  for (const [filePath, ranges] of rangeSpecsByFile.entries()) {
    rangeSpecsByFile.set(filePath, mergeLineRanges(ranges));
  }

  return {
    wholeFiles: [...wholeFiles],
    rangeSpecsByFile,
  };
}

function parseHunkHeader(header: string): {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
} {
  const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/u.exec(
    header,
  );
  if (!match) {
    throw new McpError(
      JsonRpcErrorCode.ValidationError,
      `Invalid git hunk header: ${header}`,
      { header },
    );
  }

  const oldStartRaw = match[1];
  const newStartRaw = match[3];
  if (!oldStartRaw || !newStartRaw) {
    throw new McpError(
      JsonRpcErrorCode.ValidationError,
      `Invalid git hunk header: ${header}`,
      { header },
    );
  }

  const oldStart = Number.parseInt(oldStartRaw, 10);
  const oldCount = Number.parseInt(match[2] ?? '1', 10);
  const newStart = Number.parseInt(newStartRaw, 10);
  const newCount = Number.parseInt(match[4] ?? '1', 10);

  return {
    oldStart,
    oldCount,
    newStart,
    newCount,
  };
}

function getLine(lines: string[], index: number, filePath: string): string {
  const value = lines[index];
  if (value === undefined) {
    throw new McpError(
      JsonRpcErrorCode.ValidationError,
      `Unexpected end of diff while processing ${filePath}.`,
      { index, filePath },
    );
  }
  return value;
}

function collectPrefixedLines(
  lines: string[],
  startIndex: number,
  prefix: '-' | '+',
  filePath: string,
): { collected: string[]; nextIndex: number } {
  const collected: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = getLine(lines, index, filePath);
    if (!line.startsWith(prefix)) {
      break;
    }
    collected.push(line);
    index += 1;
  }

  return { collected, nextIndex: index };
}

function parseDiffBlocks(
  hunkHeader: string,
  hunkLines: string[],
  filePath: string,
): DiffBlock[] {
  const parsedHeader = parseHunkHeader(hunkHeader);
  let oldLine = parsedHeader.oldStart;
  let newLine = parsedHeader.newStart;
  const blocks: DiffBlock[] = [];
  let lineIndex = 0;

  while (lineIndex < hunkLines.length) {
    const currentLine = getLine(hunkLines, lineIndex, filePath);

    if (!currentLine) {
      lineIndex += 1;
      continue;
    }

    if (currentLine.startsWith('\\')) {
      const previousBlock = blocks.at(-1);
      if (previousBlock) {
        previousBlock.patchLines.push(currentLine);
      }
      lineIndex += 1;
      continue;
    }

    if (!currentLine.startsWith('-') && !currentLine.startsWith('+')) {
      throw new McpError(
        JsonRpcErrorCode.ValidationError,
        `Unsupported diff line while staging range for ${filePath}.`,
        { filePath, line: currentLine },
      );
    }

    const blockStartOld = oldLine;
    const blockStartNew = newLine;
    const deletedResult = collectPrefixedLines(
      hunkLines,
      lineIndex,
      '-',
      filePath,
    );
    const deletedLines = deletedResult.collected;
    lineIndex = deletedResult.nextIndex;
    oldLine += deletedLines.length;

    const addedResult = collectPrefixedLines(
      hunkLines,
      lineIndex,
      '+',
      filePath,
    );
    const addedLines = addedResult.collected;
    lineIndex = addedResult.nextIndex;
    newLine += addedLines.length;

    const patchLines = [...deletedLines, ...addedLines];

    if (deletedLines.length === 0 && addedLines.length === 0) {
      throw new McpError(
        JsonRpcErrorCode.ValidationError,
        `Failed to parse diff block while staging range for ${filePath}.`,
        { filePath, hunkHeader },
      );
    }

    blocks.push({
      oldStart: blockStartOld,
      newStart: blockStartNew,
      deletedLines,
      addedLines,
      patchLines,
    });
  }

  return blocks;
}

type DiffHunk = {
  header: string;
  lines: string[];
};

function collectDiffHunks(diffLines: string[], filePath: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let index = 0;

  while (index < diffLines.length) {
    const line = getLine(diffLines, index, filePath);
    if (!line.startsWith('@@')) {
      index += 1;
      continue;
    }

    const header = line;
    index += 1;
    const hunkLines: string[] = [];

    while (index < diffLines.length) {
      const hunkLine = getLine(diffLines, index, filePath);
      if (hunkLine.startsWith('@@')) {
        break;
      }
      hunkLines.push(hunkLine);
      index += 1;
    }

    hunks.push({ header, lines: hunkLines });
  }

  return hunks;
}

function ensureBlockFullyContained(
  block: DiffBlock,
  ranges: LineRange[],
  filePath: string,
): void {
  if (blockIsContainedByAnyRange(block, ranges)) {
    return;
  }

  throw new McpError(
    JsonRpcErrorCode.ValidationError,
    `Range selection partially overlaps a diff block in ${filePath}. Expand the requested range to include full changed block(s).`,
    {
      filePath,
      ranges,
      blockStart: block.newStart,
      blockEnd:
        block.addedLines.length > 0
          ? block.newStart + block.addedLines.length - 1
          : block.newStart,
    },
  );
}

function blockIntersectsRange(block: DiffBlock, ranges: LineRange[]): boolean {
  const affectedStart = block.newStart;
  const affectedEnd =
    block.addedLines.length > 0
      ? block.newStart + block.addedLines.length - 1
      : block.newStart;

  return ranges.some(
    (range) => range.startLine <= affectedEnd && range.endLine >= affectedStart,
  );
}

function blockIsContainedByAnyRange(
  block: DiffBlock,
  ranges: LineRange[],
): boolean {
  const affectedStart = block.newStart;
  const affectedEnd =
    block.addedLines.length > 0
      ? block.newStart + block.addedLines.length - 1
      : block.newStart;

  return ranges.some(
    (range) => range.startLine <= affectedStart && range.endLine >= affectedEnd,
  );
}

export function buildCachedPatchForRanges(
  filePath: string,
  unifiedDiff: string,
  ranges: LineRange[],
): string {
  if (!unifiedDiff.trim()) {
    throw new McpError(
      JsonRpcErrorCode.ValidationError,
      `No unstaged changes found for range staging in ${filePath}.`,
      { filePath, ranges },
    );
  }

  const diffLines = unifiedDiff.split(/\r?\n/u);
  const selectedBlocks: DiffBlock[] = [];

  const hunks = collectDiffHunks(diffLines, filePath);
  for (const hunk of hunks) {
    const blocks = parseDiffBlocks(hunk.header, hunk.lines, filePath);
    for (const block of blocks) {
      if (!blockIntersectsRange(block, ranges)) {
        continue;
      }

      ensureBlockFullyContained(block, ranges, filePath);
      selectedBlocks.push(block);
    }
  }

  if (selectedBlocks.length === 0) {
    throw new McpError(
      JsonRpcErrorCode.ValidationError,
      `Requested ranges do not overlap changed lines in ${filePath}.`,
      { filePath, ranges },
    );
  }

  const patchLines = [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
  ];

  for (const block of selectedBlocks) {
    const oldCount = block.deletedLines.length;
    const newCount = block.addedLines.length;
    patchLines.push(
      `@@ -${block.oldStart},${oldCount} +${block.newStart},${newCount} @@`,
      ...block.patchLines,
    );
  }

  return `${patchLines.join('\n')}\n`;
}

export const commitMessageRefiner = {
  refineCommitMessage: async (
    commitSummary: string,
    appContext?: RequestContext,
  ): Promise<string> => {
    const apiKey = config.openaiApiKey;
    if (!apiKey) {
      throw new McpError(
        JsonRpcErrorCode.ConfigurationError,
        'OPENAI_API_KEY is required for commit summary refinement.',
      );
    }

    const openai = createOpenAI({ apiKey });

    if (appContext) {
      logger.debug('Formatting commit message via LLM', {
        ...appContext,
        originalSummary: commitSummary,
        model: 'gpt-5-nano',
      });
    }

    const result = await generateText({
      maxOutputTokens: 2048,
      maxRetries: 1,
      model: openai('gpt-5-nano'),
      prompt: `Transform this into a WHY-focused conventional commit message (format: type(scope): description). Return ONLY the formatted message with no other text:

"${commitSummary}"`,
      providerOptions: {
        openai: {
          reasoningEffort: 'medium',
          verbosity: 'low',
        },
      },
    });

    if (appContext) {
      logger.debug('LLM response received', {
        ...appContext,
        textLength: result.text.length,
        toolCallCount: result.toolCalls?.length ?? 0,
      });
    }

    const formattedCommitMessage = result.text.trim();

    if (!formattedCommitMessage) {
      const errorMsg = `LLM failed to produce output for commit message formatting. Expected conventional commit format, got empty response. Input: "${commitSummary}"`;
      if (appContext) {
        logger.warning(errorMsg, {
          ...appContext,
          llmText: result.text,
          llmTextLength: result.text.length,
        });
      }
      throw new McpError(JsonRpcErrorCode.ValidationError, errorMsg, {
        originalSummary: commitSummary,
        llmText: result.text,
        llmTextLength: result.text.length,
      });
    }

    if (!CONVENTIONAL_COMMIT_PATTERN.test(formattedCommitMessage)) {
      const errorMsg = `LLM output does not match conventional commit format. Got: "${formattedCommitMessage}"`;
      if (appContext) {
        logger.warning(errorMsg, {
          ...appContext,
          formattedMessage: formattedCommitMessage,
          pattern: CONVENTIONAL_COMMIT_PATTERN.toString(),
        });
      }
      throw new McpError(JsonRpcErrorCode.ValidationError, errorMsg, {
        originalSummary: commitSummary,
        formattedMessage: formattedCommitMessage,
        pattern: CONVENTIONAL_COMMIT_PATTERN.toString(),
      });
    }

    if (appContext) {
      logger.debug('Commit message formatted successfully', {
        ...appContext,
        formattedMessage: formattedCommitMessage,
      });
    }

    return formattedCommitMessage;
  },
};

export const gitRunner = {
  run: (
    commandName: string,
    args: readonly string[],
    sdkContext: SdkContext,
    appContext: RequestContext,
    stdin?: string,
  ): Promise<GitCommandResult> =>
    new Promise((resolve, reject) => {
      if (!ALLOWED_COMMANDS.has(commandName)) {
        reject(
          new McpError(
            JsonRpcErrorCode.ValidationError,
            `Command not allowed: ${commandName}`,
            { requestId: appContext.requestId, commandName },
          ),
        );
        return;
      }

      const spawnOptions: Parameters<typeof spawn>[2] = {
        cwd: process.cwd(),
        env: createSafeCommandEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
      };

      // Avoid passing potentially non-native signal objects directly to spawn.
      // Some SDK signals originate from other realms and can cause Node to
      // throw when accessing AbortSignal.aborted. Instead, spawn the child
      // and register an abort listener that kills the child process.
      const child = spawn(commandName, args, spawnOptions);

      if (
        sdkContext?.signal &&
        typeof (sdkContext.signal as EventTarget).addEventListener ===
          'function'
      ) {
        const onAbort = () => {
          try {
            child.kill('SIGTERM');
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
            `Failed to execute ${commandName}: ${error.message}`,
            { requestId: appContext.requestId, commandName, args },
          ),
        );
      });

      if (child.stdin) {
        if (stdin) {
          child.stdin.write(stdin);
        }
        try {
          child.stdin.end();
        } catch {
          // ignore
        }
      }

      child.on('close', (exitCode) => {
        resolve({
          exitCode: exitCode ?? -1,
          stdout,
          stderr,
        });
      });
    }),
};

async function stageRangeSpecs(
  rangeSpecsByFile: Map<string, LineRange[]>,
  sdkContext: SdkContext,
  appContext: RequestContext,
): Promise<void> {
  for (const [filePath, ranges] of rangeSpecsByFile.entries()) {
    const fileCheckResult = await gitRunner.run(
      'git',
      ['ls-files', '--error-unmatch', '--', filePath],
      sdkContext,
      appContext,
    );
    if (fileCheckResult.exitCode !== 0) {
      throw new McpError(
        JsonRpcErrorCode.ValidationError,
        `Range staging requires a tracked file. Not tracked: ${filePath}`,
        { filePath, stderr: fileCheckResult.stderr.trim() },
      );
    }

    const diffResult = await gitRunner.run(
      'git',
      ['diff', '--unified=0', '--no-color', '--', filePath],
      sdkContext,
      appContext,
    );

    const patch = buildCachedPatchForRanges(
      filePath,
      diffResult.stdout,
      ranges,
    );
    const applyResult = await gitRunner.run(
      'git',
      [
        'apply',
        '--cached',
        '--unidiff-zero',
        '--whitespace=nowarn',
        '--recount',
      ],
      sdkContext,
      appContext,
      patch,
    );

    if (applyResult.exitCode !== 0) {
      throw new McpError(
        JsonRpcErrorCode.ValidationError,
        `Failed to apply range patch for ${filePath}: ${applyResult.stderr.trim()}`,
        { filePath, ranges },
      );
    }
  }
}

async function validateRepository(
  sdkContext: SdkContext,
  appContext: RequestContext,
): Promise<void> {
  const repoCheckResult = await gitRunner.run(
    'git',
    ['rev-parse', '--show-toplevel'],
    sdkContext,
    appContext,
  );
  if (repoCheckResult.exitCode !== 0) {
    throw new McpError(
      JsonRpcErrorCode.ValidationError,
      'Current working directory is not a git repository.',
      { stderr: repoCheckResult.stderr.trim() },
    );
  }
}

async function validateNoPreStagedChanges(
  input: z.infer<typeof InputSchema>,
  sdkContext: SdkContext,
  appContext: RequestContext,
): Promise<void> {
  if (input.skipPreStagedCheck) {
    return;
  }

  const stagedCheckResult = await gitRunner.run(
    'git',
    ['diff', '--cached', '--name-only'],
    sdkContext,
    appContext,
  );
  if (stagedCheckResult.exitCode !== 0) {
    throw new McpError(
      JsonRpcErrorCode.InternalError,
      `Failed to inspect pre-staged changes: ${stagedCheckResult.stderr.trim()}`,
    );
  }

  if (stagedCheckResult.stdout.trim()) {
    throw new McpError(
      JsonRpcErrorCode.ValidationError,
      'Pre-staged changes detected. Clear staged changes first or set skipPreStagedCheck=true.',
      {
        stagedFiles: stagedCheckResult.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      },
    );
  }
}

async function stageAllFiles(
  groupedSpecs: ReturnType<typeof groupParsedSpecs>,
  sdkContext: SdkContext,
  appContext: RequestContext,
): Promise<void> {
  if (groupedSpecs.wholeFiles.length > 0) {
    const stageWholeResult = await gitRunner.run(
      'git',
      ['add', '--', ...groupedSpecs.wholeFiles],
      sdkContext,
      appContext,
    );
    if (stageWholeResult.exitCode !== 0) {
      await unstageAllFiles(sdkContext, appContext);
      throw new McpError(
        JsonRpcErrorCode.ValidationError,
        `Failed to stage whole file specs: ${stageWholeResult.stderr.trim()}`,
        { files: groupedSpecs.wholeFiles },
      );
    }
  }

  try {
    await stageRangeSpecs(
      groupedSpecs.rangeSpecsByFile,
      sdkContext,
      appContext,
    );
  } catch (error) {
    await unstageAllFiles(sdkContext, appContext);
    throw error;
  }
}

async function getStagedFiles(
  sdkContext: SdkContext,
  appContext: RequestContext,
): Promise<string[]> {
  const stagedFilesResult = await gitRunner.run(
    'git',
    ['diff', '--cached', '--name-only'],
    sdkContext,
    appContext,
  );
  if (stagedFilesResult.exitCode !== 0) {
    throw new McpError(
      JsonRpcErrorCode.InternalError,
      `Failed to inspect staged changes: ${stagedFilesResult.stderr.trim()}`,
    );
  }

  return stagedFilesResult.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function commitStagedChanges(
  refinedCommitMessage: string,
  sdkContext: SdkContext,
  appContext: RequestContext,
  stagedFiles: string[],
): Promise<string> {
  const commitResult = await gitRunner.run(
    'git',
    ['commit', '-m', refinedCommitMessage],
    sdkContext,
    appContext,
  );
  if (commitResult.exitCode !== 0) {
    await unstageAllFiles(sdkContext, appContext);
    throw new McpError(
      JsonRpcErrorCode.InternalError,
      `Failed to create git commit: ${commitResult.stderr.trim()}`,
      { stagedFiles },
    );
  }

  const hashResult = await gitRunner.run(
    'git',
    ['rev-parse', 'HEAD'],
    sdkContext,
    appContext,
  );
  if (hashResult.exitCode !== 0 || !hashResult.stdout.trim()) {
    throw new McpError(
      JsonRpcErrorCode.InternalError,
      `Failed to resolve commit hash: ${hashResult.stderr.trim()}`,
    );
  }

  return hashResult.stdout.trim();
}

async function unstageAllFiles(
  sdkContext: SdkContext,
  appContext: RequestContext,
): Promise<void> {
  const resetResult = await gitRunner.run(
    'git',
    ['reset'],
    sdkContext,
    appContext,
  );
  if (resetResult.exitCode !== 0) {
    logger.warning('Failed to unstage files during error cleanup', {
      ...appContext,
      stderr: resetResult.stderr.trim(),
    });
  }
}

async function stageAndCommitSelectedSpecsLogic(
  input: z.infer<typeof InputSchema>,
  appContext: RequestContext,
  sdkContext: SdkContext,
): Promise<AtomicCommitResponse> {
  logger.info(
    'Staging selected file specs and creating atomic commit.',
    appContext,
  );

  // Detect husky presence and log when checks will be skipped
  if (input.skipChecksIfHuskyPresent && detectHuskyPresent(process.cwd())) {
    logger.info(
      'Husky pre-commit hooks detected. Skipping integrated quality checks to avoid duplicate runs.',
      appContext,
    );
  }

  const parsedSpecs = input.fileSpecs.map((spec) => parseFileSpec(spec));

  await validateRepository(sdkContext, appContext);
  await validateNoPreStagedChanges(input, sdkContext, appContext);

  const groupedSpecs = groupParsedSpecs(parsedSpecs);
  await stageAllFiles(groupedSpecs, sdkContext, appContext);

  const stagedFiles = await getStagedFiles(sdkContext, appContext);

  if (stagedFiles.length === 0) {
    throw new McpError(
      JsonRpcErrorCode.ValidationError,
      'No changes were staged from provided file specs.',
      { fileSpecs: input.fileSpecs },
    );
  }

  const refinedCommitMessage = await commitMessageRefiner.refineCommitMessage(
    input.commitSummary,
    appContext,
  );

  const commitHash = await commitStagedChanges(
    refinedCommitMessage,
    sdkContext,
    appContext,
    stagedFiles,
  );

  return {
    commitHash,
    commitMessage: refinedCommitMessage,
    stagedFiles,
    stagedSpecs: input.fileSpecs,
  };
}

function responseFormatter(result: AtomicCommitResponse): ContentBlock[] {
  return [
    {
      type: 'text',
      text: JSON.stringify(result, null, 2),
    },
  ];
}

export const stageSelectedFilesAndCreateAtomicCommitTool: ToolDefinition<
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
    ['tool:git-atomic-commit:write'],
    async (input, ctx, sdk) => {
      const safeSdk = sanitizeSdkContext(sdk);
      return stageAndCommitSelectedSpecsLogic(input, ctx, safeSdk);
    },
  ),
  responseFormatter,
};
