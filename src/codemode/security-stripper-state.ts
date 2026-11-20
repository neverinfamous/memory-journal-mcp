/**
 * Delimiter, contextual keyword, ASI, and wrapper-balance state tracking for
 * `security-stripper.ts`, `auto-return.ts`, and `code-healer-rewrites.ts`.
 * Worker-thread safe (zero npm imports).
 */

const REGEX_PRECEDING_KEYWORDS =
    /^(?:return|typeof|instanceof|in|void|delete|throw|new|case|yield|await|else|do|break|continue|debugger)$/
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
const CLASS_EXTENDS_OBJ_PRECEDING = new Set(['extends', '=', '(', '[', ',', '?', ':', '&&', '||', '??'])
const FOR_OF_DECL_KEYWORDS = new Set(['var', 'let', 'const', 'using', 'await'])
const NON_LHS_BEFORE_IDENT = new Set(['=', '+', '-', '*', '/', '%', '**', '&', '|', '^', '<', '>', '!', '~', '?', ':', ',', ';', '[', '{', 'return', 'typeof', 'void', 'delete', 'throw', 'yield', 'case', 'in', 'instanceof'])

export interface BraceFrame {
    stmtInterior: boolean
    closesAsBlock: boolean
    isClassBody: boolean
}

export interface PendingClassFrame {
    isDecl: boolean
    braceDepth: number
    parenDepth: number
    inExtends: boolean
}

export type ParenKind = 'for' | 'ctrl' | 'decl' | 'expr'

export interface DelimiterState {
    templateBraces: number[]
    parenCtrl: boolean[]
    parenKind: ParenKind[]
    parenFnDecl: boolean[]
    braceStack: BraceFrame[]
    pendingClasses: PendingClassFrame[]
    awaitingForParen: boolean
    pendingFnDecl: boolean
    pendingAsyncStmt: boolean
    pendingLabel: boolean
    inCaseClause: boolean
    caseTernaryDepth: number
    prevPrevToken: string
    ofIsForOf: boolean
    pendingAsiStmtKeyword: 'break' | 'continue' | 'var_let' | null
    identAfterAsiKeyword: boolean
    canAsiRegex: boolean
}

export function createDelimiterState(): DelimiterState {
    return {
        templateBraces: [],
        parenCtrl: [],
        parenKind: [],
        parenFnDecl: [],
        braceStack: [],
        pendingClasses: [],
        awaitingForParen: false,
        pendingFnDecl: false,
        pendingAsyncStmt: false,
        pendingLabel: false,
        inCaseClause: false,
        caseTernaryDepth: 0,
        prevPrevToken: '',
        ofIsForOf: false,
        pendingAsiStmtKeyword: null,
        identAfterAsiKeyword: false,
        canAsiRegex: false,
    }
}

export function markLineTerminator(state: DelimiterState): void {
    if (
        state.pendingAsiStmtKeyword === 'break' ||
        state.pendingAsiStmtKeyword === 'continue' ||
        (state.pendingAsiStmtKeyword === 'var_let' && state.identAfterAsiKeyword)
    ) {
        state.canAsiRegex = true
    }
    state.pendingAsiStmtKeyword = null
    state.identAfterAsiKeyword = false
}

