import { describe, it, expect, beforeEach } from 'vitest'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'
import { AliasManager } from '../../src/database/sqlite-adapter/aliases.js'
import { QueryError } from '../../src/types/errors.js'

describe('AliasManager', () => {
    let connection: NativeConnectionManager
    let aliasMgr: AliasManager

    beforeEach(async () => {
        connection = new NativeConnectionManager(':memory:')
        await connection.initialize()
        connection.applyTeamSchema()
        aliasMgr = new AliasManager(connection)
    })

    it('adds and resolves an alias', () => {
        const alias = aliasMgr.addAlias('alex', 'alexander', 'admin')
        expect(alias.alias).toBe('alex')
        expect(alias.canonicalAuthor).toBe('alexander')

        const resolved = aliasMgr.resolveAuthor('alex')
        expect(resolved).toBe('alexander')
    })

    it('resolves case-insensitively', () => {
        aliasMgr.addAlias('Alex', 'alexander')
        expect(aliasMgr.resolveAuthor('alex')).toBe('alexander')
        expect(aliasMgr.resolveAuthor('ALEX')).toBe('alexander')
    })

    it('returns raw author if no alias exists', () => {
        expect(aliasMgr.resolveAuthor('unknown')).toBe('unknown')
    })

    it('prevents self-aliasing', () => {
        expect(() => {
            aliasMgr.addAlias('alexander', 'alexander')
        }).toThrow(QueryError)
        expect(() => {
            aliasMgr.addAlias('alexander', 'Alexander')
        }).toThrow(QueryError)
    })

    it('prevents duplicate aliases', () => {
        aliasMgr.addAlias('alex', 'alexander')
        expect(() => {
            aliasMgr.addAlias('alex', 'other')
        }).toThrow(/already exists/)
    })

    it('allows multiple aliases to same canonical', () => {
        aliasMgr.addAlias('alex', 'alexander')
        aliasMgr.addAlias('alex-gh', 'alexander')

        expect(aliasMgr.resolveAuthor('alex')).toBe('alexander')
        expect(aliasMgr.resolveAuthor('alex-gh')).toBe('alexander')
    })

    it('removes an alias', () => {
        aliasMgr.addAlias('alex', 'alexander')
        expect(aliasMgr.resolveAuthor('alex')).toBe('alexander')

        const removed = aliasMgr.removeAlias('alex')
        expect(removed).toBe(true)
        expect(aliasMgr.resolveAuthor('alex')).toBe('alex')
    })

    it('returns false when removing non-existent alias', () => {
        expect(aliasMgr.removeAlias('unknown')).toBe(false)
    })

    it('lists aliases with and without filter', () => {
        aliasMgr.addAlias('alex', 'alexander')
        aliasMgr.addAlias('alex-gh', 'alexander')
        aliasMgr.addAlias('bob', 'robert')

        const all = aliasMgr.listAliases()
        expect(all).toHaveLength(3)

        const filtered = aliasMgr.listAliases('alexander')
        expect(filtered).toHaveLength(2)
        expect(filtered.map(a => a.alias).sort()).toEqual(['alex', 'alex-gh'])
    })

    it('consolidates authors only in the requested workspace', () => {
        aliasMgr.addAlias('alex', 'alexander', undefined, 'alpha')
        connection.run(
            `INSERT INTO memory_journal (entry_type, content, author, workspace_id) VALUES ('note', 'alpha', 'alex', 'alpha')`
        )
        connection.run(
            `INSERT INTO memory_journal (entry_type, content, author, workspace_id) VALUES ('note', 'beta', 'alex', 'beta')`
        )

        const updated = aliasMgr.consolidateAuthors('alexander', 'alpha')
        expect(updated).toBe(1)

        const rows = connection.exec(
            `SELECT workspace_id, author FROM memory_journal ORDER BY workspace_id`
        )
        const values = rows[0]?.values ?? []
        expect(values).toEqual([
            ['alpha', 'alexander'],
            ['beta', 'alex'],
        ])
    })

    it('resolves batch of authors', () => {
        aliasMgr.addAlias('alex', 'alexander')
        aliasMgr.addAlias('bob', 'robert')

        const batch = aliasMgr.resolveAuthors(['alex', 'bob', 'unknown'])
        expect(batch.get('alex')).toBe('alexander')
        expect(batch.get('bob')).toBe('robert')
        expect(batch.get('unknown')).toBe('unknown')
    })
})
