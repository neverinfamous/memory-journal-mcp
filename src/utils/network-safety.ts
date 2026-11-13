/**
 * Network address safety helpers shared by SSRF guards.
 */

const PRIVATE_172_RE = /^172\.(1[6-9]|2[0-9]|3[0-1])\./
const CGNAT_100_RE = /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./
const UNIQUE_LOCAL_V6_RE = /^f[cd][0-9a-f]{0,2}:/
const LINK_LOCAL_V6_RE = /^fe[89ab][0-9a-f]?:/
const MAPPED_HEX_RE = /^(?:0{0,4}:){0,5}(?::|0{0,4}:)?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/
const MAPPED_DOTTED_RE = /^(?:0{0,4}:){0,5}(?::|0{0,4}:)?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/
const COMPAT_DOTTED_RE = /^::(\d{1,3}(?:\.\d{1,3}){3})$/

function hexPairToIpv4(high: string, low: string): string {
    const hi = parseInt(high, 16)
    const lo = parseInt(low, 16)
    return `${String(hi >> 8)}.${String(hi & 0xff)}.${String(lo >> 8)}.${String(lo & 0xff)}`
}

/**
 * [INTENT] Normalize a host/IP literal: strip brackets, zone IDs, trailing dots, and unwrap
 * IPv4-mapped/compatible IPv6 (both dotted and hex forms) to dotted IPv4.
 */
function normalizeAddress(address: string): string {
    let normalized = address.trim().toLowerCase()
    if (normalized.startsWith('[') && normalized.endsWith(']')) normalized = normalized.slice(1, -1)
    const zoneIdx = normalized.indexOf('%')
    if (zoneIdx !== -1) normalized = normalized.slice(0, zoneIdx)
    while (normalized.endsWith('.')) normalized = normalized.slice(0, -1)
    const dotted = MAPPED_DOTTED_RE.exec(normalized) ?? COMPAT_DOTTED_RE.exec(normalized)
    if (dotted?.[1] !== undefined) return dotted[1]
    const hex = MAPPED_HEX_RE.exec(normalized)
    if (hex?.[1] !== undefined && hex[2] !== undefined) return hexPairToIpv4(hex[1], hex[2])
    return normalized
}

function isUnspecifiedOrLoopbackV6(normalized: string): boolean {
    if (!normalized.includes(':') || !/^[0-9a-f:]+$/.test(normalized)) return false
    const halves = normalized.split('::')
    if (halves.length > 2) return false
    const head = (halves[0] ?? '').split(':').filter((g) => g !== '')
    const tail = halves.length === 2 ? (halves[1] ?? '').split(':').filter((g) => g !== '') : []
    const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
    if (fill < 0) return false
    const groups = [...head, ...Array<string>(fill).fill('0'), ...tail].map((g) => parseInt(g, 16))
    if (groups.length !== 8) return false
    // `::` (unspecified) or `::1` (loopback)
    return groups.slice(0, 7).every((g) => g === 0) && (groups[7] === 0 || groups[7] === 1)
}

/**
 * True when an IP literal (or the textual host form of one) points at a loopback,
 * unspecified, private (RFC 1918), CGNAT, link-local, or unique-local address.
 * IPv4-mapped IPv6 (dotted or hex) and bracketed literals are normalized first.
 */
export function isPrivateOrLoopbackAddress(address: string): boolean {
    const normalized = normalizeAddress(address)
    return (
        normalized === 'localhost' ||
        normalized.endsWith('.localhost') ||
        isUnspecifiedOrLoopbackV6(normalized) ||
        normalized.startsWith('0.') ||
        normalized === '0' ||
        normalized.startsWith('127.') ||
        normalized.startsWith('10.') ||
        normalized.startsWith('192.168.') ||
        PRIVATE_172_RE.test(normalized) ||
        CGNAT_100_RE.test(normalized) ||
        normalized.startsWith('169.254.') ||
        LINK_LOCAL_V6_RE.test(normalized) ||
        UNIQUE_LOCAL_V6_RE.test(normalized)
    )
}
