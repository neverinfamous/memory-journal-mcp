import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'
export {
    fenceUntrustedInline,
    sliceUntrustedInline,
    getBaseUri,
} from './fencing-helpers.js'

export function safeDecodeUriSegment(raw: string): string {
    let decoded: string
    try {
        decoded = decodeURIComponent(raw)
    } catch {
        throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            `Malformed percent-encoding in resource URI segment: ${raw}`
        )
    }
    if (/[\p{Cc}\u2028\u2029]/u.test(decoded)) {
        throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            'Control characters are not allowed in resource URI segments'
        )
    }
    return decoded
}
