/**
 * memory-journal-mcp — Markdown Interoperability Module
 *
 * Barrel re-export for frontmatter parsing, markdown export, and import.
 */

export { parseFrontmatter, serializeFrontmatter } from './frontmatter.js'
export type { FrontmatterData, ParseResult } from './frontmatter.js'

export { exportEntriesToMarkdown, generateSlug, generateFilename } from './exporter.js'
export type { ExportableEntry, ExportResult } from './exporter.js'

export { importMarkdownEntries } from './importer.js'
export type { ImportOptions, ImportResult } from './importer.js'
