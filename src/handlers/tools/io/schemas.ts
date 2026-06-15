import { z } from 'zod'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import {
    ENTRY_TYPES,
    SOURCE_FORMATS,
    DATE_FORMAT_REGEX,
    DATE_FORMAT_MESSAGE,
    EntryOutputSchema,
    relaxedNumber,
} from '../schemas.js'

// ============================================================================
// Export Entries Schemas
// ============================================================================

/** Strict schema — used inside handler for structured Zod errors */
export const ExportEntriesSchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;

            if ('type' in obj && !('format' in obj)) {
                obj['format'] = obj['type'];
                delete obj['type'];
                modified = true;
            }

            return modified ? obj : val;
        }
        return val;
    },
    z.object({

    format: z.enum(['json', 'markdown']).optional().default('json'),
    start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    entry_types: z.array(z.enum(ENTRY_TYPES)).optional(),
    tags: z.array(z.string()).optional(),
    limit: z
        .number()
        .max(5000)
        .optional()
        .default(100)
        .describe('Maximum entries to export (default: 100)'),
    project_number: z.number().int().optional(),
    }).strict()
)

/** Relaxed schema — passed to SDK inputSchema so Zod errors reach the handler */
export const ExportEntriesSchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;

            if ('type' in obj && !('format' in obj)) {
                obj['format'] = obj['type'];
                delete obj['type'];
                modified = true;
            }

            return modified ? obj : val;
        }
        return val;
    },
    z.object({

    format: z.string().optional().default('json').describe('Export format (json or markdown). Anti-Hallucination Hint: Do NOT use type, use format.'),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    entry_types: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    limit: relaxedNumber()
        .optional()
        .default(100)
        .describe('Maximum entries to export (default: 100)'),
    project_number: relaxedNumber().optional(),
    }).strict()
)

export const ExportEntriesOutputSchema = z
    .object({
        format: z.enum(['json', 'markdown']).optional(),
        entries: z.array(EntryOutputSchema).optional(),
        count: z.number().optional(),
        content: z.string().optional(),
        truncated: z
            .boolean()
            .optional()
            .describe('True if the results were truncated to fit within payload limits'),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Export Markdown Schemas
// ============================================================================

/** Strict schema — handler validation */
export const ExportMarkdownSchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;

            if (!('output_dir' in obj)) {
                for (const key of ['path', 'filepath', 'target_dir', 'dir']) {
                    if (key in obj) {
                        obj['output_dir'] = obj[key];
                        delete obj[key];
                        modified = true;
                        break;
                    }
                }
            }

            return modified ? obj : val;
        }
        return val;
    },
    z.object({

    output_dir: z.string().min(1),
    start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    entry_types: z.array(z.enum(ENTRY_TYPES)).optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().max(500).optional().default(100),
    project_number: z.number().int().optional(),
    }).strict()
)

/** Relaxed schema — MCP registration */
export const ExportMarkdownSchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;

            if (!('output_dir' in obj)) {
                for (const key of ['path', 'filepath', 'target_dir', 'dir']) {
                    if (key in obj) {
                        obj['output_dir'] = obj[key];
                        delete obj[key];
                        modified = true;
                        break;
                    }
                }
            }

            return modified ? obj : val;
        }
        return val;
    },
    z.object({

    output_dir: z.string().optional().describe('Target directory for .md files. Anti-Hallucination Hint: Do NOT use path or filepath, use output_dir.'),
    start_date: z.string().optional().describe('Start date filter (YYYY-MM-DD)'),
    end_date: z.string().optional().describe('End date filter (YYYY-MM-DD)'),
    entry_types: z.array(z.string()).optional().describe('Filter by entry types'),
    tags: z.array(z.string()).optional().describe('Filter by tags'),
    limit: relaxedNumber()
        .optional()
        .default(100)
        .describe('Max entries to export (default: 100, max: 500)'),
    project_number: relaxedNumber().optional(),
    }).strict()
)

