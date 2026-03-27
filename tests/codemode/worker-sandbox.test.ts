import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as esbuild from 'esbuild'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { WorkerSandbox, WorkerSandboxPool } from '../../src/codemode/index.js'

const workerScriptSrc = path.join(__dirname, '../../src/codemode/worker-script.ts')
const workerScriptJs = path.join(__dirname, '../../src/codemode/worker-script.js')

beforeAll(() => {
    // Compile worker-script.ts to .js specifically for test execution
    // worker_threads cannot run .ts files directly in this vitest setup
    // Uses esbuild's JS API directly (npx esbuild via execSync hangs on Windows)
    if (!fs.existsSync(workerScriptJs)) {
        esbuild.buildSync({
            entryPoints: [workerScriptSrc],
            bundle: true,
            platform: 'node',
            format: 'esm',
            outfile: workerScriptJs,
        })
    }
}, 30_000)

afterAll(() => {
    // Cleanup generated JS file
    if (fs.existsSync(workerScriptJs)) {
        fs.unlinkSync(workerScriptJs)
    }
})

describe('WorkerSandbox', () => {
    it('should execute basic code successfully', async () => {
        const sandbox = new WorkerSandbox()
        const result = await sandbox.execute('return 42', {})
        expect(result.success).toBe(true)
        expect(result.result).toBe(42)
        expect(result.metrics).toBeDefined()
    })

    it('should call api bindings correctly', async () => {
        const sandbox = new WorkerSandbox()
        const bindings = {
            core: {
                testFunc: async (x: number) => x * 2,
            },
        }
        const code = 'return await mj.core.testFunc(21)'
        const result = await sandbox.execute(code, bindings)
        expect(result.success).toBe(true)
        expect(result.result).toBe(42)
    })

    it('should handle top-level bindings correctly', async () => {
        const sandbox = new WorkerSandbox()
        const bindings = {
            testFunc: async (x: number) => x * 3,
        }
        const code = 'return await mj.testFunc(14)'
        const result = await sandbox.execute(code, bindings)
        expect(result.success).toBe(true)
        expect(result.result).toBe(42)
    })

    it('should enforce timeout limiting', async () => {
        // Provide a very short timeout
        const sandbox = new WorkerSandbox({ timeoutMs: 50 })
        const code = `
            while(true) {
                // Infinite loop
            }
        `
        const result = await sandbox.execute(code, {})
        expect(result.success).toBe(false)
        expect(result.error).toMatch(/timed out|timeout|code 1/i)
    })

    it('should catch synchronous syntax errors or throw', async () => {
        const sandbox = new WorkerSandbox()
        const result = await sandbox.execute('throw new Error("test abort")', {})
        expect(result.success).toBe(false)
        expect(result.error).toContain('test abort')
    })

    it('should handle RPC calls to non-existent groups gracefully', async () => {
        const sandbox = new WorkerSandbox()
        const bindings = {
            core: {
                echo: async (x: string) => x,
            },
        }
        // Non-existent group: the worker proxy doesn't create nested proxies
        // for unknown groups, so accessing mj.nonexistent returns undefined
        const code = `
            try {
                await mj.nonexistent.method();
            } catch(e) {
                return e.message;
            }
        `
        const result = await sandbox.execute(code, bindings)
        expect(result.success).toBe(true)
        // TypeError because mj.nonexistent is undefined
        expect(String(result.result)).toContain('Cannot read properties of undefined')
    })

    it('should handle RPC calls to non-existent methods within a valid group', async () => {
        const sandbox = new WorkerSandbox()
        const bindings = {
            core: {
                echo: async (x: string) => x,
            },
        }
        const code = `
            try {
                await mj.core.doesNotExist();
            } catch(e) {
                return e.message;
            }
        `
        const result = await sandbox.execute(code, bindings)
        expect(result.success).toBe(true)
        expect(String(result.result)).toContain('is not found in group')
    })

    it('should handle RPC errors thrown by api bindings', async () => {
        const sandbox = new WorkerSandbox()
        const bindings = {
            core: {
                failingMethod: async () => {
                    throw new Error('binding threw')
                },
            },
        }
        const code = `
            try {
                await mj.core.failingMethod();
            } catch(e) {
                return e.message;
            }
        `
        const result = await sandbox.execute(code, bindings)
        expect(result.success).toBe(true)
        expect(String(result.result)).toContain('binding threw')
    })

    it('should handle custom timeout parameter', async () => {
        const sandbox = new WorkerSandbox({ timeoutMs: 30000 })
        const result = await sandbox.execute('return "ok"', {}, 5000)
        expect(result.success).toBe(true)
        expect(result.result).toBe('ok')
    })

    it('should skip non-function and non-object bindings in serialization', async () => {
        const sandbox = new WorkerSandbox()
        const bindings = {
            core: {
                echo: async (x: string) => x,
            },
            // These should be silently skipped (not functions or objects)
            stringVal: 'hello' as unknown,
            numberVal: 42 as unknown,
        }
        const code = 'return await mj.core.echo("test")'
        const result = await sandbox.execute(code, bindings)
        expect(result.success).toBe(true)
        expect(result.result).toBe('test')
    })

    it('should handle unknown RPC method (e.g. method removed after serialization)', async () => {
        const sandbox = new WorkerSandbox()
        const bindings: Record<string, any> = {}
        
        let accessed = false
        Object.defineProperty(bindings, 'testGroup', {
            get: () => {
                if (!accessed) {
                    accessed = true
                    // Phase 1: Serialization by WorkerSandbox grabs this
                    return { doBad: async () => 'ok' }
                }
                // Phase 2: RPC request processing grabs this 
                return {} 
            },
            enumerable: true
        })
        
        const code = 'try { await mj.testGroup.doBad(); } catch(e) { return e.message; }'
        const result = await sandbox.execute(code, bindings)
        expect(result.success).toBe(true)
        expect(String(result.result)).toContain('Unknown method: testGroup.doBad')
    })

    it('should handle top-level unknown RPC method', async () => {
        const sandbox = new WorkerSandbox()
        const bindings: Record<string, any> = {}
        let accessed = false
        Object.defineProperty(bindings, 'topFunc', {
            get: () => {
                if (!accessed) {
                    accessed = true
                    return async () => 'ok'
                }
                return 'not a function'
            },
            enumerable: true
        })
        const code = 'try { await mj.topFunc(); } catch(e) { return e.message; }'
        const result = await sandbox.execute(code, bindings)
        expect(result.success).toBe(true)
        expect(String(result.result)).toContain('Unknown method: _topLevel.topFunc')
    })
})
describe('WorkerSandboxPool', () => {
    it('should create and execute using pool', async () => {
        const pool = new WorkerSandboxPool({}, { maxInstances: 2 })
        const result = await pool.execute('return "pooled"', {})
        expect(result.success).toBe(true)
        expect(result.result).toBe('pooled')
        expect(pool.getActiveCount()).toBe(0)
    })

    it('should enforce max instances exhaustion', async () => {
        const pool = new WorkerSandboxPool({}, { maxInstances: 1 })

        // Start one long-running execution that won't finish immediately
        const slowCode = 'await new Promise(r => setTimeout(r, 200)); return 1;'
        const exec1 = pool.execute(slowCode, {}).catch((e) => null)

        // Pool is now at 1/1 active count
        // Attempting a second execution should fail immediately with an exhausted error
        const result2 = await pool.execute('return 2', {})
        expect(result2.success).toBe(false)
        expect(result2.error).toContain('Sandbox pool exhausted')

        await exec1 // wait for the first to finish
        expect(pool.getActiveCount()).toBe(0)
    })
})
