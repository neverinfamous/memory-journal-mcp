import { z } from 'zod'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { relaxedNumber, StrictProjectNumberSchema } from '../schemas.js'

const aliasNames = ['text', 'message', 'description', 'name', 'from', 'source']
const canonicalNames = ['target', 'to', 'canonical', 'dest']
const searchNames = ['q', 'query', 'search']

type AliasPreprocessTarget = 'add' | 'remove' | 'list' | 'resolve' | 'consolidate'

const createAliasPreprocessor =
    (target: AliasPreprocessTarget) =>
    (val: unknown): unknown => {
        if (typeof val !== 'object' || val === null || Array.isArray(val)) return val
        const obj = { ...(val as Record<string, unknown>) }
        let modified = false

        if (target === 'add' || target === 'remove') {
            for (const key of aliasNames) {
                if (key in obj) {
                    if (!('alias' in obj)) obj['alias'] = obj[key]
                    Reflect.deleteProperty(obj, key)
                    modified = true
                    break
                }
            }
        }
        if (target === 'add' || target === 'list' || target === 'consolidate') {
            for (const key of canonicalNames) {
                if (key in obj) {
                    if (!('canonical_author' in obj)) obj['canonical_author'] = obj[key]
                    Reflect.deleteProperty(obj, key)
                    modified = true
                    break
                }
            }
        }
        for (const key of searchNames) {
            if (!(key in obj)) continue
            const targetKey =
                target === 'resolve'
                    ? 'author'
                    : target === 'remove'
                      ? 'alias'
                      : 'canonical_author'
            if (!(targetKey in obj)) obj[targetKey] = obj[key]
            Reflect.deleteProperty(obj, key)
            modified = true
            break
        }
        if ((target === 'add' || target === 'list' || target === 'consolidate') && 'author' in obj) {
            if (!('canonical_author' in obj)) obj['canonical_author'] = obj['author']
            Reflect.deleteProperty(obj, 'author')
            modified = true
        }
        return modified ? obj : val
    }

const WORKSPACE_FIELD_DESC =
    'Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'

export const AddAuthorAliasSchema = z.preprocess(
    createAliasPreprocessor('add'),
    z
        .object({
            alias: z
                .string()
                .trim()
                .min(1)
                .max(255)
                .describe('The raw author name to map (e.g., "Alex" or "GitHub: octocat")'),
            canonical_author: z
                .string()
                .trim()
                .min(1)
                .max(255)
                .describe('The canonical author identity to map the alias to (e.g., "alex-dev")'),
            project_number: StrictProjectNumberSchema,
            workspace_id: z.string().optional().describe(WORKSPACE_FIELD_DESC),
        })
        .strict()
)

export const AddAuthorAliasSchemaMcp = z.preprocess(
    createAliasPreprocessor('add'),
    z.object({
        alias: z
            .string()
            .min(1)
            .max(255)
            .optional()
            .describe('The raw author name to map (e.g., "Alex" or "GitHub: octocat")'),
        canonical_author: z
            .string()
            .min(1)
            .max(255)
            .optional()
            .describe('The canonical author identity to map the alias to (e.g., "alex-dev")'),
        project_number: relaxedNumber().optional().describe('GitHub Project number'),
        workspace_id: z.string().optional().describe(WORKSPACE_FIELD_DESC),
    })
)

export const AddAuthorAliasOutputSchema = z
    .object({
        success: z.boolean().optional(),
        alias: z
            .object({
                id: z.number(),
                alias: z.string(),
                canonicalAuthor: z.string(),
                createdAt: z.string(),
                createdBy: z.string().nullable().optional(),
            })
            .optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const RemoveAuthorAliasSchema = z.preprocess(
    createAliasPreprocessor('remove'),
    z
        .object({
            alias: z.string().trim().min(1).max(255).describe('The alias mapping to remove'),
            project_number: StrictProjectNumberSchema,
            workspace_id: z.string().optional().describe(WORKSPACE_FIELD_DESC),
        })
        .strict()
)

export const RemoveAuthorAliasSchemaMcp = z.preprocess(
    createAliasPreprocessor('remove'),
    z.object({
        alias: z.string().min(1).max(255).optional().describe('The alias mapping to remove'),
        project_number: relaxedNumber().optional().describe('GitHub Project number'),
        workspace_id: z.string().optional().describe(WORKSPACE_FIELD_DESC),
    })
)

export const RemoveAuthorAliasOutputSchema = z
    .object({
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const ListAuthorAliasesSchema = z.preprocess(
    createAliasPreprocessor('list'),
    z
        .object({
            canonical_author: z
                .string()
                .trim()
                .min(1)
                .optional()
                .describe('Optional canonical author to filter aliases by'),
            project_number: StrictProjectNumberSchema,
            workspace_id: z.string().optional().describe(WORKSPACE_FIELD_DESC),
        })
        .strict()
)

export const ListAuthorAliasesSchemaMcp = z.preprocess(
    createAliasPreprocessor('list'),
    z.object({
        canonical_author: z.string().optional().describe('Optional canonical author to filter aliases by'),
        project_number: relaxedNumber().optional().describe('GitHub Project number'),
        workspace_id: z.string().optional().describe(WORKSPACE_FIELD_DESC),
    })
)

export const ListAuthorAliasesOutputSchema = z
    .object({
        success: z.boolean().optional(),
        aliases: z
            .array(
                z.object({
                    id: z.number(),
                    alias: z.string(),
                    canonicalAuthor: z.string(),
                    createdAt: z.string(),
                    createdBy: z.string().nullable().optional(),
                })
            )
            .optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const ResolveAuthorSchema = z.preprocess(
    createAliasPreprocessor('resolve'),
    z
        .object({
            author: z.string().trim().min(1).describe('The raw author name to resolve'),
            project_number: StrictProjectNumberSchema,
            workspace_id: z.string().optional().describe(WORKSPACE_FIELD_DESC),
        })
        .strict()
)

export const ResolveAuthorSchemaMcp = z.preprocess(
    createAliasPreprocessor('resolve'),
    z.object({
        author: z.string().min(1).optional().describe('The raw author name to resolve'),
        project_number: relaxedNumber().optional().describe('GitHub Project number'),
        workspace_id: z.string().optional().describe(WORKSPACE_FIELD_DESC),
    })
)

export const ResolveAuthorOutputSchema = z
    .object({
        success: z.boolean().optional(),
        original_author: z.string().optional(),
        canonical_author: z.string().optional(),
        is_aliased: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const ConsolidateAuthorsSchema = z.preprocess(
    createAliasPreprocessor('consolidate'),
    z
        .object({
            canonical_author: z
                .string()
                .trim()
                .min(1)
                .max(255)
                .describe(
                    "The canonical author name. All entries matching any of this author's aliases will be updated to use this canonical name."
                ),
            project_number: StrictProjectNumberSchema,
            workspace_id: z.string().optional().describe(WORKSPACE_FIELD_DESC),
        })
        .strict()
)

export const ConsolidateAuthorsSchemaMcp = z.preprocess(
    createAliasPreprocessor('consolidate'),
    z.object({
        canonical_author: z
            .string()
            .min(1)
            .max(255)
            .optional()
            .describe(
                "The canonical author name. All entries matching any of this author's aliases will be updated to use this canonical name."
            ),
        project_number: relaxedNumber().optional().describe('GitHub Project number'),
        workspace_id: z.string().optional().describe(WORKSPACE_FIELD_DESC),
    })
)

export const ConsolidateAuthorsOutputSchema = z
    .object({
        success: z.boolean().optional(),
        updated_count: z.number().optional(),
        canonical_author: z.string().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)
