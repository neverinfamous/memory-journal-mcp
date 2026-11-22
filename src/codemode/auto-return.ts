/**
 * memory-journal-mcp — Code Mode Auto-Return Transform
 *
 * Transforms user code so the last expression statement is implicitly
 * returned from the async IIFE wrapper.  Mimics Node REPL / Chrome
 * DevTools semantics where bare expressions surface their value.
 *
 * The transform is intentionally heuristic (string-based, not AST)
 * because the code runs in a sandboxed `vm.Script` that already
 * handles syntax errors.  Edge-case misfires are safe — they either
 * produce a benign `return` of the last expression or leave the code
 * unchanged (returning `undefined`, the previous behavior).
 */

import {
    isJsLineTerminator,
    findNextJsLineTerminator,
    skipRegexLiteralBody,
    canStartRegexLiteral,
    markLineTerminator,
    scanIdentifierWord,
    trackIdentifierToken,
    trackPunctuationToken,
    trackTwoCharOperatorToken,
    createDelimiterState,
    skipLineOrBlockComment,
} from './security-stripper.js'

// Statements that must NOT be prefixed with `return`
const NON_RETURNABLE =
    /^\s*(?:return\b|throw\b|const\b|let\b|var\b|if\b|else\b|for\b|while\b|do\b|switch\b|try\b|catch\b|finally\b|class\b|function\b|\/\/|\/\*|\{|\})/
const CONTINUATION_START =
    /^(?:\.(?!\.\.)|\?\.|&&|\|\||\?\?|[?:,*%<>]|==|!=|&|\||\^|(?:in|instanceof)(?![A-Za-z0-9_$]))/
const CONTINUATION_PREV_TOKENS = new Set([
    '=', ',', '.', '?.', '=>', '?', ':', '+', '-', '*', '/', '%', '**', '!', '~',
    '+=', '-=', '*=', '/=', '%=', '??=', '&&=', '||=', '&&', '||', '??',
    '&', '|', '^', '==', '!=', '===', '!==', '<', '>', '<=', '>=', '<<', '>>', '>>>',
    'in', 'instanceof', 'return', 'await', 'throw', 'typeof', 'void', 'delete', 'new', 'case', 'extends', 'of',
])
const STMT_START_PREV_TOKENS = new Set([
    '', ';', ':label', '{', '}block', ')ctrl', 'else', 'do', 'try', 'finally', 'export', 'break', 'continue', 'debugger',
])

/**
 * Transform user code so the last expression statement gets an
 * implicit `return`, enabling the IIFE wrapper to propagate the value.
 *
 * Examples:
 *   `mj.help()`                       → `return mj.help()`
 *   `const r = await foo(); r`        → `const r = await foo(); return r`
 *   `return 42`                       → `return 42`          (no change)
 *   `for (const x of xs) { ... }`    → unchanged             (control flow)
 */
function scanStringStep(
    trimmed: string,
    i: number,
    inString: string,
    isEscaped: boolean,
    state: ReturnType<typeof createDelimiterState>
): { inString: string | null; isEscaped: boolean; next: number; prevToken?: string } {
    const ch = trimmed[i] ?? ''
    if (ch === '\\') return { inString, isEscaped: !isEscaped, next: i + 1 }
    if (inString === '`' && !isEscaped && ch === '$' && trimmed[i + 1] === '{') {
        state.templateBraces.push(0)
        return { inString: null, isEscaped: false, next: i + 2, prevToken: '(' }
    }
    if (ch === inString && !isEscaped) {
        return { inString: null, isEscaped: false, next: i + 1, prevToken: inString }
    }
    return { inString, isEscaped: false, next: i + 1 }
}

function isTwoCharBoundaryOperator(trimmed: string, i: number, ch: string): boolean {
    const next = trimmed[i + 1] ?? ''
    return (
        (ch === '+' && next === '+') ||
        (ch === '-' && next === '-') ||
        (ch === '=' && next === '>') ||
        (ch === '?' && next === '?') ||
        (ch === '?' && next === '.' && !/[0-9]/.test(trimmed[i + 2] ?? ''))
    )
}

