/**
 * Team Tool Group - 22 tools
 *
 * Barrel re-export composing all team tool sub-modules.
 *
 * Tools:
 *   Core:          team_create_entry, team_get_entry_by_id, team_get_recent, team_list_tags
 *   Search:        team_search, team_search_by_date_range
 *   Admin:         team_update_entry, team_delete_entry, team_merge_tags
 *   Analytics:     team_get_statistics, team_get_cross_project_insights
 *   Relationships: team_link_entries, team_visualize_relationships
 *   Export:        team_export_entries
 *   IO:            team_export_markdown, team_import_markdown
 *   Backup:        team_backup, team_list_backups
 *   Vector:        team_semantic_search, team_get_vector_index_stats,
 *                  team_rebuild_vector_index, team_add_to_vector_index
 *
 * Requires TEAM_DB_PATH to be configured. All tools return structured
 * errors when the team database is not available.
 */

import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { getTeamCoreTools } from './core-tools.js'
import { getTeamSearchTools } from './search-tools.js'
import { getTeamAdminTools } from './admin-tools.js'
import { getTeamAnalyticsTools } from './analytics-tools.js'
import { getTeamRelationshipTools } from './relationship-tools.js'
import { getTeamExportTools } from './export-tools.js'
import { getTeamIoTools } from './io-tools.js'
import { getTeamBackupTools } from './backup-tools.js'
import { getTeamVectorTools } from './vector-tools.js'

/**
 * Get all team tool definitions (22 tools).
 */
export function getTeamTools(context: ToolContext): ToolDefinition[] {
    return [
        ...getTeamCoreTools(context),
        ...getTeamSearchTools(context),
        ...getTeamAdminTools(context),
        ...getTeamAnalyticsTools(context),
        ...getTeamRelationshipTools(context),
        ...getTeamExportTools(context),
        ...getTeamIoTools(context),
        ...getTeamBackupTools(context),
        ...getTeamVectorTools(context),
    ]
}
