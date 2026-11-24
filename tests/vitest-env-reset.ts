import { afterAll } from 'vitest'

const BASELINE_ENV_KEY = Symbol.for('memory-journal-mcp.vitest.baselineEnv')

function getBaselineEnv(): Record<string, string | undefined> {
    const store = globalThis as Record<symbol, Record<string, string | undefined> | undefined>
    store[BASELINE_ENV_KEY] ??= { ...process.env }
    return store[BASELINE_ENV_KEY]
}

// Capture once at worker boot before any test file runs
const baselineEnv = getBaselineEnv()

afterAll(() => {
    for (const key of Object.keys(process.env)) {
        if (!(key in baselineEnv)) {
            Reflect.deleteProperty(process.env, key)
        }
    }
    for (const [key, value] of Object.entries(baselineEnv)) {
        if (value === undefined) {
            Reflect.deleteProperty(process.env, key)
        } else if (process.env[key] !== value) {
            process.env[key] = value
        }
    }
})
