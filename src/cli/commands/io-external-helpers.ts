import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { convertFile, type ParsedFile } from '../../markdown/index.js'
import { assertSafeFilePath } from '../../utils/security-utils.js'

const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024
const MAX_DIRECTORY_SCAN_ENTRIES = 10_000
const DEFAULT_EXTERNAL_IMPORT_LIMIT = 500
const READ_CONCURRENCY = 16

type ExternalImportFormat = 'notion' | 'obsidian' | 'logseq'

async function readSingleExternalFile(
    resolvedDir: string,
    filename: string,
    format: ExternalImportFormat,
    allowedRoots: string[]
): Promise<{ ok: true; file: ParsedFile | null } | { ok: false; error: string }> {
    let handle
    try {
        const filepath = path.join(resolvedDir, filename)
        assertSafeFilePath(filepath, allowedRoots)
        handle = await fs.open(filepath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        const stats = await handle.stat()
        if (!stats.isFile()) {
            throw new Error(`Refusing to import non-regular file: ${filename}`)
        }
        if (stats.size > MAX_IMPORT_FILE_SIZE_BYTES) {
            throw new Error(
                `File exceeds maximum allowed import size (${String(MAX_IMPORT_FILE_SIZE_BYTES)} bytes)`
            )
        }
        const content = await handle.readFile('utf-8')
        const converted = convertFile(content, filename, format)
        if (!converted.body.trim()) return { ok: true, file: null }
        return {
            ok: true,
            file: {
                filename,
                body: converted.body,
                metadata: converted.metadata,
            },
        }
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        }
    } finally {
        if (handle) await handle.close()
    }
}

/**
 * Scan and convert external Notion/Obsidian/Logseq markdown files with bounded
 * directory scan entries (`10,000`), regular-file checks, and `O_NOFOLLOW`.
 */
export async function collectExternalMarkdownFiles(
    resolvedDir: string,
    format: ExternalImportFormat,
    limit = DEFAULT_EXTERNAL_IMPORT_LIMIT
): Promise<{ parsedFiles: ParsedFile[]; errors: { file: string; error: string }[] }> {
    const allMdFiles: string[] = []
    let scannedEntries = 0
    const dir = await fs.opendir(resolvedDir)
    for await (const dirent of dir) {
        if (++scannedEntries > MAX_DIRECTORY_SCAN_ENTRIES) break
        if (dirent.isFile() && dirent.name.endsWith('.md')) {
            allMdFiles.push(dirent.name)
            if (allMdFiles.length >= MAX_DIRECTORY_SCAN_ENTRIES) break
        }
    }
    allMdFiles.sort((a, b) => a.localeCompare(b))
    const mdFiles = allMdFiles.slice(0, limit)

    const parsedFiles: ParsedFile[] = []
    const errors: { file: string; error: string }[] = []
    const allowedRoots = [resolvedDir]

    for (let i = 0; i < mdFiles.length; i += READ_CONCURRENCY) {
        const batch = mdFiles.slice(i, i + READ_CONCURRENCY)
        const settled = await Promise.all(
            batch.map((filename) => readSingleExternalFile(resolvedDir, filename, format, allowedRoots))
        )
        for (let j = 0; j < settled.length; j++) {
            const outcome = settled[j]
            const filename = batch[j]
            if (outcome === undefined || filename === undefined) continue
            if (!outcome.ok) {
                errors.push({ file: filename, error: outcome.error })
            } else if (outcome.file !== null) {
                parsedFiles.push(outcome.file)
            }
        }
    }
    return { parsedFiles, errors }
}
