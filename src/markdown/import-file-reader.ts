/**
 * File-level markdown reader for `importer.ts` (split to keep `importer.ts` concise).
 */

import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { constants } from 'node:fs'
import { parseFrontmatter } from './frontmatter.js'
import { assertSafeChildFile } from '../utils/security-utils.js'
import { logger } from '../utils/logger.js'
import type { ParsedFile } from './importer.js'

const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024

export async function readAndParseMarkdownFile(
    sourceDir: string,
    filename: string
): Promise<{ parsed?: ParsedFile; skipped?: boolean }> {
    let handle
    try {
        const filepath = join(sourceDir, filename)
        assertSafeChildFile(sourceDir, filename, filepath)
        try {
            handle = await open(filepath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        } catch (err: unknown) {
            const code =
                err instanceof Error && 'code' in err
                    ? (err as { code?: string }).code
                    : undefined
            if (code === 'ELOOP') {
                throw new Error(`Refusing to read symlink during import: ${filename}`, {
                    cause: err,
                })
            }
            throw err
        }

        const stats = await handle.stat()
        if (!stats.isFile()) {
            throw new Error(`Refusing to import non-regular file: ${filename}`)
        }
        if (stats.size > MAX_IMPORT_FILE_SIZE_BYTES) {
            throw new Error(
                `File exceeds maximum size limit of 5MB (${String(stats.size)} bytes)`
            )
        }

        const content = await handle.readFile('utf-8')
        const { metadata, body } = parseFrontmatter(content)
        if (!body.trim()) {
            return { skipped: true }
        }
        return { parsed: { filename, body, metadata } }
    } finally {
        if (handle) {
            await Promise.resolve(handle.close()).catch((closeErr: unknown) => {
                logger.debug('Failed to close import file handle', {
                    module: 'Importer',
                    filename,
                    error: closeErr instanceof Error ? closeErr.message : String(closeErr),
                })
            })
        }
    }
}
