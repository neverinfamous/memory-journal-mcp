import {
    isAlreadyInlineFencedUntrustedContent,
    markUntrustedContentInline,
} from '../../utils/security-utils.js'

const INLINE_UNTRUSTED_RE = /^<untrusted_remote_content>([^<>]*)<\/untrusted_remote_content>$/

/** Wrap a string in `<untrusted_remote_content>` once without double-escaping existing wrappers. */
export function fenceUntrustedInline(value: string): string {
    if (isAlreadyInlineFencedUntrustedContent(value)) {
        return value
    }
    return markUntrustedContentInline(value)
}

/** Unwrap any existing inline fence, slice raw text to `maxLen`, and re-fence once cleanly. */
export function sliceUntrustedInline(value: string, maxLen: number, suffix = ''): string {
    const match = INLINE_UNTRUSTED_RE.exec(value)
    const raw =
        match?.[1] !== undefined
            ? match[1]
                  .replaceAll('&lt;', '<')
                  .replaceAll('&gt;', '>')
                  .replaceAll('&amp;', '&')
            : value
    const cleanRaw = raw
        .replace(/[\r\n\u2028\u2029]+/g, ' ')
        .replace(/\p{Cc}/gu, (ch) => (ch === '\t' ? ch : ''))
    let sliceEnd = maxLen
    if (cleanRaw.length > maxLen && maxLen > 0) {
        const lastCode = cleanRaw.charCodeAt(maxLen - 1)
        const nextCode = cleanRaw.charCodeAt(maxLen)
        if (lastCode >= 0xd800 && lastCode <= 0xdbff && nextCode >= 0xdc00 && nextCode <= 0xdfff) {
            sliceEnd = maxLen - 1
        }
    }
    const truncated = cleanRaw.length > maxLen ? `${cleanRaw.slice(0, sliceEnd)}${suffix}` : cleanRaw
    return markUntrustedContentInline(truncated)
}

/** Escape newlines, control chars, backslashes, and pipes for markdown table cells. */
export function escapeCell(text: string): string {
    return text
        .replace(/[\r\n\u2028\u2029]+/g, ' ')
        .replace(/\p{Cc}/gu, '')
        .replace(/\\/g, '\\\\')
        .replace(/\|/g, '\\|')
}

/** Replace square brackets inside markdown link labels with parentheses so `escapeCell` cannot double-escape and `markUntrustedContentInline` does not double-encode `&`. */
export function escapeLinkLabel(text: string): string {
    return text.replace(/\[/g, '(').replace(/\]/g, ')')
}

/**
 * Constrain echoed URI/workspace identifiers before rendering in markdown/YAML headers.
 * Strips `*` (preventing `**bold**` breakout) and caps length at `maxLen` (default 128).
 */
export function sanitizeDisplayIdentifier(value: string, maxLen = 128): string {
    return value.replace(/[^A-Za-z0-9._\-/@]/g, '_').slice(0, maxLen)
}

/** Separator between items sharing one inline fence (cannot collide with markdown table syntax). */
export const UNTRUSTED_LIST_SEPARATOR = ' ¦ '

/**
 * Join list items (which may already carry their own inline fences) under ONE inline fence.
 * [INVARIANT] `markUntrustedContentInline` strips every nested literal/encoded wrapper and
 * re-escapes `& < >`, so per-item escaping is preserved while saving ~53 chars per extra item.
 */
export function fenceUntrustedList(items: readonly string[], separator = UNTRUSTED_LIST_SEPARATOR): string {
    const nonEmpty = items.filter((item) => item.trim() !== '')
    if (nonEmpty.length === 0) return ''
    const fenced = markUntrustedContentInline(nonEmpty.join(separator))
    return fenced === '<untrusted_remote_content></untrusted_remote_content>' ? '' : fenced
}

/** Extract base URI without query parameters or fragments for matching. */
export function getBaseUri(uri: string): string {
    // Handle memory:// URIs specially since URL parser treats the path as host
    if (uri.startsWith('memory://')) {
        const withoutScheme = uri.slice('memory://'.length)
        const queryIndex = withoutScheme.indexOf('?')
        const hashIndex = withoutScheme.indexOf('#')

        let endIndex = withoutScheme.length
        if (queryIndex !== -1 && queryIndex < endIndex) endIndex = queryIndex
        if (hashIndex !== -1 && hashIndex < endIndex) endIndex = hashIndex

        return 'memory://' + withoutScheme.slice(0, endIndex)
    }

    try {
        const url = new URL(uri)
        return `${url.protocol}//${url.host}${url.pathname}`
    } catch {
        return uri
    }
}
