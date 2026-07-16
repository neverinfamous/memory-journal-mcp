// src/codemode/worker-script.ts
import { parentPort } from "node:worker_threads";
import * as vm from "node:vm";

// src/codemode/auto-return.ts
var NON_RETURNABLE = /^\s*(return|throw|const |let |var |if\b|else\b|for\b|while\b|do\b|switch\b|try\b|catch\b|finally\b|class |function |\/\/|\/\*|\{|\})/;
function transformAutoReturn(code) {
  let trimmed = code.trimEnd();
  if (!trimmed) return code;
  while (trimmed.endsWith(";")) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }
  let inString = null;
  let isEscaped = false;
  let lastBoundary = -1;
  let depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (ch === "\\") {
        isEscaped = !isEscaped;
      } else {
        if (ch === inString && !isEscaped) {
          inString = null;
        }
        isEscaped = false;
      }
    } else {
      if (ch === "'" || ch === '"' || ch === "`") {
        inString = ch;
      } else if (ch === "{" || ch === "[" || ch === "(") {
        depth++;
      } else if (ch === "}" || ch === "]" || ch === ")") {
        depth--;
      } else if (depth === 0 && (ch === ";" || ch === "\n")) {
        lastBoundary = i;
      }
    }
  }
  const lastStmt = (lastBoundary >= 0 ? trimmed.slice(lastBoundary + 1) : trimmed).trim();
  if (!lastStmt) return code;
  if (NON_RETURNABLE.test(lastStmt)) return code;
  if (lastBoundary >= 0) {
    const before = trimmed.slice(0, lastBoundary + 1);
    return `${before}
return ${lastStmt}`;
  }
  return `return ${trimmed}`;
}

