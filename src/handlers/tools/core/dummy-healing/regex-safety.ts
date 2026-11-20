/**
 * ReDoS safety validation for user-supplied regex patterns in directory search.
 */

export const MAX_USER_REGEX_LENGTH = 256
const MAX_UNBOUNDED_QUANTIFIERS = 5
const MAX_UNBOUNDED_WILDCARDS = 2
const NESTED_QUANTIFIER_REGEX = /(?:[+*?}]|\{\d+,?\d*\})\s*\)[+*?{]/
const BACKREFERENCE_REGEX = /\\[1-9]|\\k</
const REPEATED_WILDCARD_REGEX = /(?:\.\*|\.\+){2,}/

function isGroupQuantifierFollow(ch: string | undefined): boolean {
    return ch === '*' || ch === '+' || ch === '{' || ch === '?'
}

function hasUnsafeGroupNesting(pattern: string): boolean {
    const stack: { hasQuantOrAlt: boolean; justOpened: boolean }[] = []
    let escaped = false
    let inClass = false
    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i]
        if (ch === undefined) break
        if (escaped) {
            escaped = false
            const cur = stack.at(-1)
            if (cur !== undefined) cur.justOpened = false
            continue
        }
        if (ch === '\\') {
            escaped = true
            continue
        }
        if (inClass) {
            if (ch === ']') inClass = false
            continue
        }
        if (ch === '[') {
            inClass = true
            const cur = stack.at(-1)
            if (cur !== undefined) cur.justOpened = false
            continue
        }
        if (ch === '(') {
            stack.push({ hasQuantOrAlt: false, justOpened: true })
            continue
        }
        if (ch === ')') {
            const popped = stack.pop()
            if (popped?.hasQuantOrAlt === true && isGroupQuantifierFollow(pattern[i + 1])) return true
            const parent = stack[stack.length - 1]
            if (parent !== undefined) {
                if (popped?.hasQuantOrAlt === true) parent.hasQuantOrAlt = true
                parent.justOpened = false
            }
            continue
        }
        const top = stack[stack.length - 1]
        if (top === undefined) continue
        if (top.justOpened && ch === '?') {
            top.justOpened = false
            continue
        }
        top.justOpened = false
        if (ch === '*' || ch === '+' || ch === '{' || ch === '|' || ch === '?') {
            top.hasQuantOrAlt = true
        }
    }
    return false
}

function isDisjointShorthandPair(a: string, b: string): boolean {
    const pair = `${a}|${b}`
    return (
        pair === '\\w|\\s' || pair === '\\s|\\w' ||
        pair === '\\S|\\s' || pair === '\\s|\\S' ||
        pair === '\\d|\\s' || pair === '\\s|\\d' ||
        pair === '\\w|\\W' || pair === '\\W|\\w' ||
        pair === '\\d|\\D' || pair === '\\D|\\d'
    )
}

interface QuantifierReadResult {
    end: number
    repeating: boolean
    nullable: boolean
}

function readQuantifierAt(pattern: string, pos: number): QuantifierReadResult | null {
    const ch = pattern[pos]
    if (ch === '*' || ch === '+') {
        return { end: pos + (pattern[pos + 1] === '?' ? 2 : 1), repeating: true, nullable: ch === '*' }
    }
    if (ch === '?') {
        return { end: pos + (pattern[pos + 1] === '?' ? 2 : 1), repeating: false, nullable: true }
    }
    if (ch !== '{') return null
    let j = pos + 1
    while (j < pattern.length && (pattern[j] ?? '') >= '0' && (pattern[j] ?? '') <= '9') j++
    if (j === pos + 1 || pattern[j] !== ',') return null
    const minVal = Number(pattern.slice(pos + 1, j))
    j++
    const maxStart = j
    while (j < pattern.length && (pattern[j] ?? '') >= '0' && (pattern[j] ?? '') <= '9') j++
    if (pattern[j] !== '}') return null
    const maxStr = pattern.slice(maxStart, j)
    const end = j + (pattern[j + 1] === '?' ? 2 : 1)
    if (maxStr === '') return { end, repeating: true, nullable: minVal === 0 }
    const maxVal = Number(maxStr)
    if (maxVal <= minVal) return null
    return { end, repeating: maxVal > 1, nullable: minVal === 0 }
}

function areAtomsProvablyDisjoint(a: string, b: string): boolean {
    if (a === b || a === '.' || b === '.') return false
    if (isDisjointShorthandPair(a, b)) return true
    const aIsLiteral = a.length === 1 && a !== '[' && a !== '\\'
    const bIsLiteral = b.length === 1 && b !== '[' && b !== '\\'
    return aIsLiteral && bIsLiteral
}

function readAtomToken(pattern: string, i: number): { token: string; next: number } {
    const ch = pattern[i] ?? ''
    if (ch === '\\' && i + 1 < pattern.length) {
        return { token: pattern.slice(i, i + 2), next: i + 2 }
    }
    if (ch === '[') {
        let j = i + 1
        while (j < pattern.length) {
            if (pattern[j] === '\\') { j += 2; continue }
            if (pattern[j] === ']') { j++; break }
            j++
        }
        return { token: pattern.slice(i, j), next: j }
    }
    return { token: ch, next: i + 1 }
}

/** Reject ungrouped overlapping/adjacent quantifiers and excessive wildcard/unbounded quantifier chains. */
function hasUnsafeUngroupedQuantifiers(pattern: string): boolean {
    let repeatingCount = 0
    let wildcardCount = 0
    let prevQuantAtom: string | null = null
    let i = 0
    while (i < pattern.length) {
        const ch = pattern[i] ?? ''
        if (ch === '(' || ch === ')' || ch === '|' || ch === '^' || ch === '$') {
            prevQuantAtom = null
            i++
            continue
        }
        const { token, next } = readAtomToken(pattern, i)
        if (token === '\\b' || token === '\\B') {
            i = next
            continue
        }
        const quant = readQuantifierAt(pattern, next)
        if (quant === null) {
            prevQuantAtom = null
            i = next
            continue
        }
        if (!quant.repeating) {
            i = quant.end
            continue
        }
        repeatingCount++
        if (token === '.') wildcardCount++
        if (repeatingCount > MAX_UNBOUNDED_QUANTIFIERS || wildcardCount > MAX_UNBOUNDED_WILDCARDS) {
            return true
        }
        if (prevQuantAtom !== null && !areAtomsProvablyDisjoint(prevQuantAtom, token)) {
            return true
        }
        if (!quant.nullable || prevQuantAtom === null) {
            prevQuantAtom = token
        }
        i = quant.end
    }
    return false
}

/** Reject over-long regexes, nested quantifiers (ReDoS), repeated wildcards, ungrouped quantifier chains, and backreferences. */
export function isSafeUserRegex(pattern: string): boolean {
    if (pattern.length > MAX_USER_REGEX_LENGTH) return false
    if (NESTED_QUANTIFIER_REGEX.test(pattern)) return false
    if (BACKREFERENCE_REGEX.test(pattern)) return false
    if (REPEATED_WILDCARD_REGEX.test(pattern)) return false
    if (hasUnsafeGroupNesting(pattern)) return false
    if (hasUnsafeUngroupedQuantifiers(pattern)) return false
    return true
}
