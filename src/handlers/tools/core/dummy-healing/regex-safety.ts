/**
 * ReDoS safety validation for user-supplied regex patterns in directory search.
 */

export const MAX_USER_REGEX_LENGTH = 256
const MAX_UNBOUNDED_QUANTIFIERS = 5
const MAX_UNBOUNDED_WILDCARDS = 2
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

interface QuantifierReadResult {
    end: number
    repeating: boolean
    nullable: boolean
}

function readQuantifierAt(pattern: string, pos: number): QuantifierReadResult | null {
    const ch = pattern[pos]
    if (ch === '*' || ch === '+') {
        return { end: pos + (pattern[pos + 1] === '?' ? 2 : 1), repeating: true, nullable: ch === '*' }
    }
    if (ch === '?') {
        return { end: pos + (pattern[pos + 1] === '?' ? 2 : 1), repeating: false, nullable: true }
    }
    if (ch !== '{') return null
    let j = pos + 1
    while (j < pattern.length && (pattern[j] ?? '') >= '0' && (pattern[j] ?? '') <= '9') j++
    if (j === pos + 1 || pattern[j] !== ',') return null
    const minVal = Number(pattern.slice(pos + 1, j))
    j++
    const maxStart = j
    while (j < pattern.length && (pattern[j] ?? '') >= '0' && (pattern[j] ?? '') <= '9') j++
    if (pattern[j] !== '}') return null
    const maxStr = pattern.slice(maxStart, j)
    const end = j + (pattern[j + 1] === '?' ? 2 : 1)
    if (maxStr === '') return { end, repeating: true, nullable: minVal === 0 }
    const maxVal = Number(maxStr)
    if (maxVal <= minVal) return null
    return { end, repeating: maxVal > 1, nullable: minVal === 0 }
}

const UNIVERSAL_WILDCARD_CLASSES = new Set([
    '[\\s\\S]',
    '[\\S\\s]',
    '[\\d\\D]',
    '[\\D\\d]',
    '[\\w\\W]',
    '[\\W\\w]',
])

function isUniversalWildcardAtom(token: string): boolean {
    return (
        token === '.' ||
        UNIVERSAL_WILDCARD_CLASSES.has(token) ||
        (token.startsWith('[^') && token.endsWith(']'))
    )
}

function isLiteralDisjointFromShorthand(lit: string, short: string): boolean {
    if (short === '\\s') return !/^\s$/.test(lit)
    if (short === '\\S') return /^\s$/.test(lit)
    if (short === '\\w') return !/^[A-Za-z0-9_]$/.test(lit)
    if (short === '\\W') return /^[A-Za-z0-9_]$/.test(lit)
    if (short === '\\d') return !/^[0-9]$/.test(lit)
    if (short === '\\D') return /^[0-9]$/.test(lit)
    return false
}

function isSimpleNonWhitespaceClass(token: string): boolean {
    if (!token.startsWith('[') || !token.endsWith(']') || token.startsWith('[^')) return false
    const inner = token.slice(1, -1)
    return inner.length > 0 && !inner.includes('\\') && !/\s/.test(inner)
}

function areAtomsProvablyDisjoint(a: string, b: string): boolean {
    if (isUniversalWildcardAtom(a) || isUniversalWildcardAtom(b)) return false
    const aNorm = /^[A-Za-z]$/.test(a) ? a.toLowerCase() : a
    const bNorm = /^[A-Za-z]$/.test(b) ? b.toLowerCase() : b
    if (aNorm === bNorm) return false
    if (isDisjointShorthandPair(a, b)) return true
    if (
        (a === '\\s' && isSimpleNonWhitespaceClass(b)) ||
        (b === '\\s' && isSimpleNonWhitespaceClass(a))
    ) {
        return true
    }
    const aIsLiteral = a.length === 1 && a !== '[' && a !== '\\'
    const bIsLiteral = b.length === 1 && b !== '[' && b !== '\\'
    if (aIsLiteral && bIsLiteral) return true
    if (aIsLiteral && b.startsWith('\\') && b.length === 2) return isLiteralDisjointFromShorthand(a, b)
    if (bIsLiteral && a.startsWith('\\') && a.length === 2) return isLiteralDisjointFromShorthand(b, a)
    return false
}

