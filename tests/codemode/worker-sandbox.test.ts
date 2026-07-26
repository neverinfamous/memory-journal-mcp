import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as esbuild from 'esbuild'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { WorkerSandbox, WorkerSandboxPool } from '../../src/codemode/index.js'

const workerScriptSrc = path.join(__dirname, '../../src/codemode/worker-script.ts')
const workerScriptJs = path.join(__dirname, '../../src/codemode/worker-script.js')
const workerScriptDistJs = path.join(__dirname, '../../dist/worker-script.js')

beforeAll(() => {
    // Compile worker-script.ts to .js specifically for test execution
    // worker_threads cannot run .ts files directly in this vitest setup
    // Uses esbuild's JS API directly (npx esbuild via execSync hangs on Windows)
    esbuild.buildSync({
        entryPoints: [workerScriptSrc],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: workerScriptJs,
    })
    fs.mkdirSync(path.dirname(workerScriptDistJs), { recursive: true })
    fs.copyFileSync(workerScriptJs, workerScriptDistJs)
}, 30_000)

afterAll(() => {
    // Cleanup generated JS files
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

    it('should support global aliases (_journal, MJ, adapter, Entry, getJournal, services, kernel)', async () => {
        const sandbox = new WorkerSandbox()
        const bindings = {
            core: {
                testFunc: async (x: number) => x * 2,
            },
        }
        const code = `
            const r1 = await _journal.core.testFunc(1);
            const r2 = await MJ.core.testFunc(2);
            const r3 = await adapter.core.testFunc(3);
            const r4 = await Entry.core.testFunc(4);
            const j = await getJournal();
            const r5 = await j.core.testFunc(5);
            const r6 = await services.journal.core.testFunc(6);
            const r7 = await kernel.memory.core.testFunc(7);
            return [r1, r2, r3, r4, r5, r6, r7];
        `
        const result = await sandbox.execute(code, bindings)
        expect(result.success).toBe(true)
        expect(result.result).toEqual([2, 4, 6, 8, 10, 12, 14])
    })

    it('should support entries, search, and db shim method calls', async () => {
        const sandbox = new WorkerSandbox()
        const bindings = {
            core: {
                get_recent_entries: async (args: any) => ({ success: true, entries: [{ id: 1 }] }),
                create_entry: async (args: any) => ({ success: true, id: 2 }),
            },
            search: {
                search_entries: async (args: any) => ({ success: true, results: [{ id: 3 }] }),
            },
        }
        const code = `
            const s1 = await mj.entries.search({ query: 'test' });
            const l1 = await mj.entries.listEntries();
            const c1 = await mj.entries.createEntry({ content: 'test' });
            const q1 = await mj.search.query({ query: 'test' });
            const dbRes = await mj.db.all('SELECT * FROM entries');
            return { s1, l1, c1, q1, dbRes };
        `
        const result = await sandbox.execute(code, bindings)
        expect(result.success).toBe(true)
        const res = result.result as any
        expect(res.s1.results[0].id).toBe(3)
        expect(res.l1.entries[0].id).toBe(1)
        expect(res.c1.id).toBe(2)
        expect(res.q1.results[0].id).toBe(3)
        expect(res.dbRes.success).toBe(false)
        expect(res.dbRes.error).toContain('Direct SQLite database access')
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
    }, 15000)

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
            const res = await mj.nonexistent.method();
            return res.error;
        `
        const result = await sandbox.execute(code, bindings)
        expect(result.success).toBe(true)
        // The worker proxy now traps unknown groups and rejects gracefully
        expect(String(result.result)).toContain(
            "Group or property 'nonexistent' is not found on 'mj'"
        )
    })

    it('should handle RPC calls to non-existent methods within a valid group', async () => {
        const sandbox = new WorkerSandbox()
        const bindings = {
            core: {
                echo: async (x: string) => x,
            },
        }
        const code = `
            const res = await mj.core.doesNotExist();
            return res.error;
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
            const res = await mj.core.failingMethod();
            return res.error;
        `
        const result = await sandbox.execute(code, bindings)
        expect(result.success).toBe(true)
        expect(String(result.result)).toContain('binding threw')
    })

    it('should handle custom timeout parameter', async () => {
        const sandbox = new WorkerSandbox({ timeoutMs: 30000 })
        const result = await sandbox.execute('return "ok"', {}, undefined, 5000)
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
            enumerable: true,
        })

        const code = 'const res = await mj.testGroup.doBad(); return res.error;'
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
            enumerable: true,
        })
        const code = 'const res = await mj.topFunc(); return res.error;'
        const result = await sandbox.execute(code, bindings)
        expect(result.success).toBe(true)
        expect(String(result.result)).toContain('Unknown method: _topLevel.topFunc')
    })

    it('should clamp maxResultSize', async () => {
        const oldEnv = process.env['CODE_MODE_MAX_RESULT_SIZE']
        process.env['CODE_MODE_MAX_RESULT_SIZE'] = '9999999999' // Way above 50MB
        const sandbox = new WorkerSandbox()
        const result = await sandbox.execute('return 1', {})
        expect(result.success).toBe(true)

        process.env['CODE_MODE_MAX_RESULT_SIZE'] = 'invalid'
        const result2 = await sandbox.execute('return 1', {})
        expect(result2.success).toBe(true)

        process.env['CODE_MODE_MAX_RESULT_SIZE'] = oldEnv
    })

    it('should reject unauthorized method invocation', async () => {
        const sandbox = new WorkerSandbox()
        const code = 'while(true) {}'
        // Pass timeout 50ms so it terminates naturally
        const execPromise = sandbox.execute(
            code,
            { group: { allowed: async () => 1 } },
            undefined,
            50
        )

        await new Promise((resolve) => setTimeout(resolve, 10))

        const hostPort = sandbox['currentExecution']!.hostPort as any
        let sentError = false
        hostPort.on('message', (msg: any) => {
            // Because postMessage sends TO the worker, we can't easily listen to the worker's receive end if it's spinning.
            // But we CAN intercept the hostPort's outgoing message by spying on it.
        })
        const originalPostMessage = hostPort.postMessage.bind(hostPort)
        hostPort.postMessage = (msg: any) => {
            if (msg?.error?.includes('Unauthorized method invocation')) {
                sentError = true
            }
            originalPostMessage(msg)
        }

        // Simulate a malicious worker sending a direct RPC message for a method it doesn't have access to
        hostPort.emit('message', {
            type: 'RPC',
            id: 999,
            group: 'group',
            method: 'unauthorized',
            args: [],
        })

        await execPromise
        expect(sentError).toBe(true)
    }, 15000)

    it('should handle timeout fallback if worker script fails to timeout', async () => {
        const sandbox = new WorkerSandbox()
        const code = 'while(true) {}'
        // We bypass the worker entirely and simulate a hard crash (e.g., OOM or uncatchable timeout)
        // by emitting the 'exit' event directly on the worker instance.
        const execPromise = sandbox.execute(code, {}, undefined, 50000)

        await new Promise((resolve) => setTimeout(resolve, 50))

        // Simulate worker thread crashing with code 1
        sandbox['worker']?.emit('exit', 1)

        const result = await execPromise
        expect(result.success).toBe(false)
        expect(result.error).toContain('Worker exited')
    }, 15000)
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

    it('should dispose pool correctly', async () => {
        const pool = new WorkerSandboxPool({}, { maxInstances: 1 })
        await pool.execute('return 1', {})
        expect(pool['pool'].length).toBe(1)
        pool.dispose()
        expect(pool['pool'].length).toBe(0)
    })
})
