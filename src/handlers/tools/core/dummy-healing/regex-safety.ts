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

function readUnboundedQuantifierEnd(pattern: string, pos: number): number {
    const ch = pattern[pos]
    if (ch === '*' || ch === '+') return pos + (pattern[pos + 1] === '?' ? 2 : 1)
    if (ch !== '{') return -1
    let j = pos + 1
    while (j < pattern.length && (pattern[j] ?? '') >= '0' && (pattern[j] ?? '') <= '9') j++
    if (j === pos + 1 || pattern[j] !== ',') return -1
    j++
    const closeIdx = pattern.indexOf('}', j)
    if (closeIdx === -1 || closeIdx !== j) return -1
    return closeIdx + (pattern[closeIdx + 1] === '?' ? 2 : 1)
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
    let unboundedCount = 0
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
        const quantEnd = readUnboundedQuantifierEnd(pattern, next)
        if (quantEnd === -1) {
            prevQuantAtom = null
            i = next
            continue
        }
        unboundedCount++
        if (token === '.') wildcardCount++
        if (unboundedCount > MAX_UNBOUNDED_QUANTIFIERS || wildcardCount > MAX_UNBOUNDED_WILDCARDS) {
            return true
        }
        if (
            prevQuantAtom !== null &&
            (prevQuantAtom === token || prevQuantAtom === '.' || token === '.' ||
                (!isDisjointShorthandPair(prevQuantAtom, token) &&
                    (prevQuantAtom.startsWith('[') || token.startsWith('['))))
        ) {
            return true
        }
        prevQuantAtom = token
        i = quantEnd
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
