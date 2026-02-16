/**
 * @fileoverview Diff and patch parsing utilities for git operations.
 * Parses unified diff format and constructs patches for partial file staging.
 * @module src/utils/git/diff-parser
 */

import { JsonRpcErrorCode, McpError } from '@/types-global/errors.js';

/**
 * Line range specification (start and end line numbers).
 */
export type LineRange = {
  startLine: number;
  endLine: number;
};

/**
 * Parsed diff block representing a contiguous change.
 */
export type DiffBlock = {
  oldStart: number;
  newStart: number;
  deletedLines: string[];
  addedLines: string[];
  patchLines: string[];
};

/**
 * Single hunk from a unified diff.
 */
export type DiffHunk = {
  header: string;
  lines: string[];
};

/**
 * Parses a unified diff hunk header (e.g., `@@ -10,5 +15,7 @@`) to extract line numbers.
 */
export function parseHunkHeader(header: string): {
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

/**
 * Safely retrieves a line from an array with bounds checking.
 */
export function getLine(
  lines: string[],
  index: number,
  filePath: string,
): string {
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

/**
 * Collects consecutive lines with a specific prefix ('+' or '-').
 */
export function collectPrefixedLines(
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

/**
 * Parses a diff hunk into structured blocks (contiguous change groups).
 */
export function parseDiffBlocks(
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

/**
 * Collects all hunks from a unified diff.
 */
export function collectDiffHunks(
  diffLines: string[],
  filePath: string,
): DiffHunk[] {
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

/**
 * Checks if a block intersects any of the given ranges.
 */
export function blockIntersectsRange(
  block: DiffBlock,
  ranges: LineRange[],
): boolean {
  const affectedStart = block.newStart;
  const affectedEnd =
    block.addedLines.length > 0
      ? block.newStart + block.addedLines.length - 1
      : block.newStart;

  return ranges.some(
    (range) =>
      range.startLine <= affectedEnd && range.endLine >= affectedStart,
  );
}

/**
 * Checks if a block is fully contained within any of the given ranges.
 */
export function blockIsContainedByAnyRange(
  block: DiffBlock,
  ranges: LineRange[],
): boolean {
  const affectedStart = block.newStart;
  const affectedEnd =
    block.addedLines.length > 0
      ? block.newStart + block.addedLines.length - 1
      : block.newStart;

  return ranges.some(
    (range) =>
      range.startLine <= affectedStart && range.endLine >= affectedEnd,
  );
}

/**
 * Validates that a block is fully contained within the specified ranges.
 * Throws if the block only partially overlaps.
 */
export function ensureBlockFullyContained(
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

/**
 * Builds a git patch for specific line ranges within a file's diff.
 * Ensures all changed blocks are fully contained within requested ranges.
 * @param filePath - Repository-relative path to the file
 * @param unifiedDiff - Unified diff output from git diff
 * @param ranges - Line ranges to include in the patch
 * @returns Unified diff patch restricted to the specified ranges
 */
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
