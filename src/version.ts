/**
 * Version SSoT — Single Source of Truth
 *
 * Reads the version from package.json at runtime via createRequire.
 * All modules that need the version string should import from here
 * instead of importing package.json directly.
 */

import { createRequire } from 'node:module'
import { isRecord } from './utils/type-guards.js'

const require = createRequire(import.meta.url)
const pkg: unknown = require('../package.json')

if (!isRecord(pkg) || typeof pkg['version'] !== 'string') {
    throw new Error('Invalid package.json: missing string "version" field')
}

/** The current server version, read from package.json */
export const VERSION: string = pkg['version']
