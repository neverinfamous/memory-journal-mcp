/**
 * Single-pass lexical comment, regex, and string literal stripper for Code Mode
 * security validation and recovery heuristics. Worker-thread safe (no npm imports).
 */

import {
    decodeEscapeAt,
    findNextJsLineTerminator,
    isJsLineTerminator,
    normalizeNfkcIfNonAscii,
    scanQuotedLiteral,
    scanTemplateLiteral,
    skipLineOrBlockComment,
    skipRegexLiteralBody,
} from './security-stripper-escapes.js'
import {
    canStartRegexLiteral,
    createDelimiterState,
    hasUnbalancedClosingDelimiter,
    markLineTerminator,
    trackIdentifierToken,
    trackPunctuationToken,
    trackTwoCharOperatorToken,
    type DelimiterState,
} from './security-stripper-state.js'

export {
    canStartRegexLiteral,
    createDelimiterState,
    decodeEscapeAt,
    findNextJsLineTerminator,
    hasUnbalancedClosingDelimiter,
    isJsLineTerminator,
    markLineTerminator,
    skipLineOrBlockComment,
    skipRegexLiteralBody,
    trackIdentifierToken,
    trackPunctuationToken,
    trackTwoCharOperatorToken,
    type DelimiterState,
}

function isAsciiIdentCode(cc: number): boolean {
    return (
        (cc >= 0x61 && cc <= 0x7a) ||
        (cc >= 0x41 && cc <= 0x5a) ||
        (cc >= 0x30 && cc <= 0x39) ||
        cc === 0x5f ||
        cc === 0x24
    )
}

function scanIdentifierWord(code: string, start: number): { word: string; next: number } {
    let fastEnd = start
    while (fastEnd < code.length && isAsciiIdentCode(code.charCodeAt(fastEnd))) {
        fastEnd++
    }
    const stopCode = fastEnd < code.length ? code.charCodeAt(fastEnd) : 0
    if (stopCode !== 0x5c && stopCode <= 0x7f) {
        return { word: code.slice(start, fastEnd), next: fastEnd }
    }
    let word = code.slice(start, fastEnd)
    let j = fastEnd
    while (j < code.length) {
        const cc = code.charCodeAt(j)
        if (isAsciiIdentCode(cc)) {
            word += code[j] ?? ''
            j++
            continue
        }
        if (cc === 0x5c && code[j + 1] === 'u') {
            const dec = decodeEscapeAt(code, j, false)
            word += dec.ch
            j = dec.next
            continue
        }
        if (cc <= 0x7f) break
        const cp = code.codePointAt(j)
        if (cp === undefined) break
        const ch = String.fromCodePoint(cp)
        if (!/[\p{ID_Continue}$_]/u.test(ch)) break
        word += ch
        j += ch.length
    }
    return { word: normalizeNfkcIfNonAscii(word), next: j }
}

export { scanIdentifierWord }

/**
 * Single-pass lexical scanner that strips JS comments and string literal contents
 * in a single left-to-right pass while preserving `${...}` interpolations,
 * sensitive prototype property strings, and regex literal boundaries.
 */
function isTwoCharStripperOperator(code: string, i: number, ch: string, next: string): boolean {
    return (
        (ch === '+' && next === '+') ||
        (ch === '-' && next === '-') ||
        (ch === '=' && next === '>') ||
        (ch === '?' && next === '?') ||
        (ch === '?' && next === '.' && !/[0-9]/.test(code[i + 2] ?? ''))
    )
}

function isStripperIdentStart(code: string, i: number, ch: string, next: string): boolean {
    const cc = code.charCodeAt(i)
    if (isAsciiIdentCode(cc) || (ch === '\\' && next === 'u')) return true
    if (cc <= 0x7f) return false
    const cp = code.codePointAt(i)
    return cp !== undefined && /[\p{ID_Start}\p{ID_Continue}$_]/u.test(String.fromCodePoint(cp))
}

function stepStripperTemplate(
    code: string,
    i: number,
    ch: string,
    state: ReturnType<typeof createDelimiterState>,
    lastNonWsToken: string
): { out: string; next: number; lastToken: string } | null {
    const closingInterp =
        ch === '}' && state.templateBraces.length > 0 && state.templateBraces.at(-1) === 0
    if (ch !== '`' && !closingInterp) return null
    if (ch === '}') state.templateBraces.pop()
    const scanned = scanTemplateLiteral(code, i + 1, ch === '}', state.templateBraces)
    state.canAsiRegex = false
    return {
        out: scanned.out,
        next: scanned.next,
        lastToken: scanned.lastToken ?? lastNonWsToken,
    }
}

export function stripCommentsAndStrings(code: string): string {
    const len = code.length
    let out = ''
    let i = 0
    let lastNonWsToken = ''
    let lineOnlyWsOrComments = true
    const state = createDelimiterState()

    while (i < len) {
        const ch = code[i] ?? ''
        const next = i + 1 < len ? (code[i + 1] ?? '') : ''

        const comment = skipLineOrBlockComment(code, i, lineOnlyWsOrComments)
        if (comment !== null) {
            out += comment.out
            if (comment.hasNewline === true) {
                lineOnlyWsOrComments = true
                markLineTerminator(state)
            }
            i = comment.next
            continue
        }
        if (ch === '/' && next !== '/' && next !== '*' && canStartRegexLiteral(lastNonWsToken, state)) {
            out += '/ /'
            i = skipRegexLiteralBody(code, i + 1)
            lastNonWsToken = '/'
            state.canAsiRegex = false
            lineOnlyWsOrComments = false
            continue
        }
        if (ch === '"' || ch === "'") {
            const scanned = scanQuotedLiteral(code, i + 1, ch)
            i = scanned.next
            out += scanned.sensitive ? `${ch}${scanned.content}${ch}` : `${ch}${ch}`
            lastNonWsToken = ch
            state.canAsiRegex = false
            lineOnlyWsOrComments = false
            continue
        }
        const tpl = stepStripperTemplate(code, i, ch, state, lastNonWsToken)
        if (tpl !== null) {
            out += tpl.out
            i = tpl.next
            lastNonWsToken = tpl.lastToken
            lineOnlyWsOrComments = false
            continue
        }
        if (isTwoCharStripperOperator(code, i, ch, next)) {
            lastNonWsToken = trackTwoCharOperatorToken(ch + next, lastNonWsToken, state)
            lineOnlyWsOrComments = false
            out += ch + next
            i += 2
            continue
        }
        if (isStripperIdentStart(code, i, ch, next)) {
            const ident = scanIdentifierWord(code, i)
            lastNonWsToken = trackIdentifierToken(ident.word, lastNonWsToken, state)
            lineOnlyWsOrComments = false
            out += ident.word
            i = ident.next
            continue
        }
        if (isJsLineTerminator(ch)) {
            lineOnlyWsOrComments = true
            markLineTerminator(state)
        } else if (!/\s/.test(ch)) {
            lastNonWsToken = trackPunctuationToken(ch, lastNonWsToken, state)
            lineOnlyWsOrComments = false
        }
        out += ch
        i++
    }

    return out
}
