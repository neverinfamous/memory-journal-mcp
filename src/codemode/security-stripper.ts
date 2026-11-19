/**
 * Single-pass lexical comment, regex, and string literal stripper for Code Mode
 * security validation and recovery heuristics. Worker-thread safe (no npm imports).
 */

import {
    decodeEscapeAt,
    findNextJsLineTerminator,
    isJsLineTerminator,
    scanQuotedLiteral,
    scanTemplateLiteral,
    skipLineOrBlockComment,
    skipRegexLiteralBody,
} from './security-stripper-escapes.js'

export {
    decodeEscapeAt,
    findNextJsLineTerminator,
    isJsLineTerminator,
    skipLineOrBlockComment,
    skipRegexLiteralBody,
}

function scanIdentifierWord(code: string, start: number): { word: string; next: number } {
    let word = ''
    let j = start
    while (j < code.length) {
        const nextCh = code[j]
        if (nextCh === '\\' && code[j + 1] === 'u') {
            const dec = decodeEscapeAt(code, j, false)
            word += dec.ch
            j = dec.next
            continue
        }
        const cp = code.codePointAt(j)
        if (cp === undefined) break
        const ch = String.fromCodePoint(cp)
        const isIdent =
            /[A-Za-z0-9_$]/.test(ch) || (cp > 0x7f && /[\p{ID_Continue}$_]/u.test(ch))
        if (!isIdent) break
        word += ch
        j += ch.length
    }
    return { word: word.normalize('NFKC'), next: j }
}

export { scanIdentifierWord }

const REGEX_PRECEDING_KEYWORDS =
    /^(?:return|typeof|instanceof|in|void|delete|throw|new|case|yield|await|else|do)$/
const CONTROL_HEADER_KEYWORDS = /^(?:if|while|for|with|catch|switch)$/
const STATEMENT_PRECEDING_TOKENS = new Set([
    '',
    ';',
    ':label',
    '{',
    '}block',
    ')ctrl',
    'else',
    'do',
    'try',
    'finally',
    'export',
])
const BLOCK_PRECEDING_TOKENS = new Set([
    '',
    ';',
    ':label',
    '{',
    '}block',
    ')ctrl',
    ')decl',
    '=>',
    'else',
    'do',
    'try',
    'catch',
    'finally',
])

