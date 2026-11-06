/**
 * Network address safety helpers shared by SSRF guards.
 */

const PRIVATE_172_RE = /^172\.(1[6-9]|2[0-9]|3[0-1])\./
const UNIQUE_LOCAL_V6_RE = /^f[cd][0-9a-f]{2}:/

/**
 * True when an IP literal (or the textual host form of one) points at a loopback,
 * private (RFC 1918), link-local, or unique-local address. An IPv4-mapped IPv6 prefix
 * (`::ffff:`) is stripped first, so a mapped private address is still blocked.
 */
export function isPrivateOrLoopbackAddress(address: string): boolean {
    const normalized = address.toLowerCase().replace(/^::ffff:/, '')
    return (
        normalized === 'localhost' ||
        normalized === '::1' ||
        normalized === '::' ||
        normalized === '0.0.0.0' ||
        normalized.startsWith('127.') ||
        normalized.startsWith('10.') ||
        normalized.startsWith('192.168.') ||
        PRIVATE_172_RE.test(normalized) ||
        normalized.startsWith('169.254.') ||
        normalized.startsWith('fe80:') ||
        UNIQUE_LOCAL_V6_RE.test(normalized)
    )
}
