/**
 * Lexical escape, comment, regex, and string literal scanning helpers for `security-stripper.ts`.
 * Worker-thread safe (zero npm imports).
 */

const SENSITIVE_STRING_CONTENT = /^(?:constructor|__proto__|prototype)$/i

export function isJsLineTerminator(ch: string | undefined): boolean {
    return ch === '\n' || ch === '\r' || ch === '\u2028' || ch === '\u2029'
}

export function findNextJsLineTerminator(src: string, from: number): number {
    for (let i = from; i < src.length; i++) {
        if (isJsLineTerminator(src[i])) return i
    }
    return -1
}

function decodeUnicodeEscape(code: string, slashIdx: number): { ch: string; next: number } | null {
    const len = code.length
    if (code[slashIdx + 2] === '{') {
        let end = slashIdx + 3
        while (end < len && end - (slashIdx + 3) < 8 && code[end] !== '}') end++
        if (end >= len || code[end] !== '}') return null
        const hex = code.slice(slashIdx + 3, end)
        if (!/^[0-9a-fA-F]+$/.test(hex)) return null
        const cp = Number.parseInt(hex, 16)
        return cp <= 0x10ffff ? { ch: String.fromCodePoint(cp), next: end + 1 } : null
    }
    if (slashIdx + 6 > len) return null
    const hex = code.slice(slashIdx + 2, slashIdx + 6)
    return /^[0-9a-fA-F]{4}$/.test(hex)
        ? { ch: String.fromCharCode(Number.parseInt(hex, 16)), next: slashIdx + 6 }
        : null
}

export function decodeEscapeAt(
    code: string,
    slashIdx: number,
    allowStringEscapes: boolean
): { ch: string; next: number } {
    const len = code.length
    if (slashIdx + 1 >= len) return { ch: '', next: slashIdx + 1 }
    const esc = code[slashIdx + 1] ?? ''
    if (esc === 'u') {
        const decoded = decodeUnicodeEscape(code, slashIdx)
        if (decoded !== null) return decoded
    } else if (allowStringEscapes) {
        if (isJsLineTerminator(esc)) {
            if (esc === '\r' && code[slashIdx + 2] === '\n') {
                return { ch: '', next: slashIdx + 3 }
            }
            return { ch: '', next: slashIdx + 2 }
        }
        if (esc === 'x' && slashIdx + 4 <= len) {
            const hex = code.slice(slashIdx + 2, slashIdx + 4)
            if (/^[0-9a-fA-F]{2}$/.test(hex)) {
                return { ch: String.fromCharCode(Number.parseInt(hex, 16)), next: slashIdx + 4 }
            }
        }
        if (/^[0-7]$/.test(esc)) {
            const maxDigits = esc <= '3' ? 3 : 2
            let end = slashIdx + 2
            const cap = Math.min(len, slashIdx + 1 + maxDigits)
            while (end < cap && /^[0-7]$/.test(code[end] ?? '')) end++
            const oct = code.slice(slashIdx + 1, end)
            return { ch: String.fromCharCode(Number.parseInt(oct, 8)), next: end }
        }
    }
    return { ch: esc, next: slashIdx + 2 }
}

/**
 * Skips a regex literal body starting just after the opening `/`.
 * Returns the index after the closing `/` and its flags (or at the line end if unterminated).
 */
export function skipRegexLiteralBody(code: string, start: number): number {
    const len = code.length
    let i = start
    let inCharClass = false
    while (i < len) {
        const c = code[i] ?? ''
        if (c === '\\') {
            i += i + 1 < len ? 2 : 1
            continue
        }
        if (c === '[') {
            inCharClass = true
        } else if (c === ']') {
            inCharClass = false
        } else if (c === '/' && !inCharClass) {
            i++
            while (i < len && /[dgimsuvy]/.test(code[i] ?? '')) {
                i++
            }
            break
        } else if (isJsLineTerminator(c)) {
            break
        }
        i++
    }
    return i
}

/**
 * Applies Unicode NFKC normalization only when non-ASCII code units (`> 0x7f`) are present,
 * avoiding V8 -> ICU boundary crossings on pure ASCII tokens (invariant under UAX #15 NFKC).
 */