function isBoundaryIdentStart(trimmed: string, i: number, ch: string): boolean {
    if (/[A-Za-z0-9_$]/.test(ch) || (ch === '\\' && trimmed[i + 1] === 'u')) return true
    const cp = trimmed.codePointAt(i) ?? 0
    return cp > 0x7f && /[\p{ID_Start}\p{ID_Continue}$_]/u.test(String.fromCodePoint(cp))
}

function nextNonWsStartsContinuation(
    trimmed: string,
    start: number,
    allowCallOrIndex = false
): boolean {
    let lineOnlyWs = false
    for (let j = start; j < trimmed.length; j++) {
        const ch = trimmed[j] ?? ''
        if (isJsLineTerminator(ch)) {
            lineOnlyWs = true
            continue
        }
        if (/\s/.test(ch)) continue
        const comment = skipLineOrBlockComment(trimmed, j, lineOnlyWs)
        if (comment !== null) {
            if (comment.hasNewline === true) lineOnlyWs = true
            j = comment.next - 1
            continue
        }
        if (allowCallOrIndex && (ch === '(' || ch === '[' || ch === '`')) return true
        const next = trimmed[j + 1] ?? ''
        if (ch === '.' && !(next === '.' && trimmed[j + 2] === '.')) return true
        if (ch === '?' && (next === '.' || next === '?')) return true
        if (ch === '&' || ch === '|' || ch === '^' || ch === '*' || ch === '%' || ch === '<' || ch === '>') {
            return true
        }
        if (ch === '/' && next !== '/' && next !== '*') return true
        if ((ch === '+' && next !== '+') || (ch === '-' && next !== '-')) return true
        if ((ch === '=' || ch === '!') && next === '=') return true
        if (trimmed.startsWith('in', j)) {
            const afterIn = trimmed[j + 2]
            if (afterIn === undefined || !/[A-Za-z0-9_$]/.test(afterIn)) return true
        }
        if (trimmed.startsWith('instanceof', j)) {
            const afterInst = trimmed[j + 10]
            if (afterInst === undefined || !/[A-Za-z0-9_$]/.test(afterInst)) return true
        }
        return ch === '?' || ch === ':'
    }
    return false
}

interface BoundaryScanState {
    inString: string | null
    isEscaped: boolean
    lastBoundary: number
    depth: number
    prevToken: string
    lineOnlyWsOrComments: boolean
    readonly delim: ReturnType<typeof createDelimiterState>
}

function stepBoundaryPunctuationOrWs(
    trimmed: string,
    i: number,
    ch: string,
    s: BoundaryScanState
): void {
    const closingInterp =
        ch === '}' && s.delim.templateBraces.length > 0 && s.delim.templateBraces.at(-1) === 0
    if (closingInterp) {
        s.delim.templateBraces.pop()
        s.inString = '`'
        s.isEscaped = false
        s.lineOnlyWsOrComments = false
        return
    }
    if (ch === '{' || ch === '[' || ch === '(') s.depth++
    else if (ch === '}' || ch === ']' || ch === ')') s.depth--
    if (s.depth === 0 && s.delim.templateBraces.length === 0) {
        const allowCallOrIndex = !STMT_START_PREV_TOKENS.has(s.prevToken) && !s.delim.canAsiRegex
        if (
            ch === ';' ||
            (isJsLineTerminator(ch) &&
                !CONTINUATION_PREV_TOKENS.has(s.prevToken) &&
                !nextNonWsStartsContinuation(trimmed, i + 1, allowCallOrIndex))
        ) {
            s.lastBoundary = i
        }
    }
    if (isJsLineTerminator(ch)) {
        s.lineOnlyWsOrComments = true
        markLineTerminator(s.delim)
    } else if (!/\s/.test(ch)) {
        s.prevToken = trackPunctuationToken(ch, s.prevToken, s.delim)
        s.lineOnlyWsOrComments = false
    }
}

