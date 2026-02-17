import fs from 'node:fs'
import path from 'node:path'

import type { SdkContext } from './toolDefinition.js'

/**
 * Create a safe SdkContext where `signal` is a native AbortSignal controlled
 * by a local AbortController. Proxies the incoming signal's abort event
 * instead of reading its properties (avoids cross-realm getter errors).
 */
export function sanitizeSdkContext(sdkContext: SdkContext): SdkContext {
  if (!sdkContext) return sdkContext
  // Use a narrow, well-known shape for probing the signal property
  type MaybeHasSignal = { signal?: AbortSignal | EventTarget | undefined }
  const maybeSignal = (sdkContext as MaybeHasSignal).signal

  try {
    if (
      maybeSignal &&
      typeof (maybeSignal as EventTarget).addEventListener === 'function'
    ) {
      const controller = new AbortController()
      try {
        ;(maybeSignal as EventTarget).addEventListener(
          'abort',
          () => controller.abort(),
          { once: true } as AddEventListenerOptions,
        )
      } catch {
        // best-effort
      }

      // shallow clone and replace signal with native one
      return {
        ...(sdkContext as object),
        signal: controller.signal,
      } as SdkContext
    }
  } catch {
    // ignore errors and return original context
  }

  return sdkContext
}

export type PackageManager = 'bun' | 'yarn' | 'npm' | 'pnpm'

/**
 * Detect package manager based on lockfiles or package.json heuristics.
 */
export function detectProjectPackageManager(
  cwd = process.cwd(),
): PackageManager {
  try {
    const bunLock = path.join(cwd, 'bun.lockb')
    const yarnLock = path.join(cwd, 'yarn.lock')
    const pnpmLock = path.join(cwd, 'pnpm-lock.yaml')
    const npmLock = path.join(cwd, 'package-lock.json')
    const pkgJson = path.join(cwd, 'package.json')

    if (fs.existsSync(bunLock)) return 'bun'
    if (fs.existsSync(yarnLock)) return 'yarn'
    if (fs.existsSync(pnpmLock)) return 'pnpm'
    if (fs.existsSync(npmLock)) return 'npm'

    if (fs.existsSync(pkgJson)) {
      try {
        const raw = fs.readFileSync(pkgJson, 'utf8')
        const parsedRaw: unknown = JSON.parse(raw)
        if (
          parsedRaw &&
          typeof parsedRaw === 'object' &&
          !Array.isArray(parsedRaw)
        ) {
          const parsedObj = parsedRaw as Record<string, unknown>
          const maybePm = parsedObj.packageManager
          if (typeof maybePm === 'string') {
            if (maybePm.startsWith('pnpm')) return 'pnpm'
            if (maybePm.startsWith('yarn')) return 'yarn'
            if (maybePm.startsWith('bun')) return 'bun'
            if (maybePm.startsWith('npm')) return 'npm'
          }
        }
      } catch {
        // ignore parse errors
      }
    }

    // Fallback to runtime hints (prefer explicit env var)
    if (process.env.BUN_VERSION) return 'bun'
  } catch {
    // ignore
  }

  return 'yarn'
}

/**
 * Install a best-effort AbortSignal accessor shim to guard against
 * cross-realm getters throwing when inspected by Node internals.
 * This function is safe to call multiple times.
 */
export function installAbortSignalShim(): void {
  try {
    if (typeof AbortSignal !== 'undefined') {
      const props = [
        { name: 'aborted', defaultValue: false },
        { name: 'reason', defaultValue: undefined },
        { name: 'onabort', defaultValue: null },
      ]

      for (const { name, defaultValue } of props) {
        const desc = Object.getOwnPropertyDescriptor(
          AbortSignal.prototype,
          name,
        )
        if (!desc) continue
        Object.defineProperty(AbortSignal.prototype, name, {
          get(this: AbortSignal) {
            try {
              if (typeof desc.get === 'function') {
                // call the original getter with proper `this` binding
                // call the original getter with proper typing
                return (
                  desc.get as unknown as (
                    this: unknown,
                    ...args: unknown[]
                  ) => unknown
                ).call(this)
              }
              return defaultValue
            } catch {
              return defaultValue
            }
          },
          set(this: AbortSignal, v: unknown) {
            try {
              if (typeof desc.set === 'function') {
                // call the original setter with proper `this` binding
                ;(
                  desc.set as unknown as (
                    this: unknown,
                    ...args: unknown[]
                  ) => unknown
                ).call(this, v)
              }
            } catch {
              // swallow
            }
          },
          configurable: true,
          enumerable: false,
        })
      }
    }
  } catch {
    // best-effort shim; ignore failures
  }
}

/**
 * Map a unified script-style args (e.g. ['-s','lint:fix', ...]) to the
 * concrete argv for the selected package manager.
 */
export function mapScriptArgsToRunner(
  command: PackageManager,
  args: readonly string[],
): string[] {
  const arr = Array.from(args || [])

  if (arr.length > 0 && arr[0] === '-s') {
    const script = arr[1] ?? ''
    const remainder = arr.slice(2)
    switch (command) {
      case 'bun':
        return ['run', script, '--', ...remainder]
      case 'yarn':
        return ['-s', script, ...remainder]
      case 'pnpm':
      case 'npm':
        return ['run', script, '--silent', '--', ...remainder]
      default:
        return ['-s', script, ...remainder]
    }
  }

  return arr
}
