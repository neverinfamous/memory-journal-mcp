/**
 * Validates test-server-config.json, which Node 26 cannot execute directly.
 * Prompt, scheduler, and progress scripts load that file as server config.
 *
 * Usage:
 *   node test-server/scripts/test-server-config.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const configPath = join(dirname(fileURLToPath(import.meta.url)), 'test-server-config.json')
const parsed = JSON.parse(readFileSync(configPath, 'utf8'))

function requirePath(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        console.error(`${field} must be a non-empty string`)
        process.exit(1)
    }
}

requirePath(parsed.testDbPath, 'testDbPath')
requirePath(parsed.testTeamDbPath, 'testTeamDbPath')
console.log('test-server-config.json ok')
