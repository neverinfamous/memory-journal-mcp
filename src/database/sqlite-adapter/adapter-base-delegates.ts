/**
 * Base delegate layer for SQLite DatabaseAdapter:
 * Houses connection lifecycle, RBAC team members, author aliases, and tags.
 * Extracted from `adapter-delegates.ts` (Appendix A) to stay within file line budgets.
 */

import type { Tag, ToolHandlerConfig } from '../../types/index.js'
import type { AuthorAlias, TeamMember, TeamRole } from '../core/interfaces.js'
import { NativeConnectionManager } from './native-connection.js'
import { AliasManager } from './aliases.js'
import { TagsManager } from './tags.js'
import { EntriesManager } from './entries/index.js'
import { RelationshipsManager } from './relationships.js'
import { BackupManager } from './backup.js'
import { MembersManager } from './members.js'
import { HealthOperations } from './health-operations.js'
import { LifecycleOperations } from './lifecycle-operations.js'
import { InsightsOperations } from './insights-operations.js'
import { VectorOperations } from './vector-operations.js'
import { runImmediateWriteTx } from './row-helpers.js'

export class AdapterBaseDelegates {
    protected connection: NativeConnectionManager
    protected tagsMgr: TagsManager
    protected entriesMgr: EntriesManager
    protected relationshipsMgr: RelationshipsManager
    protected backupMgr: BackupManager
    protected membersMgr: MembersManager
    protected aliasMgr: AliasManager
    protected healthOps: HealthOperations
    protected lifecycleOps: LifecycleOperations
    protected insightsOps: InsightsOperations
    protected vectorOps: VectorOperations

    constructor(dbPath: string, config?: ToolHandlerConfig, adapterOptions?: { backupsDir?: string }) {
        this.connection = new NativeConnectionManager(dbPath, adapterOptions?.backupsDir)
        this.tagsMgr = new TagsManager(this.connection)
        this.entriesMgr = new EntriesManager(this.connection, this.tagsMgr, config)
        this.relationshipsMgr = new RelationshipsManager(this.connection)
        this.backupMgr = new BackupManager(this.connection)
        this.membersMgr = new MembersManager(this.connection)
        this.aliasMgr = new AliasManager(this.connection)
        this.healthOps = new HealthOperations(this.connection, this.backupMgr)
        this.lifecycleOps = new LifecycleOperations(this.connection)
        this.insightsOps = new InsightsOperations(this.connection)
        this.vectorOps = new VectorOperations(this.connection)
    }

    async initialize(): Promise<void> {
        return this.connection.initialize()
    }

    applyTeamSchema(): void {
        this.connection.applyTeamSchema()
        this.membersMgr.invalidateCache()
    }

    flushSave(): void {
        this.connection.flushSave()
    }

    close(): void {
        this.connection.close()
    }

    getDbPath(): string {
        return this.connection.getDbPath()
    }

    pragma(command: string): void {
        this.connection.pragma(command)
    }

    executeInTransaction<T>(cb: () => T): T {
        return runImmediateWriteTx(this.connection.getNativeDb(), cb)
    }

    // Team Membership (RBAC)

    addTeamMember(
        author: string,
        role: TeamRole,
        addedBy?: string,
        displayName?: string
    ): TeamMember {
        return this.membersMgr.addMember(author, role, addedBy, displayName)
    }

    removeTeamMember(author: string): boolean {
        return this.membersMgr.removeMember(author)
    }

    updateTeamMemberRole(author: string, newRole: TeamRole): TeamMember | null {
        return this.membersMgr.updateRole(author, newRole)
    }

    getTeamMember(author: string): TeamMember | null {
        return this.membersMgr.getMember(author)
    }

    listTeamMembers(): TeamMember[] {
        return this.membersMgr.listMembers()
    }

    getTeamMemberCount(): number {
        return this.membersMgr.getMemberCount()
    }

    isTeamRbacActive(): boolean {
        return this.membersMgr.isRbacActive()
    }

    resolveTeamRole(author: string, defaultRole?: TeamRole | 'denied'): TeamRole | null {
        return this.membersMgr.resolveRole(author, defaultRole)
    }

    // Author Aliases (Level 2 Identity)

    addAuthorAlias(
        alias: string,
        canonicalAuthor: string,
        createdBy?: string,
        workspaceId?: string
    ): AuthorAlias {
        return workspaceId === undefined
            ? this.aliasMgr.addAlias(alias, canonicalAuthor, createdBy)
            : this.aliasMgr.addAlias(alias, canonicalAuthor, createdBy, workspaceId)
    }

    removeAuthorAlias(alias: string, workspaceId?: string): boolean {
        return workspaceId === undefined
            ? this.aliasMgr.removeAlias(alias)
            : this.aliasMgr.removeAlias(alias, workspaceId)
    }

    listAuthorAliases(canonicalAuthor?: string, workspaceId?: string): AuthorAlias[] {
        return this.aliasMgr.listAliases(canonicalAuthor, workspaceId)
    }

    resolveAuthor(rawAuthor: string, workspaceId?: string): string {
        return workspaceId === undefined
            ? this.aliasMgr.resolveAuthor(rawAuthor)
            : this.aliasMgr.resolveAuthor(rawAuthor, workspaceId)
    }

    resolveAuthors(rawAuthors: string[], workspaceId?: string): Map<string, string> {
        return this.aliasMgr.resolveAuthors(rawAuthors, workspaceId)
    }

    consolidateAuthors(
        canonicalAuthor: string,
        workspaceId?: string,
        projectNumber?: number | null
    ): number {
        if (projectNumber !== undefined) {
            return this.aliasMgr.consolidateAuthors(canonicalAuthor, workspaceId, projectNumber)
        }
        return workspaceId === undefined
            ? this.aliasMgr.consolidateAuthors(canonicalAuthor)
            : this.aliasMgr.consolidateAuthors(canonicalAuthor, workspaceId)
    }

    // Tags

    getTagsForEntry(entryId: number): string[] {
        return this.tagsMgr.getTagsForEntry(entryId)
    }

    getTagsForEntries(entryIds: number[]): Map<number, string[]> {
        return this.tagsMgr.batchGetTagsForEntries(entryIds)
    }

    listTags(workspaceId?: string, projectNumber?: number): Tag[] {
        return this.tagsMgr.listTags(workspaceId, projectNumber)
    }

    mergeTags(
        sourceTag: string,
        targetTag: string,
        workspaceId?: string,
        projectNumber?: number
    ): { entriesUpdated: number; sourceDeleted: boolean } {
        return this.tagsMgr.mergeTags(sourceTag, targetTag, workspaceId, projectNumber)
    }
}
