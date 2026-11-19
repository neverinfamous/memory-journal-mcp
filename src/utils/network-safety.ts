/**
 * Network address safety helpers shared by SSRF guards.
 */

const IPV4_DOTTED_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

function wordsToIpv4(hi: number, lo: number): string {
    return `${String((hi >> 8) & 0xff)}.${String(hi & 0xff)}.${String((lo >> 8) & 0xff)}.${String(lo & 0xff)}`
}

function isRestrictedIpv4(address: string): boolean {
    const m = IPV4_DOTTED_RE.exec(address)
    if (!m) return false
    const a = Number(m[1])
    const b = Number(m[2])
    const c = Number(m[3])
    const d = Number(m[4])
    if (a > 255 || b > 255 || c > 255 || d > 255) return false
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224
    )
}

function parseHexWords(section: string): number[] | null {
    if (section === '') return []
    const rawParts = section.split(':')
    const words: number[] = []
    for (let i = 0; i < rawParts.length; i++) {
        const part = rawParts[i]
        if (part === undefined || part === '') return null
        if (i === rawParts.length - 1 && part.includes('.')) {
            const m = IPV4_DOTTED_RE.exec(part)
            if (!m) return null
            const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
            if (octets.some((o) => o > 255)) return null
            words.push(((octets[0] ?? 0) << 8) | (octets[1] ?? 0))
            words.push(((octets[2] ?? 0) << 8) | (octets[3] ?? 0))
        } else {
            if (!/^[0-9a-f]{1,4}$/.test(part)) return null
            words.push(parseInt(part, 16))
        }
    }
    return words
}

function parseIpv6Groups(normalized: string): number[] | null {
    if (!normalized.includes(':')) return null
    const halves = normalized.split('::')
    if (halves.length > 2) return null
    const head = parseHexWords(halves[0] ?? '')
    if (head === null) return null
    if (halves.length === 1) {
        return head.length === 8 ? head : null
    }
    const tail = parseHexWords(halves[1] ?? '')
    if (tail === null) return null
    const fill = 8 - head.length - tail.length
    if (fill < 1) return null
    return [...head, ...Array<number>(fill).fill(0), ...tail]
}

function isRestrictedIpv6(groups: readonly number[]): boolean {
    const g0 = groups[0] ?? 0
    const g1 = groups[1] ?? 0
    const g2 = groups[2] ?? 0
    const g3 = groups[3] ?? 0
    const g4 = groups[4] ?? 0
    const g5 = groups[5] ?? 0
    const g6 = groups[6] ?? 0
    const g7 = groups[7] ?? 0
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && (g6 === 0 && (g7 === 0 || g7 === 1))) {
        return true
    }
    if ((g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0 || (g0 & 0xff00) === 0xff00) {
        return true
    }
    if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true
    if (g0 === 0x0064 && g1 === 0xff9b) return true
    if (g0 === 0x2001 && g1 === 0x0000) return true
    if (g0 === 0x2001 && g1 === 0x0002 && g2 === 0) return true
    if (g0 === 0x2001 && ((g1 & 0xfff0) === 0x0010 || (g1 & 0xfff0) === 0x0020)) return true
    if (g0 === 0x2002) return isRestrictedIpv4(wordsToIpv4(g1, g2))
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
        return isRestrictedIpv4(wordsToIpv4(g6, g7))
    }
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) {
        return isRestrictedIpv4(wordsToIpv4(g6, g7))
    }
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && (g6 !== 0 || g7 > 1)) {
        return isRestrictedIpv4(wordsToIpv4(g6, g7))
    }
    return false
}

/**
 * True when an IP literal (or the textual host form of one) points at a loopback,
 * unspecified, private (RFC 1918), CGNAT, link-local, unique-local, multicast, or
 * embedded IPv4 translation address (mapped/compatible/SIIT/NAT64/6to4/Teredo).
 */
export function isPrivateOrLoopbackAddress(address: string): boolean {
    let normalized = address.trim().toLowerCase()
    if (normalized.startsWith('[') && normalized.endsWith(']')) normalized = normalized.slice(1, -1)
    const zoneIdx = normalized.indexOf('%')
    if (zoneIdx !== -1) normalized = normalized.slice(0, zoneIdx)
    while (normalized.endsWith('.')) normalized = normalized.slice(0, -1)

    if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '0') {
        return true
    }
    if (isRestrictedIpv4(normalized)) return true
    const v6 = parseIpv6Groups(normalized)
    return v6 !== null ? isRestrictedIpv6(v6) : false
}
