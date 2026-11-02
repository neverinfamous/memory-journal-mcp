/**
 * Unit Tests for:
 * - Entity Lookups & Search Facets (src/database/sqlite-adapter/entries/search/entity-lookups.ts)
 * - Entry Revisions & Version Diffs (src/database/sqlite-adapter/entries/revisions.ts)
 * - IO Tool Schemas & Handlers (src/handlers/tools/io/schemas.ts, src/handlers/tools/io/tools.ts)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import { compareEntryVersions, getEntryRevisions } from '../../src/database/sqlite-adapter/entries/revisions.js'
import { getIoTools } from '../../src/handlers/tools/io/tools.js'
import {
    ExportEntriesSchema,
    ExportEntriesSchemaMcp,
    ExportMarkdownSchema,
    ExportMarkdownSchemaMcp,
    ImportMarkdownSchema,
    ImportMarkdownSchemaMcp,
    ImportExternalSchema,
    ImportExternalSchemaMcp,
} from '../../src/handlers/tools/io/schemas.js'

describe('Entity Lookups, Revisions, and IO Tools Coverage', () => {
    let tmpDir: string
    let db: DatabaseAdapter

    beforeEach(async () => {
        const baseTestOut = path.join(process.cwd(), '.test-output', 'unit-io')
        fs.mkdirSync(baseTestOut, { recursive: true })
        tmpDir = fs.mkdtempSync(path.join(baseTestOut, 'mj-lookups-io-test-'))
        db = new DatabaseAdapter(path.join(tmpDir, 'test.db'))
        await db.initialize()
    })

    afterEach(() => {
        try {
            db.close()
        } catch {
            // ignore
        }
        fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    // =========================================================================
    // 1. Entity Lookups & Search Facets (entity-lookups.ts)
    // =========================================================================
    describe('Entity Lookups & Search Facets', () => {
        it('should query entries by project, issue, PR, workflow run, session, and compute search facets', () => {
            const e1 = db.createEntry({
                content: 'Alpha feature implementation for search facets',
                entryType: 'technical_achievement',
                tags: ['alpha-tag', 'shared-tag'],
                isPersonal: false,
                projectNumber: 101,
                issueNumber: 202,
                prNumber: 303,
                prStatus: 'merged',
                workflowRunId: 404,
                workspaceId: 'ws-one',
                sessionId: 'sess-abc',
            })

            db.createEntry({
                content: 'Beta bug fix in another workspace',
                entryType: 'bug_fix',
                tags: ['beta-tag', 'shared-tag'],
                isPersonal: true,
                projectNumber: 101,
                issueNumber: 202,
                prNumber: 303,
                prStatus: 'open',
                workflowRunId: 404,
                workspaceId: 'ws-two',
                sessionId: 'sess-abc',
            })

            // Lookups with specific workspaceId vs wildcard '*'
            expect(db.getEntriesByProject(101, 10, 'ws-one').map((e) => e.id)).toEqual([e1.id])
            expect(db.getEntriesByProject(101, 10, '*').length).toBe(2)

            expect(db.getEntriesByIssue(202, 10, 'ws-one').map((e) => e.id)).toEqual([e1.id])
            expect(db.getEntriesByIssue(202, 10, '*').length).toBe(2)

            expect(db.getEntriesByPR(303, 10, 'ws-one').map((e) => e.id)).toEqual([e1.id])
            expect(db.getEntriesByPR(303, 10, '*').length).toBe(2)

            expect(db.getEntriesByWorkflowRun(404, 10, 'ws-one').map((e) => e.id)).toEqual([e1.id])
            expect(db.getEntriesByWorkflowRun(404, 10, '*').length).toBe(2)

            expect(db.getEntriesBySession('sess-abc', 10, 'ws-one').map((e) => e.id)).toEqual([e1.id])
            expect(db.getEntriesBySession('sess-abc', 10, '*').length).toBe(2)

            // Search facets with all filter branches
            const facetsAll = db.getSearchFacets('facets', {
                workspaceId: '*',
                includeArchived: true,
            })
            expect(facetsAll.tags.some((t) => t.name === 'alpha-tag')).toBe(true)
            expect(facetsAll.entryTypes.some((t) => t.name === 'technical_achievement')).toBe(true)

            const facetsFiltered = db.getSearchFacets('', {
                workspaceId: 'ws-one',
                isPersonal: false,
                projectNumber: 101,
                issueNumber: 202,
                prNumber: 303,
                prStatus: 'merged',
                workflowRunId: 404,
                tags: ['alpha-tag'],
                entryType: 'technical_achievement',
                startDate: '2020-01-01',
                endDate: '2030-12-31',
            })
            expect(facetsFiltered.tags.map((t) => t.name)).toEqual(['alpha-tag'])
            expect(facetsFiltered.entryTypes.map((t) => t.name)).toEqual(['technical_achievement'])
        })
    })

    // =========================================================================
    // 2. Entry Revisions & Version Diffs (revisions.ts)
    // =========================================================================
    describe('Entry Revisions & compareEntryVersions', () => {
        it('should record revisions on update and compute line-by-line diffs between versions', () => {
            const entry = db.createEntry({
                content: 'Line 1\nLine 2\nLine 3',
                entryType: 'development_note',
                workspaceId: 'default',
            })

            db.updateEntry(entry.id, {
                content: 'Line 1\nLine 2 modified\nLine 4',
                workspaceId: 'default',
            })

            db.updateEntry(entry.id, {
                content: 'Line 1\nLine 2 final\nLine 5',
                workspaceId: 'default',
            })

            const history = db.getEntryHistory(entry.id)
            expect(history.length).toBeGreaterThanOrEqual(2)

            // Access internal sharedContext to test compareEntryVersions directly
            const sharedCtx = (
                db as unknown as {
                    entriesMgr: { sharedContext: Parameters<typeof compareEntryVersions>[0] }
                }
            ).entriesMgr.sharedContext

            const revs = getEntryRevisions(sharedCtx, entry.id)
            expect(revs.length).toBe(2)

            // Compare revision 1 to revision 2
            const diff1to2 = compareEntryVersions(sharedCtx, entry.id, 1, 2)
            expect(diff1to2).not.toBeNull()
            expect(diff1to2?.fromRevision).toBe(1)
            expect(diff1to2?.toRevision).toBe(2)
            expect(diff1to2?.addedLines).toContain('Line 2 modified')
            expect(diff1to2?.removedLines).toContain('Line 2')

            // Compare revision 1 to current entry content
            const diff1toCurrent = compareEntryVersions(sharedCtx, entry.id, 1)
            expect(diff1toCurrent).not.toBeNull()
            expect(diff1toCurrent?.toRevision).toBe('current')
            expect(diff1toCurrent?.addedLines).toContain('Line 2 final')

            // Non-existent revisions return null
            expect(compareEntryVersions(sharedCtx, entry.id, 999)).toBeNull()
            expect(compareEntryVersions(sharedCtx, entry.id, 1, 999)).toBeNull()
        })
    })

    // =========================================================================
    // 3. IO Schemas & Tool Handlers (src/handlers/tools/io/*)
    // =========================================================================
    describe('IO Schemas & Tool Handlers', () => {
        it('should preprocess alias keys in IO schemas (type->format, path/dir->output_dir/source_dir, source->source_format)', () => {
            expect(ExportEntriesSchema.parse({ type: 'markdown' }).format).toBe('markdown')
            expect(ExportEntriesSchemaMcp.parse({ type: 'json' }).format).toBe('json')

            expect(ExportMarkdownSchema.parse({ path: '/tmp/out' }).output_dir).toBe('/tmp/out')
            expect(ExportMarkdownSchemaMcp.parse({ dir: '/tmp/out2' }).output_dir).toBe('/tmp/out2')

            expect(ImportMarkdownSchema.parse({ filepath: '/tmp/in' }).source_dir).toBe('/tmp/in')
            expect(ImportMarkdownSchemaMcp.parse({ target_dir: '/tmp/in2' }).source_dir).toBe('/tmp/in2')

            const ext1 = ImportExternalSchema.parse({ path: '/tmp/ext', source: 'obsidian' })
            expect(ext1.source_dir).toBe('/tmp/ext')
            expect(ext1.source_format).toBe('obsidian')

            const ext2 = ImportExternalSchemaMcp.parse({ dir: '/tmp/ext2', source: 'notion' })
            expect(ext2.source_dir).toBe('/tmp/ext2')
            expect(ext2.source_format).toBe('notion')
        })

        it('should execute export_entries, export_markdown, import_markdown, and import_external end-to-end', async () => {
            const exportDir = path.join(tmpDir, 'exported-md')
            const externalDir = path.join(tmpDir, 'external-md')
            fs.mkdirSync(exportDir, { recursive: true })
            fs.mkdirSync(externalDir, { recursive: true })

            db.createEntry({
                content: 'First entry for IO export test',
                entryType: 'technical_achievement',
                tags: ['io-tag'],
                workspaceId: 'default',
            })
            db.createEntry({
                content: 'Second entry for IO export test',
                entryType: 'bug_fix',
                tags: ['other-tag'],
                workspaceId: 'default',
            })

            const ioTools = getIoTools({
                db,
                config: { allowedIoRoots: [tmpDir] },
            })
            const findTool = (name: string) => ioTools.find((t) => t.name === name)!

            // 1. export_entries (JSON with date range, tags, and entry_types filter, plus Markdown format)
            const exportEntriesTool = findTool('export_entries')
            const jsonByDate = (await exportEntriesTool.handler({
                format: 'json',
                start_date: '2020-01-01',
                end_date: '2030-12-31',
                entry_types: ['technical_achievement'],
            })) as { format: string; count: number }
            expect(jsonByDate.format).toBe('json')
            expect(jsonByDate.count).toBe(1)

            const mdByTag = (await exportEntriesTool.handler({
                type: 'markdown',
                tags: ['io-tag'],
            })) as { format: string; content: string; count: number }
            expect(mdByTag.format).toBe('markdown')
            expect(mdByTag.count).toBe(1)
            expect(mdByTag.content).toContain('First entry for IO export test')

            // 2. export_markdown (with filters and without filters)
            const exportMdTool = findTool('export_markdown')
            const expMdRes = (await exportMdTool.handler({
                output_dir: exportDir,
                tags: ['io-tag'],
                entry_types: ['technical_achievement'],
            })) as { success: boolean; exported_count: number; files: string[] }
            expect(expMdRes.success).toBe(true)
            expect(expMdRes.exported_count).toBe(1)
            expect(expMdRes.files.length).toBe(1)

            const expMdByDate = (await exportMdTool.handler({
                output_dir: exportDir,
                start_date: '2020-01-01',
                end_date: '2030-12-31',
            })) as { success: boolean; exported_count: number }
            expect(expMdByDate.success).toBe(true)
            expect(expMdByDate.exported_count).toBe(2)

            // 3. import_markdown (dry_run and live import)
            const importMdTool = findTool('import_markdown')
            const impDry = (await importMdTool.handler({
                source_dir: exportDir,
                dry_run: true,
            })) as { success: boolean; dry_run: boolean }
            expect(impDry.success).toBe(true)
            expect(impDry.dry_run).toBe(true)

            const impLive = (await importMdTool.handler({
                source_dir: exportDir,
                dry_run: false,
            })) as { success: boolean; updated: number }
            expect(impLive.success).toBe(true)
            expect(impLive.updated).toBe(2)

            // 4. import_external (Obsidian format + empty file skipped)
            fs.writeFileSync(
                path.join(externalDir, 'note1.md'),
                `---\ntags:\n  - obsidian-note\n---\n# Obsidian Heading\nLinked to [[Second Note]].`,
                'utf-8'
            )
            fs.writeFileSync(path.join(externalDir, 'empty.md'), `   \n  `, 'utf-8')

            const importExtTool = findTool('import_external')
            const extRes = (await importExtTool.handler({
                source_dir: externalDir,
                source_format: 'obsidian',
                default_entry_type: 'development_note',
            })) as { success: boolean; created: number }
            expect(extRes.success).toBe(true)
            expect(extRes.created).toBe(1)
        })
    })
})