function findLastStatementBoundary(trimmed: string): number {
    const s: BoundaryScanState = {
        inString: null,
        isEscaped: false,
        lastBoundary: -1,
        depth: 0,
        prevToken: '',
        lineOnlyWsOrComments: true,
        delim: createDelimiterState(),
    }

    for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i] ?? ''
        if (s.inString !== null) {
            const step = scanStringStep(trimmed, i, s.inString, s.isEscaped, s.delim)
            s.inString = step.inString
            s.isEscaped = step.isEscaped
            if (step.prevToken !== undefined) {
                s.prevToken = step.prevToken
                s.delim.canAsiRegex = false
            }
            s.lineOnlyWsOrComments = false
            i = step.next - 1
            continue
        }
        const comment = skipLineOrBlockComment(trimmed, i, s.lineOnlyWsOrComments)
        if (comment !== null) {
            if (comment.hasNewline === true) {
                const allowCallOrIndex = !STMT_START_PREV_TOKENS.has(s.prevToken) && !s.delim.canAsiRegex
                if (
                    comment.next < trimmed.length &&
                    s.depth === 0 &&
                    s.delim.templateBraces.length === 0 &&
                    !CONTINUATION_PREV_TOKENS.has(s.prevToken) &&
                    !nextNonWsStartsContinuation(trimmed, comment.next, allowCallOrIndex)
                ) {
                    s.lastBoundary = comment.next - 1
                }
                s.lineOnlyWsOrComments = true
                markLineTerminator(s.delim)
            }
            if (comment.next === trimmed.length && findNextJsLineTerminator(trimmed, i) === -1) break
            i = comment.next - 1
            continue
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            s.inString = ch
            s.lineOnlyWsOrComments = false
        } else if (
            ch === '/' &&
            trimmed[i + 1] !== '/' &&
            trimmed[i + 1] !== '*' &&
            canStartRegexLiteral(s.prevToken, s.delim)
        ) {
            i = skipRegexLiteralBody(trimmed, i + 1) - 1
            s.prevToken = '/'
            s.delim.canAsiRegex = false
            s.lineOnlyWsOrComments = false
        } else if (ch === '.' && trimmed[i + 1] === '.' && trimmed[i + 2] === '.') {
            s.prevToken = trackPunctuationToken('...', s.prevToken, s.delim)
            s.lineOnlyWsOrComments = false
            i += 2
        } else if (isTwoCharBoundaryOperator(trimmed, i, ch)) {
            s.prevToken = trackTwoCharOperatorToken(ch + (trimmed[i + 1] ?? ''), s.prevToken, s.delim)
            s.lineOnlyWsOrComments = false
            i++
        } else if (isBoundaryIdentStart(trimmed, i, ch)) {
            const ident = scanIdentifierWord(trimmed, i)
            s.prevToken = trackIdentifierToken(ident.word, s.prevToken, s.delim)
            s.lineOnlyWsOrComments = false
            i = ident.next - 1
        } else {
            stepBoundaryPunctuationOrWs(trimmed, i, ch, s)
        }
    }
    return s.lastBoundary
}

export function transformAutoReturn(code: string): string {
    let trimmed = code.trimEnd()
    if (!trimmed) return code

    // Strip trailing semicolons so the final statement isn't empty
    while (trimmed.endsWith(';')) {
        trimmed = trimmed.slice(0, -1).trimEnd()
    }

    const lastBoundary = findLastStatementBoundary(trimmed)
    const lastStmt = (lastBoundary >= 0 ? trimmed.slice(lastBoundary + 1) : trimmed).trim()
    if (!lastStmt || NON_RETURNABLE.test(lastStmt) || CONTINUATION_START.test(lastStmt)) return code

    return lastBoundary >= 0
        ? `${trimmed.slice(0, lastBoundary + 1)}\nreturn ${lastStmt}`
        : `return ${trimmed}`
}
