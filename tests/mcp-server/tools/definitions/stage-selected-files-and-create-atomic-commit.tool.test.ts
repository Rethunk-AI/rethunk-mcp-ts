import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCachedPatchForRanges } from '../../../../src/utils/git/index.js';
import {
  commitMessageRefiner,
  gitRunner,
  parseFileSpec,
  stageSelectedFilesAndCreateAtomicCommitTool,
} from '../../../../src/mcp-server/tools/definitions/stage-selected-files-and-create-atomic-commit.tool.js';
import {
  JsonRpcErrorCode,
  McpError,
} from '../../../../src/types-global/errors.js';
import { requestContextService } from '../../../../src/utils/index.js';
import 'reflect-metadata';

describe('stageSelectedFilesAndCreateAtomicCommitTool', () => {
  const mockSdkContext = {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses whole-file and range file specs', () => {
    expect(parseFileSpec('src/a.ts')).toEqual({
      kind: 'whole',
      rawSpec: 'src/a.ts',
      filePath: 'src/a.ts',
    });

    expect(parseFileSpec('src/a.ts#L10')).toEqual({
      kind: 'range',
      rawSpec: 'src/a.ts#L10',
      filePath: 'src/a.ts',
      startLine: 10,
      endLine: 10,
    });

    expect(parseFileSpec('src/a.ts#L10-L20')).toEqual({
      kind: 'range',
      rawSpec: 'src/a.ts#L10-L20',
      filePath: 'src/a.ts',
      startLine: 10,
      endLine: 20,
    });
  });

  it('builds cached patch for selected ranges and rejects partial overlap', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -2,1 +2,1 @@',
      '-const value = 1;',
      '+const value = 2;',
      '@@ -10,0 +11,2 @@',
      '+const addedA = true;',
      '+const addedB = true;',
      '',
    ].join('\n');

    const patch = buildCachedPatchForRanges('src/a.ts', diff, [
      { startLine: 2, endLine: 2 },
      { startLine: 11, endLine: 12 },
    ]);

    expect(patch).toContain('@@ -2,1 +2,1 @@');
    expect(patch).toContain('@@ -10,0 +11,2 @@');

    expect(() =>
      buildCachedPatchForRanges('src/a.ts', diff, [
        { startLine: 11, endLine: 11 },
      ]),
    ).toThrowError(McpError);
  });

  it('fails when pre-staged changes exist and skipPreStagedCheck is not true', async () => {
    vi.spyOn(gitRunner, 'run')
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '/tmp/repo\n',
        stderr: '',
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'already-staged.ts\n',
        stderr: '',
      });

    const context = requestContextService.createRequestContext();
    const input = stageSelectedFilesAndCreateAtomicCommitTool.inputSchema.parse(
      {
        fileSpecs: ['src/a.ts'],
        commitSummary:
          'because we needed to prevent duplicate writes in production',
      },
    );

    await expect(
      stageSelectedFilesAndCreateAtomicCommitTool.logic(
        input,
        context,
        mockSdkContext,
      ),
    ).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
    });
  });

  it('creates atomic commit from mixed whole-file and range specs', async () => {
    vi.spyOn(commitMessageRefiner, 'refineCommitMessage').mockResolvedValue(
      'fix(commit): prevent partial index state during selective staging',
    );

    const diff = [
      'diff --git a/src/ranged.ts b/src/ranged.ts',
      '--- a/src/ranged.ts',
      '+++ b/src/ranged.ts',
      '@@ -3,1 +3,1 @@',
      '-oldValue();',
      '+newValue();',
      '',
    ].join('\n');

    let cachedDiffNameOnlyCallCount = 0;

    const gitSpy = vi
      .spyOn(gitRunner, 'run')
      .mockImplementation(async (_commandName, args, _sdk, _ctx) => {
        if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
          return { exitCode: 0, stdout: '/tmp/repo\n', stderr: '' };
        }
        if (
          args[0] === 'diff' &&
          args[1] === '--cached' &&
          args[2] === '--name-only'
        ) {
          cachedDiffNameOnlyCallCount += 1;
          return cachedDiffNameOnlyCallCount === 1
            ? { exitCode: 0, stdout: '', stderr: '' }
            : {
                exitCode: 0,
                stdout: 'src/whole.ts\nsrc/ranged.ts\n',
                stderr: '',
              };
        }
        if (args[0] === 'add') {
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        if (args[0] === 'ls-files') {
          return { exitCode: 0, stdout: 'src/ranged.ts\n', stderr: '' };
        }
        if (args[0] === 'diff' && args[1] === '--unified=0') {
          return { exitCode: 0, stdout: diff, stderr: '' };
        }
        if (args[0] === 'apply') {
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        if (args[0] === 'commit') {
          return { exitCode: 0, stdout: '[main abc123] msg\n', stderr: '' };
        }
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return { exitCode: 0, stdout: 'abc123def456\n', stderr: '' };
        }

        return { exitCode: 0, stdout: '', stderr: '' };
      });

    const context = requestContextService.createRequestContext();
    const input = stageSelectedFilesAndCreateAtomicCommitTool.inputSchema.parse(
      {
        fileSpecs: ['src/whole.ts', 'src/ranged.ts#L3'],
        commitSummary:
          'because we need consistent index state for mixed selective staging and whole-file commits',
      },
    );

    const result = await stageSelectedFilesAndCreateAtomicCommitTool.logic(
      input,
      context,
      mockSdkContext,
    );

    expect(result.commitHash).toBe('abc123def456');
    expect(result.commitMessage).toBe(
      'fix(commit): prevent partial index state during selective staging',
    );
    expect(gitSpy).toHaveBeenCalled();
  });

  it('formats commit message using grammar constraint', async () => {
    vi.spyOn(commitMessageRefiner, 'refineCommitMessage').mockResolvedValue(
      'fix: convert free-form summary into conventional format',
    );

    vi.spyOn(gitRunner, 'run')
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '/tmp/repo\n',
        stderr: '',
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'src/a.ts\n',
        stderr: '',
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: '[main abc123] msg\n',
        stderr: '',
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'abc123',
        stderr: '',
      });

    const context = requestContextService.createRequestContext();
    const input = stageSelectedFilesAndCreateAtomicCommitTool.inputSchema.parse(
      {
        fileSpecs: ['src/a.ts'],
        commitSummary:
          'just some rambling description of what was done to multiple files',
      },
    );

    const result = await stageSelectedFilesAndCreateAtomicCommitTool.logic(
      input,
      context,
      mockSdkContext,
    );

    expect(result.commitMessage).toBe(
      'fix: convert free-form summary into conventional format',
    );
  });
});
