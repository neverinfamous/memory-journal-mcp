import { z } from 'zod'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'
import { relaxedNumber, StrictProjectNumberSchema } from '../schemas.js'
import { isRecord } from '../../../utils/type-guards.js'

const aliasNames = ['text', 'message', 'description', 'name', 'from', 'source']
const canonicalNames = ['target', 'to', 'canonical', 'dest']
const searchNames = ['q', 'query', 'search']

type AliasPreprocessTarget = 'add' | 'remove' | 'list' | 'resolve' | 'consolidate'

function aliasStringValuesMatch(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true
    if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim()
    return false
}

function applyAuthorAliasGroup(
    obj: Record<string, unknown>,
    aliasKeys: readonly string[],
    targetKey: string,
    deleteExplicitUndefined = false
): boolean {
    let modified = false
    for (const key of aliasKeys) {
        if (deleteExplicitUndefined ? !(key in obj) : obj[key] === undefined) continue
        if (obj[key] === undefined) {
            Reflect.deleteProperty(obj, key)
            modified = true
            continue
        }
        if (obj[targetKey] === undefined) {
            obj[targetKey] = obj[key]
            Reflect.deleteProperty(obj, key)
            modified = true
            continue
        }
        if (aliasStringValuesMatch(obj[targetKey], obj[key])) {
            Reflect.deleteProperty(obj, key)
            modified = true
        }
    }
    return modified
}

const createAliasPreprocessor =
    (target: AliasPreprocessTarget) =>
    (val: unknown): unknown => {
        if (!isRecord(val)) return val
        const obj: Record<string, unknown> = { ...val }
        let modified = false

        if (target === 'add' || target === 'remove') {
            if (applyAuthorAliasGroup(obj, aliasNames, 'alias')) modified = true
        }
        if (target === 'add' || target === 'list' || target === 'consolidate') {
            if (applyAuthorAliasGroup(obj, canonicalNames, 'canonical_author')) modified = true
        }
        const searchTarget =
            target === 'resolve' ? 'author' : target === 'remove' ? 'alias' : 'canonical_author'
        if (applyAuthorAliasGroup(obj, searchNames, searchTarget)) modified = true
        if (target === 'add' || target === 'list' || target === 'consolidate') {
            if (applyAuthorAliasGroup(obj, ['author'], 'canonical_author', true)) modified = true
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
            workspace_id: z.string().max(255).optional().describe(WORKSPACE_FIELD_DESC),
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
    }).strict()
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
            workspace_id: z.string().max(255).optional().describe(WORKSPACE_FIELD_DESC),
        })
        .strict()
)

export const RemoveAuthorAliasSchemaMcp = z.preprocess(
    createAliasPreprocessor('remove'),
    z.object({
        alias: z.string().min(1).max(255).optional().describe('The alias mapping to remove'),
        project_number: relaxedNumber().optional().describe('GitHub Project number'),
        workspace_id: z.string().optional().describe(WORKSPACE_FIELD_DESC),
    }).strict()
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
            workspace_id: z.string().max(255).optional().describe(WORKSPACE_FIELD_DESC),
        })
        .strict()
)

export const ListAuthorAliasesSchemaMcp = z.preprocess(
    createAliasPreprocessor('list'),
    z.object({
        canonical_author: z.string().optional().describe('Optional canonical author to filter aliases by'),
        project_number: relaxedNumber().optional().describe('GitHub Project number'),
        workspace_id: z.string().optional().describe(WORKSPACE_FIELD_DESC),
    }).strict()
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
            author: z
                .string()
                .trim()
                .min(1)
                .max(255)
                .describe('The raw author name to resolve'),
            project_number: StrictProjectNumberSchema,
            workspace_id: z.string().max(255).optional().describe(WORKSPACE_FIELD_DESC),
        })
        .strict()
)

export const ResolveAuthorSchemaMcp = z.preprocess(
    createAliasPreprocessor('resolve'),
    z.object({
        author: z.string().min(1).optional().describe('The raw author name to resolve'),
        project_number: relaxedNumber().optional().describe('GitHub Project number'),
        workspace_id: z.string().optional().describe(WORKSPACE_FIELD_DESC),
    }).strict()
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
            workspace_id: z.string().max(255).optional().describe(WORKSPACE_FIELD_DESC),
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
    }).strict()
)

export const ConsolidateAuthorsOutputSchema = z
    .object({
        success: z.boolean().optional(),
        updated_count: z.number().optional(),
        canonical_author: z.string().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)