export function normalizeNfkcIfNonAscii(value: string): string {
    for (let i = 0; i < value.length; i++) {
        if (value.charCodeAt(i) > 0x7f) return value.normalize('NFKC')
    }
    return value
}

/**
 * Scans a quoted string literal starting just after the opening quote.
 * Returns the unescaped content and the index after the closing quote.
 */
export function scanQuotedLiteral(
    code: string,
    start: number,
    quote: string
): { content: string; next: number; sensitive: boolean } {
    const len = code.length
    let i = start
    let content = ''
    while (i < len) {
        const c = code[i] ?? ''
        if (c === '\\') {
            const dec = decodeEscapeAt(code, i, true)
            content += dec.ch
            i = dec.next
            continue
        }
        if (c === quote) {
            i++
            break
        }
        content += c
        i++
    }
    const rawTrimmed = content.trim()
    const trimmed = rawTrimmed.length <= 64 ? normalizeNfkcIfNonAscii(rawTrimmed) : rawTrimmed
    const sensitive = trimmed.length <= 64 && SENSITIVE_STRING_CONTENT.test(trimmed)
    return { content: trimmed, next: i, sensitive }
}

/**
 * Scans a template literal segment starting just after the opening backtick (or the
 * closing `}` of a `${...}` interpolation when `resumed` is true).
 */
export function scanTemplateLiteral(
    code: string,
    start: number,
    resumed: boolean,
    braceDepthStack: number[]
): { out: string; next: number; lastToken: string | undefined } {
    const len = code.length
    let out = resumed ? ')`' : '`'
    let i = start
    let lastToken: string | undefined

    let content = ''
    while (i < len) {
        const c = code[i] ?? ''
        if (c === '\\') {
            const dec = decodeEscapeAt(code, i, true)
            content += dec.ch
            i = dec.next
            continue
        }
        if (c === '$' && code[i + 1] === '{') {
            out += '`' + '+('
            braceDepthStack.push(0)
            lastToken = '('
            i += 2
            break
        }
        if (c === '`') {
            const rawTrimmed = content.trim()
            const trimmed =
                rawTrimmed.length <= 64 ? normalizeNfkcIfNonAscii(rawTrimmed) : rawTrimmed
            out +=
                trimmed.length <= 64 && SENSITIVE_STRING_CONTENT.test(trimmed)
                    ? `${trimmed}\``
                    : '`'
            lastToken = '`'
            i++
            break
        }
        content += c
        i++
    }
    return { out, next: i, lastToken }
}

export function skipLineOrBlockComment(
    code: string,
    start: number
): { out: string; next: number; unterminated?: boolean } | null {
    const ch = code[start] ?? ''
    const next = start + 1 < code.length ? (code[start + 1] ?? '') : ''
    if (ch === '/' && next === '/') {
        let i = start + 2
        while (i < code.length && !isJsLineTerminator(code[i])) i++
        return { out: ' ', next: i, ...(i >= code.length ? { unterminated: true } : {}) }
    }
    if (ch === '<' && code.slice(start, start + 4) === '<!--') {
        let i = start + 4
        while (i < code.length && !isJsLineTerminator(code[i])) i++
        return { out: ' ', next: i, ...(i >= code.length ? { unterminated: true } : {}) }
    }
    if (ch === '-' && code.slice(start, start + 3) === '-->') {
        let pos = start - 1
        while (pos >= 0 && (code[pos] === ' ' || code[pos] === '\t')) pos--
        if (pos < 0 || isJsLineTerminator(code[pos])) {
            let i = start + 3
            while (i < code.length && !isJsLineTerminator(code[i])) i++
            return { out: ' ', next: i, ...(i >= code.length ? { unterminated: true } : {}) }
        }
    }
    if (ch === '/' && next === '*') {
        let out = ' '
        let i = start + 2
        while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
            if (isJsLineTerminator(code[i])) out += '\n'
            i++
        }
        const closed = i < code.length
        if (closed) i += 2
        return { out, next: i, ...(!closed ? { unterminated: true } : {}) }
    }
    return null
}