// src/codemode/worker-result-proxy.ts
function wrapResult(result) {
  if (result !== null && result !== void 0 && typeof result === "object") {
    const isFailed = "success" in result && result["success"] === false;
    if (isFailed) {
      const failedResult = result;
      return new Proxy(failedResult, {
        ownKeys(target) {
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, prop) {
          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
        get(target, prop) {
          if (prop === "error" && typeof target["error"] === "string" && typeof target["code"] === "string") {
            return `[${target["code"]}] ${target["error"]}`;
          }
          if (prop in target) return target[prop];
          if (typeof prop === "string" && prop !== "then" && prop !== "catch" && prop !== "finally" && prop !== "constructor" && prop !== "prototype" && prop !== "toJSON") {
            const errVal = target["error"];
            const errorMsg = typeof errVal === "string" ? errVal : "Unknown error";
            throw new Error(
              `\u{1F6E0}\uFE0F AUTONOMOUS HEALING: Attempted to access property '${prop}' on a failed operation. You MUST check if 'success' is true before accessing properties on the result object. API Error: ${errorMsg}`
            );
          }
          return void 0;
        }
      });
    }
    if (!Array.isArray(result)) {
      const successResult = result;
      if ("next_cursor" in successResult && successResult["next_cursor"] !== null && successResult["next_cursor"] !== void 0 && successResult["next_cursor"] !== "") {
        successResult["hasMore"] = true;
      } else if (("entries" in successResult || "results" in successResult || "items" in successResult) && !("hasMore" in successResult)) {
        successResult["hasMore"] = false;
      }
      if (!("statistics" in successResult) && !("stats" in successResult) && ("totalEntries" in successResult || "entriesByType" in successResult)) {
        successResult["statistics"] = successResult;
        successResult["stats"] = successResult;
      }
      return new Proxy(successResult, {
        ownKeys(target) {
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, prop) {
          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
        get(target, prop) {
          if (prop in target) return target[prop];
          const isObject = (val) => typeof val === "object" && val !== null;
          const hasNumberId = (val) => isObject(val) && typeof val["id"] === "number";
          const targetRecord = target;
          if (prop === "entryIds" && "entries" in targetRecord && Array.isArray(targetRecord["entries"])) {
            return targetRecord["entries"].filter(hasNumberId).map((e) => e.id);
          }
          if (prop === "entryIds" && "updated" in targetRecord && Array.isArray(targetRecord["updated"])) {
            return targetRecord["updated"].filter(hasNumberId).map((e) => e.id);
          }
          if (prop === "deletedIds" && "deleted" in targetRecord && Array.isArray(targetRecord["deleted"])) {
            return targetRecord["deleted"];
          }
          if (prop === "deletedCount" && "count" in targetRecord && typeof targetRecord["count"] === "number") {
            return targetRecord["count"];
          }
          if (prop === "revisions" && "history" in targetRecord && Array.isArray(targetRecord["history"])) {
            return targetRecord["history"].map((h) => new Proxy(h, {
              get(t, p) {
                if (p === "revisionNumber") return t["revisionId"];
                if (p === "contentSnapshot") return t["content"];
                return typeof p === "string" ? t[p] : void 0;
              }
            }));
          }
          if (prop === Symbol.iterator) {
            const targetRecord2 = target;
            const arrayKeys = Object.keys(targetRecord2).filter((k) => Array.isArray(targetRecord2[k]));
            let targetKey = arrayKeys.find((k) => ["entries", "results", "projects", "items", "issues", "pullRequests", "milestones", "columns", "comments", "files", "errors", "backups", "deleted", "updated", "notFound", "history", "relationships", "members"].includes(k));
            if (targetKey === void 0 && arrayKeys.length === 1) {
              targetKey = arrayKeys[0];
            }
            if (targetKey !== void 0) {
              return function* () {
                yield* targetRecord2[targetKey];
              };
            }
          }
          if (prop === "length") {
            const targetRecord2 = target;
            const arrayKeys = Object.keys(targetRecord2).filter((k) => Array.isArray(targetRecord2[k]));
            let targetKey = arrayKeys.find((k) => ["entries", "results", "projects", "items", "rows", "tables", "flags", "groups", "users", "capabilities", "metrics", "events", "records", "logs", "aliases", "tags", "issues", "pullRequests", "milestones", "columns", "comments", "files", "errors", "backups", "deleted", "updated", "notFound", "history", "relationships", "members"].includes(k));
            if (targetKey === void 0 && arrayKeys.length === 1) {
              targetKey = arrayKeys[0];
            }
            if (targetKey !== void 0) {
              return targetRecord2[targetKey].length;
            }
          }
          if (typeof prop === "string" && /^\d+$/.test(prop)) {
            const idx = parseInt(prop, 10);
            const targetRecord2 = target;
            const arrayKeys = Object.keys(targetRecord2).filter((k) => Array.isArray(targetRecord2[k]));
            let targetKey = arrayKeys.find((k) => ["entries", "results", "projects", "items", "rows", "tables", "flags", "groups", "users", "capabilities", "metrics", "events", "records", "logs", "aliases", "tags", "issues", "pullRequests", "milestones", "columns", "comments", "files", "errors", "backups", "deleted", "updated", "notFound", "history", "relationships", "members"].includes(k));
            if (targetKey === void 0 && arrayKeys.length === 1) {
              targetKey = arrayKeys[0];
            }
            if (targetKey !== void 0) {
              return targetRecord2[targetKey][idx];
            }
          }
          if (typeof prop === "string" && [
            "find",
            "map",
            "filter",
            "reduce",
            "reduceRight",
            "forEach",
            "some",
            "every",
            "flatMap",
            "includes",
            "indexOf",
            "findIndex",
            "findLast",
            "findLastIndex",
            "join",
            "at",
            "concat",
            "keys",
            "values",
            "entries",
            "flat",
            "with",
            "slice"
          ].includes(prop)) {
            const targetRecord2 = target;
            const arrayKeys = Object.keys(targetRecord2).filter((k) => Array.isArray(targetRecord2[k]));
            let targetKey = arrayKeys.find((k) => ["entries", "results", "projects", "items", "rows", "tables", "flags", "groups", "users", "capabilities", "metrics", "events", "records", "logs", "aliases", "tags", "issues", "pullRequests", "milestones", "columns", "comments", "files", "errors", "backups", "deleted", "updated", "notFound", "history", "relationships", "members"].includes(k));
            if (targetKey === void 0 && arrayKeys.length === 1) {
              targetKey = arrayKeys[0];
            }
            if (targetKey !== void 0) {
              const arr = target[targetKey];
              const method = arr[prop];
              if (typeof method === "function") {
                return (...args) => {
                  const fn = method;
                  return fn.apply(arr, args);
                };
              }
            }
            const keys = Object.keys(target).join(", ") || "none";
            throw new TypeError(
              `\u{1F6E0}\uFE0F AUTONOMOUS HEALING: CodeMode Non-Array Proxy Error: Attempted to call Array method '${prop}' on an Object. The returned result is not an Array, and no array properties could be automatically resolved. Check the available keys and access the correct array property. Keys available: ${keys}`
            );
          }
          if (typeof prop === "string" && ["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "copyWithin", "fill"].includes(prop)) {
            throw new Error(
              `\u{1F6E0}\uFE0F AUTONOMOUS HEALING: [VALIDATION_ERROR] CodeMode Proxy Error: Array mutator method '${prop}' is not allowed on API results. Modifying local arrays does not update the server state. You MUST use the appropriate API tool (e.g., mj.core.updateEntry, mj.admin.batchUpdateEntries) to persist changes.`
            );
          }
          return void 0;
        }
      });
    }
  }
  return result;
}

// src/codemode/api-constants.ts
var METHOD_ALIASES = {
  core: {
    create: "createEntry",
    add: "createEntry",
    newEntry: "createEntry",
    addEntry: "createEntry",
    insert: "createEntry",
    write: "createEntry",
    log: "createEntry",
    record: "createEntry",
    note: "createEntry",
    save: "createEntry",
    get: "getEntryById",
    getEntry: "getEntryById",
    fetch: "getEntryById",
    read: "getEntryById",
    recent: "getRecentEntries",
    getRecent: "getRecentEntries",
    list: "getRecentEntries",
    entries: "getRecentEntries",
    all: "getRecentEntries",
    latest: "getRecentEntries",
    quick: "createEntry",
    createEntryMinimal: "createEntry",
    tags: "listTags",
    appendInsight: "createEntry",
    writeQuery: "createEntry",
    history: "getEntryHistory",
    revisions: "getEntryHistory",
    listEntries: "searchEntries",
    sessionSummary: "createEntry",
    create_entry: "createEntry",
    get_entry_by_id: "getEntryById",
    get_recent_entries: "getRecentEntries",
    create_entry_minimal: "createEntryMinimal",
    list_tags: "listTags",
    get_entry_history: "getEntryHistory",
    search_audit_log: "searchAuditLog"
  },
  search: {
    find: "searchEntries",
    search: "searchEntries",
    query: "searchEntries",
    lookup: "searchEntries",
    findEntries: "searchEntries",
    listEntries: "searchEntries",
    entries: "searchEntries",
    byDate: "searchByDateRange",
    similar: "semanticSearch",
    stats: "getVectorIndexStats",
    deleted: "listDeletedEntries",
    trash: "listDeletedEntries",
    crossSearch: "crossTeamSearch",
    readQuery: "searchEntries",
    read_query: "searchEntries",
    search_entries: "searchEntries",
    search_by_date_range: "searchByDateRange",
    semantic_search: "semanticSearch",
    get_vector_index_stats: "getVectorIndexStats",
    list_deleted_entries: "listDeletedEntries",
    cross_team_search: "crossTeamSearch"
  },
  analytics: {
    stats: "getStatistics",
    getStats: "getStatistics",
    insights: "getCrossProjectInsights",
    getInsights: "getCrossProjectInsights",
    getProjects: "getCrossProjectInsights",
    listProjects: "getCrossProjectInsights",
    projects: "getCrossProjectInsights",
    get_statistics: "getStatistics",
    get_cross_project_insights: "getCrossProjectInsights"
  },
  relationships: {
    link: "linkEntries",
    graph: "visualizeRelationships",
    link_entries: "linkEntries",
    visualize_relationships: "visualizeRelationships"
  },
  io: {
    dump: "exportEntries",
    md: "exportMarkdown",
    importMd: "importMarkdown",
    importNotion: "importExternal",
    importObsidian: "importExternal",
    export_entries: "exportEntries",
    export_markdown: "exportMarkdown",
    import_markdown: "importMarkdown",
    import_external: "importExternal"
  },
  admin: {
    edit: "updateEntry",
    update: "updateEntry",
    editEntry: "updateEntry",
    modifyEntry: "updateEntry",
    modify: "updateEntry",
    remove: "deleteEntry",
    delete: "deleteEntry",
    removeEntry: "deleteEntry",
    restore: "restoreEntry",
    restoreEntry: "restoreEntry",
    rebuild: "rebuildVectorIndex",
    addVector: "addToVectorIndex",
    mergeTags: "mergeTags",
    batchCreate: "batchCreateEntries",
    batchUpdate: "batchUpdateEntries",
    batchDelete: "batchDeleteEntries",
    bulkCreate: "batchCreateEntries",
    bulkUpdate: "batchUpdateEntries",
    bulkDelete: "batchDeleteEntries",
    createEntries: "batchCreateEntries",
    updateEntries: "batchUpdateEntries",
    deleteEntries: "batchDeleteEntries",
    batchCreateEntry: "batchCreateEntries",
    config: "updateConfiguration",
    configure: "updateConfiguration",
    auditLog: "searchAuditLog",
    audit: "searchAuditLog",
    registerProject: "registerProject",
    updateProject: "updateProject",
    deleteProject: "deleteProject",
    removeProject: "deleteProject",
    getProject: "getProject",
    listProjects: "listProjects",
    projects: "listProjects",
    update_entry: "updateEntry",
    delete_entry: "deleteEntry",
    restore_entry: "restoreEntry",
    rebuild_vector_index: "rebuildVectorIndex",
    add_to_vector_index: "addToVectorIndex",
    merge_tags: "mergeTags",
    batch_create_entries: "batchCreateEntries",
    batch_update_entries: "batchUpdateEntries",
    batch_delete_entries: "batchDeleteEntries",
    update_configuration: "updateConfiguration",
    search_audit_log: "searchAuditLog",
    register_project: "registerProject",
    update_project: "updateProject",
    delete_project: "deleteProject",
    get_project: "getProject",
    list_projects: "listProjects"
  },
  github: {
    issues: "getGithubIssues",
    issue: "getGithubIssue",
    prs: "getGithubPrs",
    pr: "getGithubPr",
    context: "getGithubContext",
    kanban: "getKanbanBoard",
    moveKanban: "moveKanbanItem",
    addKanban: "addKanbanItem",
    deleteKanban: "deleteKanbanItem",
    milestones: "getGithubMilestones",
    milestone: "getGithubMilestone",
    createMilestone: "createGithubMilestone",
    updateMilestone: "updateGithubMilestone",
    deleteMilestone: "deleteGithubMilestone",
    repoInsights: "getRepoInsights",
    createIssue: "createGithubIssueWithEntry",
    closeIssue: "closeGithubIssueWithEntry",
    copilotReviews: "getCopilotReviews",
    get_github_issues: "getGithubIssues",
    get_github_issue: "getGithubIssue",
    get_github_prs: "getGithubPrs",
    get_github_pr: "getGithubPr",
    get_github_context: "getGithubContext",
    get_kanban_board: "getKanbanBoard",
    move_kanban_item: "moveKanbanItem",
    add_kanban_item: "addKanbanItem",
    delete_kanban_item: "deleteKanbanItem",
    get_github_milestones: "getGithubMilestones",
    get_github_milestone: "getGithubMilestone",
    create_github_milestone: "createGithubMilestone",
    update_github_milestone: "updateGithubMilestone",
    delete_github_milestone: "deleteGithubMilestone",
    get_repo_insights: "getRepoInsights",
    create_github_issue_with_entry: "createGithubIssueWithEntry",
    close_github_issue_with_entry: "closeGithubIssueWithEntry",
    get_copilot_reviews: "getCopilotReviews"
  },
  backup: {
    save: "backupJournal",
    create: "backupJournal",
    backup: "backupJournal",
    list: "listBackups",
    restore: "restoreBackup",
    cleanup: "cleanupBackups",
    backup_journal: "backupJournal",
    list_backups: "listBackups",
    restore_backup: "restoreBackup",
    cleanup_backups: "cleanupBackups"
  },
  team: {
    create: "teamCreateEntry",
    createEntry: "teamCreateEntry",
    create_entry: "teamCreateEntry",
    addEntry: "teamCreateEntry",
    recent: "teamGetRecent",
    find: "teamSearch",
    search: "teamSearch",
    get: "teamGetEntryById",
    read: "teamGetEntryById",
    listEntries: "teamGetRecent",
    teamListEntries: "teamGetRecent",
    list: "teamGetRecent",
    entries: "teamGetRecent",
    teamList: "teamGetRecent",
    tags: "teamListTags",
    byDate: "teamSearchByDateRange",
    update: "teamUpdateEntry",
    edit: "teamUpdateEntry",
    delete: "teamDeleteEntry",
    restore: "teamRestoreEntry",
    teamRestore: "teamRestoreEntry",
    mergeTags: "teamMergeTags",
    batchCreate: "teamBatchCreateEntries",
    batchCreateEntries: "teamBatchCreateEntries",
    batchUpdate: "teamBatchUpdateEntries",
    batchUpdateEntries: "teamBatchUpdateEntries",
    batchDelete: "teamBatchDeleteEntries",
    batchDeleteEntries: "teamBatchDeleteEntries",
    bulkCreate: "teamBatchCreateEntries",
    bulkUpdate: "teamBatchUpdateEntries",
    bulkDelete: "teamBatchDeleteEntries",
    createEntries: "teamBatchCreateEntries",
    updateEntries: "teamBatchUpdateEntries",
    deleteEntries: "teamBatchDeleteEntries",
    batchCreateEntry: "teamBatchCreateEntries",
    stats: "teamGetStatistics",
    link: "teamLinkEntries",
    linkEntries: "teamLinkEntries",
    graph: "teamVisualizeRelationships",
    visualizeRelationships: "teamVisualizeRelationships",
    export: "teamExportEntries",
    exportEntries: "teamExportEntries",
    exportMarkdown: "teamExportMarkdown",
    md: "teamExportMarkdown",
    importMarkdown: "teamImportMarkdown",
    importMd: "teamImportMarkdown",
    importNotion: "teamImportExternal",
    importObsidian: "teamImportExternal",
    importExternal: "teamImportExternal",
    trash: "teamListDeletedEntries",
    backup: "teamBackup",
    listBackups: "teamListBackups",
    semanticSearch: "teamSemanticSearch",
    vectorStats: "teamGetVectorIndexStats",
    rebuildIndex: "teamRebuildVectorIndex",
    addToIndex: "teamAddToVectorIndex",
    insights: "teamGetCrossProjectInsights",
    collaborationMatrix: "teamGetCollaborationMatrix",
    searchProjects: "teamGetCrossProjectInsights",
    listProjects: "teamGetCrossProjectInsights",
    getProjects: "teamGetCrossProjectInsights",
    deleted: "teamListDeletedEntries",
    addMember: "teamAddMember",
    removeMember: "teamRemoveMember",
    members: "teamListMembers",
    listMembers: "teamListMembers",
    getMember: "teamGetMember",
    updateRole: "teamUpdateMemberRole",
    changeRole: "teamUpdateMemberRole",
    setRole: "teamUpdateMemberRole",
    addAlias: "teamAddAuthorAlias",
    removeAlias: "teamRemoveAuthorAlias",
    aliases: "teamListAuthorAliases",
    listAliases: "teamListAuthorAliases",
    resolveAuthor: "teamResolveAuthor",
    consolidate: "teamConsolidateAuthors",
    consolidateAuthors: "teamConsolidateAuthors",
    sessionSummary: "teamCreateEntry",
    teamSessionSummary: "teamCreateEntry"
  },
  git: {
    history: "getCommitHistory",
    log: "getCommitHistory",
    commits: "getCommitHistory",
    search: "searchCommits",
    find: "searchCommits",
    release: "getReleaseInfo",
    unreleased: "getUnreleasedCommits",
    analyze: "analyzeCommitPatterns",
    get_commit_history: "getCommitHistory",
    search_commits: "searchCommits",
    get_release_info: "getReleaseInfo",
    get_unreleased_commits: "getUnreleasedCommits",
    analyze_commit_patterns: "analyzeCommitPatterns"
  }
};

// src/codemode/api/git-api.ts
function applyGitInterceptions(methodName, args) {
  const gitMethods = [
    "get_commit_history",
    "getCommitHistory",
    "search_commits",
    "searchCommits",
    "get_release_info",
    "getReleaseInfo",
    "get_unreleased_commits",
    "getUnreleasedCommits",
    "analyze_commit_patterns",
    "analyzeCommitPatterns"
  ];
  if (gitMethods.includes(methodName) && args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
    const obj = args[0];
    for (const key of ["text", "message", "description", "q", "search"]) {
      if (obj[key] !== void 0 && obj["query"] === void 0 && (methodName.includes("search_commits") || methodName.includes("searchCommits"))) {
        obj["query"] = obj[key];
        Reflect.deleteProperty(obj, key);
      }
    }
    if (obj["keep"] !== void 0 && obj["maxCount"] === void 0 && obj["max_count"] === void 0) {
      obj["maxCount"] = obj["keep"];
      delete obj["keep"];
    }
    if (obj["limit"] !== void 0 && obj["maxCount"] === void 0 && obj["max_count"] === void 0) {
      obj["maxCount"] = obj["limit"];
      delete obj["limit"];
    }
    if (!methodName.includes("search") && (obj["q"] !== void 0 || obj["query"] !== void 0 || obj["search"] !== void 0)) {
      return { error: {
        success: false,
        error: `${methodName} does not support search queries (q/query/search). It only retrieves history or analysis.`,
        code: "VALIDATION_ERROR",
        category: "validation",
        suggestion: "Remove the query parameter, or use search_commits for text search.",
        recoverable: true
      } };
    }
    return { args: [obj] };
  }
  return null;
}

// src/codemode/param-normalizer.ts
function isRecord(val) {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}
function applyArgInterceptions(methodName, args) {
  const gitIntercept = applyGitInterceptions(methodName, args);
  if (gitIntercept) return gitIntercept;
  if (args.length === 1 && isRecord(args[0])) {
    const obj = { ...args[0] };
    args[0] = obj;
    if (obj["user"] !== void 0 && obj["target_user"] === void 0) {
      obj["target_user"] = obj["user"];
      delete obj["user"];
    }
    if (obj["severity"] !== void 0 && obj["flag_type"] === void 0) {
      obj["flag_type"] = obj["severity"];
      delete obj["severity"];
    }
    if (obj["msg"] !== void 0 && obj["message"] === void 0) {
      obj["message"] = obj["msg"];
      delete obj["msg"];
    }
    if (obj["sort"] !== void 0 && obj["sort_by"] === void 0) {
      obj["sort_by"] = obj["sort"];
      delete obj["sort"];
    }
    if (obj["sortBy"] !== void 0 && obj["sort_by"] === void 0) {
      obj["sort_by"] = obj["sortBy"];
      delete obj["sortBy"];
    }
    if (obj["orderBy"] !== void 0 && obj["sort_by"] === void 0) {
      obj["sort_by"] = obj["orderBy"];
      delete obj["orderBy"];
    }
    if (obj["order_by"] !== void 0 && obj["sort_by"] === void 0) {
      obj["sort_by"] = obj["order_by"];
      delete obj["order_by"];
    }
    if (typeof obj["sort_by"] === "string") {
      const lowerSort = obj["sort_by"].toLowerCase();
      if (lowerSort.endsWith("_asc")) {
        obj["sort_by"] = obj["sort_by"].replace(/_asc$/i, "");
        if (obj["sort_order"] === void 0) obj["sort_order"] = "asc";
      } else if (lowerSort.endsWith("_desc")) {
        obj["sort_by"] = obj["sort_by"].replace(/_desc$/i, "");
        if (obj["sort_order"] === void 0) obj["sort_order"] = "desc";
      }
    }
    if (obj["comment"] !== void 0 && obj["resolution"] === void 0) {
      obj["resolution"] = obj["comment"];
      delete obj["comment"];
    }
    if (obj["version"] !== void 0 && obj["expected_version"] === void 0) {
      obj["expected_version"] = obj["version"];
      delete obj["version"];
    }
    if (obj["repo"] !== void 0 && obj["repo_name"] === void 0) {
      obj["repo_name"] = obj["repo"];
      delete obj["repo"];
    }
    if (obj["item_type"] !== void 0 && obj["type"] === void 0) {
      obj["type"] = obj["item_type"];
      delete obj["item_type"];
    }
    if (obj["category"] !== void 0 && obj["type"] === void 0) {
      obj["type"] = obj["category"];
      delete obj["category"];
    }
    if (obj["metadata"] !== void 0 && obj["context"] === void 0) {
      obj["context"] = obj["metadata"];
      delete obj["metadata"];
    }
    if ((methodName === "create_entry" || methodName === "createEntry" || methodName === "update_entry" || methodName === "updateEntry") && obj["content"] === void 0) {
      if (obj["text"] !== void 0) {
        obj["content"] = obj["text"];
        delete obj["text"];
      } else if (obj["message"] !== void 0) {
        obj["content"] = obj["message"];
        delete obj["message"];
      }
    }
    if (obj["search"] !== void 0 && obj["query"] === void 0) {
      obj["query"] = obj["search"];
      delete obj["search"];
    }
    if ((methodName === "import_external" || methodName === "importExternal" || methodName === "team_import_external" || methodName === "teamImportExternal") && obj["source_dir"] === void 0) {
      if (obj["filename"] !== void 0) {
        obj["source_dir"] = obj["filename"];
        delete obj["filename"];
      }
    }
  }
  if ((methodName === "search_entries" || methodName === "searchEntries" || methodName === "team_search" || methodName === "teamSearch" || methodName === "search_by_date_range" || methodName === "searchByDateRange" || methodName === "team_search_by_date_range" || methodName === "teamSearchByDateRange" || methodName === "semantic_search" || methodName === "semanticSearch" || methodName === "team_semantic_search" || methodName === "teamSemanticSearch" || methodName === "cross_team_search" || methodName === "crossTeamSearch") && args.length === 1 && isRecord(args[0])) {
    const obj = { ...args[0] };
    args[0] = obj;
    if (methodName === "search_by_date_range" || methodName === "searchByDateRange" || methodName === "team_search_by_date_range" || methodName === "teamSearchByDateRange") {
      if (obj["q"] !== void 0 || obj["query"] !== void 0 || obj["text"] !== void 0 || obj["message"] !== void 0 || obj["description"] !== void 0 || obj["keep"] !== void 0 || obj["path"] !== void 0) {
        return { error: {
          success: false,
          error: `${methodName} does not support search queries. It only searches by date.`,
          code: "VALIDATION_ERROR",
          category: "validation",
          suggestion: "Use team_search (or search_entries) if you want to search by text, or remove the text/query parameters.",
          recoverable: true
        } };
      }
    }
    if (obj["q"] !== void 0 && obj["query"] === void 0) {
      obj["query"] = obj["q"];
      delete obj["q"];
    }
    if (obj["text"] !== void 0 && obj["query"] === void 0) {
      obj["query"] = obj["text"];
      delete obj["text"];
    }
    if (obj["message"] !== void 0 && obj["query"] === void 0) {
      obj["query"] = obj["message"];
      delete obj["message"];
    }
    if (obj["description"] !== void 0 && obj["query"] === void 0) {
      obj["query"] = obj["description"];
      delete obj["description"];
    }
    if (obj["path"] !== void 0 && obj["query"] === void 0) {
      obj["query"] = obj["path"];
      delete obj["path"];
    }
    if (obj["keep"] !== void 0 && obj["query"] === void 0) {
      obj["query"] = obj["keep"];
      delete obj["keep"];
    }
    if (obj["start"] !== void 0 && obj["start_date"] === void 0) {
      obj["start_date"] = obj["start"];
      delete obj["start"];
    }
    if (obj["end"] !== void 0 && obj["end_date"] === void 0) {
      obj["end_date"] = obj["end"];
      delete obj["end"];
    }
    if (typeof obj["limit"] === "string") {
      const parsed = parseInt(obj["limit"], 10);
      if (!isNaN(parsed)) obj["limit"] = parsed;
    }
    if (methodName !== "search_entries" && methodName !== "searchEntries" && methodName !== "team_search" && methodName !== "teamSearch") {
      if (obj["mode"] !== void 0) {
        return { error: {
          success: false,
          error: `${methodName} does not support the 'mode' parameter.`,
          code: "VALIDATION_ERROR",
          category: "validation",
          suggestion: "Remove the mode parameter or use search_entries instead.",
          recoverable: true
        } };
      }
    }
  }
  if ((methodName === "search_entries" || methodName === "searchEntries" || methodName === "team_search" || methodName === "teamSearch" || methodName === "search_by_date_range" || methodName === "searchByDateRange" || methodName === "team_search_by_date_range" || methodName === "teamSearchByDateRange" || methodName === "cross_team_search" || methodName === "crossTeamSearch") && args.length === 1 && isRecord(args[0])) {
    const obj = { ...args[0] };
    args[0] = obj;
    if ("exact_match" in obj) {
      const isFuzzy = obj["exact_match"] === false;
      obj["fuzzy_match"] = isFuzzy;
      if (methodName !== "cross_team_search" && methodName !== "crossTeamSearch") {
        obj["auto_correct"] = isFuzzy;
      }
      delete obj["exact_match"];
    } else if (obj["fuzzy_match"] === true && !("auto_correct" in obj)) {
      if (methodName !== "cross_team_search" && methodName !== "crossTeamSearch") {
        obj["auto_correct"] = true;
      }
    }
    if (typeof obj["start_date"] === "string" && (obj["end_date"] === void 0 || obj["end_date"] === null || obj["end_date"] === "")) {
      obj["end_date"] = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    }
    if ((methodName === "team_search" || methodName === "teamSearch") && obj["project_number"] == null) {
      const tags = obj["tags"];
      const entryType = obj["entry_type"];
      const isFlagSearch = Boolean(tags && tags.length > 0 && tags.every((t) => typeof t === "string" && t.startsWith("flag:"))) || entryType === "flag";
      if (!isFlagSearch) {
        return { error: {
          success: false,
          error: 'Cross-project team searches are only permitted for flags. Provide a project_number or filter by entry_type="flag" or flag:* tags.',
          code: "VALIDATION_ERROR",
          category: "validation",
          suggestion: 'Provide a project_number, or use tags starting with "flag:" or entry_type="flag"',
          recoverable: true
        } };
      }
    }
    if ((methodName === "team_search_by_date_range" || methodName === "teamSearchByDateRange") && obj["project_number"] == null) {
      const tags = obj["tags"];
      const entryType = obj["entry_type"];
      const isFlagSearch = Boolean(tags && tags.length > 0 && tags.every((t) => typeof t === "string" && t.startsWith("flag:"))) || entryType === "flag";
      if (!isFlagSearch) {
        return { error: {
          success: false,
          error: 'Cross-project team date range searches are only permitted for flags. Provide a project_number or filter by entry_type="flag" or flag:* tags.',
          code: "VALIDATION_ERROR",
          category: "validation",
          suggestion: 'Provide a project_number, or use tags starting with "flag:" or entry_type="flag"',
          recoverable: true
        } };
      }
    }
  }
  const ioMethods = ["export_entries", "exportEntries", "team_export_entries", "teamExportEntries", "export_markdown", "exportMarkdown", "team_export_markdown", "teamExportMarkdown", "import_markdown", "importMarkdown", "team_import_markdown", "teamImportMarkdown", "import_external", "importExternal", "team_import_external", "teamImportExternal"];
  if (ioMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
    const obj = { ...args[0] };
    args[0] = obj;
    if (obj["keep"] !== void 0 && obj["limit"] === void 0) {
      obj["limit"] = obj["keep"];
      delete obj["keep"];
    }
    if (obj["q"] !== void 0 || obj["query"] !== void 0 || obj["text"] !== void 0 || obj["search"] !== void 0 || obj["message"] !== void 0 || obj["description"] !== void 0) {
      return { error: {
        success: false,
        error: `${methodName} does not support text search or content parameters. It only exports/imports data.`,
        code: "VALIDATION_ERROR",
        category: "validation",
        suggestion: "To search for specific text, use search_entries (or team_search). Otherwise, remove the search/content parameters.",
        recoverable: true
      } };
    }
    if (obj["mode"] !== void 0) {
      return { error: {
        success: false,
        error: `${methodName} does not support the 'mode' parameter.`,
        code: "VALIDATION_ERROR",
        category: "validation",
        suggestion: "Remove the mode parameter.",
        recoverable: true
      } };
    }
    if (methodName === "export_entries" || methodName === "exportEntries" || methodName === "team_export_entries" || methodName === "teamExportEntries") {
      if (obj["path"] !== void 0 || obj["output_dir"] !== void 0 || obj["file"] !== void 0) {
        return { error: {
          success: false,
          error: `export_entries returns the exported data directly and does not write to disk.`,
          code: "VALIDATION_ERROR",
          category: "validation",
          suggestion: "Use export_markdown if you want to save files to a directory, or remove path/output_dir.",
          recoverable: true
        } };
      }
    }
    for (const key of ["path", "file", "filepath", "dir", "folder", "target", "source"]) {
      if (obj[key] !== void 0) {
        let didMap = false;
        if (methodName.includes("export_markdown") || methodName.includes("exportMarkdown") || methodName.includes("teamExportMarkdown") || methodName.includes("team_export_markdown")) {
          if (obj["output_dir"] === void 0) obj["output_dir"] = obj[key];
          didMap = true;
        } else if (methodName.toLowerCase().includes("import")) {
          if (key === "source" && (methodName.includes("import_external") || methodName.includes("importExternal") || methodName.includes("teamImportExternal") || methodName.includes("team_import_external"))) {
          } else {
            if (obj["source_dir"] === void 0) obj["source_dir"] = obj[key];
            didMap = true;
          }
        }
        if (didMap) {
          if (key === "path") delete obj["path"];
          else if (key === "file") delete obj["file"];
          else if (key === "filepath") delete obj["filepath"];
          else if (key === "dir") delete obj["dir"];
          else if (key === "folder") delete obj["folder"];
          else if (key === "target") delete obj["target"];
          else if (key === "source") delete obj["source"];
        }
      }
    }
    if (methodName.includes("import_external") || methodName.includes("importExternal") || methodName.includes("teamImportExternal") || methodName.includes("team_import_external")) {
      if (obj["url"] !== void 0 || obj["link"] !== void 0) {
        return { error: {
          success: false,
          error: `import_external does not download from URLs. It imports from a local directory (source_dir).`,
          code: "VALIDATION_ERROR",
          category: "validation",
          suggestion: "Provide a local directory path in source_dir.",
          recoverable: true
        } };
      }
      if (obj["format"] !== void 0 && obj["source_format"] === void 0) {
        obj["source_format"] = obj["format"];
        delete obj["format"];
      }
      if (obj["source"] !== void 0 && obj["source_format"] === void 0) {
        obj["source_format"] = obj["source"];
        delete obj["source"];
      }
    }
  }
  if ((methodName === "team_get_vector_index_stats" || methodName === "teamGetVectorIndexStats" || methodName === "get_vector_index_stats" || methodName === "getVectorIndexStats") && args.length === 1 && isRecord(args[0])) {
    const obj = { ...args[0] };
    args[0] = obj;
    if (obj["q"] !== void 0 || obj["query"] !== void 0 || obj["search"] !== void 0 || obj["text"] !== void 0 || obj["message"] !== void 0 || obj["description"] !== void 0 || obj["path"] !== void 0) {
      return { error: {
        success: false,
        error: `${methodName} does not support search queries. It returns overall index statistics.`,
        code: "VALIDATION_ERROR",
        category: "validation",
        suggestion: "Remove the search query parameter.",
        recoverable: true
      } };
    }
  }
  const parameterlessMethods = ["rebuild_vector_index", "rebuildVectorIndex", "team_rebuild_vector_index", "teamRebuildVectorIndex"];
  if (parameterlessMethods.includes(methodName) && args.length === 1 && (typeof args[0] === "boolean" || typeof args[0] === "string" || typeof args[0] === "number")) {
    args[0] = {};
  }
  const listDeletedMethods = ["list_deleted_entries", "listDeletedEntries", "team_list_deleted_entries", "teamListDeletedEntries"];
  if (listDeletedMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
    const obj = { ...args[0] };
    args[0] = obj;
    if (obj["q"] !== void 0 || obj["query"] !== void 0 || obj["search"] !== void 0 || obj["text"] !== void 0 || obj["message"] !== void 0 || obj["description"] !== void 0 || obj["path"] !== void 0 || obj["mode"] !== void 0) {
      return { error: {
        success: false,
        error: `${methodName} does not support search queries, path, or mode. It returns all deleted entries.`,
        code: "VALIDATION_ERROR",
        category: "validation",
        suggestion: "Remove these parameters.",
        recoverable: true
      } };
    }
    if (obj["keep"] !== void 0 && obj["limit"] === void 0) {
      obj["limit"] = obj["keep"];
      delete obj["keep"];
    }
    if (obj["project_number"] !== void 0) {
      delete obj["project_number"];
    }
    if (obj["project_id"] !== void 0) {
      delete obj["project_id"];
    }
  }
  const analyticsMethods = ["get_statistics", "getStatistics", "get_cross_project_insights", "getCrossProjectInsights", "team_get_statistics", "teamGetStatistics", "team_get_cross_project_insights", "teamGetCrossProjectInsights", "get_collaboration_matrix", "getCollaborationMatrix", "team_get_collaboration_matrix", "teamGetCollaborationMatrix"];
  if (analyticsMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
    const obj = { ...args[0] };
    args[0] = obj;
    if (obj["q"] !== void 0 || obj["query"] !== void 0 || obj["search"] !== void 0 || obj["text"] !== void 0 || obj["message"] !== void 0 || obj["description"] !== void 0 || obj["path"] !== void 0 || obj["keep"] !== void 0 || obj["mode"] !== void 0) {
      return { error: {
        success: false,
        error: `${methodName} does not support search queries, content parameters, or modes. It returns analytical data.`,
        code: "VALIDATION_ERROR",
        category: "validation",
        suggestion: "Remove these parameters. Use search_entries or team_search if you want to find specific content.",
        recoverable: true
      } };
    }
    if (methodName.includes("get_statistics") || methodName.includes("getStatistics")) {
      if (obj["time"] !== void 0 || obj["timeframe"] !== void 0 || obj["period"] !== void 0) {
        return { error: {
          success: false,
          error: `get_statistics does not accept a time/timeframe parameter. Use 'group_by' ('day', 'week', 'month') instead.`,
          code: "VALIDATION_ERROR",
          category: "validation",
          suggestion: "Remove time/timeframe and use group_by.",
          recoverable: true
        } };
      }
    }
    if (methodName.includes("get_cross_project_insights") || methodName.includes("getCrossProjectInsights")) {
      if (obj["limit"] !== void 0) {
        return { error: {
          success: false,
          error: `get_cross_project_insights does not accept a limit parameter. It analyzes all projects.`,
          code: "VALIDATION_ERROR",
          category: "validation",
          suggestion: "Remove the limit parameter.",
          recoverable: true
        } };
      }
    }
  }
  const githubMethods = [
    "get_github_issues",
    "getGithubIssues",
    "get_github_prs",
    "getGithubPrs",
    "get_github_issue",
    "getGithubIssue",
    "get_github_pr",
    "getGithubPr",
    "get_github_context",
    "getGithubContext",
    "get_kanban_board",
    "getKanbanBoard",
    "move_kanban_item",
    "moveKanbanItem",
    "add_kanban_item",
    "addKanbanItem",
    "delete_kanban_item",
    "deleteKanbanItem",
    "create_github_issue_with_entry",
    "createGithubIssueWithEntry",
    "close_github_issue_with_entry",
    "closeGithubIssueWithEntry",
    "get_github_milestones",
    "getGithubMilestones",
    "get_github_milestone",
    "getGithubMilestone",
    "create_github_milestone",
    "createGithubMilestone",
    "update_github_milestone",
    "updateGithubMilestone",
    "delete_github_milestone",
    "deleteGithubMilestone",
    "get_repo_insights",
    "getRepoInsights",
    "get_copilot_reviews",
    "getCopilotReviews"
  ];
  if (githubMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
    const obj = { ...args[0] };
    args[0] = obj;
    for (const key of ["text", "message", "description"]) {
      if (obj[key] !== void 0) {
        if (methodName.includes("create_github_issue") || methodName.includes("createGithubIssue")) {
          if (obj["body"] === void 0) {
            obj["body"] = obj[key];
            if (key === "text") delete obj["text"];
            else if (key === "message") delete obj["message"];
            else if (key === "description") delete obj["description"];
          }
        } else if (methodName.includes("create_github_milestone") || methodName.includes("createGithubMilestone") || methodName.includes("update_github_milestone") || methodName.includes("updateGithubMilestone")) {
          if (obj["title"] === void 0 && (key === "text" || key === "message" || key === "description")) {
            obj["title"] = obj[key];
            if (key === "text") delete obj["text"];
            else if (key === "message") delete obj["message"];
            else if (key === "description") delete obj["description"];
          }
        } else if (methodName.includes("close_github_issue") || methodName.includes("closeGithubIssue")) {
          if (obj["comment"] === void 0 && key !== "description") {
            obj["comment"] = obj[key];
            if (key === "text") delete obj["text"];
            else if (key === "message") delete obj["message"];
          } else if (obj["resolution_notes"] === void 0 && key === "description") {
            obj["resolution_notes"] = obj[key];
            delete obj["description"];
          }
        }
      }
    }
    const hasStateParam = methodName.includes("get_github_issues") || methodName.includes("getGithubIssues") || methodName.includes("get_github_prs") || methodName.includes("getGithubPrs") || methodName.includes("get_github_milestones") || methodName.includes("getGithubMilestones");
    if (hasStateParam && obj["keep"] !== void 0 && obj["state"] === void 0) {
      if (obj["keep"] === true) {
        obj["state"] = "open";
      } else if (obj["keep"] === false) {
        obj["state"] = "closed";
      } else if (typeof obj["keep"] === "string") {
        obj["state"] = obj["keep"];
      }
      delete obj["keep"];
    }
    if (methodName.includes("get_kanban_board") || methodName.includes("getKanbanBoard")) {
      if (obj["keep"] !== void 0 && obj["project_number"] === void 0) {
        obj["project_number"] = obj["keep"];
        delete obj["keep"];
      }
      if (obj["path"] !== void 0 && obj["project_number"] === void 0) {
        obj["project_number"] = obj["path"];
        delete obj["path"];
      }
    }
    if (methodName.includes("move_kanban_item") || methodName.includes("moveKanbanItem")) {
      if (obj["keep"] !== void 0 && obj["item_id"] === void 0) {
        obj["item_id"] = obj["keep"];
        delete obj["keep"];
      }
      if (obj["path"] !== void 0 && obj["target_status"] === void 0) {
        obj["target_status"] = obj["path"];
        delete obj["path"];
      }
    }
    if (methodName.includes("add_kanban_item") || methodName.includes("addKanbanItem")) {
      if (obj["keep"] !== void 0 && obj["issue_number"] === void 0) {
        obj["issue_number"] = obj["keep"];
        delete obj["keep"];
      }
    }
    if (methodName.includes("delete_kanban_item") || methodName.includes("deleteKanbanItem")) {
      if (obj["keep"] !== void 0 && obj["item_id"] === void 0) {
        obj["item_id"] = obj["keep"];
        delete obj["keep"];
      }
    }
    if (methodName.includes("get_github_milestone") || methodName.includes("getGithubMilestone") || methodName.includes("update_github_milestone") || methodName.includes("updateGithubMilestone") || methodName.includes("delete_github_milestone") || methodName.includes("deleteGithubMilestone")) {
      if (obj["keep"] !== void 0 && obj["milestone_number"] === void 0) {
        obj["milestone_number"] = obj["keep"];
        delete obj["keep"];
      }
    }
    if (obj["mode"] !== void 0 && obj["summary_only"] === void 0) {
      obj["summary_only"] = obj["mode"] === "summary";
      delete obj["mode"];
    }
    if ((methodName.includes("get_github_issues") || methodName.includes("getGithubIssues") || methodName.includes("get_github_prs") || methodName.includes("getGithubPrs") || methodName.includes("get_github_milestones") || methodName.includes("getGithubMilestones")) && (obj["q"] !== void 0 || obj["query"] !== void 0 || obj["search"] !== void 0)) {
      return { error: {
        success: false,
        error: `${methodName} does not support search queries (q/query/search). It only supports listing by state (open/closed).`,
        code: "VALIDATION_ERROR",
        category: "validation",
        suggestion: "Remove the query parameter to list items, or use GitHub directly for complex searches.",
        recoverable: true
      } };
    }
    if ((methodName.includes("get_github_context") || methodName.includes("getGithubContext")) && obj["path"] !== void 0) {
      return { error: {
        success: false,
        error: `get_github_context does not take a 'path' parameter. It returns repository-wide context.`,
        code: "VALIDATION_ERROR",
        category: "validation",
        suggestion: "Remove the path parameter.",
        recoverable: true
      } };
    }
  }
  const backupMethods = ["backup_journal", "backupJournal", "team_backup", "teamBackup", "list_backups", "listBackups", "team_list_backups", "teamListBackups", "restore_backup", "restoreBackup", "cleanup_backups", "cleanupBackups"];
  if (backupMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
    const obj = { ...args[0] };
    args[0] = obj;
    if (methodName.includes("backup_journal") || methodName.includes("backupJournal") || methodName.includes("team_backup") || methodName.includes("teamBackup")) {
      if (obj["name"] === void 0) {
        if (obj["description"] !== void 0) obj["name"] = obj["description"];
        else if (obj["message"] !== void 0) obj["name"] = obj["message"];
        else if (obj["text"] !== void 0) obj["name"] = obj["text"];
        else if (obj["path"] !== void 0) obj["name"] = obj["path"];
        else if (obj["q"] !== void 0) obj["name"] = obj["q"];
        else if (obj["keep"] !== void 0) obj["name"] = obj["keep"];
        else if (obj["mode"] !== void 0) obj["name"] = obj["mode"];
        delete obj["description"];
        delete obj["message"];
        delete obj["text"];
        delete obj["path"];
        delete obj["q"];
        delete obj["keep"];
        delete obj["mode"];
      }
    }
    if (methodName.includes("list_backups") || methodName.includes("listBackups") || methodName.includes("team_list_backups") || methodName.includes("teamListBackups")) {
      if (obj["q"] !== void 0 || obj["query"] !== void 0 || obj["search"] !== void 0 || obj["text"] !== void 0 || obj["message"] !== void 0 || obj["description"] !== void 0 || obj["path"] !== void 0 || obj["keep"] !== void 0 || obj["mode"] !== void 0) {
        return { error: {
          success: false,
          error: `list_backups does not support search queries or other parameters. It lists all available backups.`,
          code: "VALIDATION_ERROR",
          category: "validation",
          suggestion: "Remove these parameters.",
          recoverable: true
        } };
      }
      if (obj["limit"] !== void 0) {
        return { error: {
          success: false,
          error: `list_backups does not support a limit parameter.`,
          code: "VALIDATION_ERROR",
          category: "validation",
          suggestion: "Remove the limit parameter.",
          recoverable: true
        } };
      }
    }
    if (methodName.includes("restore_backup") || methodName.includes("restoreBackup")) {
      if (obj["filename"] === void 0) {
        if (obj["path"] !== void 0) obj["filename"] = obj["path"];
        else if (obj["file"] !== void 0) obj["filename"] = obj["file"];
        else if (obj["text"] !== void 0) obj["filename"] = obj["text"];
        else if (obj["message"] !== void 0) obj["filename"] = obj["message"];
        else if (obj["description"] !== void 0) obj["filename"] = obj["description"];
        else if (obj["q"] !== void 0) obj["filename"] = obj["q"];
        else if (obj["keep"] !== void 0) obj["filename"] = obj["keep"];
        else if (obj["mode"] !== void 0) obj["filename"] = obj["mode"];
        delete obj["path"];
        delete obj["file"];
        delete obj["text"];
        delete obj["message"];
        delete obj["description"];
        delete obj["q"];
        delete obj["keep"];
        delete obj["mode"];
      }
    }
    if (methodName.includes("cleanup_backups") || methodName.includes("cleanupBackups")) {
      if (obj["keep_count"] === void 0) {
        if (obj["keep"] !== void 0) obj["keep_count"] = obj["keep"];
        else if (obj["limit"] !== void 0) obj["keep_count"] = obj["limit"];
        else if (obj["q"] !== void 0) obj["keep_count"] = obj["q"];
        else if (obj["mode"] !== void 0) obj["keep_count"] = obj["mode"];
        else if (obj["text"] !== void 0) obj["keep_count"] = obj["text"];
        else if (obj["message"] !== void 0) obj["keep_count"] = obj["message"];
        else if (obj["description"] !== void 0) obj["keep_count"] = obj["description"];
        else if (obj["path"] !== void 0) obj["keep_count"] = obj["path"];
        delete obj["keep"];
        delete obj["limit"];
        delete obj["q"];
        delete obj["mode"];
        delete obj["text"];
        delete obj["message"];
        delete obj["description"];
        delete obj["path"];
      }
    }
  }
  const singleIdMethods = ["delete_entry", "deleteEntry", "restore_entry", "restoreEntry", "get_entry_by_id", "getEntryById", "team_get_entry_by_id", "teamGetEntryById", "get_entry_history", "getEntryHistory", "add_to_vector_index", "addToVectorIndex", "team_add_to_vector_index", "teamAddToVectorIndex", "add_to_index", "addToIndex", "update_entry", "updateEntry", "team_update_entry", "teamUpdateEntry", "edit", "update", "team_delete_entry", "teamDeleteEntry", "delete", "team_restore_entry", "teamRestoreEntry", "restore", "team_restore", "teamRestore"];
  if (singleIdMethods.includes(methodName)) {
    if (args.length === 0) {
      return { error: {
        success: false,
        error: `${methodName} requires an 'entry_id' parameter.`,
        code: "VALIDATION_ERROR",
        category: "validation",
        suggestion: `Provide { entry_id: number } as the argument`,
        recoverable: true
      } };
    } else if (args.length === 1) {
      if (Array.isArray(args[0])) {
        return { error: {
          success: false,
          error: `${methodName} only accepts a single entry. To process multiple entries, use the batch equivalent (e.g., batch_delete_entries).`,
          code: "VALIDATION_ERROR",
          category: "validation",
          suggestion: `Use a batch method or pass a single object like { entry_id: number }`,
          recoverable: true
        } };
      } else if (isRecord(args[0])) {
        const obj = { ...args[0] };
        args[0] = obj;
        if (Array.isArray(obj["ids"]) || Array.isArray(obj["entry_ids"]) || Array.isArray(obj["entry_id"]) || Array.isArray(obj["id"])) {
          return { error: {
            success: false,
            error: `${methodName} only accepts a single entry_id. To process multiple entries, use the batch equivalent.`,
            code: "VALIDATION_ERROR",
            category: "validation",
            suggestion: `Use a batch method (e.g. batch_delete_entries) or pass { entry_id: number }`,
            recoverable: true
          } };
        }
        if (obj["entry_id"] === void 0 && obj["id"] === void 0 && obj["entryId"] === void 0 && obj["path"] === void 0 && obj["keep"] === void 0) {
          return { error: {
            success: false,
            error: `${methodName} requires an 'entry_id' parameter.`,
            code: "VALIDATION_ERROR",
            category: "validation",
            suggestion: `Provide { entry_id: number, ... } as the argument`,
            recoverable: true
          } };
        }
        const idVal = obj["entry_id"] !== void 0 ? obj["entry_id"] : obj["entryId"] !== void 0 ? obj["entryId"] : obj["id"] !== void 0 ? obj["id"] : obj["path"] !== void 0 ? obj["path"] : obj["keep"];
        if (obj["path"] !== void 0 && obj["entry_id"] === void 0) {
          obj["entry_id"] = obj["path"];
          delete obj["path"];
        }
        if (obj["keep"] !== void 0 && obj["entry_id"] === void 0) {
          obj["entry_id"] = obj["keep"];
          delete obj["keep"];
        }
        if (obj["q"] !== void 0 || obj["query"] !== void 0 || obj["mode"] !== void 0 || obj["search"] !== void 0) {
          if (methodName !== "update_entry" && methodName !== "updateEntry" && methodName !== "team_update_entry" && methodName !== "teamUpdateEntry") {
            return { error: {
              success: false,
              error: `${methodName} does not support q, query, search, or mode parameters. It operates on a single entry by entry_id.`,
              code: "VALIDATION_ERROR",
              category: "validation",
              suggestion: "Remove these parameters. Provide only the entry_id.",
              recoverable: true
            } };
          }
        }
        if (typeof idVal === "string" && isNaN(parseInt(idVal, 10))) {
          return { error: {
            success: false,
            error: `${methodName} requires a numeric entry_id, but received a non-numeric string ('${idVal}'). Journal entries use auto-incrementing integer IDs.`,
            code: "VALIDATION_ERROR",
            category: "validation",
            suggestion: "Provide a numeric ID.",
            recoverable: true
          } };
        }
      } else if (typeof args[0] === "number" || typeof args[0] === "string") {
        const asNum = typeof args[0] === "string" ? parseInt(args[0], 10) : args[0];
        if (!isNaN(asNum)) {
          args[0] = { entry_id: asNum };
        } else {
          return { error: {
            success: false,
            error: `${methodName} requires a numeric entry_id, but received a non-numeric string ('${args[0]}'). Journal entries use auto-incrementing integer IDs.`,
            code: "VALIDATION_ERROR",
            category: "validation",
            suggestion: "Provide a numeric ID.",
            recoverable: true
          } };
        }
      }
    }
  }
  if ((methodName === "update_entry" || methodName === "updateEntry") && args.length === 2 && (typeof args[0] === "number" || typeof args[0] === "string") && typeof args[1] === "object" && args[1] !== null) {
    const asNum = typeof args[0] === "string" ? parseInt(args[0], 10) : args[0];
    if (!isNaN(asNum)) {
      args = [{ entry_id: asNum, ...args[1] }];
    }
  }
  if ((methodName === "batch_create_entries" || methodName === "batchCreateEntries" || methodName === "team_batch_create_entries" || methodName === "teamBatchCreateEntries") && args.length === 1) {
    if (Array.isArray(args[0])) {
      args[0] = { entries: args[0] };
    } else if (isRecord(args[0]) && !("entries" in args[0])) {
      return { error: {
        success: false,
        error: `${methodName} requires an 'entries' array.`,
        code: "VALIDATION_ERROR",
        category: "validation",
        suggestion: `Provide { entries: [...] } as the argument`,
        recoverable: true
      } };
    }
  }
  if ((methodName === "batch_update_entries" || methodName === "batchUpdateEntries" || methodName === "team_batch_update_entries" || methodName === "teamBatchUpdateEntries") && args.length === 1) {
    if (Array.isArray(args[0])) {
      args[0] = { updates: args[0] };
    } else if (isRecord(args[0]) && !("updates" in args[0])) {
      return { error: {
        success: false,
        error: `${methodName} requires an 'updates' array.`,
        code: "VALIDATION_ERROR",
        category: "validation",
        suggestion: `Provide { updates: [...] } as the argument`,
        recoverable: true
      } };
    }
  }
  if (methodName === "batch_delete_entries" || methodName === "batchDeleteEntries" || methodName === "team_batch_delete_entries" || methodName === "teamBatchDeleteEntries") {
    if (args.length === 1 && typeof args[0] === "string") {
      const ids = args[0].split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
      args[0] = { entry_ids: ids };
    } else if (args.length === 1 && Array.isArray(args[0])) {
      const hasStrings = args[0].some((id) => typeof id === "string");
      if (hasStrings) {
        return { error: {
          success: false,
          error: `batch_delete_entries expects an array of numeric IDs, but received an array containing strings.`,
          code: "VALIDATION_ERROR",
          category: "validation",
          suggestion: "Ensure all IDs in the array are numbers. Use parseInt() if necessary.",
          recoverable: true
        } };
      }
      args[0] = { entry_ids: args[0] };
    } else if (args.length > 1 && args.every((a) => typeof a === "number")) {
      args = [{ entry_ids: args }];
    } else if (args.length === 1 && isRecord(args[0]) && !Array.isArray(args[0]) && !("entry_ids" in args[0])) {
      return { error: {
        success: false,
        error: `${methodName} requires an 'entry_ids' array.`,
        code: "VALIDATION_ERROR",
        category: "validation",
        suggestion: `Provide { entry_ids: [...] } as the argument`,
        recoverable: true
      } };
    }
  }
  if (methodName === "link_entries" || methodName === "linkEntries" || methodName === "team_link_entries" || methodName === "teamLinkEntries") {
    if (args.length === 1 && isRecord(args[0])) {
      const obj = { ...args[0] };
      args[0] = obj;
      if (obj["source"] !== void 0 && obj["from_entry_id"] === void 0) {
        obj["from_entry_id"] = obj["source"];
        delete obj["source"];
      }
      if (obj["source_id"] !== void 0 && obj["from_entry_id"] === void 0) {
        obj["from_entry_id"] = obj["source_id"];
        delete obj["source_id"];
      }
      if (obj["target"] !== void 0 && obj["to_entry_id"] === void 0) {
        obj["to_entry_id"] = obj["target"];
        delete obj["target"];
      }
      if (obj["target_id"] !== void 0 && obj["to_entry_id"] === void 0) {
        obj["to_entry_id"] = obj["target_id"];
        delete obj["target_id"];
      }
      if (obj["dest"] !== void 0 && obj["to_entry_id"] === void 0) {
        obj["to_entry_id"] = obj["dest"];
        delete obj["dest"];
      }
      if (obj["type"] !== void 0 && obj["relationship_type"] === void 0) {
        obj["relationship_type"] = obj["type"];
        delete obj["type"];
      }
      if (obj["rel"] !== void 0 && obj["relationship_type"] === void 0) {
        obj["relationship_type"] = obj["rel"];
        delete obj["rel"];
      }
      if (obj["notes"] !== void 0 && obj["description"] === void 0) {
        obj["description"] = obj["notes"];
        delete obj["notes"];
      }
      if (obj["message"] !== void 0 && obj["description"] === void 0) {
        obj["description"] = obj["message"];
        delete obj["message"];
      }
      if (obj["text"] !== void 0 && obj["description"] === void 0) {
        obj["description"] = obj["text"];
        delete obj["text"];
      }
    }
  }
  if (methodName === "update_configuration" || methodName === "updateConfiguration" || methodName === "config" || methodName === "configure") {
    if (args.length === 1 && typeof args[0] === "string") {
    } else if (args.length === 1 && isRecord(args[0])) {
      const obj = { ...args[0] };
      if (typeof obj["config"] === "object" && obj["config"] !== null) {
        args[0] = { ...obj, ...obj["config"] };
        delete args[0]["config"];
      }
      if (obj["maxTokens"] !== void 0 || obj["max_tokens"] !== void 0 || obj["temperature"] !== void 0 || obj["model"] !== void 0 || obj["top_p"] !== void 0) {
        return { error: {
          success: false,
          error: `update_configuration is for configuring the memory-journal-mcp server. It does not configure the LLM context (like maxTokens or temperature).`,
          code: "VALIDATION_ERROR",
          category: "validation",
          suggestion: "Remove LLM parameters. Server configuration does not accept LLM generation parameters.",
          recoverable: true
        } };
      }
    }
  }
  if (methodName === "update_entry" || methodName === "updateEntry" || methodName === "team_update_entry" || methodName === "teamUpdateEntry") {
    if (args.length === 1 && isRecord(args[0])) {
      const obj = { ...args[0] };
      args[0] = obj;
      if (obj["keep"] !== void 0 && obj["is_archived"] === void 0) {
        obj["is_archived"] = !obj["keep"];
        delete obj["keep"];
      }
      if (obj["text"] !== void 0 && obj["content"] === void 0) {
        obj["content"] = obj["text"];
        delete obj["text"];
      }
      if (obj["message"] !== void 0 && obj["content"] === void 0) {
        obj["content"] = obj["message"];
        delete obj["message"];
      }
      if (obj["description"] !== void 0 && obj["content"] === void 0) {
        obj["content"] = obj["description"];
        delete obj["description"];
      }
      if (obj["q"] !== void 0 || obj["query"] !== void 0 || obj["path"] !== void 0 || obj["mode"] !== void 0 || obj["search"] !== void 0) {
        return { error: {
          success: false,
          error: `${methodName} does not support q, query, search, path, or mode parameters.`,
          code: "VALIDATION_ERROR",
          category: "validation",
          suggestion: "Remove these parameters. Use entry_id and content to update the entry.",
          recoverable: true
        } };
      }
    }
  }
  const deleteMethods = ["delete_entry", "deleteEntry", "team_delete_entry", "teamDeleteEntry"];
  if (deleteMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
    const obj = { ...args[0] };
    args[0] = obj;
    if (obj["version"] !== void 0 && obj["expected_version"] === void 0) {
      obj["expected_version"] = obj["version"];
      delete obj["version"];
    }
    if (obj["project_number"] !== void 0) {
      delete obj["project_number"];
    }
  }
  const recentMethods = ["get_recent_entries", "getRecentEntries", "team_get_recent", "teamGetRecent"];
  if (recentMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
    const obj = { ...args[0] };
    args[0] = obj;
    if (obj["q"] !== void 0 || obj["query"] !== void 0 || obj["search"] !== void 0) {
      return { error: {
        success: false,
        error: `${methodName} does not support search queries. It only returns the most recent entries.`,
        code: "VALIDATION_ERROR",
        category: "validation",
        suggestion: "To search for specific text, use team_search (or search_entries) instead.",
        recoverable: true
      } };
    }
    if (obj["keep"] !== void 0 && obj["limit"] === void 0) {
      obj["limit"] = obj["keep"];
      delete obj["keep"];
    }
  }
  const listTagsMethods = ["list_tags", "listTags", "team_list_tags", "teamListTags"];
  if (listTagsMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
    const obj = { ...args[0] };
    args[0] = obj;
    if (obj["q"] !== void 0 || obj["query"] !== void 0 || obj["search"] !== void 0 || obj["path"] !== void 0 || obj["mode"] !== void 0 || obj["keep"] !== void 0) {
      return { error: {
        success: false,
        error: `${methodName} does not support search queries, path, mode, or keep. It returns all tags.`,
        code: "VALIDATION_ERROR",
        category: "validation",
        suggestion: "Remove these parameters.",
        recoverable: true
      } };
    }
  }
  const createMethods = ["create_entry", "createEntry", "team_create_entry", "teamCreateEntry"];
  if (createMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
    const obj = { ...args[0] };
    args[0] = obj;
    if (obj["text"] !== void 0 && obj["content"] === void 0) {
      obj["content"] = obj["text"];
      delete obj["text"];
    }
    if (obj["message"] !== void 0 && obj["content"] === void 0) {
      obj["content"] = obj["message"];
      delete obj["message"];
    }
    if (obj["description"] !== void 0 && obj["content"] === void 0) {
      obj["content"] = obj["description"];
      delete obj["description"];
    }
    if (obj["auto_context"] !== void 0) {
      if (typeof obj["auto_context"] === "object" && obj["auto_context"] !== null) {
        try {
          obj["auto_context"] = JSON.stringify(obj["auto_context"]);
        } catch {
          return { error: {
            success: false,
            error: `${methodName}: auto_context could not be serialized to JSON. Ensure it is a plain object (e.g. { commits: ['<sha>'] }) or a valid JSON string.`,
            code: "VALIDATION_ERROR",
            category: "validation",
            suggestion: "Pass auto_context as either a JSON string (e.g. JSON.stringify({ commits: [sha] })) or a plain serializable object.",
            recoverable: true
          } };
        }
      } else if (typeof obj["auto_context"] !== "string") {
        return { error: {
          success: false,
          error: `${methodName}: auto_context must be a JSON string or plain object (received ${typeof obj["auto_context"]}).`,
          code: "VALIDATION_ERROR",
          category: "validation",
          suggestion: 'Pass auto_context as a JSON string, e.g. JSON.stringify({ commits: ["<sha>"] }), or as a plain object like { commits: ["<sha>"] }.',
          recoverable: true
        } };
      }
    }
    if (obj["q"] !== void 0 || obj["query"] !== void 0 || obj["path"] !== void 0 || obj["mode"] !== void 0 || obj["keep"] !== void 0 || obj["search"] !== void 0) {
      return { error: {
        success: false,
        error: `${methodName} does not support q, query, search, path, mode, or keep parameters. It creates a new journal entry.`,
        code: "VALIDATION_ERROR",
        category: "validation",
        suggestion: 'Remove these parameters. Ensure you are providing the "content" of the entry.',
        recoverable: true
      } };
    }
  }
  if ((methodName === "test_simple" || methodName === "testSimple" || methodName === "test_error_handling" || methodName === "testErrorHandling") && args.length === 1 && isRecord(args[0])) {
    const obj = { ...args[0] };
    args[0] = obj;
    if (obj["text"] !== void 0 && obj["message"] === void 0) {
      obj["message"] = obj["text"];
      delete obj["text"];
    }
    if (obj["description"] !== void 0 && obj["message"] === void 0) {
      obj["message"] = obj["description"];
      delete obj["description"];
    }
    if (obj["type"] !== void 0 && obj["error_type"] === void 0 && (methodName === "test_error_handling" || methodName === "testErrorHandling")) {
      obj["error_type"] = obj["type"];
      delete obj["type"];
    }
  }
  if (methodName === "merge_tags" || methodName === "mergeTags" || methodName === "team_merge_tags" || methodName === "teamMergeTags") {
    if (args.length === 1 && isRecord(args[0])) {
      const obj = { ...args[0] };
      args[0] = obj;
      if (obj["source_tags"] !== void 0 && obj["source_tag"] === void 0) {
        obj["source_tag"] = Array.isArray(obj["source_tags"]) ? obj["source_tags"][0] : obj["source_tags"];
        delete obj["source_tags"];
      }
      if (obj["old_tag"] !== void 0 && obj["source_tag"] === void 0) {
        obj["source_tag"] = obj["old_tag"];
        delete obj["old_tag"];
      }
      if (obj["new_tag"] !== void 0 && obj["target_tag"] === void 0) {
        obj["target_tag"] = obj["new_tag"];
        delete obj["new_tag"];
      }
      if (obj["from"] !== void 0 && obj["source_tag"] === void 0) {
        obj["source_tag"] = obj["from"];
        delete obj["from"];
      }
      if (obj["to"] !== void 0 && obj["target_tag"] === void 0) {
        obj["target_tag"] = obj["to"];
        delete obj["to"];
      }
      if (typeof obj["source_tag"] === "string" && obj["source_tag"].includes(",")) {
        return { error: {
          success: false,
          error: `merge_tags only accepts a single source_tag string, not a comma-separated list.`,
          code: "VALIDATION_ERROR",
          category: "validation",
          suggestion: "Provide a single tag string for source_tag. To merge multiple tags, call this tool multiple times.",
          recoverable: true
        } };
      }
    }
  }
  if (methodName === "search_audit_log" || methodName === "searchAuditLog") {
    if (args.length === 1 && isRecord(args[0])) {
      const obj = { ...args[0] };
      args[0] = obj;
      if (obj["keep"] !== void 0 && obj["limit"] === void 0) {
        obj["limit"] = obj["keep"];
        delete obj["keep"];
      }
      if (typeof obj["limit"] === "string") {
        const parsed = parseInt(obj["limit"], 10);
        if (!isNaN(parsed)) obj["limit"] = parsed;
      }
    }
  }
  if (methodName === "rebuild_vector_index" || methodName === "rebuildVectorIndex" || methodName === "team_rebuild_vector_index" || methodName === "teamRebuildVectorIndex") {
    if (args.length === 1 && (typeof args[0] === "boolean" || typeof args[0] === "string")) {
      args[0] = {};
    }
  }
  const memberMethods = ["team_add_member", "teamAddMember", "team_update_member_role", "teamUpdateMemberRole", "team_remove_member", "teamRemoveMember", "team_get_member", "teamGetMember"];
  if (memberMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
    const obj = { ...args[0] };
    args[0] = obj;
    for (const key of ["path", "target", "user", "name", "account", "username", "member"]) {
      if (obj[key] !== void 0 && obj["author"] === void 0) {
        obj["author"] = obj[key];
        Reflect.deleteProperty(obj, key);
      }
    }
    for (const key of ["keep", "mode", "type", "level", "permission"]) {
      if (obj[key] !== void 0 && obj["role"] === void 0) {
        obj["role"] = obj[key];
        Reflect.deleteProperty(obj, key);
      }
    }
  }
  const aliasMethods = ["team_add_author_alias", "teamAddAuthorAlias", "team_remove_author_alias", "teamRemoveAuthorAlias", "team_list_author_aliases", "teamListAuthorAliases", "team_resolve_author", "teamResolveAuthor", "team_consolidate_authors", "teamConsolidateAuthors"];
  if (aliasMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
    const obj = { ...args[0] };
    args[0] = obj;
    for (const key of ["q", "query", "search"]) {
      if (obj[key] !== void 0) {
        if (obj["canonical_author"] === void 0 && obj["author"] === void 0 && obj["alias"] === void 0) {
          obj["canonical_author"] = obj[key];
          obj["author"] = obj[key];
          obj["alias"] = obj[key];
        }
        Reflect.deleteProperty(obj, key);
      }
    }
    for (const key of ["text", "message", "description", "name", "from", "source"]) {
      if (obj[key] !== void 0 && obj["alias"] === void 0) {
        obj["alias"] = obj[key];
        Reflect.deleteProperty(obj, key);
      }
    }
    for (const key of ["target", "to", "canonical", "dest"]) {
      if (obj[key] !== void 0 && obj["canonical_author"] === void 0) {
        obj["canonical_author"] = obj[key];
        Reflect.deleteProperty(obj, key);
      }
    }
    if (obj["author"] !== void 0 && obj["canonical_author"] === void 0 && obj["alias"] === void 0) {
      obj["canonical_author"] = obj["author"];
    }
  }
  if (methodName === "update_configuration" || methodName === "updateConfiguration") {
    if (args.length === 1 && isRecord(args[0])) {
      const obj = { ...args[0] };
      args[0] = obj;
      const hasContextParam = ["maxTokens", "max_tokens", "temperature", "top_p", "topP"].find((k) => k in obj);
      if (hasContextParam) {
        return {
          error: {
            success: false,
            error: `Unrecognized key: "${hasContextParam}". update_configuration does not support changing LLM context parameters.`,
            code: "VALIDATION_ERROR",
            category: "validation",
            suggestion: `Remove '${hasContextParam}' from the payload. Only tool_filter and briefing preferences are supported.`,
            recoverable: false
          }
        };
      }
    }
  }
  const sessionSummaryMethods = ["create_entry", "createEntry", "team_create_entry", "teamCreateEntry", "update_entry", "updateEntry", "team_update_entry", "teamUpdateEntry"];
  if (sessionSummaryMethods.includes(methodName) && args.length === 1 && isRecord(args[0])) {
    const obj = { ...args[0] };
    args[0] = obj;
    const tags = obj["tags"];
    const entryType = obj["entry_type"];
    if (typeof obj["content"] === "string" && (tags?.includes("session-summary") || entryType === "retrospective")) {
      let content = obj["content"];
      content = content.replace(/^#+\s+(?:Accomplishments|Completed|Done|What I did|What we did)\s*$/gim, "## Accomplished");
      content = content.replace(/^#+\s+(?:Blockers|Unfinished|Unfinished\/?Blocked|Blocked)\s*$/gim, "## Unfinished / Blocked");
      content = content.replace(/^#+\s+(?:Next Session|Context|Next steps)\s*$/gim, "## Context for Next Session");
      content = content.replace(/(?:^#+\s+Accomplished\s*\n-\s*(?:None\.?|)\s*){2,}/gim, "## Accomplished\n- None.\n");
      content = content.replace(/(?:^#+\s+Unfinished \/ Blocked\s*\n-\s*(?:None\.?|)\s*){2,}/gim, "## Unfinished / Blocked\n- None.\n");
      content = content.replace(/(?:^#+\s+Context for Next Session\s*\n-\s*(?:None\.?|)\s*){2,}/gim, "## Context for Next Session\n- None.\n");
      content = content.replace(/(?:^#+\s+Commits\s*\n-\s*(?:None\.?|)\s*){2,}/gim, "## Commits\n- None.\n");
      const deduplicate = (str, headerRegexStr) => {
        let count = 0;
        return str.replace(new RegExp(headerRegexStr, "gim"), (match) => {
          count++;
          return count === 1 ? match : "";
        });
      };
      content = deduplicate(content, "^#+\\s+Accomplished");
      content = deduplicate(content, "^#+\\s+Unfinished \\/ Blocked");
      content = deduplicate(content, "^#+\\s+Context for Next Session");
      content = deduplicate(content, "^#+\\s+Commits");
      const hasAccomplished = /#+\s+Accomplished/i.test(content);
      const hasUnfinished = /#+\s+Unfinished \/ Blocked/i.test(content);
      const hasContext = /#+\s+Context for Next Session/i.test(content);
      const hasCommits = /#+\s+Commits/i.test(content);
      if (!hasAccomplished) content += "\n\n## Accomplished\n- \n";
      if (!hasUnfinished) content += "\n\n## Unfinished / Blocked\n- None\n";
      if (!hasContext) content += "\n\n## Context for Next Session\n- \n";
      if (!hasCommits) content += "\n\n## Commits\n- None\n";
      obj["content"] = content.trim();
    }
  }
  return { args };
}

// src/codemode/worker-api-proxy.ts
function buildApiProxy(rpcCall2, methods, schemas, readonlyMode) {
  const api = {};
  const safeRpcCall = (group, method, args) => rpcCall2(group, method, args).catch((err) => ({ success: false, error: err instanceof Error ? err.message : String(err), code: "EXECUTION_ERROR", category: "execution", recoverable: true }));
  function wrapPromise(promise, methodName) {
    return new Proxy(promise, {
      get(target, prop) {
        if (prop === "then") return target.then.bind(target);
        if (prop === "catch") return target.catch.bind(target);
        if (prop === "finally") return target.finally.bind(target);
        if (typeof prop === "string" && prop !== "constructor" && prop !== "toString" && prop !== "valueOf" && prop !== "toJSON") {
          throw new Error(`Attempted to access property '${prop}' on a Promise object. Did you forget to 'await' the tool call? (e.g. const result = await mj.group.${methodName}(...))`);
        }
        if (prop === Symbol.iterator) {
          throw new Error(`Attempted to iterate over a Promise object. Did you forget to 'await' the tool call? (e.g. const [item] = await mj.group.${methodName}(...))`);
        }
        return Reflect.get(target, prop);
      }
    });
  }
  for (const [group, methodNames] of Object.entries(methods)) {
    if (group === "_topLevel") {
      for (const methodName of methodNames) {
        const proxyFn = (...args) => {
          const intercept = applyArgInterceptions(methodName, args);
          if ("error" in intercept) {
            return wrapPromise(Promise.resolve(wrapResult(intercept.error)), methodName);
          }
          const resultPromise = safeRpcCall("_topLevel", methodName, intercept.args).then(wrapResult);
          return wrapPromise(resultPromise, methodName);
        };
        Object.assign(proxyFn, {
          schema: () => Promise.resolve(schemas?.["_topLevel"]?.[methodName] ?? "unknown")
        });
        api[methodName] = proxyFn;
      }
      continue;
    }
    const groupProxy = {};
    for (const methodName of methodNames) {
      const proxyFn = (...args) => {
        const intercept = applyArgInterceptions(methodName, args);
        if ("error" in intercept) {
          return wrapPromise(Promise.resolve(wrapResult(intercept.error)), methodName);
        }
        const resultPromise = safeRpcCall(group, methodName, intercept.args).then(wrapResult);
        return wrapPromise(resultPromise, methodName);
      };
      Object.assign(proxyFn, {
        schema: () => Promise.resolve(schemas?.[group]?.[methodName] ?? "unknown")
      });
      groupProxy[methodName] = proxyFn;
    }
    groupProxy["help"] = () => Promise.resolve({
      group,
      methods: methodNames
    });
    const groupProxyWrapped = new Proxy(groupProxy, {
      get(target, prop) {
        if (typeof prop === "symbol") return void 0;
        const key = prop;
        if (key in target) return target[key];
        if (typeof key === "string" && /[A-Z]/.test(key)) {
          const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
          if (snakeKey in target) return target[snakeKey];
        }
        const aliases = METHOD_ALIASES[group];
        let resolvedKey = key;
        if (aliases && typeof key === "string" && aliases[key]) {
          const canonicalCamel = aliases[key];
          const canonicalSnake = canonicalCamel.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
          if (canonicalSnake in target) return target[canonicalSnake];
          if (canonicalCamel in target) return target[canonicalCamel];
          resolvedKey = canonicalCamel;
        }
        if (group === "core") {
          const semanticGroup = api["semantic"];
          const adminGroup = api["admin"];
          if (resolvedKey === "semanticSearch" || key === "semantic_search") {
            return semanticGroup?.["semantic_search"] ?? semanticGroup?.["semanticSearch"];
          }
          if (resolvedKey === "vectorStats" || key === "vector_stats") {
            return semanticGroup?.["vector_stats"] ?? semanticGroup?.["vectorStats"];
          }
          if (resolvedKey === "searchAuditLog" || key === "search_audit_log") {
            return adminGroup?.["search_audit_log"] ?? adminGroup?.["searchAuditLog"];
          }
          if (resolvedKey === "listDeletedEntries" || key === "list_deleted_entries") {
            return adminGroup?.["list_deleted_entries"] ?? adminGroup?.["listDeletedEntries"];
          }
        }
        if (resolvedKey === "getConfig") {
          return () => wrapPromise(Promise.resolve(wrapResult({
            success: false,
            error: "Code Mode cannot directly read configuration via getConfig(). Use mj.core.listProjects() to discover active projects, or updateConfiguration() to change settings.",
            code: "VALIDATION_ERROR",
            category: "validation",
            recoverable: true
          })), "getConfig");
        }
        if (resolvedKey === "getBriefing") {
          return () => wrapPromise(Promise.resolve(wrapResult({
            success: false,
            error: "Code Mode cannot directly read the briefing resource via getBriefing(). Use mj.core.getRecentEntries() instead, or read the memory://briefing resource via standard MCP client requests outside of Code Mode.",
            code: "VALIDATION_ERROR",
            category: "validation",
            recoverable: true
          })), "getBriefing");
        }
        if (resolvedKey === "readResource") {
          return (uri) => {
            const suggestions = {
              "memory://recent": "mj.core.getRecentEntries()",
              "memory://statistics": "mj.analytics.getStatistics()",
              "memory://tags": "mj.core.listTags()",
              "memory://flags": 'mj.team.teamListFlags({ status: "active" })',
              "memory://significant": 'mj.search.searchEntries({ sort_by: "importance" })',
              "memory://insights": "mj.analytics.getCrossProjectInsights()"
            };
            let hint = "";
            if (typeof uri === "string") {
              const match = Object.entries(suggestions).find(([k]) => uri.startsWith(k));
              if (match !== void 0) {
                hint = ` Try: ${match[1]}`;
              }
            }
            return wrapPromise(Promise.resolve(wrapResult({
              success: false,
              error: `Code Mode cannot directly read MCP resources (e.g., memory://briefing) using readResource().${hint} Use the appropriate mj.* tools to query data, or read the resource via standard MCP client requests outside of Code Mode.`,
              code: "VALIDATION_ERROR",
              category: "validation",
              recoverable: true
            })), "readResource");
          };
        }
        if (resolvedKey === "then") return void 0;
        if (typeof resolvedKey === "string") {
          const snakeKey = /[A-Z]/.test(resolvedKey) ? resolvedKey.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`) : resolvedKey;
          const teamSnakeKey = `team_${snakeKey}`;
          const teamGroup = Object.keys(methods).find((g) => methods[g]?.includes(teamSnakeKey));
          if (teamGroup && !Object.keys(methods).some((g) => methods[g]?.includes(snakeKey))) {
            return (...args) => {
              const intercept = applyArgInterceptions(teamSnakeKey, args);
              if ("error" in intercept) {
                return wrapPromise(Promise.resolve(wrapResult(intercept.error)), teamSnakeKey);
              }
              const resultPromise = safeRpcCall(teamGroup, teamSnakeKey, intercept.args).then(wrapResult);
              return wrapPromise(resultPromise, teamSnakeKey);
            };
          }
          const foundGroup = Object.keys(methods).find((g) => methods[g]?.includes(snakeKey));
          if (foundGroup) {
            return (...args) => {
              const intercept = applyArgInterceptions(snakeKey, args);
              if ("error" in intercept) {
                return wrapPromise(Promise.resolve(wrapResult(intercept.error)), snakeKey);
              }
              const resultPromise = safeRpcCall(foundGroup, snakeKey, intercept.args).then(wrapResult);
              return wrapPromise(resultPromise, snakeKey);
            };
          }
        }
        const available = methodNames.join(", ") || "none";
        const reason = readonlyMode ? `Operation '${key}' is blocked in readonly mode. Read operations only.` : methodNames.length === 0 ? `Operation '${key}' is not available \u2014 this group has no methods (read-only mode?). Available: ${available}.` : `Operation '${key}' is not found in group '${group}'. Available: ${available}.`;
        return (..._args) => {
          return wrapPromise(Promise.resolve(wrapResult({
            success: false,
            error: reason,
            code: "VALIDATION_ERROR",
            category: "validation",
            recoverable: true
          })), key);
        };
      }
    });
    api[group] = groupProxyWrapped;
  }
  api["help"] = () => {
    const groups = Object.keys(methods).filter(
      (g) => g !== "_topLevel" && g !== "memory" && g !== "entries"
    );
    let totalMethods = 0;
    for (const group of groups) {
      totalMethods += methods[group]?.length ?? 0;
    }
    return Promise.resolve({
      groups,
      totalMethods,
      usage: "Use mj.<group>.help() for group details. Use mj.<group>.<method>.schema() for parameter details."
    });
  };
  return new Proxy(api, {
    get(target, prop) {
      if (typeof prop === "symbol") return void 0;
      if (prop in target) return target[prop];
      if (prop === "gitApi") return target["git"];
      if (prop === "then") return void 0;
      if (typeof prop === "string") {
        const snakeKey = /[A-Z]/.test(prop) ? prop.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`) : prop;
        for (const [g, groupAliases] of Object.entries(METHOD_ALIASES)) {
          if (groupAliases?.[prop] !== void 0) {
            const canonicalCamel = groupAliases[prop];
            const canonicalSnake = canonicalCamel.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
            if (methods[g]?.includes(canonicalSnake)) {
              return (...args) => {
                const intercept = applyArgInterceptions(canonicalSnake, args);
                if ("error" in intercept) {
                  return wrapPromise(Promise.resolve(wrapResult(intercept.error)), canonicalSnake);
                }
                const resultPromise = safeRpcCall(g, canonicalSnake, intercept.args).then(wrapResult);
                return wrapPromise(resultPromise, canonicalSnake);
              };
            }
          }
        }
        const teamSnakeKey = `team_${snakeKey}`;
        const teamGroup = Object.keys(methods).find((g) => methods[g]?.includes(teamSnakeKey));
        if (teamGroup && !Object.keys(methods).some((g) => methods[g]?.includes(snakeKey))) {
          return (...args) => {
            const intercept = applyArgInterceptions(teamSnakeKey, args);
            if ("error" in intercept) {
              return wrapPromise(Promise.resolve(wrapResult(intercept.error)), teamSnakeKey);
            }
            const resultPromise = safeRpcCall(teamGroup, teamSnakeKey, intercept.args).then(wrapResult);
            return wrapPromise(resultPromise, teamSnakeKey);
          };
        }
        const foundGroup = Object.keys(methods).find((g) => methods[g]?.includes(snakeKey));
        if (foundGroup) {
          return (...args) => {
            const intercept = applyArgInterceptions(snakeKey, args);
            if ("error" in intercept) {
              return wrapPromise(Promise.resolve(wrapResult(intercept.error)), snakeKey);
            }
            const resultPromise = safeRpcCall(foundGroup, snakeKey, intercept.args).then(wrapResult);
            return wrapPromise(resultPromise, snakeKey);
          };
        }
      }
      const available = Object.keys(methods).filter((k) => k !== "_topLevel").join(", ");
      let reason = `Group or property '${prop}' is not found on 'mj'. Available groups: ${available}. Use mj.help() for more info.`;
      if (typeof prop === "string") {
        const normalized = prop.replace(/^mj_/, "").replace(/_/g, "-");
        const knownPrompts = ["session-summary", "plan-draft", "adversarial-review", "copilot-validation", "plan-refinement", "team-session-summary"];
        const isPrompt = knownPrompts.includes(normalized) || knownPrompts.includes(prop) || knownPrompts.includes(prop.replace(/^mj_/, ""));
        if (isPrompt) {
          reason = `'${prop}' is an MCP Prompt, not an MCP Tool. Code Mode cannot invoke MCP Prompts directly. Please use the 'get_prompt' tool (or your native MCP Prompts integration) outside of Code Mode to evaluate it, then use 'mj.core.createEntry' to save the result.`;
        } else if (prop.startsWith("mj_")) {
          reason = `'${prop}' is not a valid root tool in Code Mode. Code Mode uses namespaced groups (e.g., 'mj.core.searchEntries'). Use 'mj.help()' to see available namespaces.`;
        }
      }
      return new Proxy(
        () => {
        },
        {
          apply() {
            return wrapPromise(Promise.resolve(wrapResult({
              success: false,
              error: reason,
              code: "VALIDATION_ERROR",
              category: "validation",
              recoverable: true
            })), prop);
          },
          get(_t, subProp) {
            if (typeof subProp === "symbol") return void 0;
            if (subProp === "then") return void 0;
            return (..._args) => {
              return wrapPromise(Promise.resolve(wrapResult({
                success: false,
                error: `${reason} (Attempted to access 'mj.${prop}.${subProp}')`,
                code: "VALIDATION_ERROR",
                category: "validation",
                recoverable: true
              })), `${prop}.${subProp}`);
            };
          }
        }
      );
    }
  });
}

// src/codemode/worker-script.ts
var rpcPort = null;
var rpcIdCounter = 0;
var pendingRpcRequests = /* @__PURE__ */ new Map();
function rpcCall(group, method, args) {
  return new Promise((resolve, reject) => {
    if (!rpcPort) {
      reject(new Error("RPC port not initialized"));
      return;
    }
    const id = ++rpcIdCounter;
    pendingRpcRequests.set(id, { resolve, reject });
    const request = { id, group, method, args };
    rpcPort.postMessage(request);
  });
}
async function executeCode(code, methodList, schemaList, timeoutMs, contextObj, readonlyMode) {
  const startCpu = process.cpuUsage();
  const startTime = performance.now();
  try {
    const mjApi = buildApiProxy(rpcCall, methodList, schemaList, readonlyMode);
    for (const key of Object.keys(mjApi)) {
      const val = mjApi[key];
      if (typeof val === "object" && val !== null) {
        Object.freeze(val);
      }
    }
    Object.freeze(mjApi);
    const DB_TO_JOURNAL = {
      listTables: ["analytics", "getStatistics"],
      describeTable: ["analytics", "getStatistics"],
      count: ["analytics", "getStatistics"],
      analyze: ["analytics", "getStatistics"],
      vacuum: ["analytics", "getStatistics"],
      integrityCheck: ["analytics", "getStatistics"],
      exists: ["core", "getEntryById"],
      upsert: ["core", "createEntry"],
      batchInsert: ["core", "createEntry"],
      readQuery: ["core", "readQuery"]
    };
    const shimMj = new Proxy({}, {
      get(_fakeTarget, prop) {
        const target = mjApi;
        if (prop === "mj" || prop === "journal" || prop === "memory") return shimMj;
        if (prop === "executeCode") {
          if ("codemode" in target) {
            const codemodeGroup = target["codemode"];
            return codemodeGroup["mjExecuteCode"] ?? codemodeGroup["executeCode"];
          }
          return () => Promise.resolve({
            success: false,
            error: "You are already inside Code Mode execution. You do not need to call executeCode again. Just write your logic directly (e.g., return await mj.core.createEntry(...)).",
            code: "VALIDATION_ERROR",
            category: "validation",
            recoverable: true
          });
        }
        if (prop === "readResource") {
          return (uri) => {
            const suggestions = {
              "memory://recent": "mj.core.getRecentEntries()",
              "memory://statistics": "mj.analytics.getStatistics()",
              "memory://tags": "mj.core.listTags()",
              "memory://flags": 'mj.team.teamListFlags({ status: "active" })',
              "memory://significant": 'mj.search.searchEntries({ sort_by: "importance" })',
              "memory://insights": "mj.analytics.getCrossProjectInsights()"
            };
            let hint = "";
            if (typeof uri === "string") {
              const match = Object.entries(suggestions).find(([k]) => uri.startsWith(k));
              if (match !== void 0) {
                hint = ` Try: ${match[1]}`;
              }
            }
            return Promise.resolve({
              success: false,
              error: `Code Mode cannot directly read MCP resources (e.g., memory://briefing) using readResource().${hint} Use the appropriate mj.* tools to query data, or read the resource via standard MCP client requests outside of Code Mode.`,
              code: "VALIDATION_ERROR",
              category: "validation",
              recoverable: true
            });
          };
        }
        if ((prop === "addEntry" || prop === "create_entry" || prop === "createEntry") && "core" in target) {
          const coreGroup = target["core"];
          return coreGroup["create_entry"] ?? coreGroup["createEntry"];
        }
        if (prop === "getProjects" || prop === "listProjects" || prop === "searchProjects") {
          if ("analytics" in target) {
            const analyticsGroup = target["analytics"];
            return analyticsGroup["get_cross_project_insights"] ?? analyticsGroup["getCrossProjectInsights"];
          }
        }
        if (prop === "search" && "search" in target) {
          const searchGroup = target["search"];
          const searchFunc = searchGroup["search_entries"] ?? searchGroup["searchEntries"];
          if (typeof searchFunc === "function") {
            const callableSearch = function(...args) {
              return searchFunc.apply(this, args);
            };
            Object.assign(callableSearch, searchGroup);
            return callableSearch;
          }
          return searchGroup;
        }
        if (prop === "append" && "core" in target) {
          const coreGroup = target["core"];
          const createEntry = coreGroup["createEntry"];
          return (arg1, arg2, arg3) => {
            const tags = Array.isArray(arg1) ? arg1 : [typeof arg1 === "string" ? arg1 : "test"];
            const content = typeof arg2 === "string" ? arg2 : arg2 != null ? JSON.stringify(arg2) : "";
            const metadata = typeof arg3 === "object" && arg3 !== null ? { ...arg3 } : void 0;
            const typeVal = metadata?.["type"];
            const type = typeof typeVal === "string" && typeVal !== "" ? typeVal : "test_entry";
            if (metadata && "type" in metadata) delete metadata["type"];
            return createEntry({ type, tags, content, metadata });
          };
        }
        if (typeof prop === "string" && prop.includes("_")) {
          const camelProp = prop.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
          if (camelProp !== prop) {
            const mapping = DB_TO_JOURNAL[camelProp];
            if (mapping !== void 0) {
              const [group, method] = mapping;
              if (group in target) return target[group][method];
            }
            if (camelProp in target) return Reflect.get(target, camelProp);
          }
        }
        if (typeof prop === "string") {
          const mapping = DB_TO_JOURNAL[prop];
          if (mapping !== void 0) {
            const [group, method] = mapping;
            if (group in target) {
              return target[group][method];
            }
          }
        }
        return Reflect.get(target, prop);
      },
      has(_fakeTarget, prop) {
        return prop in mjApi;
      },
      ownKeys(_fakeTarget) {
        return Reflect.ownKeys(mjApi);
      },
      getOwnPropertyDescriptor(_fakeTarget, prop) {
        const desc = Reflect.getOwnPropertyDescriptor(mjApi, prop);
        if (desc) {
          return { ...desc, configurable: true };
        }
        return void 0;
      },
      set() {
        return false;
      },
      defineProperty() {
        return false;
      },
      deleteProperty() {
        return false;
      },
      setPrototypeOf() {
        return false;
      },
      isExtensible() {
        return true;
      },
      preventExtensions() {
        return false;
      }
    });
    const frozenContext = Object.freeze(contextObj ?? {});
    const consoleShim = {
      log: (...args) => args,
      warn: (...args) => args,
      error: (...args) => args,
      info: (...args) => args,
      debug: (...args) => args
    };
    Object.freeze(consoleShim);
    const sandbox = {
      mj: shimMj,
      journal: shimMj,
      sqlite: shimMj,
      postgres: shimMj,
      mysql: shimMj,
      db: shimMj,
      api: shimMj,
      memory: shimMj,
      // Unified with shimMj to catch memory.append and memory.journal
      sqlite_journal_add_entry: shimMj["core"]?.["createEntry"] ?? shimMj["core"]?.["create_entry"],
      create_entry: shimMj["core"]?.["createEntry"] ?? shimMj["core"]?.["create_entry"],
      createEntry: shimMj["core"]?.["createEntry"] ?? shimMj["core"]?.["create_entry"],
      context: frozenContext,
      console: consoleShim,
      fetch: void 0,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      setTimeout: (cb, ms, ...args) => setTimeout(cb, ms, ...args),
      setInterval: void 0,
      setImmediate: void 0,
      getConfig: () => Promise.resolve({ dbPath: "memory-journal.db" }),
      process: void 0,
      require: void 0,
      __dirname: void 0,
      __filename: void 0,
      global: void 0,
      globalThis: void 0,
      Proxy: void 0
    };
    for (const key of Object.keys(mjApi)) {
      if (key in sandbox) continue;
      const val = shimMj[key];
      if (typeof val === "function") {
        sandbox[key] = val;
      }
    }
    Object.freeze(sandbox);
    const context = vm.createContext(sandbox, {
      name: "codemode-worker-sandbox",
      codeGeneration: {
        strings: false,
        wasm: false
      }
    });
    vm.runInContext(
      `(function() {
                "use strict";
                const builtins = [
                    Object, Function, Array, String, Number, Boolean, RegExp,
                    Error, TypeError, RangeError, ReferenceError, SyntaxError,
                    URIError, EvalError, Map, Set, WeakMap, WeakSet,
                    Promise, Date, ArrayBuffer, DataView,
                    Int8Array, Uint8Array, Uint8ClampedArray,
                    Int16Array, Uint16Array, Int32Array, Uint32Array,
                    Float32Array, Float64Array, BigInt64Array, BigUint64Array,
                    JSON, Math,
                ];
                for (const B of builtins) {
                    if (B && typeof B === "function" && B.prototype) {
                        try { Object.freeze(B.prototype); } catch(e) {}
                    }
                    try { Object.freeze(B); } catch(e) {}
                }
                try { Object.freeze(Object.prototype); } catch(e) {}
                try { Object.freeze(Function.prototype); } catch(e) {}
            })()`,
      context
    );
    const wrappedCode = `(async () => { ${transformAutoReturn(code)} })()`;
    const script = new vm.Script(wrappedCode, {
      filename: "codemode-execution.js"
    });
    const resultPromise = script.runInContext(context, {
      timeout: timeoutMs
    });
    const result = await resultPromise;
    const endTime = performance.now();
    const endCpu = process.cpuUsage(startCpu);
    const metrics = {
      wallTimeMs: Math.round(endTime - startTime),
      cpuTimeMs: Math.round((endCpu.user + endCpu.system) / 1e3),
      memoryUsedMb: 0
    };
    return { success: true, result, metrics };
  } catch (err) {
    const endTime = performance.now();
    const endCpu = process.cpuUsage(startCpu);
    const error = err instanceof Error ? err : new Error(String(err));
    const errString = String(err);
    if (errString.includes("missing ) after argument list") || errString.includes("is not a function") || errString.includes("Invalid or unexpected token")) {
      error.message += "\n\n\u{1F4A1} Tip: When passing long multi-line strings or markdown with embedded quotes/backticks, NEVER use template literals (backticks `) in the code string as they will prematurely evaluate and cause SyntaxErrors or Tagged Template TypeErrors. ALWAYS pass them safely via the `context` parameter and reference them as `context.myParam`.";
    }
    return {
      success: false,
      error: error.message,
      metrics: {
        wallTimeMs: Math.round(endTime - startTime),
        cpuTimeMs: Math.round((endCpu.user + endCpu.system) / 1e3),
        memoryUsedMb: 0
      }
    };
  }
}
parentPort?.on("message", (msg) => {
  void (async () => {
    if (msg !== null && msg !== void 0 && typeof msg === "object" && "type" in msg && msg.type === "EXECUTE") {
      const executeMsg = msg;
      const {
        id,
        code,
        methodList,
        schemaList,
        timeoutMs,
        maxResultSize,
        rpcPort: newRpcPort,
        contextObj,
        readonlyMode
      } = executeMsg;
      rpcPort = newRpcPort;
      rpcIdCounter = 0;
      pendingRpcRequests.clear();
      rpcPort?.on("message", (response) => {
        const pending = pendingRpcRequests.get(response.id);
        if (pending) {
          pendingRpcRequests.delete(response.id);
          if (response.error !== void 0) {
            pending.reject(new Error(response.error));
          } else {
            pending.resolve(response.result);
          }
        }
      });
      const result = await executeCode(
        code,
        methodList,
        schemaList,
        timeoutMs ?? 3e4,
        contextObj,
        readonlyMode
      );
      if (result.success) {
        try {
          const egressLimit = maxResultSize ?? 100 * 1024;
          let bytes = 0;
          const cache = /* @__PURE__ */ new Set();
          const resultJson = JSON.stringify(
            result.result,
            (_key, value) => {
              if (typeof value === "object" && value !== null) {
                if (cache.has(value)) return "[Circular]";
                cache.add(value);
              }
              if (typeof value === "string") {
                bytes += Buffer.byteLength(value, "utf8") + 2;
              } else if (typeof value === "number" || typeof value === "boolean") {
                bytes += Buffer.byteLength(String(value), "utf8");
              } else if (typeof value === "bigint") {
                bytes += Buffer.byteLength(value.toString(), "utf8") + 2;
                return value.toString();
              } else {
                bytes += 5;
              }
              if (bytes > egressLimit) {
                throw new Error(`EgressLimitExceeded:${bytes}`);
              }
              return value;
            }
          );
          if (resultJson !== void 0) {
            const byteLength = Buffer.byteLength(resultJson, "utf8");
            if (byteLength > egressLimit) {
              throw new Error(`EgressLimitExceeded:${byteLength}`);
            }
            result.result = JSON.parse(resultJson);
          } else {
            result.result = void 0;
          }
        } catch (err) {
          result.success = false;
          const egressLimit = maxResultSize ?? 100 * 1024;
          if (err instanceof Error && err.message.startsWith("EgressLimitExceeded:")) {
            const actualBytesStr = err.message.split(":")[1];
            const actualBytes = actualBytesStr !== void 0 ? Number(actualBytesStr) : egressLimit + 1;
            const actualKb = (actualBytes / 1024).toFixed(1);
            result.error = `Output limit exceeded: Result serialization exceeded the ${Math.round(egressLimit / 1024)}KB boundary (Actual size: >${actualKb}KB). Please aggregate or filter your results to reduce the payload size.`;
          } else {
            result.error = `Result could not be serialized or exceeded memory limits: ${err instanceof Error ? err.message : String(err)}`;
          }
          result.result = void 0;
        }
      }
      rpcPort?.close();
      rpcPort = null;
      parentPort?.postMessage({ type: "RESULT", id, result });
    }
  })();
});