export function canStartRegexLiteral(prev: string, inControlParen = false): boolean {
    if (!prev || prev === '}block' || prev === ')ctrl' || prev === '=>' || prev === ':label') return true
    if (inControlParen && prev === 'of') return true
    if (/^[([{:;,=!?&|+\-~*%^<>]$/.test(prev)) return true
    return REGEX_PRECEDING_KEYWORDS.test(prev)
}

export interface DelimiterState {
    templateBraces: number[]
    parenCtrl: boolean[]
    parenFnDecl: boolean[]
    braceBlock: boolean[]
    awaitingForParen: boolean
    awaitingClassBody: boolean
    classBraceDepth: number
    classParenDepth: number
    pendingFnDecl: boolean
    pendingAsyncStmt: boolean
    pendingLabel: boolean
    inCaseClause: boolean
}

export function createDelimiterState(): DelimiterState {
    return {
        templateBraces: [],
        parenCtrl: [],
        parenFnDecl: [],
        braceBlock: [],
        awaitingForParen: false,
        awaitingClassBody: false,
        classBraceDepth: -1,
        classParenDepth: -1,
        pendingFnDecl: false,
        pendingAsyncStmt: false,
        pendingLabel: false,
        inCaseClause: false,
    }
}

function isStatementContext(prevToken: string, state: DelimiterState): boolean {
    return (
        STATEMENT_PRECEDING_TOKENS.has(prevToken) &&
        (prevToken !== '{' || state.braceBlock.at(-1) !== false)
    )
}

function isAtClassSignatureDepth(state: DelimiterState): boolean {
    return (
        state.awaitingClassBody &&
        state.braceBlock.length === state.classBraceDepth &&
        state.parenCtrl.length === state.classParenDepth
    )
}

function clearClassSignature(state: DelimiterState): void {
    state.awaitingClassBody = false
    state.classBraceDepth = -1
    state.classParenDepth = -1
}

export function trackIdentifierToken(word: string, prevToken: string, state: DelimiterState): string {
    if (prevToken === '.' || prevToken === '?.') {
        state.awaitingForParen = false
        if (!isAtClassSignatureDepth(state)) clearClassSignature(state)
        state.pendingFnDecl = false
        state.pendingAsyncStmt = false
        state.pendingLabel = false
        return '$prop'
    }
    const stmtStart = isStatementContext(prevToken, state)
    state.awaitingForParen = prevToken === 'for' && word === 'await'
    state.pendingLabel =
        word === 'default' ||
        (stmtStart && word !== 'else' && word !== 'do' && word !== 'try' && word !== 'finally')
    if (word === 'case' && state.braceBlock.at(-1) === true) {
        state.inCaseClause = true
    }
    if (word === 'async') {
        state.pendingAsyncStmt = stmtStart
        state.pendingFnDecl = false
    } else if (word === 'function') {
        state.pendingFnDecl = stmtStart || (prevToken === 'async' && state.pendingAsyncStmt)
        state.pendingAsyncStmt = false
        clearClassSignature(state)
    } else if (word === 'class') {
        if (stmtStart) {
            state.awaitingClassBody = true
            state.classBraceDepth = state.braceBlock.length
            state.classParenDepth = state.parenCtrl.length
        } else {
            clearClassSignature(state)
        }
        state.pendingFnDecl = false
        state.pendingAsyncStmt = false
    } else {
        if (prevToken !== 'function') state.pendingFnDecl = false
        state.pendingAsyncStmt = false
        if (word === 'catch' || word === 'finally' || word === 'try' || word === 'else') {
            clearClassSignature(state)
        }
    }
    return word
}

export function trackPunctuationToken(ch: string, prevToken: string, state: DelimiterState): string {
    if (ch === '*' && prevToken === 'function' && state.pendingFnDecl) {
        state.pendingLabel = false
        return 'function'
    }
    if (ch === '(') {
        const isCtrl = CONTROL_HEADER_KEYWORDS.test(prevToken) || (state.awaitingForParen && prevToken === 'await')
        state.parenCtrl.push(isCtrl)
        state.parenFnDecl.push(!isCtrl && state.pendingFnDecl)
        state.awaitingForParen = false
        state.pendingFnDecl = false
        state.pendingAsyncStmt = false
        state.pendingLabel = false
        return '('
    }
    if (ch === ')') {
        const isCtrl = state.parenCtrl.pop() === true
        const isFnDecl = state.parenFnDecl.pop() === true
        state.pendingLabel = false
        if (isCtrl) return ')ctrl'
        return isFnDecl ? ')decl' : ')'
    }
    if (ch === '{') {
        if (state.templateBraces.length > 0) {
            const topIdx = state.templateBraces.length - 1
            state.templateBraces[topIdx] = (state.templateBraces[topIdx] ?? 0) + 1
        }
        const isClassBody = isAtClassSignatureDepth(state)
        const isBlock =
            isClassBody ||
            (BLOCK_PRECEDING_TOKENS.has(prevToken) &&
                (prevToken !== '{' || state.braceBlock.at(-1) === true))
        if (isClassBody) clearClassSignature(state)
        state.pendingFnDecl = false
        state.pendingAsyncStmt = false
        state.pendingLabel = false
        state.braceBlock.push(isBlock)
        return '{'
    }
    if (ch === '}') {
        if (state.templateBraces.length > 0) {
            const topIdx = state.templateBraces.length - 1
            const top = state.templateBraces[topIdx] ?? 0
            if (top > 0) state.templateBraces[topIdx] = top - 1
        }
        state.pendingLabel = false
        return state.braceBlock.pop() === true ? '}block' : '}expr'
    }
    if (ch === ':') {
        const isLabelOrCase = state.pendingLabel || state.inCaseClause
        state.pendingLabel = false
        state.inCaseClause = false
        state.awaitingForParen = false
        state.pendingFnDecl = false
        state.pendingAsyncStmt = false
        if (isAtClassSignatureDepth(state)) clearClassSignature(state)
        return isLabelOrCase ? ':label' : ':'
    }
    if (ch === ';' && isAtClassSignatureDepth(state)) clearClassSignature(state)
    state.awaitingForParen = false
    state.pendingFnDecl = false
    state.pendingAsyncStmt = false
    state.pendingLabel = false
    return ch
}

/**
 * Single-pass lexical scanner that strips JS comments and string literal contents
 * in a single left-to-right pass while preserving `${...}` interpolations,
 * sensitive prototype property strings, and regex literal boundaries.
 */
export function stripCommentsAndStrings(rawCode: string): string {
    const code = rawCode
    const len = code.length
    let out = ''
    let i = 0
    let lastNonWsToken = ''
    const state = createDelimiterState()

    while (i < len) {
        const ch = code[i] ?? ''
        const next = i + 1 < len ? (code[i + 1] ?? '') : ''

        const comment = skipLineOrBlockComment(code, i)
        if (comment !== null) {
            out += comment.out
            i = comment.next
            continue
        }
        if (
            ch === '/' &&
            next !== '/' &&
            next !== '*' &&
            canStartRegexLiteral(lastNonWsToken, state.parenCtrl.at(-1) === true)
        ) {
            out += '/ /'
            i = skipRegexLiteralBody(code, i + 1)
            lastNonWsToken = '/'
            continue
        }
        if (ch === '"' || ch === "'") {
            const scanned = scanQuotedLiteral(code, i + 1, ch)
            i = scanned.next
            out += scanned.sensitive ? `${ch}${scanned.content}${ch}` : `${ch}${ch}`
            lastNonWsToken = ch
            continue
        }
        const closingInterp =
            ch === '}' && state.templateBraces.length > 0 && state.templateBraces.at(-1) === 0
        if (ch === '`' || closingInterp) {
            if (ch === '}') state.templateBraces.pop()
            const scanned = scanTemplateLiteral(code, i + 1, ch === '}', state.templateBraces)
            out += scanned.out
            i = scanned.next
            if (scanned.lastToken !== undefined) lastNonWsToken = scanned.lastToken
            continue
        }
        if (
            (ch === '+' && next === '+') ||
            (ch === '-' && next === '-') ||
            (ch === '=' && next === '>') ||
            (ch === '?' && next === '.' && !/[0-9]/.test(code[i + 2] ?? ''))
        ) {
            lastNonWsToken = ch + next
            out += ch + next
            i += 2
            continue
        }
        const cp = code.codePointAt(i)
        if (
            /[A-Za-z0-9_$]/.test(ch) ||
            (ch === '\\' && next === 'u') ||
            (cp !== undefined && cp > 0x7f && /[\p{ID_Start}\p{ID_Continue}$_]/u.test(String.fromCodePoint(cp)))
        ) {
            const ident = scanIdentifierWord(code, i)
            lastNonWsToken = trackIdentifierToken(ident.word, lastNonWsToken, state)
            out += ident.word
            i = ident.next
            continue
        }
        if (!/\s/.test(ch)) lastNonWsToken = trackPunctuationToken(ch, lastNonWsToken, state)
        out += ch
        i++
    }

    return out
}
