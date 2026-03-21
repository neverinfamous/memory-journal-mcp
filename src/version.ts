/**
 * Version SSoT — Single Source of Truth
 *
 * Reads the version from package.json at runtime via createRequire.
 * All modules that need the version string should import from here
 * instead of importing package.json directly.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

/** The current server version, read from package.json */
export const VERSION: string = pkg.version
