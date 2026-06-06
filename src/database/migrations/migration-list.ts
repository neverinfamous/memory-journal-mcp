import { Migration001Init } from './001-init.js'
import { Migration002AddSignificanceAndContext } from './002-add-significance-and-context.js'
import { Migration003AddDeletedAndArchived } from './003-add-deleted-and-archived.js'
import { Migration004AddGithubAndWorkflowIntegration } from './004-add-github-and-workflow-integration.js'
import { Migration005AddEntryRevisions } from './005-add-entry-revisions.js'
import { Migration006AddAnalyticsSnapshots } from './006-add-analytics-snapshots.js'
import { Migration007AddTeamAuthor } from './007-add-team-author.js'
import { Migration008AddTeamMembers } from './008-add-team-members.js'
import { Migration009AddEntryVersion } from './009-add-entry-version.js'
import { Migration010AddAuthorAliases } from './010-add-author-aliases.js'
import type { Migration } from './migration.js'

export const MIGRATIONS: Migration[] = [
    Migration001Init,
    Migration002AddSignificanceAndContext,
    Migration003AddDeletedAndArchived,
    Migration004AddGithubAndWorkflowIntegration,
    Migration005AddEntryRevisions,
    Migration006AddAnalyticsSnapshots,
    Migration007AddTeamAuthor,
    Migration008AddTeamMembers,
    Migration009AddEntryVersion,
    Migration010AddAuthorAliases,
]
