import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { SemanticSearchSchemaMcp, SemanticSearchOutputSchema } from './schemas.js'
import { executeSemanticSearch } from './semantic-search-helpers.js'

export function getSemanticSearchTool(context: ToolContext): ToolDefinition[] {
    return [
        {
            name: 'semantic_search',
            title: 'Semantic Search',
            description:
                'Perform semantic/vector search on journal entries using AI embeddings. Supports find-related-by-ID (entry_id) and metadata filters (tags, entry_type, date range). ' +
                'Threshold default is 0.25 (try 0.15-0.2 for broader matches, 0.4+ for strict matches). ' +
                'Entries are auto-indexed on creation. If index drifts, use rebuild_vector_index.',
            group: 'search',
            inputSchema: SemanticSearchSchemaMcp,
            outputSchema: SemanticSearchOutputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: (params: unknown) => executeSemanticSearch(context, params),
        },
    ]
}
