import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'
import { TagsManager } from '../../src/database/sqlite-adapter/tags.js'

vi.mock('../../src/utils/logger.js', () => ({
    logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

function createTagsManager(): { conn: NativeConnectionManager; manager: TagsManager } {
    const conn = new NativeConnectionManager(':memory:')
    const db = new Database(':memory:')

    db.exec(`
        CREATE TABLE IF NOT EXISTS memory_journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT
        );
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            usage_count INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS entry_tags (
            entry_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY(entry_id, tag_id)
        );
    `)

    Object.assign(conn, { db, initialized: true })
    const manager = new TagsManager(conn)
    return { conn, manager }
}

describe('TagsManager', () => {
    let conn: NativeConnectionManager
    let manager: TagsManager

    beforeEach(() => {
        vi.clearAllMocks()
        const setup = createTagsManager()
        conn = setup.conn
        manager = setup.manager
    })

    afterEach(() => {
        conn.close()
    })

    it('should link tags to entry', () => {
        const db = conn.getNativeDb() as Database
        db.prepare('INSERT INTO memory_journal (id) VALUES (1)').run()

        manager.linkTagsToEntry(1, ['tag1', 'tag2'])

        const tags = manager.getTagsForEntry(1)
        expect(tags).toContain('tag1')
        expect(tags).toContain('tag2')
    })

    it('should ignore linking zero tags', () => {
        expect(() => manager.linkTagsToEntry(1, [])).not.toThrow()
    })

    it('should support batch retrieval', () => {
        const db = conn.getNativeDb() as Database
        db.prepare('INSERT INTO memory_journal (id) VALUES (1)').run()
        db.prepare('INSERT INTO memory_journal (id) VALUES (2)').run()

        manager.linkTagsToEntry(1, ['tag1'])
        manager.linkTagsToEntry(2, ['tag1', 'tag2'])

        const map = manager.batchGetTagsForEntries([1, 2])
        expect(map.get(1)).toContain('tag1')
        expect(map.get(2)).toContain('tag2')
    })

    it('should support empty array batch get', () => {
        const map = manager.batchGetTagsForEntries([])
        expect(map.size).toBe(0)
    })

    it('should list tags ordered by usage', () => {
        const db = conn.getNativeDb() as Database
        db.prepare('INSERT INTO memory_journal (id) VALUES (1)').run()
        manager.linkTagsToEntry(1, ['tag1', 'tag2'])

        const tags = manager.listTags()
        expect(tags.length).toBe(2)
        expect(tags[0]!.name).toBeDefined()
        expect(tags[0]!.usageCount).toBe(1)
    })

    it('should merge tags properly', () => {
        const db = conn.getNativeDb() as Database
        db.prepare('INSERT INTO memory_journal (id) VALUES (1)').run()
        manager.linkTagsToEntry(1, ['sourceTag'])

        const result = manager.mergeTags('sourceTag', 'targetTag')
        expect(result.entriesUpdated).toBe(1)
        expect(result.sourceDeleted).toBe(true)

        const tags = manager.getTagsForEntry(1)
        expect(tags).not.toContain('sourceTag')
        expect(tags).toContain('targetTag')
    })

    it('should merge tags when target already has it but ignore duplicates', () => {
        const db = conn.getNativeDb() as Database
        db.prepare('INSERT INTO memory_journal (id) VALUES (1)').run()
        db.prepare('INSERT INTO memory_journal (id) VALUES (2)').run()

        manager.linkTagsToEntry(1, ['sourceTag', 'targetTag'])
        manager.linkTagsToEntry(2, ['sourceTag'])

        const result = manager.mergeTags('sourceTag', 'targetTag')
        expect(result.entriesUpdated).toBe(1) // only entry 2 updated
        expect(manager.getTagsForEntry(1)).toContain('targetTag')
        expect(manager.getTagsForEntry(2)).toContain('targetTag')
    })

    it('should handle merge when target tag does not exist yet', () => {
        const db = conn.getNativeDb() as Database
        db.prepare('INSERT INTO memory_journal (id) VALUES (1)').run()
        manager.linkTagsToEntry(1, ['sourceTag'])

        manager.mergeTags('sourceTag', 'newTargetTag')
        expect(manager.getTagsForEntry(1)).toContain('newTargetTag')
    })

    it('should throw on merging a non-existent tag', () => {
        expect(() => manager.mergeTags('ghostTag', 'targetTag')).toThrow(/not found/i)
    })
})
