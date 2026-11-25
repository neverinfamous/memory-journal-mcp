import { describe, it, expect } from 'vitest'
import {
    isMissingTableError,
    isMissingColumnError,
} from '../../src/database/sqlite-adapter/schema-errors.js'
import { workspaceSnapshotType } from '../../src/database/sqlite-adapter/entries/digest.js'

describe('db-remediation: schema-errors', () => {
    it('detects missing table / column errors', () => {
        expect(isMissingTableError(new Error('SqliteError: no such table: foo'))).toBe(true)
        expect(isMissingTableError(new Error('boom'))).toBe(false)
        expect(isMissingTableError('no such table')).toBe(false)
        expect(isMissingColumnError(new Error('no such column: x'))).toBe(true)
        expect(isMissingColumnError(new Error('no such table: x'))).toBe(false)
    })
})

describe('db-remediation: workspaceSnapshotType', () => {
    it('keeps the legacy key for an omitted workspace and namespaces default, wildcard, and other workspaces', () => {
        expect(workspaceSnapshotType('digest')).toBe('digest')
        expect(workspaceSnapshotType('digest', 'default')).toBe('digest:default')
        expect(workspaceSnapshotType('digest', '*')).toBe('digest:*')
    })
    it('namespaces other workspaces', () => {
        expect(workspaceSnapshotType('digest', 'proj-a')).toBe('digest:proj-a')
    })
})
