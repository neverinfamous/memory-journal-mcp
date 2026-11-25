/**
 * Invariant: Every package listed in tsup.config.ts `external` must be
 * resolvable at runtime — i.e., listed in dependencies or optionalDependencies.
 *
 * This prevents the "works in dev, crashes in prod" class of bugs where
 * externalized packages are only available as transitive devDependencies
 * and get removed by `npm ci --omit=dev` in Docker builds.
 *
 * @see https://github.com/neverinfamous/db-mcp/issues/149
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('Build externals consistency', () => {
    it('every tsup external must be in dependencies or optionalDependencies and multi-config builds must not race clean dist', async () => {
        const mod = (await import('../tsup.config.js')) as {
            default:
                | {
                      entry?: Record<string, string>
                      external?: string[]
                      clean?: boolean
                      splitting?: boolean
                  }[]
                | {
                      entry?: Record<string, string>
                      external?: string[]
                      clean?: boolean
                      splitting?: boolean
                  }
        }
        const configs = Array.isArray(mod.default) ? mod.default : [mod.default]
        expect(configs.length).toBeGreaterThanOrEqual(2)

        const mainConfig = configs.find((c) => c.entry && 'index' in c.entry)
        expect(mainConfig).toBeDefined()
        const externals = mainConfig?.external ?? []
        expect(externals.length).toBeGreaterThan(0)

        const workerConfig = configs.find((c) => c.entry && 'worker-script' in c.entry)
        expect(workerConfig).toBeDefined()
        expect(workerConfig?.splitting).toBe(false)
        expect(workerConfig?.external).toEqual([])

        for (const cfg of configs) {
            expect(cfg.clean).toBe(false)
        }

        const pkgJson = JSON.parse(
            readFileSync(resolve(__dirname, '../package.json'), 'utf-8')
        ) as {
            dependencies?: Record<string, string>
            optionalDependencies?: Record<string, string>
        }

        const prodDeps = new Set([
            ...Object.keys(pkgJson.dependencies ?? {}),
            ...Object.keys(pkgJson.optionalDependencies ?? {}),
        ])

        const allExternals = configs.flatMap((c) => c.external ?? [])
        const missing = allExternals.filter((ext) => !prodDeps.has(ext))
        expect(
            missing,
            `These packages are externalized in tsup.config.ts but missing from ` +
                `dependencies/optionalDependencies: ${missing.join(', ')}. ` +
                `They will NOT be available at runtime after \`npm ci --omit=dev\`.`
        ).toEqual([])
    })
})
