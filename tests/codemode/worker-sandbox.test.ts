import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { WorkerSandbox, WorkerSandboxPool } from '../../src/codemode/index.js'

const workerScriptSrc = path.join(__dirname, '../../src/codemode/worker-script.ts')
const workerScriptJs = path.join(__dirname, '../../src/codemode/worker-script.js')

beforeAll(() => {
    // Compile worker-script.ts to .js specifically for test execution
    // worker_threads cannot run .ts files directly in this vitest setup
    if (!fs.existsSync(workerScriptJs)) {
        execSync(`npx esbuild ${workerScriptSrc} --bundle --platform=node --format=esm --outfile=${workerScriptJs}`)
    }
})

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
                testFunc: async (x: number) => x * 2
            }
        }
        const code = 'return await mj.core.testFunc(21)'
        const result = await sandbox.execute(code, bindings)
        expect(result.success).toBe(true)
        expect(result.result).toBe(42)
    })

    it('should handle top-level bindings correctly', async () => {
        const sandbox = new WorkerSandbox()
        const bindings = {
            testFunc: async (x: number) => x * 3
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
        expect(result.error).toContain('timed out')
    })

    it('should catch synchronous syntax errors or throw', async () => {
        const sandbox = new WorkerSandbox()
        const result = await sandbox.execute('throw new Error("test abort")', {})
        expect(result.success).toBe(false)
        expect(result.error).toContain('test abort')
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
        const exec1 = pool.execute(slowCode, {}).catch(e => null)
        
        // Pool is now at 1/1 active count
        // Attempting a second execution should fail immediately with an exhausted error
        const result2 = await pool.execute('return 2', {})
        expect(result2.success).toBe(false)
        expect(result2.error).toContain('Sandbox pool exhausted')

        await exec1 // wait for the first to finish
        expect(pool.getActiveCount()).toBe(0)
    })
})
