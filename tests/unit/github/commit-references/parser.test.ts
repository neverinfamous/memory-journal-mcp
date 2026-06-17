import { describe, it, expect } from 'vitest'
import { parseCommitReferences } from '../../../../src/github/commit-references/parser.js'

describe('parseCommitReferences', () => {
    it('parses basic issue references', () => {
        const refs = parseCommitReferences('fixes #123')
        expect(refs).toHaveLength(1)
        expect(refs[0]).toEqual({
            raw: 'fixes #123',
            number: 123,
            owner: undefined,
            repo: undefined,
            action: 'fixes',
        })
    })

    it('parses cross-repository references', () => {
        const refs = parseCommitReferences('closes owner/repo#456')
        expect(refs).toHaveLength(1)
        expect(refs[0]).toEqual({
            raw: 'closes owner/repo#456',
            number: 456,
            owner: 'owner',
            repo: 'repo',
            action: 'closes',
        })
    })

    it('parses GH- references', () => {
        const refs = parseCommitReferences('resolves GH-789')
        expect(refs).toHaveLength(1)
        expect(refs[0]).toEqual({
            raw: 'resolves GH-789',
            number: 789,
            owner: undefined,
            repo: undefined,
            action: 'resolves',
        })
    })

    it('parses multiple references in a commit', () => {
        const refs = parseCommitReferences('fixes #1, closes #2 and also #3')
        expect(refs).toHaveLength(3)
        expect(refs[0].number).toBe(1)
        expect(refs[0].action).toBe('fixes')
        expect(refs[1].number).toBe(2)
        expect(refs[1].action).toBe('closes')
        expect(refs[2].number).toBe(3)
        expect(refs[2].action).toBe('none')
    })

    it('deduplicates references', () => {
        const refs = parseCommitReferences('fixes #123 and also mentions #123')
        expect(refs).toHaveLength(1)
        expect(refs[0].number).toBe(123)
    })

    it('handles different casing and actions', () => {
        const refs = parseCommitReferences('Fixes #10, CLOSES #20, RESOLVES #30')
        expect(refs).toHaveLength(3)
        expect(refs[0].action).toBe('fixes')
        expect(refs[1].action).toBe('closes')
        expect(refs[2].action).toBe('resolves')
    })
})
