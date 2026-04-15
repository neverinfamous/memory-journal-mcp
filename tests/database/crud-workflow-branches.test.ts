/**
 * memory-journal-mcp — CRUD + Workflow Prompt Branch Coverage
 *
 * Targets uncovered branches in:
 * - crud.ts (80.24%): timestamp normalization, update all field types, GitHub extensions loop, permanent delete
 * - workflow.ts (79.41%): prepare-standup, prepare-retro, weekly-digest, analyze-period, get-context-bundle
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('../../src/utils/logger.js', () => ({
    logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
    createEntry,
    getEntryById,
    getEntriesByIds,
    getEntryByIdIncludeDeleted,
    getActiveEntryCount,
    updateEntry,
    deleteEntry,
} from '../../src/database/sqlite-adapter/entries/crud.js'
import { TagsManager } from '../../src/database/sqlite-adapter/tags.js'
import { getWorkflowPromptDefinitions } from '../../src/handlers/prompts/workflow.js'
import type { IDatabaseAdapter } from '../../src/database/core/interfaces.js'
import type { JournalEntry } from '../../src/types/index.js'

// ============================================================================
// In-memory DB helper
// ============================================================================

function createTestDb() {
    const db = new Database(':memory:')
    db.exec(`
        CREATE TABLE memory_journal (
            id INTEGER PRIMARY KEY,
            content TEXT NOT NULL,
            entry_type TEXT DEFAULT 'personal_reflection',
            timestamp TEXT NOT NULL,
            is_personal INTEGER DEFAULT 1,
            deleted_at TEXT DEFAULT NULL,
            project_number INTEGER DEFAULT NULL,
            issue_number INTEGER DEFAULT NULL,
            pr_number INTEGER DEFAULT NULL,
            issue_url TEXT DEFAULT NULL,
            pr_url TEXT DEFAULT NULL,
            pr_status TEXT DEFAULT NULL,
            project_owner TEXT DEFAULT NULL,
            workflow_run_id INTEGER DEFAULT NULL,
            workflow_name TEXT DEFAULT NULL,
            workflow_status TEXT DEFAULT NULL,
            significance_type TEXT DEFAULT NULL,
            auto_context TEXT DEFAULT NULL,
            share_with_team INTEGER DEFAULT 0
        );
        CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, usage_count INTEGER DEFAULT 0);
        CREATE TABLE entry_tags (entry_id INTEGER, tag_id INTEGER);
        CREATE TABLE relationships (
            id INTEGER PRIMARY KEY,
            from_entry_id INTEGER,
            to_entry_id INTEGER,
            relationship_type TEXT,
            description TEXT DEFAULT NULL
        );
        CREATE VIRTUAL TABLE fts_content USING fts5(content, content_rowid='rowid');
        CREATE TRIGGER trg_fts_insert AFTER INSERT ON memory_journal BEGIN
            INSERT INTO fts_content(rowid, content) VALUES (NEW.id, NEW.content);
        END;
    `)
    return db
}

/** Creates a mock NativeConnectionManager for TagsManager */
function makeCtx(db: InstanceType<typeof Database>) {
    return { getRawDb: () => db } as ConstructorParameters<typeof TagsManager>[0]
}

function createContext(db: InstanceType<typeof Database>) {
    const tagsMgr = new TagsManager(makeCtx(db))
    return { db, tagsMgr }
}

// ============================================================================
// CRUD Branch Coverage
// ============================================================================

