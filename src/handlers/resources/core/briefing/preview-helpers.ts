/**
 * Briefing — shared preview extraction.
 *
 * [INVARIANT] Every briefing/graph/agent-context preview goes through `extractPreview` so the
 * Journal row, Active threads, `memory://graph` nodes and session-entry lists agree on marker
 * stripping, CMS-04 heading skipping and home-path redaction. Callers fence the result.
 */

const PREVIEW_FENCE_OPEN_RE = /^<untrusted_remote_content>\r?\n?/i
const PREVIEW_FENCE_CLOSE_RE = /\r?\n?<\/untrusted_remote_content>$/i
const CLOSING_FENCE_TAG_RE = /<\/untrusted_remote_content>/i
const INLINE_FENCE_TAG_RE = /<\/?untrusted_remote_content>/gi

/** CMS-04 session-summary H2 headings and standalone `# Session Summary` carry no signal alone. */
const CMS_HEADING_RE =
    /^#{1,6}[^\w#]*(?:Session Summary(?:\s*:\s*(?:Accomplished|Unfinished\s*\/\s*Blocked|Context for Next Session|Commits))?|Accomplished|Unfinished\s*\/\s*Blocked|Context for Next Session|Commits)\s*(?::\s*)?$/i
/** Inline legacy form `## Accomplished - did X`. */
const CMS_INLINE_HEADING_RE =
    /^#{1,6}[^\w#]*(?:Accomplished|Unfinished\s*\/\s*Blocked|Context for Next Session|Commits)\s*[-:–—]\s*/i
/** Commit-narrative trailer lines (`Commit: <sha>`, `**Commit**: <sha>`) duplicate `→#id`. */
const COMMIT_TRAILER_RE = /^(?:\*\*)?Commit:?(?:\*\*)?:?\s*`?[0-9a-f]{7,40}`?\s*$/i
/** CommonMark code fence openers (` ``` ` with no backticks in info string, or `~~~`) and horizontal rules. */
const CODE_FENCE_OPEN_RE = /^[ ]{0,3}(?:(`{3,})[^`]*$|(~{3,}))/
const HORIZONTAL_RULE_RE = /^[-*_]{3,}\s*$/

const LEADING_MARKER_RES: readonly RegExp[] = [
    /^#{1,6}\s+/,
    /^>\s*/,
    /^[-*+•]\s+/,
    /^\d+[.)]\s+/,
    /^\[[ xX]\]\s+/,
]

