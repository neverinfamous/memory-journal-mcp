import { describe, it, expect } from 'vitest'
import {
    coerceNumber,
    coerceBoolean,
    coerceLimit,
    buildLimitClause,
} from '../../src/utils/query-helpers.js'

describe('query-helpers', () => {
    describe('coerceNumber', () => {
        it('returns number for numbers', () => {
            expect(coerceNumber(42)).toBe(42)
        })
        it('returns number for numeric strings', () => {
            expect(coerceNumber('42')).toBe(42)
        })
        it('returns undefined for invalid strings', () => {
            expect(coerceNumber('foo')).toBeUndefined()
        })
        it('returns undefined for objects', () => {
            expect(coerceNumber({})).toBeUndefined()
            expect(coerceNumber(null)).toBeUndefined()
        })
    })

    describe('coerceBoolean', () => {
        it('returns boolean for booleans', () => {
            expect(coerceBoolean(true)).toBe(true)
            expect(coerceBoolean(false)).toBe(false)
        })
        it('returns boolean for string "true"/"false"', () => {
            expect(coerceBoolean('true')).toBe(true)
            expect(coerceBoolean('false')).toBe(false)
        })
        it('returns undefined for other strings', () => {
            expect(coerceBoolean('foo')).toBeUndefined()
            expect(coerceBoolean('')).toBeUndefined()
        })
        it('returns undefined for numbers or objects', () => {
            expect(coerceBoolean(1)).toBeUndefined()
            expect(coerceBoolean({})).toBeUndefined()
            expect(coerceBoolean(null)).toBeUndefined()
        })
    })

    describe('coerceLimit', () => {
        it('returns default limit for undefined/null', () => {
            expect(coerceLimit(undefined)).toBe(100)
            expect(coerceLimit(null)).toBe(100)
        })
        it('returns default limit for NaN', () => {
            expect(coerceLimit('foo')).toBe(100)
            expect(coerceLimit(NaN)).toBe(100)
        })
        it('returns default limit for negative numbers', () => {
            expect(coerceLimit(-5)).toBe(100)
        })
        it('returns null for 0', () => {
            expect(coerceLimit(0)).toBeNull()
            expect(coerceLimit('0')).toBeNull()
        })
        it('returns the number for positive numbers', () => {
            expect(coerceLimit(50)).toBe(50)
            expect(coerceLimit('50')).toBe(50)
        })
        it('respects custom default limit', () => {
            expect(coerceLimit(undefined, 20)).toBe(20)
            expect(coerceLimit(-5, 20)).toBe(20)
        })
    })

    describe('buildLimitClause', () => {
        it('returns empty string for null', () => {
            expect(buildLimitClause(null)).toBe('')
        })
        it('returns LIMIT string for numbers', () => {
            expect(buildLimitClause(50)).toBe(' LIMIT 50')
        })
    })
})