describe('CRUD — branch coverage', () => {
    let db: InstanceType<typeof Database>
    let context: ReturnType<typeof createContext>

    beforeEach(() => {
        db = createTestDb()
        context = createContext(db)
    })

    describe('createEntry', () => {
        it('should normalize timestamp without T', () => {
            const entry = createEntry(context, {
                content: 'test',
                timestamp: '2025-01-15',
            })
            expect(entry.timestamp).toContain('T')
        })

        it('should auto-generate timestamp when not provided', () => {
            const entry = createEntry(context, { content: 'auto ts' })
            expect(entry.timestamp).toBeTruthy()
        })

        it('should link tags when provided', () => {
            const entry = createEntry(context, {
                content: 'tagged',
                tags: ['tag-a', 'tag-b'],
            })
            expect(entry.tags.length).toBe(2)
        })

        it('should create entry with all GitHub extension fields', () => {
            const entry = createEntry(context, {
                content: 'github entry',
                projectNumber: 1,
                projectOwner: 'owner',
                issueNumber: 42,
                issueUrl: 'https://github.com/issue',
                prNumber: 10,
                prUrl: 'https://github.com/pr',
                prStatus: 'open',
                workflowRunId: 100,
                workflowName: 'CI',
                workflowStatus: 'success',
                significanceType: 'decision',
                autoContext: '1.0',
                isPersonal: false,
                entryType: 'decision',
            })
            expect(entry.entryType).toBe('decision')
            expect(entry.isPersonal).toBe(false)
        })
    })

    describe('getEntryById', () => {
        it('should return null for non-existent', () => {
            expect(getEntryById(context, 999)).toBeNull()
        })

        it('should return entry for existing', () => {
            const created = createEntry(context, { content: 'hello' })
            const found = getEntryById(context, created.id)
            expect(found!.content).toBe('hello')
        })
    })

    describe('getEntriesByIds', () => {
        it('should return empty map for empty ids', () => {
            expect(getEntriesByIds(context, []).size).toBe(0)
        })

        it('should return entries for valid ids', () => {
            const e1 = createEntry(context, { content: 'one' })
            const e2 = createEntry(context, { content: 'two' })
            const result = getEntriesByIds(context, [e1.id, e2.id])
            expect(result.size).toBe(2)
        })

        it('should return empty for non-existent ids', () => {
            expect(getEntriesByIds(context, [999, 1000]).size).toBe(0)
        })
    })

    describe('getEntryByIdIncludeDeleted', () => {
        it('should return deleted entries', () => {
            const entry = createEntry(context, { content: 'to delete' })
            deleteEntry(context, entry.id)
            const found = getEntryByIdIncludeDeleted(context, entry.id)
            expect(found).not.toBeNull()
        })

        it('should return null for non-existent', () => {
            expect(getEntryByIdIncludeDeleted(context, 999)).toBeNull()
        })
    })

    describe('getActiveEntryCount', () => {
        it('should count only non-deleted', () => {
            createEntry(context, { content: '1' })
            const e2 = createEntry(context, { content: '2' })
            deleteEntry(context, e2.id)
            expect(getActiveEntryCount(context)).toBe(1)
        })
    })

    describe('updateEntry', () => {
        it('should return null for non-existent entry', () => {
            expect(updateEntry(context, 999, { content: 'new' })).toBeNull()
        })

        it('should update content', () => {
            const entry = createEntry(context, { content: 'old' })
            const updated = updateEntry(context, entry.id, { content: 'new' })
            expect(updated!.content).toBe('new')
        })

        it('should update entryType', () => {
            const entry = createEntry(context, { content: 'test' })
            const updated = updateEntry(context, entry.id, { entryType: 'decision' })
            expect(updated!.entryType).toBe('decision')
        })

        it('should update isPersonal', () => {
            const entry = createEntry(context, { content: 'test', isPersonal: true })
            const updated = updateEntry(context, entry.id, { isPersonal: false })
            expect(updated!.isPersonal).toBe(false)
        })

        it('should update significanceType', () => {
            const entry = createEntry(context, { content: 'test' })
            const updated = updateEntry(context, entry.id, { significanceType: 'milestone' })
            expect(updated).not.toBeNull()
        })

        it('should update autoContext', () => {
            const entry = createEntry(context, { content: 'test' })
            const updated = updateEntry(context, entry.id, { autoContext: '1.0' })
            expect(updated).not.toBeNull()
        })

        it('should update GitHub extension fields (projectNumber, issueNumber, etc.)', () => {
            const entry = createEntry(context, { content: 'test' })
            const updated = updateEntry(context, entry.id, {
                projectNumber: 42,
                projectOwner: 'org',
                issueNumber: 10,
                issueUrl: 'https://issue',
                prNumber: 5,
                prUrl: 'https://pr',
                prStatus: 'merged',
                workflowRunId: 100,
                workflowName: 'Deploy',
                workflowStatus: 'completed',
            })
            expect(updated).not.toBeNull()
        })

        it('should update tags', () => {
            const entry = createEntry(context, { content: 'test', tags: ['old-tag'] })
            const updated = updateEntry(context, entry.id, { tags: ['new-tag-1', 'new-tag-2'] })
            expect(updated!.tags.length).toBe(2)
        })

        it('should handle update with no changes (empty update)', () => {
            const entry = createEntry(context, { content: 'test' })
            const updated = updateEntry(context, entry.id, {})
            expect(updated).not.toBeNull()
            expect(updated!.content).toBe('test')
        })
    })

    describe('deleteEntry', () => {
        it('should soft-delete by default', () => {
            const entry = createEntry(context, { content: 'soft' })
            const result = deleteEntry(context, entry.id)
            expect(result).toBe(true)
            expect(getEntryByIdIncludeDeleted(context, entry.id)).not.toBeNull()
            expect(getEntryById(context, entry.id)).toBeNull()
        })

        it('should hard-delete when permanent=true', () => {
            const entry = createEntry(context, { content: 'hard' })
            const result = deleteEntry(context, entry.id, true)
            expect(result).toBe(true)
            expect(getEntryByIdIncludeDeleted(context, entry.id)).toBeNull()
        })

        it('should return false for non-existent soft delete', () => {
            expect(deleteEntry(context, 999)).toBe(false)
        })

        it('should return false for non-existent hard delete', () => {
            expect(deleteEntry(context, 999, true)).toBe(false)
        })
    })
})

// ============================================================================
// Workflow Prompts Branch Coverage (assertions based on actual output text)
// ============================================================================