function readEscapeAtomEnd(pattern: string, i: number): number {
    const esc = pattern[i + 1]
    if (esc === 'x' && /^[0-9a-fA-F]{2}/.test(pattern.slice(i + 2, i + 4))) return i + 4
    if (esc === 'c' && /[A-Za-z]/.test(pattern[i + 2] ?? '')) return i + 3
    if (esc === 'u') {
        if (pattern[i + 2] === '{') {
            const close = pattern.indexOf('}', i + 3)
            if (close !== -1) return close + 1
        }
        if (/^[0-9a-fA-F]{4}/.test(pattern.slice(i + 2, i + 6))) return i + 6
    }
    if ((esc === 'p' || esc === 'P') && pattern[i + 2] === '{') {
        const close = pattern.indexOf('}', i + 3)
        if (close !== -1) return close + 1
    }
    return i + 2
}

function readAtomToken(pattern: string, i: number): { token: string; next: number } {
    const ch = pattern[i] ?? ''
    if (ch === '\\' && i + 1 < pattern.length) {
        const end = readEscapeAtomEnd(pattern, i)
        return { token: pattern.slice(i, end), next: end }
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

interface QuantGroupFrame {
    entryPrev: readonly string[]
    hasAlternation: boolean
    zeroWidth: boolean
    singleAtom: string | null
    tokenCount: number
    hasInnerQuant: boolean
    branchEnds: (readonly string[])[]
}

function mergeQuantAtomSets(sets: readonly (readonly string[])[]): string[] {
    const merged: string[] = []
    for (const atoms of sets) {
        for (const atom of atoms) {
            if (isUniversalWildcardAtom(atom)) return ['.']
            if (!merged.includes(atom)) merged.push(atom)
        }
    }
    return merged.length > 6 ? ['.'] : merged
}

function anyAtomOverlaps(atoms: readonly string[], token: string): boolean {
    return atoms.some((atom) => !areAtomsProvablyDisjoint(atom, token))
}

function retainOverlappingAtoms(atoms: readonly string[], token: string): string[] {
    return atoms.filter((atom) => !areAtomsProvablyDisjoint(atom, token))
}

function groupPrefixSkipLength(pattern: string, idx: number): { skip: number; zeroWidth: boolean } {
    if (pattern[idx + 1] !== '?') return { skip: 1, zeroWidth: false }
    if (pattern.startsWith('(?<=', idx) || pattern.startsWith('(?<!', idx)) return { skip: 4, zeroWidth: true }
    if (pattern.startsWith('(?!', idx) || pattern.startsWith('(?=', idx)) return { skip: 3, zeroWidth: true }
    if (pattern.startsWith('(?:', idx)) return { skip: 3, zeroWidth: false }
    if (pattern.startsWith('(?<', idx)) {
        const closeAngle = pattern.indexOf('>', idx + 3)
        if (closeAngle > idx + 3) {
            const nameSlice = pattern.slice(idx + 3, closeAngle)
            if (!/[()[\]\\]/.test(nameSlice)) {
                return { skip: closeAngle - idx + 1, zeroWidth: false }
            }
        }
    }
    return { skip: 1, zeroWidth: false }
}

interface QuantScannerState {
    repeatingCount: number
    wildcardCount: number
    prevQuantAtoms: readonly string[]
    groupStack: QuantGroupFrame[]
}

function stepClosingParenGroup(pattern: string, i: number, state: QuantScannerState): { nextIdx: number; unsafe: boolean } {
    const popped = state.groupStack.pop()
    const groupQuant = readQuantifierAt(pattern, i + 1)
    if (popped === undefined) {
        state.prevQuantAtoms = []
        return { nextIdx: groupQuant !== null ? groupQuant.end : i + 1, unsafe: false }
    }
    if (popped.zeroWidth) {
        if (groupQuant?.repeating === true) {
            return { nextIdx: pattern.length, unsafe: true }
        }
        state.prevQuantAtoms = popped.entryPrev
        return { nextIdx: groupQuant !== null ? groupQuant.end : i + 1, unsafe: false }
    }
    if (groupQuant !== null && groupQuant.repeating && popped.tokenCount === 1 && popped.singleAtom !== null) {
        state.repeatingCount++
        if (isUniversalWildcardAtom(popped.singleAtom)) state.wildcardCount++
        if (state.repeatingCount > MAX_UNBOUNDED_QUANTIFIERS || state.wildcardCount > MAX_UNBOUNDED_WILDCARDS) {
            return { nextIdx: pattern.length, unsafe: true }
        }
        if (anyAtomOverlaps(popped.entryPrev, popped.singleAtom)) {
            return { nextIdx: pattern.length, unsafe: true }
        }
        state.prevQuantAtoms = !groupQuant.nullable
            ? [popped.singleAtom]
            : mergeQuantAtomSets([popped.entryPrev, [popped.singleAtom]])
        return { nextIdx: groupQuant.end, unsafe: false }
    }
    if (groupQuant?.repeating === true) {
        if (popped.entryPrev.length > 0) {
            return { nextIdx: pattern.length, unsafe: true }
        }
        state.repeatingCount++
        if (state.repeatingCount > MAX_UNBOUNDED_QUANTIFIERS) {
            return { nextIdx: pattern.length, unsafe: true }
        }
        state.prevQuantAtoms = ['.']
        return { nextIdx: groupQuant.end, unsafe: false }
    }
    const branchMerged = popped.hasAlternation
        ? mergeQuantAtomSets([...popped.branchEnds, state.prevQuantAtoms])
        : state.prevQuantAtoms
    state.prevQuantAtoms =
        groupQuant?.nullable === true ? mergeQuantAtomSets([branchMerged, popped.entryPrev]) : branchMerged
    return { nextIdx: groupQuant !== null ? groupQuant.end : i + 1, unsafe: false }
}

/** Reject ungrouped overlapping/adjacent quantifiers, group-boundary chains, and excessive wildcards. */
function hasUnsafeUngroupedQuantifiers(pattern: string): boolean {
    const state: QuantScannerState = { repeatingCount: 0, wildcardCount: 0, prevQuantAtoms: [], groupStack: [] }
    let i = 0
    while (i < pattern.length) {
        const ch = pattern[i] ?? ''
        if (ch === '^' || ch === '$') { state.prevQuantAtoms = []; i++; continue }
        if (ch === '(') {
            const prefix = groupPrefixSkipLength(pattern, i)
            state.groupStack.push({
                entryPrev: state.prevQuantAtoms, hasAlternation: false, zeroWidth: prefix.zeroWidth,
                singleAtom: null, tokenCount: 0, hasInnerQuant: false, branchEnds: [],
            })
            if (prefix.zeroWidth) state.prevQuantAtoms = []
            i += prefix.skip; continue
        }
        if (ch === '|') {
            const top = state.groupStack.at(-1)
            if (top !== undefined) {
                top.hasAlternation = true; top.branchEnds.push(state.prevQuantAtoms)
                state.prevQuantAtoms = top.zeroWidth ? [] : top.entryPrev
            } else { state.prevQuantAtoms = [] }
            i++; continue
        }
        if (ch === ')') {
            const step = stepClosingParenGroup(pattern, i, state)
            if (step.unsafe) return true
            i = step.nextIdx; continue
        }
        const { token, next } = readAtomToken(pattern, i)
        if (token === '\\b' || token === '\\B') { i = next; continue }
        const topFrame = state.groupStack.at(-1)
        if (topFrame !== undefined) {
            topFrame.tokenCount++
            topFrame.singleAtom = topFrame.tokenCount === 1 ? token : null
        }
        const quant = readQuantifierAt(pattern, next)
        if (quant === null) {
            state.prevQuantAtoms = retainOverlappingAtoms(state.prevQuantAtoms, token)
            i = next
            continue
        }
        if (topFrame !== undefined) topFrame.hasInnerQuant = true
        if (!quant.repeating) { i = quant.end; continue }
        state.repeatingCount++
        if (isUniversalWildcardAtom(token)) state.wildcardCount++
        if (state.repeatingCount > MAX_UNBOUNDED_QUANTIFIERS || state.wildcardCount > MAX_UNBOUNDED_WILDCARDS) return true
        if (anyAtomOverlaps(state.prevQuantAtoms, token)) return true
        state.prevQuantAtoms = quant.nullable
            ? mergeQuantAtomSets([state.prevQuantAtoms, [token]])
            : [token]
        i = quant.end
    }
    return false
}

/** Reject over-long regexes, nested quantifiers (ReDoS), repeated wildcards, ungrouped quantifier chains, and backreferences. */
export function isSafeUserRegex(pattern: string): boolean {
    if (pattern.length > MAX_USER_REGEX_LENGTH) return false
    if (BACKREFERENCE_REGEX.test(pattern)) return false
    if (REPEATED_WILDCARD_REGEX.test(pattern)) return false
    if (hasUnsafeGroupNesting(pattern)) return false
    if (hasUnsafeUngroupedQuantifiers(pattern)) return false
    return true
}
