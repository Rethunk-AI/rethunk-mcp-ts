/**
 * @fileoverview Barrel export for git utilities
 * @module src/utils/git
 */

export {
  blockIntersectsRange,
  blockIsContainedByAnyRange,
  buildCachedPatchForRanges,
  collectDiffHunks,
  collectPrefixedLines,
  ensureBlockFullyContained,
  getLine,
  parseHunkHeader,
  parseDiffBlocks,
  type DiffBlock,
  type DiffHunk,
  type LineRange,
} from './diff-parser.js';
