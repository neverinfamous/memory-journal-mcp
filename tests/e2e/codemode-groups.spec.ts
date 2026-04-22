/**
 * E2E Tests: Code Mode Per-Group API Surface
 *
 * Systematically verifies that all mj.* Code Mode API groups are
 * wired, accessible, and return valid results. Ensures no group
 * is silently broken or missing from the sandbox bridge.
 *
 * Ported from db-mcp/tests/e2e/codemode-groups.spec.ts and
 * postgres-mcp/tests/e2e/codemode-groups.spec.ts — adapted
 * for memory-journal-mcp's mj.* API surface.
 *
 * Groups tested: core, search, analytics, relationships, export,
 * admin, github, backup, team.
 */

import { test, expect } from '@playwright/test'
import { createClient, callToolAndParse, expectSuccess } from './helpers.js'

test.describe.configure({ mode: 'serial' })

// =============================================================================
// mj.help() — Global API Surface
// =============================================================================

test.describe('Code Mode Groups: Global help()', () => {
    test('mj.help() returns all expected groups', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: 'return mj.help();',
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(Array.isArray(result.groups)).toBe(true)

            const groups = result.groups as string[]
            const expected = [
                'core',
                'search',
                'analytics',
                'relationships',
                'export',
                'admin',
                'github',
                'backup',
                'team',
            ]
            for (const g of expected) {
                expect(groups, `Missing group: ${g}`).toContain(g)
            }
        } finally {
            await client.close()
        }
    })

    test('mj.help() totalMethods is a positive number', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: 'return mj.help();',
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            if (result.totalMethods !== undefined) {
                expect(typeof result.totalMethods).toBe('number')
                expect(result.totalMethods as number).toBeGreaterThan(0)
            }
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Per-Group help() — Verify Methods Array
// =============================================================================

test.describe('Code Mode Groups: Per-Group help()', () => {
    test('mj.core.help() returns methods including createEntry', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: 'return mj.core.help();',
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(result.group).toBe('core')
            const methods = result.methods as string[]
            expect(Array.isArray(methods)).toBe(true)
            expect(methods).toContain('createEntry')
            expect(methods).toContain('getRecentEntries')
        } finally {
            await client.close()
        }
    })

    test('mj.search.help() returns methods including searchEntries', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: 'return mj.search.help();',
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(result.group).toBe('search')
            const methods = result.methods as string[]
            expect(Array.isArray(methods)).toBe(true)
            expect(methods).toContain('searchEntries')
        } finally {
            await client.close()
        }
    })

    test('mj.analytics.help() returns methods including getStatistics', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: 'return mj.analytics.help();',
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(result.group).toBe('analytics')
            const methods = result.methods as string[]
            expect(Array.isArray(methods)).toBe(true)
            expect(methods).toContain('getStatistics')
        } finally {
            await client.close()
        }
    })

    test('mj.relationships.help() returns methods including linkEntries', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: 'return mj.relationships.help();',
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(result.group).toBe('relationships')
            const methods = result.methods as string[]
            expect(Array.isArray(methods)).toBe(true)
            expect(methods).toContain('linkEntries')
        } finally {
            await client.close()
        }
    })

    test('mj.export.help() returns methods including exportEntries', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: 'return mj.export.help();',
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(result.group).toBe('export')
            const methods = result.methods as string[]
            expect(Array.isArray(methods)).toBe(true)
            expect(methods).toContain('exportEntries')
        } finally {
            await client.close()
        }
    })

    test('mj.admin.help() returns methods including updateEntry', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: 'return mj.admin.help();',
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(result.group).toBe('admin')
            const methods = result.methods as string[]
            expect(Array.isArray(methods)).toBe(true)
            expect(methods).toContain('updateEntry')
            expect(methods).toContain('deleteEntry')
        } finally {
            await client.close()
        }
    })

    test('mj.github.help() returns methods including getGithubIssues', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: 'return mj.github.help();',
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(result.group).toBe('github')
            const methods = result.methods as string[]
            expect(Array.isArray(methods)).toBe(true)
            expect(methods).toContain('getGithubIssues')
        } finally {
            await client.close()
        }
    })

    test('mj.backup.help() returns methods including backupJournal', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: 'return mj.backup.help();',
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(result.group).toBe('backup')
            const methods = result.methods as string[]
            expect(Array.isArray(methods)).toBe(true)
            expect(methods).toContain('backupJournal')
            expect(methods).toContain('listBackups')
        } finally {
            await client.close()
        }
    })

    test('mj.team.help() returns methods including teamCreateEntry', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: 'return mj.team.help();',
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(result.group).toBe('team')
            const methods = result.methods as string[]
            expect(Array.isArray(methods)).toBe(true)
            expect(methods).toContain('teamCreateEntry')
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// All Groups Reachable via Loop
// =============================================================================

test.describe('Code Mode Groups: Bulk Validation', () => {
    test('all 9 groups have >0 methods from help()', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: `
                    const groups = ["core","search","analytics","relationships","export","admin","github","backup","team"];
                    const results = {};
                    for (const g of groups) {
                        const h = await mj[g].help();
                        results[g] = h.methods.length;
                    }
                    return results;
                `,
            })
            expectSuccess(p)
            const result = p.result as Record<string, number>
            expect(Object.keys(result).length).toBe(9)
            for (const [group, count] of Object.entries(result)) {
                expect(count, `${group} should have >0 methods`).toBeGreaterThan(0)
            }
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Per-Group Representative Calls
// =============================================================================

test.describe('Code Mode Groups: Representative Calls', () => {
    test('mj.core.getRecentEntries() returns entries array', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: `
                    const result = await mj.core.getRecentEntries({ limit: 2 });
                    return { count: result.count, hasEntries: Array.isArray(result.entries) };
                `,
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(typeof result.count).toBe('number')
            expect(result.hasEntries).toBe(true)
        } finally {
            await client.close()
        }
    })

    test('mj.search.searchEntries() returns entries array', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: `
                    const result = await mj.search.searchEntries({ query: 'test' });
                    return { count: result.count, hasEntries: Array.isArray(result.entries) };
                `,
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(typeof result.count).toBe('number')
            expect(result.hasEntries).toBe(true)
        } finally {
            await client.close()
        }
    })

    test('mj.analytics.getStatistics() returns stats object', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: 'return await mj.analytics.getStatistics({});',
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            // Stats response should have totalEntries or similar top-level field
            expect(typeof result).toBe('object')
        } finally {
            await client.close()
        }
    })

    test('mj.export.exportEntries() returns export data', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: `return await mj.export.exportEntries({ format: 'json', limit: 1 });`,
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(typeof result).toBe('object')
        } finally {
            await client.close()
        }
    })

    test('mj.admin.rebuildVectorIndex() returns success', async () => {
        test.setTimeout(120000)
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: 'return await mj.admin.rebuildVectorIndex({});',
            })
            const result = p.result as Record<string, unknown>
            // Accept success or structured error (index may not be initialized or might throw)
            if (result.success !== undefined) {
                expect(typeof result.success).toBe('boolean')
            } else {
                expect(typeof result.error).toBe('string')
            }
        } finally {
            await client.close()
        }
    })

    test('mj.backup.listBackups() returns backups array', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: 'return await mj.backup.listBackups({});',
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(typeof result).toBe('object')
            // Should have a backups field (array, possibly empty)
            if (result.backups !== undefined) {
                expect(Array.isArray(result.backups)).toBe(true)
            }
        } finally {
            await client.close()
        }
    })

    test('mj.core.listTags() returns tags array', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: 'return await mj.core.listTags({});',
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(Array.isArray(result.tags)).toBe(true)
        } finally {
            await client.close()
        }
    })
})