/** Abbreviations and numbered-list prefixes that end in `.` without ending a sentence. */
const NON_SENTENCE_END_RE = /(?:^|[\s(])(?:e\.g|i\.e|vs|etc|cf|al|dr|mr|mrs|ms|jr|sr|no|fig|eq|ref|v\d+|\d+)\.$/i

/** Collapse machine-local home directories (Windows, JSON-escaped Windows, WSL2, POSIX). */
export function redactHomePaths(text: string): string {
    return text
        .replace(
            /[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)[^\\/\r\n<>`"')\].,:;]+(?:\\{1,2}|\/)\.gemini(?:\\{1,2}|\/)antigravity(?:-ide)?(?:\\{1,2}|\/)brain/gi,
            '<appDataDir>/brain'
        )
        .replace(
            /(?<![\w.])(?:\/mnt\/[A-Za-z])?\/(?:home|Users)\/[^/\r\n<>`"')\].,:;]+\/\.gemini\/antigravity(?:-ide)?\/brain/gi,
            '<appDataDir>/brain'
        )
        .replace(
            /[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)[^\\/\r\n<>`"')\].,:;]+(?:\\{1,2}|\/)Desktop/gi,
            '<desktop>'
        )
        .replace(
            /(?<![\w.])(?:\/mnt\/[A-Za-z])?\/(?:home|Users)\/[^/\r\n<>`"')\].,:;]+\/Desktop/gi,
            '<desktop>'
        )
        .replace(/[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)[^\\/\s<>`"')\].,:;]+/gi, '~')
        .replace(/(?<![\w.~])\/mnt\/[A-Za-z]\/Users\/[^/\s<>`"')\].,:;]+/gi, '~')
        .replace(/(?<![\w.~])\/(?:home|Users)\/[^/\s<>`"')\].,:;]+/g, '~')
}

function unwrapSinglePreviewFence(trimmed: string): string | null {
    const openMatch = PREVIEW_FENCE_OPEN_RE.exec(trimmed)
    const closeMatch = PREVIEW_FENCE_CLOSE_RE.exec(trimmed)
    if (openMatch === null || closeMatch === null) return null
    const closeStart = trimmed.length - closeMatch[0].length
    if (closeStart < openMatch[0].length) return null
    const inner = trimmed.slice(openMatch[0].length, closeStart)
    if (CLOSING_FENCE_TAG_RE.test(inner)) return null
    return inner.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}

function unwrapFence(content: string): string {
    let current = content
    for (let pass = 0; pass < 8; pass++) {
        const trimmed = current.trim()
        const unwrapped = unwrapSinglePreviewFence(trimmed)
        const next =
            unwrapped ??
            (INLINE_FENCE_TAG_RE.test(trimmed)
                ? trimmed.replace(INLINE_FENCE_TAG_RE, '')
                : current)
        INLINE_FENCE_TAG_RE.lastIndex = 0
        if (next === current) break
        current = next
    }
    return current
}

function isClosingCodeFence(line: string, fenceChar: string, fenceLen: number): boolean {
    let idx = 0
    while (idx < 3 && line[idx] === ' ') idx++
    let count = 0
    while (line[idx] === fenceChar) {
        count++
        idx++
    }
    if (count < fenceLen) return false
    return line.slice(idx).trim() === ''
}

function stripLeadingMarkers(line: string): string {
    let out = line.trim().replace(CMS_INLINE_HEADING_RE, '')
    for (let pass = 0; pass < 4; pass++) {
        const before = out
        for (const re of LEADING_MARKER_RES) out = out.replace(re, '')
        out = out.trimStart()
        if (out === before) break
    }
    return out
}

function stripBoldAndSummaryPrefix(stripped: string): string {
    // [INVARIANT] Strip paired `**bold**` markers without mangling globs (`src/**/*.ts`) or `2**3`.
    return stripped
        .replace(/\*\*([^*\r\n]+?)\*\*/g, '$1')
        .replace(/^Session Summary:\s*/i, '')
        .trim()
}

/** Meaningful content lines: markers stripped, CMS-04 headings, code fences, HRs and trailers dropped. */
export function previewLines(content: string | null | undefined): string[] {
    if (content === null || content === undefined || content === '') return []
    const lines: string[] = []
    let openFenceChar: string | null = null
    let openFenceLen = 0
    for (const raw of redactHomePaths(unwrapFence(content)).split(/\r?\n/)) {
        const lineNoCr = raw.replace(/\r$/, '')
        if (openFenceChar === null) {
            const openMatch = CODE_FENCE_OPEN_RE.exec(lineNoCr)
            const fenceMarker = openMatch?.[1] ?? openMatch?.[2]
            if (fenceMarker !== undefined) {
                openFenceChar = fenceMarker[0] ?? '`'
                openFenceLen = fenceMarker.length
                continue
            }
        } else {
            if (isClosingCodeFence(lineNoCr, openFenceChar, openFenceLen)) {
                openFenceChar = null
                openFenceLen = 0
            }
            continue
        }
        const trimmed = raw.trim()
        if (
            trimmed === '' ||
            HORIZONTAL_RULE_RE.test(trimmed) ||
            CMS_HEADING_RE.test(trimmed) ||
            COMMIT_TRAILER_RE.test(trimmed)
        ) {
            continue
        }
        const strippedLeading = stripLeadingMarkers(trimmed)
        if (COMMIT_TRAILER_RE.test(strippedLeading)) continue
        const line = stripBoldAndSummaryPrefix(strippedLeading)
        if (line.length > 0) lines.push(line)
    }
    return lines
}

/** Avoid splitting a UTF-16 surrogate pair (e.g. emoji) at `index`. */
function safeSliceEnd(text: string, index: number): number {
    if (index <= 0 || index >= text.length) return index
    const code = text.charCodeAt(index - 1)
    return code >= 0xd800 && code <= 0xdbff ? index - 1 : index
}

function findSentenceBoundary(probe: string, minLen: number): string | null {
    for (let i = probe.length - 2; i >= minLen; i--) {
        const ch = probe[i]
        const next = probe[i + 1]
        if ((ch === '.' || ch === '?' || ch === '!') && next !== undefined && /\s/.test(next)) {
            const candidate = probe.slice(0, i + 1)
            if (ch === '.' && NON_SENTENCE_END_RE.test(candidate)) continue
            return candidate
        }
    }
    return null
}

/** Clip to `length`, preferring a sentence boundary, then a word boundary. */
export function clipPreview(text: string, length: number): string {
    if (text.length <= length) return text
    // [INVARIANT] Probe one char past the cut so `commit.ts` is not mistaken for a sentence end.
    const probe = text.slice(0, length + 1)
    const sentence = findSentenceBoundary(probe, Math.floor(length * 0.4) + 1)
    if (sentence !== null) return sentence
    const cut = safeSliceEnd(text, length)
    const truncated = text.slice(0, cut)
    const lastSpace = truncated.lastIndexOf(' ')
    const boundary = lastSpace > length * 0.6 ? lastSpace : cut
    return `${text.slice(0, safeSliceEnd(text, boundary)).trimEnd()}…`
}

/** Threshold below which a terse first line joins the next line in `firstLineOnly` mode. */
const TERSE_FIRST_LINE_MAX = 20

/**
 * Unfenced preview text. `firstLineOnly` returns the first meaningful line (labels),
 * joining the second line with ` — ` when the first line is a terse heading (`< 20` chars);
 * otherwise meaningful lines are joined with spaces (Journal rows).
 */
export function extractPreview(
    content: string | null | undefined,
    length: number,
    options: { firstLineOnly?: boolean } = {}
): string {
    const lines = previewLines(content)
    if (lines.length === 0) return ''
    let text: string
    if (options.firstLineOnly === true) {
        const first = lines[0] ?? ''
        const second = lines[1]
        text =
            !/\s/.test(first) && first.length < TERSE_FIRST_LINE_MAX && second !== undefined
                ? `${first} — ${second}`
                : first
    } else {
        text = lines.join(' ')
    }
    return clipPreview(text, length)
}
