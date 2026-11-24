import { afterAll, afterEach, beforeEach, vi } from 'vitest'

const BASELINE_ENV_KEY = Symbol.for('memory-journal-mcp.vitest.baselineEnv')

function getBaselineEnv(): Record<string, string | undefined> {
    const store = globalThis as Record<symbol, Record<string, string | undefined> | undefined>
    store[BASELINE_ENV_KEY] ??= { ...process.env }
    return store[BASELINE_ENV_KEY]
}

function restoreEnvSnapshot(snapshot: Record<string, string | undefined>): void {
    for (const key of Object.keys(process.env)) {
        if (!Object.hasOwn(snapshot, key)) {
            Reflect.deleteProperty(process.env, key)
        }
    }
    for (const [key, value] of Object.entries(snapshot)) {
        if (value === undefined) {
            Reflect.deleteProperty(process.env, key)
        } else if (process.env[key] !== value) {
            process.env[key] = value
        }
    }
}

// Capture once at worker boot before any test file runs
const baselineEnv = getBaselineEnv()
let testEnvSnapshot: Record<string, string | undefined> = baselineEnv

beforeEach(() => {
    testEnvSnapshot = { ...process.env }
})

afterEach(() => {
    vi.restoreAllMocks()
    restoreEnvSnapshot(testEnvSnapshot)
})

afterAll(() => {
    restoreEnvSnapshot(baselineEnv)
})
