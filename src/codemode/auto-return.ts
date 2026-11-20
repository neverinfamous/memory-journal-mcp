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
    /^\s*(return|throw|const |let |var |if\b|else\b|for\b|while\b|do\b|switch\b|try\b|catch\b|finally\b|class |function |\/\/|\/\*|\{|\})/

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

function findLastStatementBoundary(trimmed: string): number {
    let inString: string | null = null
    let isEscaped = false
    let lastBoundary = -1
    let depth = 0
    let prevToken = ''
    let lineOnlyWsOrComments = true
    const state = createDelimiterState()

    for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i] ?? ''
        if (inString !== null) {
            const step = scanStringStep(trimmed, i, inString, isEscaped, state)
            inString = step.inString
            isEscaped = step.isEscaped
            if (step.prevToken !== undefined) {
                prevToken = step.prevToken
                state.canAsiRegex = false
            }
            lineOnlyWsOrComments = false
            i = step.next - 1
            continue
        }
        const comment = skipLineOrBlockComment(trimmed, i, lineOnlyWsOrComments)
        if (comment !== null) {
            if (comment.hasNewline === true) {
                lineOnlyWsOrComments = true
                markLineTerminator(state)
            }
            if (comment.next === trimmed.length && findNextJsLineTerminator(trimmed, i) === -1) break
            i = comment.next - 1
            continue
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            inString = ch
            lineOnlyWsOrComments = false
        } else if (ch === '/' && trimmed[i + 1] !== '/' && trimmed[i + 1] !== '*' && canStartRegexLiteral(prevToken, state)) {
            i = skipRegexLiteralBody(trimmed, i + 1) - 1
            prevToken = '/'
            state.canAsiRegex = false
            lineOnlyWsOrComments = false
        } else if (ch === '.' && trimmed[i + 1] === '.' && trimmed[i + 2] === '.') {
            prevToken = trackPunctuationToken('...', prevToken, state)
            lineOnlyWsOrComments = false
            i += 2
        } else if (isTwoCharBoundaryOperator(trimmed, i, ch)) {
            prevToken = trackTwoCharOperatorToken(ch + (trimmed[i + 1] ?? ''), prevToken, state)
            lineOnlyWsOrComments = false
            i++
        } else if (isBoundaryIdentStart(trimmed, i, ch)) {
            const ident = scanIdentifierWord(trimmed, i)
            prevToken = trackIdentifierToken(ident.word, prevToken, state)
            lineOnlyWsOrComments = false
            i = ident.next - 1
        } else {
            const closingInterp = ch === '}' && state.templateBraces.length > 0 && state.templateBraces.at(-1) === 0
            if (closingInterp) {
                state.templateBraces.pop()
                inString = '`'
                isEscaped = false
                lineOnlyWsOrComments = false
                continue
            }
            if (ch === '{' || ch === '[' || ch === '(') depth++
            else if (ch === '}' || ch === ']' || ch === ')') depth--
            if (depth === 0 && state.templateBraces.length === 0 && (ch === ';' || isJsLineTerminator(ch))) {
                lastBoundary = i
            }
            if (isJsLineTerminator(ch)) {
                lineOnlyWsOrComments = true
                markLineTerminator(state)
            } else if (!/\s/.test(ch)) {
                prevToken = trackPunctuationToken(ch, prevToken, state)
                lineOnlyWsOrComments = false
            }
        }
    }
    return lastBoundary
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
    if (!lastStmt || NON_RETURNABLE.test(lastStmt)) return code

    return lastBoundary >= 0
        ? `${trimmed.slice(0, lastBoundary + 1)}\nreturn ${lastStmt}`
        : `return ${trimmed}`
}
