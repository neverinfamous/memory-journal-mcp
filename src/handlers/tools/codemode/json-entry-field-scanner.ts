/**
 * [INTENT] Linear O(n) field and delimiter scanners for fuzzy Code Mode entry recovery,
 * replacing polynomial/quadratic `[\s\S]*?` regex lookaheads on unclosed inputs.
 */

import { skipLineOrBlockComment } from '../../../codemode/security-stripper.js'

export interface FieldMatchSpan {
    content: string
    start: number
    end: number
}

type NextNonWsCursor = (pos: number) => number

function createMonotonicWsCursor(code: string): NextNonWsCursor {
    let wsStart = -1
    let wsEnd = -1
    return (pos: number): number => {
        if (pos >= wsStart && pos < wsEnd) return wsEnd
        let cur = pos
        while (cur < code.length && /\s/.test(code[cur] ?? '')) {
            cur++
        }
        wsStart = pos
        wsEnd = cur
        return cur
    }
}

const PROP_KEY_LOOKAHEAD_RE = /^[a-zA-Z_$][\w$]*\s*:/
const ALT_PROP_KEY_LOOKAHEAD_RE = /^[\w$]+\s*:/
const HEADER_SCAN_CAP = 16

function findFallbackEnd(
    code: string,
    valueStart: number,
    quote: string,
    nextNonWs: NextNonWsCursor
): { contentEnd: number; spanEnd: number } | null {
    let trailingWsStart = -1
    for (let i = valueStart; i < code.length; i++) {
        const ch = code[i] ?? ''
        if (/\s/.test(ch)) {
            if (trailingWsStart === -1) trailingWsStart = i
            continue
        }
        if (ch === quote) {
            const nextCh = code[nextNonWs(i + 1)]
            if (nextCh === ',' || nextCh === '}' || nextCh === ')') {
                return { contentEnd: i, spanEnd: i + 1 }
            }
        } else if (ch === ',') {
            const afterComma = nextNonWs(i + 1)
            if (code[afterComma] === '}') {
                return { contentEnd: i, spanEnd: i }
            }
            if (PROP_KEY_LOOKAHEAD_RE.test(code.slice(afterComma, afterComma + 128))) {
                const contentEnd = trailingWsStart !== -1 ? trailingWsStart : i
                return { contentEnd, spanEnd: contentEnd }
            }
        } else if (ch === '}') {
            return { contentEnd: i, spanEnd: i }
        }
        trailingWsStart = -1
    }
    return null
}

/** Scans unclosed or fallback `content` literals in O(n) worst-case time. */
export function scanFallbackContentField(code: string): FieldMatchSpan | null {
    const headerRe = /\bcontent\s*:\s*([`'"])/gi
    const nextNonWs = createMonotonicWsCursor(code)
    for (let attempt = 0; attempt < HEADER_SCAN_CAP; attempt++) {
        const m = headerRe.exec(code)
        if (m?.[1] === undefined) return null
        const valueStart = m.index + m[0].length
        const found = findFallbackEnd(code, valueStart, m[1], nextNonWs)
        if (found !== null) {
            return {
                content: code.slice(valueStart, found.contentEnd),
                start: m.index,
                end: found.spanEnd,
            }
        }
    }
    return null
}

function isQuotedBoundaryMatch(
    code: string,
    quotePos: number,
    boundaryMode: 'prop-or-brace' | 'prop-brace-or-paren',
    nextNonWs: NextNonWsCursor
): boolean {
    if (boundaryMode === 'prop-or-brace') {
        if (code[quotePos + 1] === ',') {
            const afterComma = nextNonWs(quotePos + 2)
            return ALT_PROP_KEY_LOOKAHEAD_RE.test(code.slice(afterComma, afterComma + 128))
        }
        return code[nextNonWs(quotePos + 1)] === '}'
    }
    const nextIdx = nextNonWs(quotePos + 1)
    const nextCh = code[nextIdx]
    if (nextCh === '}' || nextCh === ')') return true
    if (nextCh !== ',') return false
    const afterComma = nextNonWs(nextIdx + 1)
    return (
        code[afterComma] === '}' ||
        PROP_KEY_LOOKAHEAD_RE.test(code.slice(afterComma, afterComma + 128))
    )
}

/** Scans a quoted field (`headerRe` capturing the opening quote) in O(n) worst-case time. */
export function scanQuotedFieldLinear(
    code: string,
    headerRe: RegExp,
    boundaryMode: 'prop-or-brace' | 'prop-brace-or-paren'
): FieldMatchSpan | null {
    const flags = headerRe.flags.includes('g') ? headerRe.flags : `${headerRe.flags}g`
    const globalRe = new RegExp(headerRe.source, flags)
    const nextNonWs = createMonotonicWsCursor(code)
    for (let attempt = 0; attempt < HEADER_SCAN_CAP; attempt++) {
        const m = globalRe.exec(code)
        if (m?.[1] === undefined) return null
        const quote = m[1]
        const valueStart = m.index + m[0].length
        for (let i = valueStart; i < code.length; i++) {
            if (code[i] !== quote) continue
            if (isQuotedBoundaryMatch(code, i, boundaryMode, nextNonWs)) {
                return {
                    content: code.slice(valueStart, i),
                    start: m.index,
                    end: i + 1,
                }
            }
        }
    }
    return null
}

export function stripJsCommentsPreservingStrings(code: string): string {
    const out: string[] = []
    let quote: string | null = null
    let escaped = false
    for (let i = 0; i < code.length; i++) {
        const ch = code[i] ?? ''
        if (quote !== null) {
            out.push(ch)
            if (escaped) escaped = false
            else if (ch === '\\') escaped = true
            else if (ch === quote) quote = null
            continue
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            quote = ch
            out.push(ch)
            continue
        }
        const comment = skipLineOrBlockComment(code, i, false)
        if (comment !== null) {
            out.push(comment.hasNewline === true ? '\n' : ' ')
            i = comment.next - 1
            continue
        }
        out.push(ch)
    }
    return out.join('')
}

export function findBalancedDelimitedBlockEnd(
    code: string,
    openIdx: number,
    openChar: string,
    closeChar: string
): number {
    let depth = 1
    let j = openIdx + 1
    let quote: string | null = null
    let escaped = false
    while (j < code.length && depth > 0) {
        const ch = code[j] ?? ''
        if (quote !== null) {
            if (escaped) escaped = false
            else if (ch === '\\') escaped = true
            else if (ch === quote) quote = null
        } else if (ch === "'" || ch === '"' || ch === '`') {
            quote = ch
        } else if (ch === openChar) {
            depth++
        } else if (ch === closeChar) {
            depth--
        }
        j++
    }
    return j
}

export function stripNestedPropBlocks(code: string): string {
    const out: string[] = []
    let i = 0
    const propRe = /\b(?:auto_context|autoContext|relationships|anchors)\s*:\s*(?:JSON\.stringify\s*(\()|([{[]))/iy
    while (i < code.length) {
        propRe.lastIndex = i
        const m = propRe.exec(code)
        if (m?.[1] !== undefined) {
            const endIdx = findBalancedDelimitedBlockEnd(code, i + m[0].length - 1, '(', ')')
            out.push('""')
            i = endIdx
            continue
        }
        if (m?.[2] !== undefined) {
            const openChar = m[2]
            const closeChar = openChar === '{' ? '}' : ']'
            const endIdx = findBalancedDelimitedBlockEnd(code, i + m[0].length - 1, openChar, closeChar)
            out.push(`${openChar}${closeChar}`)
            i = endIdx
            continue
        }
        out.push(code[i] ?? '')
        i++
    }
    return out.join('')
}
