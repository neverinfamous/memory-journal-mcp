/**
 * Team Tool Group - 15 tools
 *
 * Barrel re-export composing all team tool sub-modules.
 *
 * Tools:
 *   Core:          team_create_entry, team_get_entry_by_id, team_get_recent, team_list_tags
 *   Search:        team_search, team_search_by_date_range
 *   Admin:         team_update_entry, team_delete_entry, team_merge_tags
 *   Analytics:     team_get_statistics
 *   Relationships: team_link_entries, team_visualize_relationships
 *   Export:        team_export_entries
 *   Backup:        team_backup, team_list_backups
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
import { getTeamBackupTools } from './backup-tools.js'

/**
 * Get all team tool definitions (15 tools).
 */
export function getTeamTools(context: ToolContext): ToolDefinition[] {
    return [
        ...getTeamCoreTools(context),
        ...getTeamSearchTools(context),
        ...getTeamAdminTools(context),
        ...getTeamAnalyticsTools(context),
        ...getTeamRelationshipTools(context),
        ...getTeamExportTools(context),
        ...getTeamBackupTools(context),
    ]
}
