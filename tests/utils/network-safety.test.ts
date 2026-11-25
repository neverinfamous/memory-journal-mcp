import { describe, expect, it } from 'vitest'
import { isPrivateOrLoopbackAddress } from '../../src/utils/network-safety.js'

describe('isPrivateOrLoopbackAddress (SSRF hardening)', () => {
    it.each([
        'localhost',
        'api.localhost',
        '127.0.0.1',
        '0.0.0.0',
        '0.1.2.3',
        '10.0.0.1',
        '172.16.5.4',
        '192.168.1.1',
        '100.64.0.1',
        '169.254.169.254',
        '::',
        '::1',
        '0:0:0:0:0:0:0:1',
        '[::1]',
        '[::ffff:127.0.0.1]',
        '::ffff:7f00:1',
        '::ffff:a9fe:a9fe',
        '0:0:0:0:0:ffff:c0a8:0101',
        'fe80::1',
        'fe80::1%eth0',
        'febf::1',
        'fc00::1',
        'fd12:3456::1',
    ])('blocks %s', (addr) => {
        expect(isPrivateOrLoopbackAddress(addr)).toBe(true)
    })

    it.each(['8.8.8.8', '1.1.1.1', '2606:4700::1111', '1::', '::ffff:808:808', 'example.com', '172.32.0.1'])(
        'allows %s',
        (addr) => {
            expect(isPrivateOrLoopbackAddress(addr)).toBe(false)
        }
    )
})
