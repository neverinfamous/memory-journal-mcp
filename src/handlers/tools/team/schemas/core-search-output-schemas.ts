import { z } from 'zod'
import { EntryOutputSchema, RelationshipOutputSchema, TagOutputSchema } from '../../schemas.js'
import { ErrorFieldsMixin } from '../../error-fields-mixin.js'

export const TeamEntryOutputSchema = EntryOutputSchema.extend({
    author: z.string().nullable().optional(),
})

export const TeamCreateOutputSchema = z
    .object({
        success: z.boolean().optional(),
        entry: TeamEntryOutputSchema.optional(),
        author: z.string().optional(),
        error: z.string().optional(),
        relationshipWarnings: z.array(z.string()).optional(),
        vectorIndex: z.string().optional(),
        warning: z.string().optional(),
        degraded: z.boolean().optional(),
        relationshipsLinked: z.number().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TeamEntriesListOutputSchema = z
    .object({
        entries: z.array(TeamEntryOutputSchema).optional(),
        count: z.number().optional(),
        next_cursor: z.string().optional().describe('Cursor for the next page of results'),
        suggestions: z
            .array(z.string())
            .optional()
            .describe('Fuzzy matches when fuzzy_match=true and no exact results were found'),
        correctedQuery: z
            .string()
            .optional()
            .describe('The corrected query when auto_correct=true and a confident match was found'),
        success: z.boolean().optional(),
        error: z.string().optional(),
        degraded: z.boolean().optional(),
        warning: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TeamEntryDetailOutputSchema = z
    .object({
        success: z.boolean().optional(),
        entry: TeamEntryOutputSchema.optional(),
        relationships: z.array(RelationshipOutputSchema).optional(),
        importance: z
            .object({
                score: z.number(),
                breakdown: z
                    .object({
                        significance: z.number(),
                        relationships: z.number(),
                        causal: z.number(),
                        recency: z.number(),
                        trustModifier: z.number().optional(),
                    })
                    .optional(),
            })
            .optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const TeamTagsListOutputSchema = z
    .object({
        success: z.boolean().optional(),
        tags: z.array(TagOutputSchema).optional(),
        count: z.number().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)
