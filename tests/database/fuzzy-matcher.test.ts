import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/index.js'
import {
    levenshteinDistance,
    buildVocabulary,
    findFuzzyMatches,
    expandFuzzyQuery,
} from '../../src/database/sqlite-adapter/entries/fuzzy-matcher.js'

describe('Fuzzy Matcher Utilities', () => {
    describe('levenshteinDistance', () => {
        it('calculates correct distances', () => {
            expect(levenshteinDistance('', '')).toBe(0)
            expect(levenshteinDistance('a', '')).toBe(1)
            expect(levenshteinDistance('', 'a')).toBe(1)
            expect(levenshteinDistance('abc', 'abc')).toBe(0)
            expect(levenshteinDistance('kitten', 'sitting')).toBe(3)
            expect(levenshteinDistance('flaw', 'lawn')).toBe(2)
        })

        it('is case insensitive', () => {
            expect(levenshteinDistance('Kitten', 'sitting')).toBe(3)
            expect(levenshteinDistance('ABC', 'abc')).toBe(0)
        })
    })

    describe('findFuzzyMatches', () => {
        const vocab = ['typescript', 'javascript', 'react', 'python', 'architecture', 'design']

        it('does not return exact matches (distance 0)', () => {
            const matches = findFuzzyMatches('react', vocab)
            expect(matches).toEqual([])
        })

        it('finds close matches (distance <= 2)', () => {
            const matches = findFuzzyMatches('typscript', vocab)
            expect(matches).toEqual([{ match: 'typescript', distance: 1 }])
        })

        it('respects maxDistance parameter', () => {
            // "pithon" is distance 1 from "python" (i->y)
            // "pytthon" is distance 1
            // "pithoon" is distance 2
            expect(findFuzzyMatches('pithoon', vocab, 1)).toEqual([])
            expect(findFuzzyMatches('pithoon', vocab, 2)).toEqual([{ match: 'python', distance: 2 }])
        })

        it('returns empty array when no matches found', () => {
            expect(findFuzzyMatches('ruby', vocab)).toEqual([])
        })
    })

    describe('expandFuzzyQuery', () => {
        const vocab = ['typescript', 'react', 'database']

        it('returns original query if all terms are in vocab', () => {
            const res = expandFuzzyQuery('typescript react', vocab, false)
            expect(res.expanded).toBe('typescript react')
            expect(res.suggestions).toEqual([])
            expect(res.corrected).toBe(false)
        })

        it('identifies unknown terms and suggests corrections', () => {
            const res = expandFuzzyQuery('typscript react', vocab, false)
            // It suggests "typescript" for "typscript"
            expect(res.suggestions).toEqual(['typescript'])
            // Since autoCorrect is false, expanded is unchanged
            expect(res.expanded).toBe('typscript react')
            expect(res.corrected).toBe(false)
        })

        it('auto-corrects if autoCorrect is true and distance is 1', () => {
            const res = expandFuzzyQuery('typscript', vocab, true)
            // When auto-corrected, it does not populate suggestions for that term
            expect(res.suggestions).toEqual([])
            expect(res.expanded).toBe('typescript')
            expect(res.corrected).toBe(true)
        })

        it('does not auto-correct if distance > 1 even if autoCorrect is true', () => {
            const res = expandFuzzyQuery('tpscript', vocab, true) // distance is 2
            expect(res.suggestions).toEqual(['typescript'])
            expect(res.expanded).toBe('tpscript')
            expect(res.corrected).toBe(false)
        })

        it('ignores short terms for fuzzy matching', () => {
            const res = expandFuzzyQuery('typscript a b cd', vocab, false)
            // 'a', 'b', 'cd' are length <=3, skipped
            expect(res.suggestions).toEqual(['typescript'])
        })
        
        it('ignores terms with FTS5 special characters', () => {
            const res = expandFuzzyQuery('typscript* "react"', vocab, false)
            // 'typscript*' contains a special char so it is ignored
            expect(res.suggestions).toEqual([])
        })
    })

    describe('Integration with DatabaseAdapter', () => {
        let db: DatabaseAdapter

        beforeEach(async () => {
            db = new DatabaseAdapter(':memory:')
            await db.initialize()

            // Seed db with tags and entries to populate the vocabulary
            db.createEntry({
                content: 'Working with typescript and react',
                entryType: 'development_note',
                tags: ['typescript', 'frontend', 'react'],
                projectNumber: 1,
            })
            db.createEntry({
                content: 'Optimizing the postgresql database queries',
                entryType: 'development_note',
                tags: ['database', 'postgresql', 'backend'],
                projectNumber: 1,
            })
        })

        afterEach(() => {
            db.close()
        })

        it('builds vocabulary from tags and entry types', () => {
            const vocab = buildVocabulary((db as any).connection.getNativeDb())
            
            // Should include tags
            expect(vocab.includes('typescript')).toBe(true)
            expect(vocab.includes('frontend')).toBe(true)
            expect(vocab.includes('react')).toBe(true)
            expect(vocab.includes('database')).toBe(true)
            expect(vocab.includes('postgresql')).toBe(true)
            expect(vocab.includes('backend')).toBe(true)

            // Should include entry types
            expect(vocab.includes('development_note')).toBe(true)
        })

        it('returns suggestions via searchEntries', () => {
            // "postgrsql" is missing 'e' -> distance 1 from postgresql
            const res = db.searchEntries('postgrsql', { fuzzy_match: true })
            expect(res.entries.length).toBe(0)
            expect(res.suggestions).toEqual(['postgresql'])
        })

        it('auto-corrects via searchEntries when auto_correct=true', () => {
            // "postgrsql" (dist 1) -> should auto-correct to postgresql
            const res = db.searchEntries('postgrsql', { fuzzy_match: true, auto_correct: true })
            expect(res.entries.length).toBe(1)
            expect(res.correctedQuery).toBe('postgresql')
            expect(res.entries[0]?.content).toContain('postgresql')
        })
        
        it('does not auto-correct distance > 1', () => {
            // "postgsql" (dist 2 from postgresql) -> should not auto-correct
            const res = db.searchEntries('postgsql', { fuzzy_match: true, auto_correct: true })
            expect(res.entries.length).toBe(0)
            expect(res.suggestions).toEqual(['postgresql'])
            expect(res.correctedQuery).toBeUndefined()
        })
    })
})