describe('Workflow prompts — branch coverage', () => {
    function mockEntry(overrides?: Partial<JournalEntry>): JournalEntry {
        return {
            id: 1,
            content: 'test content',
            entryType: 'personal_reflection',
            timestamp: '2025-01-15T10:00:00Z',
            isPersonal: true,
            tags: ['test'],
            ...overrides,
        } as JournalEntry
    }

    function createMockDb(entries: JournalEntry[] = []): IDatabaseAdapter {
        return {
            searchByDateRange: vi.fn().mockReturnValue(entries),
            getStatistics: vi.fn().mockReturnValue({
                totalEntries: entries.length,
                entriesByType: {},
                entriesByPeriod: [],
                decisionDensity: [],
                relationshipComplexity: { totalRelationships: 0, avgPerEntry: 0 },
                activityTrend: { currentPeriod: '', previousPeriod: '', growthPercent: null },
                causalMetrics: {},
            }),
            searchEntries: vi.fn().mockReturnValue(entries),
            getRecentEntries: vi.fn().mockReturnValue(entries),
            getSignificantEntries: vi.fn().mockReturnValue(
                entries.map((e) => ({
                    id: e.id,
                    content: e.content,
                    entryType: e.entryType,
                    timestamp: e.timestamp,
                    significanceType: 'decision',
                }))
            ),
        } as unknown as IDatabaseAdapter
    }

    it('should generate prepare-standup prompt', () => {
        const prompts = getWorkflowPromptDefinitions()
        const standup = prompts.find((p) => p.name === 'prepare-standup')!
        const db = createMockDb([mockEntry({ content: 'worked on auth' })])
        const result = standup.handler({}, db)
        expect(result.messages[0]!.content.text).toContain('standup')
    })

    it('should generate prepare-retro prompt with default 14 days', () => {
        const prompts = getWorkflowPromptDefinitions()
        const retro = prompts.find((p) => p.name === 'prepare-retro')!
        const db = createMockDb([mockEntry()])
        const result = retro.handler({}, db)
        expect(result.messages[0]!.content.text).toContain('14 days')
    })

    it('should generate prepare-retro prompt with custom days', () => {
        const prompts = getWorkflowPromptDefinitions()
        const retro = prompts.find((p) => p.name === 'prepare-retro')!
        const db = createMockDb()
        const result = retro.handler({ days: '7' }, db)
        expect(result.messages[0]!.content.text).toContain('7 days')
    })

    it('should generate weekly-digest prompt', () => {
        const prompts = getWorkflowPromptDefinitions()
        const digest = prompts.find((p) => p.name === 'weekly-digest')!
        const db = createMockDb([mockEntry()])
        const result = digest.handler({}, db)
        expect(result.messages[0]!.content.text).toContain('weekly')
    })

    it('should generate analyze-period prompt with dates', () => {
        const prompts = getWorkflowPromptDefinitions()
        const analyze = prompts.find((p) => p.name === 'analyze-period')!
        const db = createMockDb()
        // Uses start_date and end_date arg names
        const result = analyze.handler({ start_date: '2025-01-01', end_date: '2025-02-01' }, db)
        expect(result.messages[0]!.content.text).toContain('2025-01-01')
        expect(result.messages[0]!.content.text).toContain('2025-02-01')
    })

    it('should generate analyze-period prompt without dates', () => {
        const prompts = getWorkflowPromptDefinitions()
        const analyze = prompts.find((p) => p.name === 'analyze-period')!
        const db = createMockDb()
        const result = analyze.handler({}, db)
        expect(result.messages[0]!.content.text).toContain('Analyze')
    })

    it('should generate goal-tracker prompt', () => {
        const prompts = getWorkflowPromptDefinitions()
        const goal = prompts.find((p) => p.name === 'goal-tracker')!
        const db = createMockDb([mockEntry({ content: 'goal: ship v2' })])
        const result = goal.handler({}, db)
        expect(result.messages[0]!.content.text).toContain('progress')
    })

    it('should generate get-context-bundle prompt', () => {
        const prompts = getWorkflowPromptDefinitions()
        const bundle = prompts.find((p) => p.name === 'get-context-bundle')!
        const db = createMockDb()
        const result = bundle.handler({}, db)
        expect(result.messages[0]!.content.text).toContain('Project context bundle')
    })

    it('should generate get-recent-entries prompt', () => {
        const prompts = getWorkflowPromptDefinitions()
        const recent = prompts.find((p) => p.name === 'get-recent-entries')!
        const db = createMockDb([mockEntry()])
        const result = recent.handler({}, db)
        expect(result.messages[0]!.content.text).toContain('entries')
    })

    it('should generate confirm-briefing prompt', () => {
        const prompts = getWorkflowPromptDefinitions()
        const confirm = prompts.find((p) => p.name === 'confirm-briefing')!
        const db = createMockDb([mockEntry()])
        const result = confirm.handler({}, db)
        expect(result.messages.length).toBeGreaterThan(0)
    })

    it('should generate session-summary prompt', () => {
        const prompts = getWorkflowPromptDefinitions()
        const summary = prompts.find((p) => p.name === 'session-summary')!
        const db = createMockDb([mockEntry({ content: 'debug session' })])
        const result = summary.handler({}, db)
        expect(result.messages[0]!.content.text).toContain('session summary')
    })
})