export function canStartRegexLiteral(
    prev: string,
    inControlOrState: boolean | DelimiterState = false
): boolean {
    const state = typeof inControlOrState === 'object' ? inControlOrState : undefined
    if (state?.canAsiRegex === true) return true
    if (!prev || prev === '}block' || prev === ')ctrl' || prev === '=>' || prev === ':label') return true
    if (prev === 'of') {
        return state !== undefined ? state.parenKind.at(-1) === 'for' && state.ofIsForOf : inControlOrState === true
    }
    if (/^(?:[([{:;,=!?&|+\-~*%^<>]|\?\?|\*\*|&&|\|\|)$/.test(prev)) return true
    return REGEX_PRECEDING_KEYWORDS.test(prev)
}

function isStatementContext(prevToken: string, state: DelimiterState): boolean {
    if (!STATEMENT_PRECEDING_TOKENS.has(prevToken)) return false
    if (prevToken === '{') return state.braceStack.at(-1)?.stmtInterior !== false
    return true
}

function isAtPendingClassTop(state: DelimiterState): PendingClassFrame | undefined {
    const top = state.pendingClasses.at(-1)
    if (top === undefined) return undefined
    return state.braceStack.length === top.braceDepth && state.parenKind.length === top.parenDepth
        ? top
        : undefined
}

function isValidForOfLhsBeforeOf(prevToken: string, prevPrevToken: string): boolean {
    if (prevToken === ']' || prevToken === '}expr' || prevToken === '$prop' || prevToken === ')') {
        return true
    }
    if (!/^[A-Za-z_$][\w$]*$/.test(prevToken) && (prevToken.codePointAt(0) ?? 0) <= 0x7f) {
        return false
    }
    if (FOR_OF_DECL_KEYWORDS.has(prevToken)) return false
    if (FOR_OF_DECL_KEYWORDS.has(prevPrevToken) || prevPrevToken === '(') return true
    return !NON_LHS_BEFORE_IDENT.has(prevPrevToken)
}

function updateAsiTrackingOnIdentifier(word: string, stmtStart: boolean, state: DelimiterState): void {
    state.canAsiRegex = false
    if (stmtStart && (word === 'break' || word === 'continue')) {
        state.pendingAsiStmtKeyword = word
        state.identAfterAsiKeyword = false
        return
    }
    if (stmtStart && (word === 'let' || word === 'var')) {
        state.pendingAsiStmtKeyword = 'var_let'
        state.identAfterAsiKeyword = false
        return
    }
    if (state.pendingAsiStmtKeyword !== null && !state.identAfterAsiKeyword) {
        state.identAfterAsiKeyword = true
        return
    }
    state.pendingAsiStmtKeyword = null
    state.identAfterAsiKeyword = false
}

export function trackIdentifierToken(word: string, prevToken: string, state: DelimiterState): string {
    const prevPrev = state.prevPrevToken
    state.prevPrevToken = prevToken
    if (prevToken === '.' || prevToken === '?.') {
        state.awaitingForParen = false
        state.pendingFnDecl = false
        state.pendingAsyncStmt = false
        state.pendingLabel = false
        state.pendingAsiStmtKeyword = null
        state.identAfterAsiKeyword = false
        state.canAsiRegex = false
        state.ofIsForOf = false
        return '$prop'
    }
    const stmtStart = isStatementContext(prevToken, state)
    const clsTop = isAtPendingClassTop(state)
    state.ofIsForOf = word === 'of' && state.parenKind.at(-1) === 'for' && isValidForOfLhsBeforeOf(prevToken, prevPrev)
    state.awaitingForParen = prevToken === 'for' && word === 'await'
    state.pendingLabel =
        word === 'default' ||
        (stmtStart && word !== 'else' && word !== 'do' && word !== 'try' && word !== 'finally')
    updateAsiTrackingOnIdentifier(word, stmtStart, state)

    if (word === 'case' && state.braceStack.at(-1)?.stmtInterior === true) {
        state.inCaseClause = true
        state.caseTernaryDepth = 0
    }
    if (word === 'async') {
        state.pendingAsyncStmt = stmtStart
        state.pendingFnDecl = false
    } else if (word === 'function') {
        state.pendingFnDecl = stmtStart || (prevToken === 'async' && state.pendingAsyncStmt)
        state.pendingAsyncStmt = false
    } else if (word === 'class') {
        state.pendingClasses.push({
            isDecl: stmtStart,
            braceDepth: state.braceStack.length,
            parenDepth: state.parenKind.length,
            inExtends: false,
        })
        state.pendingFnDecl = false
        state.pendingAsyncStmt = false
    } else {
        if (prevToken !== 'function') state.pendingFnDecl = false
        state.pendingAsyncStmt = false
        if (word === 'extends' && clsTop !== undefined) clsTop.inExtends = true
        else if (word === 'catch' || word === 'finally' || word === 'try' || word === 'else') {
            if (clsTop !== undefined) state.pendingClasses.pop()
        }
    }
    return word
}

function handleOpenBrace(prevToken: string, state: DelimiterState): string {
    if (state.templateBraces.length > 0) {
        const topIdx = state.templateBraces.length - 1
        state.templateBraces[topIdx] = (state.templateBraces[topIdx] ?? 0) + 1
    }
    const parentFrame = state.braceStack.at(-1)
    const clsTop = isAtPendingClassTop(state)
    const isExtendsObjLiteral = clsTop !== undefined && clsTop.inExtends && CLASS_EXTENDS_OBJ_PRECEDING.has(prevToken)
    const isClassBody = clsTop !== undefined && !isExtendsObjLiteral
    if (isClassBody) state.pendingClasses.pop()

    const isStaticBlock = prevToken === 'static' && parentFrame?.isClassBody === true
    const isMethodOrFnExprBody = !isClassBody && prevToken === ')'
    const isNestedStmtBlock = prevToken === '{' && parentFrame?.stmtInterior === true
    const isStdBlock = BLOCK_PRECEDING_TOKENS.has(prevToken) && (prevToken !== '{' || isNestedStmtBlock)
    const stmtInterior = isClassBody ? false : isStaticBlock || isMethodOrFnExprBody || isStdBlock
    const closesAsBlock = isClassBody
        ? clsTop.isDecl
        : isMethodOrFnExprBody
          ? parentFrame?.isClassBody === true
          : isStaticBlock || isStdBlock

    state.braceStack.push({ stmtInterior, closesAsBlock, isClassBody })
    state.pendingFnDecl = false
    state.pendingAsyncStmt = false
    state.pendingLabel = false
    return '{'
}

function handleColonOrSemicolon(ch: string, state: DelimiterState): string {
    if (ch === ':') {
        if (state.inCaseClause && state.caseTernaryDepth > 0) {
            state.caseTernaryDepth--
            state.pendingLabel = false
            return ':'
        }
        const isLabelOrCase = state.pendingLabel || state.inCaseClause
        state.pendingLabel = false
        state.inCaseClause = false
        state.caseTernaryDepth = 0
        state.awaitingForParen = false
        state.pendingFnDecl = false
        state.pendingAsyncStmt = false
        if (isAtPendingClassTop(state) !== undefined) state.pendingClasses.pop()
        return isLabelOrCase ? ':label' : ':'
    }
    if (state.parenKind.at(-1) === 'for') {
        state.parenKind[state.parenKind.length - 1] = 'ctrl'
    }
    if (isAtPendingClassTop(state) !== undefined) state.pendingClasses.pop()
    return ';'
}

export function trackPunctuationToken(ch: string, prevToken: string, state: DelimiterState): string {
    state.prevPrevToken = prevToken
    state.canAsiRegex = false
    state.ofIsForOf = false
    state.pendingAsiStmtKeyword = null
    state.identAfterAsiKeyword = false
    if (ch === '*' && prevToken === 'function' && state.pendingFnDecl) {
        state.pendingLabel = false
        return 'function'
    }
    if (ch === '(') {
        const isFor = prevToken === 'for' || (state.awaitingForParen && prevToken === 'await')
        const isCtrl = isFor || CONTROL_HEADER_KEYWORDS.test(prevToken)
        const isFnDecl = !isCtrl && state.pendingFnDecl
        state.parenCtrl.push(isCtrl)
        state.parenKind.push(isFor ? 'for' : isCtrl ? 'ctrl' : isFnDecl ? 'decl' : 'expr')
        state.parenFnDecl.push(isFnDecl)
        state.awaitingForParen = false
        state.pendingFnDecl = false
        state.pendingAsyncStmt = false
        state.pendingLabel = false
        return '('
    }
    if (ch === ')') {
        state.parenCtrl.pop()
        const kind = state.parenKind.pop()
        const isFnDecl = state.parenFnDecl.pop() === true
        state.pendingLabel = false
        if (kind === 'for' || kind === 'ctrl') return ')ctrl'
        return isFnDecl ? ')decl' : ')'
    }
    if (ch === '{') return handleOpenBrace(prevToken, state)
    if (ch === '}') {
        if (state.templateBraces.length > 0) {
            const topIdx = state.templateBraces.length - 1
            const top = state.templateBraces[topIdx] ?? 0
            if (top > 0) state.templateBraces[topIdx] = top - 1
        }
        state.pendingLabel = false
        return state.braceStack.pop()?.closesAsBlock === true ? '}block' : '}expr'
    }
    if (ch === '?' && state.inCaseClause) {
        state.caseTernaryDepth++
        state.pendingLabel = false
        return ch
    }
    if (ch === ':' || ch === ';') {
        if (ch === ':') return handleColonOrSemicolon(ch, state)
        handleColonOrSemicolon(ch, state)
    }
    state.awaitingForParen = false
    state.pendingFnDecl = false
    state.pendingAsyncStmt = false
    state.pendingLabel = false
    return ch
}

/**
 * Returns true if stripped sandbox code drops any delimiter (`}`, `)`, `]`) below zero depth,
 * preventing early breakout from the top-level `vm.Script` async IIFE wrapper.
 */
export function hasUnbalancedClosingDelimiter(strippedCode: string): boolean {
    let braceDepth = 0
    let parenDepth = 0
    let bracketDepth = 0
    let inQuote: string | null = null
    let i = 0
    while (i < strippedCode.length) {
        const ch = strippedCode[i] ?? ''
        if (inQuote !== null) {
            if (ch === '\\') {
                i += 2
                continue
            }
            if (ch === inQuote) inQuote = null
            i++
            continue
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            inQuote = ch
        } else if (ch === '{') braceDepth++
        else if (ch === '}') {
            if (--braceDepth < 0) return true
        } else if (ch === '(') parenDepth++
        else if (ch === ')') {
            if (--parenDepth < 0) return true
        } else if (ch === '[') bracketDepth++
        else if (ch === ']') {
            if (--bracketDepth < 0) return true
        }
        i++
    }
    return false
}