export const ExportMarkdownOutputSchema = z
    .object({
        success: z.boolean().optional(),
        exported_count: z.number().optional(),
        output_dir: z.string().optional(),
        files: z.array(z.string()).optional(),
        skipped: z.number().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Import Markdown Schemas
// ============================================================================

/** Strict schema — handler validation */
export const ImportMarkdownSchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;

            if (!('source_dir' in obj)) {
                for (const key of ['path', 'filepath', 'target_dir', 'dir']) {
                    if (key in obj) {
                        obj['source_dir'] = obj[key];
                        delete obj[key];
                        modified = true;
                        break;
                    }
                }
            }

            return modified ? obj : val;
        }
        return val;
    },
    z.object({

    source_dir: z.string().min(1),
    dry_run: z.boolean().optional().default(false),
    limit: z.number().max(500).optional().default(100),
    project_number: z.number().int().optional(),
    }).strict()
)

/** Relaxed schema — MCP registration */
export const ImportMarkdownSchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;

            if (!('source_dir' in obj)) {
                for (const key of ['path', 'filepath', 'target_dir', 'dir']) {
                    if (key in obj) {
                        obj['source_dir'] = obj[key];
                        delete obj[key];
                        modified = true;
                        break;
                    }
                }
            }

            return modified ? obj : val;
        }
        return val;
    },
    z.object({

    source_dir: z.string().optional().describe('Directory containing .md files to import. Anti-Hallucination Hint: Do NOT use path or filepath, use source_dir.'),
    dry_run: z
        .boolean()
        .optional()
        .default(false)
        .describe('Parse and validate without writing to database'),
    limit: relaxedNumber()
        .optional()
        .default(100)
        .describe('Max files to process (default: 100, max: 500)'),
    project_number: relaxedNumber().optional(),
    }).strict()
)

export const ImportMarkdownOutputSchema = z
    .object({
        success: z.boolean().optional(),
        created: z.number().optional(),
        updated: z.number().optional(),
        skipped: z.number().optional(),
        relationshipsLinked: z.number().optional(),
        vectorsIndexed: z.number().optional(),
        errors: z
            .array(
                z.object({
                    file: z.string(),
                    error: z.string(),
                })
            )
            .optional(),
        dry_run: z.boolean().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

// ============================================================================
// Import External Schemas
// ============================================================================

/** Strict schema — handler validation */
export const ImportExternalSchema = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;

            if (!('source_dir' in obj)) {
                for (const key of ['path', 'filepath', 'target_dir', 'dir']) {
                    if (key in obj) {
                        obj['source_dir'] = obj[key];
                        delete obj[key];
                        modified = true;
                        break;
                    }
                }
            }
            if ('source' in obj && !('source_format' in obj)) {
                obj['source_format'] = obj['source'];
                delete obj['source'];
                modified = true;
            }

            return modified ? obj : val;
        }
        return val;
    },
    z.object({

    source_dir: z.string().min(1),
    source_format: z.enum(SOURCE_FORMATS),
    dry_run: z.boolean().optional().default(false),
    limit: z.number().max(500).optional().default(100),
    default_entry_type: z.enum(ENTRY_TYPES).optional(),
    project_number: z.number().int().optional(),
    }).strict()
)

/** Relaxed schema — MCP registration */
export const ImportExternalSchemaMcp = z.preprocess(
    (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            const obj = { ...(val as Record<string, unknown>) };
            let modified = false;

            if (!('source_dir' in obj)) {
                for (const key of ['path', 'filepath', 'target_dir', 'dir']) {
                    if (key in obj) {
                        obj['source_dir'] = obj[key];
                        delete obj[key];
                        modified = true;
                        break;
                    }
                }
            }
            if ('source' in obj && !('source_format' in obj)) {
                obj['source_format'] = obj['source'];
                delete obj['source'];
                modified = true;
            }

            return modified ? obj : val;
        }
        return val;
    },
    z.object({

    source_dir: z.string().optional().describe('Directory containing files to import. Anti-Hallucination Hint: Do NOT use path or filepath, use source_dir.'),
    source_format: z.string().optional().describe('Source format (notion, obsidian, logseq). Anti-Hallucination Hint: Do NOT use source, use source_format.'),
    dry_run: z
        .boolean()
        .optional()
        .default(false)
        .describe('Parse and validate without writing to database'),
    limit: relaxedNumber()
        .optional()
        .default(100)
        .describe('Max files to process (default: 100, max: 500)'),
    default_entry_type: z
        .string()
        .optional()
        .describe('Fallback entry type if heuristics cannot determine one'),
    project_number: relaxedNumber().optional(),
    }).strict()
)

// Output is identical to ImportMarkdownOutputSchema
export const ImportExternalOutputSchema = ImportMarkdownOutputSchema
