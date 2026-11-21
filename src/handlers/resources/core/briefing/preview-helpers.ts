/**
 * Briefing — shared preview extraction.
 *
 * [INVARIANT] Every briefing/graph/agent-context preview goes through `extractPreview` so the
 * Journal row, Active threads, `memory://graph` nodes and session-entry lists agree on marker
 * stripping, CMS-04 heading skipping and home-path redaction. Callers fence the result.
 */

const PREVIEW_FENCE_WRAPPER_RE =
    /^<untrusted_remote_content>\r?\n?([\s\S]*?)\r?\n?<\/untrusted_remote_content>$/i

/** CMS-04 session-summary H2 headings carry no signal on their own. */
const CMS_HEADING_RE =
    /^#{1,6}\s*(?:Session Summary:\s*)?(?:Accomplished|Unfinished \/ Blocked|Context for Next Session|Commits)\s*:?\s*$/i
/** Inline legacy form `## Accomplished - did X`. */
const CMS_INLINE_HEADING_RE = /^#{1,6}\s*(?:Accomplished|Unfinished \/ Blocked|Context for Next Session|Commits)\s*[-:–—]\s*/i
/** Commit-narrative trailer lines (`Commit: <sha>`) duplicate the Git History `→#id` pivot. */
const COMMIT_TRAILER_RE = /^(?:\*\*)?Commit:?(?:\*\*)?\s*`?[0-9a-f]{7,40}`?\s*$/i

const LEADING_MARKER_RES: readonly RegExp[] = [
    /^#{1,6}\s+/,
    /^>\s*/,
    /^[-*+•]\s+/,
    /^\d+[.)]\s+/,
    /^\[[ xX]\]\s+/,
]

/** Collapse machine-local home directories so previews never leak user names or layouts. */
export function redactHomePaths(text: string): string {
    return text
        .replace(
            /[A-Za-z]:[\\/]Users[\\/][^\\/\s]+[\\/]\.gemini[\\/]antigravity(?:-ide)?[\\/]brain/gi,
            '<appDataDir>/brain'
        )
        .replace(/(?<![\w.])\/(?:home|Users)\/[^/\s]+\/\.gemini\/antigravity(?:-ide)?\/brain/g, '<appDataDir>/brain')
        .replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s]+[\\/]Desktop/gi, '<desktop>')
        .replace(/(?<![\w.])\/(?:home|Users)\/[^/\s]+\/Desktop/g, '<desktop>')
        .replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s<>]+/gi, '~')
        .replace(/(?<![\w.~])\/(?:home|Users)\/[^/\s<>]+/g, '~')
}

function unwrapFence(content: string): string {
    const fencedMatch = PREVIEW_FENCE_WRAPPER_RE.exec(content.trim())
    if (fencedMatch?.[1] === undefined) return content
    return fencedMatch[1].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}

function stripLineMarkers(line: string): string {
    let out = line.trim().replace(CMS_INLINE_HEADING_RE, '')
    for (const re of LEADING_MARKER_RES) out = out.replace(re, '')
    return out.replaceAll('**', '').replace(/^Session Summary:\s*/i, '').trim()
}

/** Meaningful content lines: markers stripped, CMS-04 heading-only lines and blanks dropped. */
export function previewLines(content: string | null | undefined): string[] {
    if (content === null || content === undefined || content === '') return []
    const lines: string[] = []
    for (const raw of redactHomePaths(unwrapFence(content)).split(/\r?\n/)) {
        if (CMS_HEADING_RE.test(raw.trim()) || COMMIT_TRAILER_RE.test(raw.trim())) continue
        const line = stripLineMarkers(raw)
        if (line.length > 0) lines.push(line)
    }
    return lines
}

/** Clip to `length`, preferring a sentence boundary, then a word boundary. */
export function clipPreview(text: string, length: number): string {
    if (text.length <= length) return text
    // [INVARIANT] Probe one char past the cut so `commit.ts` is not mistaken for a sentence end.
    const probe = text.slice(0, length + 1)
    const sentenceBoundaryMatch = /.*[.?!](?=\s)/.exec(probe)
    if (sentenceBoundaryMatch && sentenceBoundaryMatch[0].length > length * 0.4) {
        return sentenceBoundaryMatch[0]
    }
    const truncated = text.slice(0, length)
    const lastSpace = truncated.lastIndexOf(' ')
    const boundary = lastSpace > length * 0.6 ? lastSpace : length
    return `${text.slice(0, boundary).trimEnd()}…`
}

/**
 * Unfenced preview text. `firstLineOnly` returns the first meaningful line (labels);
 * otherwise meaningful lines are joined with spaces (Journal rows).
 */
export function extractPreview(
    content: string | null | undefined,
    length: number,
    options: { firstLineOnly?: boolean } = {}
): string {
    const lines = previewLines(content)
    if (lines.length === 0) return ''
    const text = options.firstLineOnly === true ? (lines[0] ?? '') : lines.join(' ')
    return clipPreview(text, length)
}
