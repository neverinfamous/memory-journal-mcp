/**
 * memory-journal-mcp — Markdown Interoperability Module
 *
 * Barrel re-export for frontmatter parsing, markdown export, and import.
 */

export { parseFrontmatter, serializeFrontmatter } from './frontmatter.js'
export type { FrontmatterData, ParseResult } from './frontmatter.js'

export { exportEntriesToMarkdown, generateSlug, generateFilename } from './exporter.js'
export type { ExportableEntry, ExportResult } from './exporter.js'

export { importMarkdownEntries, processImportBatch } from './importer.js'
export type { ImportOptions, ImportResult, ParsedFile } from './importer.js'

export { convertFile } from './converters/index.js'
export type { SourceFormat, ConvertedFile } from './converters/index.js'
