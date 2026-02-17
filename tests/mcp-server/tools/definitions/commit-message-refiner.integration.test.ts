/**
 * @fileoverview Integration test for LLM-based commit message refinement.
 * Tests the actual commitMessageRefiner function with the real OpenAI API.
 * Skips all tests if OPENAI_API_KEY is not provided.
 * Run with: bun test commit-message-refiner.integration.test.ts
 * @module tests/mcp-server/tools/definitions/commit-message-refiner.integration
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { commitMessageRefiner } from '../../../../src/mcp-server/tools/definitions/stage-selected-files-and-create-atomic-commit.tool.js'
import { requestContextService } from '../../../../src/utils/index.js'
import 'reflect-metadata'

/**
 * Load environment variables from .env.local file.
 * @returns Object containing parsed environment variables
 */
function loadEnvLocal(): Record<string, string> {
  const envPath = resolve(process.cwd(), '.env.local')
  try {
    const content = readFileSync(envPath, 'utf-8')
    const env: Record<string, string> = {}
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const [key, ...valueParts] = trimmed.split('=')
      if (key) {
        env[key] = valueParts.join('=')
      }
    }
    return env
  } catch {
    return {}
  }
}

/**
 * Get OPENAI_API_KEY from .env.local or environment.
 * @returns API key string or empty string if not found
 */
function getApiKey(): string {
  const env = loadEnvLocal()
  return env.OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY || ''
}

const apiKey = getApiKey()
const hasApiKey = Boolean(apiKey)

describe.skipIf(!hasApiKey)('commitMessageRefiner - Integration Tests', () => {
  beforeAll(() => {
    if (!hasApiKey) {
      throw new Error('OPENAI_API_KEY not available')
    }
    // Set API key in environment for the refiner to use
    process.env.OPENAI_API_KEY = apiKey
  }, 30000)

  it('should format a free-form summary into a conventional commit message using gpt-5-nano', async () => {
    const commitSummary =
      'we need to fix the authentication flow and add better error messages'
    const context = requestContextService.createRequestContext()

    console.log('\n=== Commit Message Refinement Test ===')
    console.log('Input:', commitSummary)
    console.log('Model: gpt-5-nano (reasoning model)')

    const result = await commitMessageRefiner.refineCommitMessage(
      commitSummary,
      context,
    )

    console.log('Output:', result)
    console.log('Length:', result.length)

    expect(result).toBeDefined()
    expect(result.length).toBeGreaterThan(0)
    expect(result).toMatch(
      /^(feat|fix|refactor|perf|test|docs|chore)(\([^)]+\))?!?:\s.+/,
    )
  }, 120000)

  it('should handle various commit summary formats', async () => {
    const testCases = [
      'add JWT validation support',
      'we need to prevent duplicate writes to the database',
      'Implement reasoning model for commit messages',
      'fix bug where missing output breaks commit generation',
    ]

    const context = requestContextService.createRequestContext()

    console.log('\n=== Multiple Commit Summaries Test ===')

    for (const summary of testCases) {
      console.log(`\nInput: "${summary}"`)

      const result = await commitMessageRefiner.refineCommitMessage(
        summary,
        context,
      )

      console.log(`Output: ${result}`)

      expect(result).toBeDefined()
      expect(result.length).toBeGreaterThan(0)
      expect(result).toMatch(
        /^(feat|fix|refactor|perf|test|docs|chore)(\([^)]+\))?!?:\s.+/,
      )
    }
  }, 300000)

  it('should reject empty or whitespace-only responses from LLM', async () => {
    const commitSummary = 'test refinement with thinking model'
    const context = requestContextService.createRequestContext()

    console.log('\n=== Empty Response Handling Test ===')
    console.log('Input:', commitSummary)

    const result = await commitMessageRefiner.refineCommitMessage(
      commitSummary,
      context,
    )

    console.log('Output length:', result.length)
    console.log('Output:', result)

    expect(result.trim().length).toBeGreaterThan(0)
  }, 120000)
})