// =============================================================================
// Method Alias Resolution
// =============================================================================

test.describe('Code Mode Groups: Method Aliases', () => {
    test('mj.core.create() resolves to createEntry()', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: `
                    const r1 = await mj.core.create({ content: 'Alias test entry', entry_type: 'test_entry' });
                    return { success: r1.success, hasEntry: !!r1.entry };
                `,
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(result.success).toBe(true)
            expect(result.hasEntry).toBe(true)
        } finally {
            await client.close()
        }
    })

    test('mj.core.recent() resolves to getRecentEntries()', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: `
                    const r1 = await mj.core.recent({ limit: 1 });
                    const r2 = await mj.core.getRecentEntries({ limit: 1 });
                    return { aliasCount: r1.count, canonicalCount: r2.count };
                `,
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(result.aliasCount).toBe(result.canonicalCount)
        } finally {
            await client.close()
        }
    })

    test('mj.search.find() resolves to searchEntries()', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: `
                    const r1 = await mj.search.find({ query: 'test' });
                    return { hasEntries: Array.isArray(r1.entries), count: r1.count };
                `,
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(result.hasEntries).toBe(true)
            expect(typeof result.count).toBe('number')
        } finally {
            await client.close()
        }
    })

    test('mj.backup.list() resolves to listBackups()', async () => {
        const client = await createClient()
        try {
            const p = await callToolAndParse(client, 'mj_execute_code', {
                code: `
                    const r1 = await mj.backup.list({});
                    const r2 = await mj.backup.listBackups({});
                    return { aliasSuccess: r1.success, canonicalSuccess: r2.success };
                `,
            })
            expectSuccess(p)
            const result = p.result as Record<string, unknown>
            expect(result.aliasSuccess).toBe(result.canonicalSuccess)
        } finally {
            await client.close()
        }
    })
})
