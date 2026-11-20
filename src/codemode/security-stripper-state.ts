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
const FOR_OF_NON_LHS_KEYWORDS = new Set([
    'typeof',
    'void',
    'new',
    'delete',
    'in',
    'instanceof',
    'yield',
    'throw',
    'return',
    'case',
    'else',
    'do',
])
const NON_LHS_BEFORE_IDENT = new Set(['=', '+', '-', '*', '/', '%', '**', '&', '|', '^', '<', '>', '!', '~', '?', ':', ',', ';', '[', '{', 'return', 'typeof', 'void', 'delete', 'throw', 'yield', 'case', 'in', 'instanceof'])
const CLASS_MEMBER_NAME_PRECEDING = new Set(['{', '}block', ';', 'static', 'async', 'get', 'set', '*'])

export { hasUnbalancedClosingDelimiter } from './security-stripper-delimiters.js'

export interface BraceFrame {
    stmtInterior: boolean
    closesAsBlock: boolean
    isClassBody: boolean
    isSwitchBody: boolean
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
    parenBraceDepth: number[]
    parenFnDecl: boolean[]
    parenFnExpr: boolean[]
    parenIsSwitch: boolean[]
    braceStack: BraceFrame[]
    pendingClasses: PendingClassFrame[]
    awaitingForParen: boolean
    pendingFnDecl: boolean
    pendingFnExpr: boolean
    lastParenWasFnExpr: boolean
    pendingAsyncStmt: boolean
    pendingSwitchOpen: boolean
    pendingLabel: boolean
    inCaseClause: boolean
    caseTernaryDepth: number
    caseBraceDepth: number
    caseParenDepth: number
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
        parenBraceDepth: [],
        parenFnDecl: [],
        parenFnExpr: [],
        parenIsSwitch: [],
        braceStack: [],
        pendingClasses: [],
        awaitingForParen: false,
        pendingFnDecl: false,
        pendingFnExpr: false,
        lastParenWasFnExpr: false,
        pendingAsyncStmt: false,
        pendingSwitchOpen: false,
        pendingLabel: false,
        inCaseClause: false,
        caseTernaryDepth: 0,
        caseBraceDepth: 0,
        caseParenDepth: 0,
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
    if (state.braceStack.at(-1)?.stmtInterior === false) return false
    return STATEMENT_PRECEDING_TOKENS.has(prevToken)
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
    if (FOR_OF_DECL_KEYWORDS.has(prevToken) || FOR_OF_NON_LHS_KEYWORDS.has(prevToken)) return false
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

function resetNonMemberPendingFlags(state: DelimiterState): void {
    state.awaitingForParen = false
    state.pendingFnDecl = false
    state.pendingFnExpr = false
    state.pendingAsyncStmt = false
    state.pendingSwitchOpen = false
    state.pendingLabel = false
    state.lastParenWasFnExpr = false
}

/** Updates delimiter/ASI state across two-character operators (`++`, `--`, `=>`, `??`, `?.`). */
export function trackTwoCharOperatorToken(
    op: string,
    prevToken: string,
    state: DelimiterState
): string {
    state.prevPrevToken = prevToken
    state.canAsiRegex = false
    state.ofIsForOf = false
    state.pendingAsiStmtKeyword = null
    state.identAfterAsiKeyword = false
    resetNonMemberPendingFlags(state)
    return op
}

export function trackIdentifierToken(word: string, prevToken: string, state: DelimiterState): string {
    const prevPrev = state.prevPrevToken
    state.prevPrevToken = prevToken
    if (prevToken === '.' || prevToken === '?.' || prevToken === '.#') {
        resetNonMemberPendingFlags(state)
        state.pendingAsiStmtKeyword = null
        state.identAfterAsiKeyword = false
        state.canAsiRegex = false
        state.ofIsForOf = false
        return '$prop'
    }
    state.pendingSwitchOpen = false
    state.lastParenWasFnExpr = false
    const stmtStart = isStatementContext(prevToken, state)
    const clsTop = isAtPendingClassTop(state)
    const inSwitchBody = state.braceStack.at(-1)?.isSwitchBody === true
    state.ofIsForOf =
        word === 'of' &&
        state.parenKind.at(-1) === 'for' &&
        state.braceStack.length === state.parenBraceDepth.at(-1) &&
        isValidForOfLhsBeforeOf(prevToken, prevPrev)
    state.awaitingForParen = prevToken === 'for' && word === 'await'
    state.pendingLabel =
        word === 'default'
            ? inSwitchBody
            : stmtStart && word !== 'else' && word !== 'do' && word !== 'try' && word !== 'finally'
    updateAsiTrackingOnIdentifier(word, stmtStart, state)

    if (word === 'case' && state.braceStack.at(-1)?.stmtInterior === true) {
        state.inCaseClause = true
        state.caseTernaryDepth = 0
        state.caseBraceDepth = state.braceStack.length
        state.caseParenDepth = state.parenKind.length
    }
    if (word === 'async') {
        state.pendingAsyncStmt = stmtStart
        state.pendingFnDecl = false
        state.pendingFnExpr = false
    } else if (word === 'function') {
        const isDeclFn = stmtStart || (prevToken === 'async' && state.pendingAsyncStmt)
        state.pendingFnDecl = isDeclFn
        state.pendingFnExpr = !isDeclFn
        state.pendingAsyncStmt = false
    } else if (word === 'class') {
        const inClassMemberSlot =
            state.braceStack.at(-1)?.isClassBody === true &&
            CLASS_MEMBER_NAME_PRECEDING.has(prevToken)
        if (!inClassMemberSlot) {
            state.pendingClasses.push({
                isDecl: stmtStart,
                braceDepth: state.braceStack.length,
                parenDepth: state.parenKind.length,
                inExtends: false,
            })
        }
        state.pendingFnDecl = false
        state.pendingFnExpr = false
        state.pendingAsyncStmt = false
    } else {
        if (prevToken !== 'function') {
            state.pendingFnDecl = false
            state.pendingFnExpr = false
        }
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

    const isSwitchBody = prevToken === ')ctrl' && state.pendingSwitchOpen
    const isStaticBlock = prevToken === 'static' && parentFrame?.isClassBody === true
    const isMethodOrFnExprBody = !isClassBody && prevToken === ')'
    const isNestedStmtBlock = prevToken === '{' && parentFrame?.stmtInterior === true
    const isStdBlock = BLOCK_PRECEDING_TOKENS.has(prevToken) && (prevToken !== '{' || isNestedStmtBlock)
    const stmtInterior = isClassBody ? false : isStaticBlock || isMethodOrFnExprBody || isStdBlock
    const closesAsBlock = isClassBody
        ? clsTop.isDecl
        : isMethodOrFnExprBody
          ? parentFrame?.isClassBody === true && !state.lastParenWasFnExpr
          : isStaticBlock || isStdBlock

    state.braceStack.push({ stmtInterior, closesAsBlock, isClassBody, isSwitchBody })
    resetNonMemberPendingFlags(state)
    return '{'
}

function handleColonOrSemicolon(ch: string, state: DelimiterState): string {
    state.pendingSwitchOpen = false
    state.lastParenWasFnExpr = false
    if (ch === ':') {
        const atCaseTop =
            state.inCaseClause &&
            state.braceStack.length === state.caseBraceDepth &&
            state.parenKind.length === state.caseParenDepth
        if (atCaseTop && state.caseTernaryDepth > 0) {
            state.caseTernaryDepth--
            state.pendingLabel = false
            return ':'
        }
        const isLabelOrCase = state.pendingLabel || atCaseTop
        state.pendingLabel = false
        if (atCaseTop) {
            state.inCaseClause = false
            state.caseTernaryDepth = 0
        }
        state.awaitingForParen = false
        state.pendingFnDecl = false
        state.pendingFnExpr = false
        state.pendingAsyncStmt = false
        if (isAtPendingClassTop(state) !== undefined) state.pendingClasses.pop()
        return isLabelOrCase ? ':label' : ':'
    }
    if (state.parenKind.at(-1) === 'for' && state.braceStack.length === state.parenBraceDepth.at(-1)) {
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
    if (ch === '#' && (prevToken === '.' || prevToken === '?.')) {
        resetNonMemberPendingFlags(state)
        return '.#'
    }
    if (ch === '*' && prevToken === 'function' && (state.pendingFnDecl || state.pendingFnExpr)) {
        state.pendingLabel = false
        state.pendingSwitchOpen = false
        state.lastParenWasFnExpr = false
        return 'function'
    }
    if (ch === '(') {
        const clsTop = isAtPendingClassTop(state)
        if (clsTop !== undefined && !clsTop.inExtends) state.pendingClasses.pop()
        const isFor = prevToken === 'for' || (state.awaitingForParen && prevToken === 'await')
        const isSwitch = prevToken === 'switch'
        const isCtrl = isFor || CONTROL_HEADER_KEYWORDS.test(prevToken)
        const isFnDecl = !isCtrl && state.pendingFnDecl
        const isFnExpr = !isCtrl && state.pendingFnExpr
        state.parenCtrl.push(isCtrl)
        state.parenKind.push(isFor ? 'for' : isCtrl ? 'ctrl' : isFnDecl ? 'decl' : 'expr')
        state.parenBraceDepth.push(state.braceStack.length)
        state.parenFnDecl.push(isFnDecl)
        state.parenFnExpr.push(isFnExpr)
        state.parenIsSwitch.push(isSwitch)
        resetNonMemberPendingFlags(state)
        state.awaitingForParen = false
        return '('
    }
    if (ch === ')') {
        state.parenCtrl.pop()
        const kind = state.parenKind.pop()
        state.parenBraceDepth.pop()
        const isFnDecl = state.parenFnDecl.pop() === true
        state.lastParenWasFnExpr = state.parenFnExpr.pop() === true
        state.pendingSwitchOpen = state.parenIsSwitch.pop() === true
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
        resetNonMemberPendingFlags(state)
        return state.braceStack.pop()?.closesAsBlock === true ? '}block' : '}expr'
    }
    if (ch === '=' || ch === ',') {
        const clsTop = isAtPendingClassTop(state)
        if (clsTop !== undefined && !clsTop.inExtends) state.pendingClasses.pop()
    }
    if (
        ch === '?' &&
        state.inCaseClause &&
        state.braceStack.length === state.caseBraceDepth &&
        state.parenKind.length === state.caseParenDepth
    ) {
        state.caseTernaryDepth++
        resetNonMemberPendingFlags(state)
        return ch
    }
    if (ch === ':' || ch === ';') {
        if (ch === ':') return handleColonOrSemicolon(ch, state)
        handleColonOrSemicolon(ch, state)
    }
    resetNonMemberPendingFlags(state)
    return ch
}
