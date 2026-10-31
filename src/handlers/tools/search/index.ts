import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { getSearchEntriesTool } from './search-entries.js'
import { getDateRangeSearchTool } from './date-range-search.js'
import { getSemanticSearchTool } from './semantic-search.js'
import { getMiscSearchTools } from './misc-tools.js'
import { getCrossTeamTools } from './cross-team.js'

export function getSearchTools(context: ToolContext): ToolDefinition[] {
    return [
        ...getSearchEntriesTool(context),
        ...getDateRangeSearchTool(context),
        ...getSemanticSearchTool(context),
        ...getMiscSearchTools(context),
        ...getCrossTeamTools(context),
    ];
}
