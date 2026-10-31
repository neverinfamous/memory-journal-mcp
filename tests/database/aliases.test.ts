import { describe, it, expect, beforeEach } from 'vitest'
import { NativeConnectionManager } from '../../src/database/sqlite-adapter/native-connection.js'
import { AliasManager } from '../../src/database/sqlite-adapter/aliases.js'
import { AUTHOR_ALIASES_SQL } from '../../src/database/core/schema.js'
import { QueryError } from '../../src/types/errors.js'

describe('AliasManager', () => {
    let connection: NativeConnectionManager
    let aliasMgr: AliasManager

    beforeEach(async () => {
        connection = new NativeConnectionManager(':memory:')
        await connection.initialize()
        const statements = AUTHOR_ALIASES_SQL.split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0)
        for (const stmt of statements) {
            connection.run(stmt)
        }
        aliasMgr = new AliasManager(connection)
    })

    it('adds and resolves an alias', () => {
        const alias = aliasMgr.addAlias('chris', 'christopher', 'admin')
        expect(alias.alias).toBe('chris')
        expect(alias.canonicalAuthor).toBe('christopher')

        const resolved = aliasMgr.resolveAuthor('chris')
        expect(resolved).toBe('christopher')
    })

    it('resolves case-insensitively', () => {
        aliasMgr.addAlias('Chris', 'christopher')
        expect(aliasMgr.resolveAuthor('chris')).toBe('christopher')
        expect(aliasMgr.resolveAuthor('CHRIS')).toBe('christopher')
    })

    it('returns raw author if no alias exists', () => {
        expect(aliasMgr.resolveAuthor('unknown')).toBe('unknown')
    })

    it('prevents self-aliasing', () => {
        expect(() => {
            aliasMgr.addAlias('christopher', 'christopher')
        }).toThrow(QueryError)
        expect(() => {
            aliasMgr.addAlias('christopher', 'Christopher')
        }).toThrow(QueryError)
    })

    it('prevents duplicate aliases', () => {
        aliasMgr.addAlias('chris', 'christopher')
        expect(() => {
            aliasMgr.addAlias('chris', 'other')
        }).toThrow(/already exists/)
    })

    it('allows multiple aliases to same canonical', () => {
        aliasMgr.addAlias('chris', 'christopher')
        aliasMgr.addAlias('neverinfamous', 'christopher')
        
        expect(aliasMgr.resolveAuthor('chris')).toBe('christopher')
        expect(aliasMgr.resolveAuthor('neverinfamous')).toBe('christopher')
    })

    it('removes an alias', () => {
        aliasMgr.addAlias('chris', 'christopher')
        expect(aliasMgr.resolveAuthor('chris')).toBe('christopher')
        
        const removed = aliasMgr.removeAlias('chris')
        expect(removed).toBe(true)
        expect(aliasMgr.resolveAuthor('chris')).toBe('chris')
    })

    it('returns false when removing non-existent alias', () => {
        expect(aliasMgr.removeAlias('unknown')).toBe(false)
    })

    it('lists aliases with and without filter', () => {
        aliasMgr.addAlias('chris', 'christopher')
        aliasMgr.addAlias('neverinfamous', 'christopher')
        aliasMgr.addAlias('bob', 'robert')

        const all = aliasMgr.listAliases()
        expect(all).toHaveLength(3)

        const filtered = aliasMgr.listAliases('christopher')
        expect(filtered).toHaveLength(2)
        expect(filtered.map(a => a.alias).sort()).toEqual(['chris', 'neverinfamous'])
    })

    it('resolves batch of authors', () => {
        aliasMgr.addAlias('chris', 'christopher')
        aliasMgr.addAlias('bob', 'robert')

        const batch = aliasMgr.resolveAuthors(['chris', 'bob', 'unknown'])
        expect(batch.get('chris')).toBe('christopher')
        expect(batch.get('bob')).toBe('robert')
        expect(batch.get('unknown')).toBe('unknown')
    })
})
