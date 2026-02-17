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
  type DiffBlock,
  type DiffHunk,
  ensureBlockFullyContained,
  getLine,
  type LineRange,
  parseDiffBlocks,
  parseHunkHeader,
} from './diff-parser.js'
