#!/usr/bin/env bun
import { watch } from 'node:fs'
import * as path from 'node:path'
import * as process from 'node:process'
import { type Subprocess, spawn } from 'bun'

/**
 * @fileoverview Watch mode for devcheck: automatically re-runs fast checks on file changes.
 * @module scripts/devwatch
 * @description
 *   Watches src/** and scripts/** for changes and automatically runs fast checks.
 *   Useful for iterative development to get quick feedback without waiting for full suite.
 *
 * @example
 * // Start watch mode with fast checks:
 * bun run devwatch
 *
 * // Include full checks on changes:
 * bun run devwatch --full
 */

const ROOT_DIR = new URL('..', import.meta.url).pathname

let currentProcess: Subprocess | null = null
let debounceTimer: Timer | null = null

const watchPaths = ['src/', 'scripts/', 'tsconfig.json', '.env', '.env.local']

function runDevcheck(full: boolean = false) {
  // Kill any existing process
  if (currentProcess) {
    currentProcess.kill()
  }

  const args = ['run', 'scripts/devcheck.ts', '--no-todos', '--no-secrets']
  if (!full) {
    args.push('--fast')
  }

  console.clear()
  console.log(
    `\n🔄 ${new Date().toLocaleTimeString()} - ${full ? 'Running full checks...' : 'Running fast checks...'}`,
  )

  currentProcess = spawn(args, {
    cwd: ROOT_DIR,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
}

function scheduleCheck(full: boolean = false) {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  debounceTimer = setTimeout(
    () => {
      runDevcheck(full)
    },
    500, // Wait 500ms to batch file changes
  )
}

// Handle command line arguments
const fullMode = process.argv.includes('--full')

// Initial run
console.log('⏳ Starting DevWatch...')
runDevcheck(fullMode)

// Watch for file changes
for (const watchPath of watchPaths) {
  const fullPath = path.join(ROOT_DIR, watchPath)
  try {
    watch(fullPath, { recursive: true }, (_event, filename) => {
      if (!filename || filename.includes('node_modules')) return
      scheduleCheck(fullMode)
    })
  } catch {
    // Path may not exist, skip
  }
}

console.log(
  `\n👀 Watching ${watchPaths.join(', ')} for changes (${fullMode ? 'full' : 'fast'} mode)...`,
)
console.log(
  '    Press Ctrl+C to stop. Changes will trigger re-runs automatically.\n',
)

// Graceful shutdown
process.on('SIGINT', () => {
  if (currentProcess) {
    currentProcess.kill()
  }
  process.exit(0)
})
