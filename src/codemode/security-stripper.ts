/**
 * Single-pass lexical comment, regex, and string literal stripper for Code Mode
 * security validation and recovery heuristics. Worker-thread safe (no npm imports).
 */

const SENSITIVE_STRING_CONTENT = /^(?:constructor|__proto__|prototype)$/i

/**
 * Skips a regex literal body starting just after the opening `/`.
 * Returns the index after the closing `/` and its flags (or at the line end if unterminated).
 */
function skipRegexLiteralBody(code: string, start: number): number {
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
        } else if (c === '\n') {
            break
        }
        i++
    }
    return i
}

/**
 * Scans a quoted string literal starting just after the opening quote.
 * Returns the unescaped content and the index after the closing quote.
 */
function scanQuotedLiteral(
    code: string,
    start: number,
    quote: string
): { content: string; next: number } {
    const len = code.length
    let i = start
    let content = ''
    while (i < len) {
        const c = code[i] ?? ''
        if (c === '\\') {
            if (i + 1 < len) {
                content += code[i + 1] ?? ''
                i += 2
            } else {
                i++
            }
            continue
        }
        if (c === quote) {
            i++
            break
        }
        content += c
        i++
    }
    return { content, next: i }
}

/**
 * Scans a template literal segment starting just after the opening backtick (or the
 * closing `}` of a `${...}` interpolation when `resumed` is true).
 */
function scanTemplateLiteral(
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
            if (i + 1 < len) {
                content += code[i + 1] ?? ''
                i += 2
            } else {
                i++
            }
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
            if (SENSITIVE_STRING_CONTENT.test(content.trim())) {
                out += `${content.trim()}\``
            } else {
                out += '`'
            }
            lastToken = '`'
            i++
            break
        }
        content += c
        i++
    }
    return { out, next: i, lastToken }
}

function canStartRegexLiteral(prev: string): boolean {
    if (!prev) return true
    if (/^[([{:;,=!?&|+-~*%^<>]$/.test(prev)) return true
    return /^(?:return|typeof|instanceof|in|of|void|delete|throw|new|case|yield|await)$/.test(
        prev
    )
}

function skipLineOrBlockComment(
    code: string,
    start: number
): { out: string; next: number } | null {
    const ch = code[start] ?? ''
    const next = start + 1 < code.length ? (code[start + 1] ?? '') : ''
    if (ch === '/' && next === '/') {
        let i = start + 2
        while (i < code.length && code[i] !== '\n') i++
        return { out: ' ', next: i }
    }
    if (ch === '/' && next === '*') {
        let out = ' '
        let i = start + 2
        while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
            if (code[i] === '\n') out += '\n'
            i++
        }
        if (i < code.length) i += 2
        return { out, next: i }
    }
    return null
}

function scanIdentifierWord(code: string, start: number): { word: string; next: number } {
    let word = code[start] ?? ''
    let j = start + 1
    while (j < code.length) {
        const nextCh = code[j]
        if (nextCh === undefined || !/[A-Za-z0-9_$]/.test(nextCh)) break
        word += nextCh
        j++
    }
    return { word, next: j }
}

function updateTemplateBraceDepth(ch: string, stack: number[]): void {
    if (stack.length === 0) return
    const topIdx = stack.length - 1
    const currentDepth = stack[topIdx] ?? 0
    if (ch === '{') stack[topIdx] = currentDepth + 1
    else if (ch === '}' && currentDepth > 0) stack[topIdx] = currentDepth - 1
}

/**
 * Single-pass lexical scanner that strips JS comments and string literal contents
 * in a single left-to-right pass while preserving `${...}` interpolations,
 * sensitive prototype property strings, and regex literal boundaries.
 */
export function stripCommentsAndStrings(rawCode: string): string {
    const code = rawCode.normalize('NFKC')
    const len = code.length
    let out = ''
    let i = 0
    let lastNonWsToken = ''
    const templateBraceDepthStack: number[] = []

    while (i < len) {
        const ch = code[i] ?? ''
        const next = i + 1 < len ? (code[i + 1] ?? '') : ''

        const comment = skipLineOrBlockComment(code, i)
        if (comment !== null) {
            out += comment.out
            i = comment.next
            continue
        }

        if (ch === '/' && next !== '/' && next !== '*' && canStartRegexLiteral(lastNonWsToken)) {
            out += '/ /'
            i = skipRegexLiteralBody(code, i + 1)
            lastNonWsToken = '/'
            continue
        }

        if (ch === '"' || ch === "'") {
            const scanned = scanQuotedLiteral(code, i + 1, ch)
            i = scanned.next
            const trimmed = scanned.content.trim()
            out += SENSITIVE_STRING_CONTENT.test(trimmed) ? `${ch}${trimmed}${ch}` : `${ch}${ch}`
            lastNonWsToken = ch
            continue
        }

        const closingInterpolation =
            ch === '}' &&
            templateBraceDepthStack.length > 0 &&
            templateBraceDepthStack[templateBraceDepthStack.length - 1] === 0
        if (ch === '`' || closingInterpolation) {
            if (ch === '}') templateBraceDepthStack.pop()
            const scanned = scanTemplateLiteral(code, i + 1, ch === '}', templateBraceDepthStack)
            out += scanned.out
            i = scanned.next
            if (scanned.lastToken !== undefined) lastNonWsToken = scanned.lastToken
            continue
        }

        updateTemplateBraceDepth(ch, templateBraceDepthStack)

        if (/[A-Za-z0-9_$]/.test(ch)) {
            const ident = scanIdentifierWord(code, i)
            lastNonWsToken = ident.word
            out += ident.word
            i = ident.next
            continue
        }
        if (!/\s/.test(ch)) lastNonWsToken = ch
        out += ch
        i++
    }

    return out
}
