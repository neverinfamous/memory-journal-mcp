import { describe, it, expect } from 'vitest'
import { sanitizeFtsQuery } from '../../src/database/sqlite-adapter/entries/search.js'

describe('sanitizeFtsQuery', () => {
    it('preserves balanced double quotes for exact phrases', () => {
        expect(sanitizeFtsQuery('"error handling"')).toBe('"error handling"')
        expect(sanitizeFtsQuery('find "exact phrase" here')).toBe('"exact phrase" find here')
        expect(sanitizeFtsQuery('"first phrase" and "second phrase"')).toBe('"first phrase" "second phrase"')
    })

    it('sanitizes inside phrases but preserves the quotes', () => {
        expect(sanitizeFtsQuery('"error (handling)"')).toBe('"error handling"')
        expect(sanitizeFtsQuery('"word-with-hyphen"')).toBe('"word-with-hyphen"')
        expect(sanitizeFtsQuery('"some_underscore"')).toBe('"some_underscore"')
        expect(sanitizeFtsQuery('"DROP TABLE users;"')).toBe('"DROP TABLE users"')
    })

    it('strips unbalanced quotes', () => {
        expect(sanitizeFtsQuery('"error handling')).toBe('error handling')
        expect(sanitizeFtsQuery('error" handling')).toBe('error handling')
        expect(sanitizeFtsQuery('here is "one quote')).toBe('here is one quote')
    })

    it('removes special characters outside phrases', () => {
        expect(sanitizeFtsQuery('hello (world)')).toBe('hello world')
        expect(sanitizeFtsQuery('DROP TABLE users;')).toBe('DROP TABLE users')
        expect(sanitizeFtsQuery('word-with-hyphen some_underscore')).toBe('word-with-hyphen some_underscore')
    })

    it('preserves asterisk at the end of tokens', () => {
        expect(sanitizeFtsQuery('prefix*')).toBe('prefix*')
        expect(sanitizeFtsQuery('prefix* AND something')).toBe('prefix* AND something')
        // Drops internal or standalone asterisks
        expect(sanitizeFtsQuery('*')).toBe('')
        expect(sanitizeFtsQuery('pre*fix')).toBe('prefix')
    })

    it('drops NEAR operator to prevent ReDoS', () => {
        expect(sanitizeFtsQuery('NEAR')).toBe('')
        expect(sanitizeFtsQuery('word NEAR other')).toBe('word other')
        expect(sanitizeFtsQuery('NEAR/5')).toBe('') // NEAR is dropped, / is stripped, 5 remains attached to NEAR and is dropped
    })

    it('validates boolean operators (AND, OR, NOT)', () => {
        // Uppercases them
        expect(sanitizeFtsQuery('word and other')).toBe('word AND other')
        
        // Cannot start with operator
        expect(sanitizeFtsQuery('AND word')).toBe('word')
        
        // Cannot have adjacent operators
        expect(sanitizeFtsQuery('word AND OR NOT other')).toBe('word AND other')
        
        // Cannot end with operator (must have valid next token)
        expect(sanitizeFtsQuery('word AND')).toBe('word')
    })

    it('handles empty or purely special character input', () => {
        expect(sanitizeFtsQuery('')).toBe('')
        expect(sanitizeFtsQuery('   ')).toBe('')
        expect(sanitizeFtsQuery('();')).toBe('')
        expect(sanitizeFtsQuery('""')).toBe('')
    })
})
