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
    const truncated = cleanRaw.length > maxLen ? `${cleanRaw.slice(0, maxLen)}${suffix}` : cleanRaw
    return markUntrustedContentInline(truncated)
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
