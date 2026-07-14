import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const toolMapPath = path.join(__dirname, 'tool-map.json');
const toolMapData = JSON.parse(fs.readFileSync(toolMapPath, 'utf8'));
const reverseMap = {};

const hallucinationFixes = {
  'github_create_issue': 'create_github_issue_with_entry',
  'github_close_issue': 'close_github_issue_with_entry',
  'repo_insights': 'get_repo_insights',
  'copilot_reviews': 'get_copilot_reviews',
  'add_author_alias': 'team_add_author_alias',
  'remove_author_alias': 'team_remove_author_alias',
  'list_author_aliases': 'team_list_author_aliases',
  'resolve_author': 'team_resolve_author',
  'consolidate_authors': 'team_consolidate_authors'
};

function fixHallucinations(text) {
  let fixed = text;
  for (const [bad, good] of Object.entries(hallucinationFixes)) {
    // We use a regex with negative lookbehind/lookahead to avoid matching substring parts,
    // but \\b works for these tool names since they are composed of word chars.
    fixed = fixed.replace(new RegExp('\\b' + bad + '\\b', 'g'), good);
  }
  return fixed;
}

function fixFormatting(text) {
  let fixed = text;
  // Fix bad regex replace resulting in > workspace_id: "test-ws", > content:
  fixed = fixed.replace(/> workspace_id: "test-ws", >\s*content:/g, '>   workspace_id: "test-ws",\n>   content:');
  
  // Clean up duplicate workspace_id caused by replacing project_number: 5 in an object that already has workspace_id
  fixed = fixed.replace(/workspace_id:\s*"test-ws",([^}]+?),\s*workspace_id:\s*"test-ws"/g, 'workspace_id: "test-ws",$1');
  
  // Clean up edge cases where it appears twice back-to-back
  fixed = fixed.replace(/workspace_id:\s*"test-ws",\s*workspace_id:\s*"test-ws"/g, 'workspace_id: "test-ws"');
  
  // Fix backslash paths in the standardization script for commit.ts
  fixed = fixed.replace(/`bun \.\\\\\.agents\\\\scripts\\\\commit\.ts/g, '`bun ./.agents/scripts/commit.ts');
  fixed = fixed.replace(/`bun \.\\.agents\\scripts\\commit\.ts/g, '`bun ./.agents/scripts/commit.ts');
  
  return fixed;
}

// Build reverse map: file -> tools
for (const [tool, files] of Object.entries(toolMapData.toolMap)) {
  if (tool === 'mj_execute_code') {
    if (!reverseMap['test-usability-codemode.md']) {
      reverseMap['test-usability-codemode.md'] = [];
    }
    if (!reverseMap['test-usability-codemode.md'].includes('mj_execute_code')) {
      reverseMap['test-usability-codemode.md'].push('mj_execute_code');
    }
    continue;
  }
  for (const file of files) {
    if (!reverseMap[file]) {
      reverseMap[file] = [];
    }
    reverseMap[file].push(tool);
  }
}

const usabilityDir = path.join(__dirname, '..', 'usability');

const isolationFilePath = path.join(usabilityDir, 'test-usability-workspace-isolation.md');
let isoContent;
if (fs.existsSync(isolationFilePath)) {
  isoContent = fs.readFileSync(isolationFilePath, 'utf8');
  fs.unlinkSync(isolationFilePath);
} else if (fs.existsSync(isolationFilePath.replace('.md', '-part1.md'))) {
  isoContent = fs.readFileSync(isolationFilePath.replace('.md', '-part1.md'), 'utf8');
}
if (isoContent) {
  fs.writeFileSync(path.join(usabilityDir, 'test-usability-workspace-isolation-part1.md'), isoContent);
  fs.writeFileSync(path.join(usabilityDir, 'test-usability-workspace-isolation-part2.md'), isoContent);
  fs.writeFileSync(path.join(usabilityDir, 'test-usability-workspace-isolation-part3.md'), isoContent);
  fs.writeFileSync(path.join(usabilityDir, 'test-usability-workspace-isolation-part4.md'), isoContent);
}

const splitFiles = {
  'test-usability-admin-projects.md': 3,
  'test-usability-github-read.md': 3,
  'test-usability-github-milestones.md': 3,
  'test-usability-team-members.md': 3,
  'test-usability-team-aliases.md': 3,
  'test-usability-github-kanban.md': 2,
  'test-usability-git-analysis.md': 2,
  'test-usability-backup.md': 2,
  'test-usability-admin-batch.md': 2,
  'test-usability-search-core.md': 2,
  'test-usability-admin-mutations.md': 2,
  'test-usability-io.md': 2,
  'test-usability-git-history.md': 2,
  'test-usability-core-read.md': 2,
  'test-usability-search-vector.md': 2,
  'test-usability-core-misc.md': 2,
  'test-usability-admin-system.md': 2,
  'test-usability-team-vector.md': 2,
  'test-usability-team-batch.md': 2,
  'test-usability-team-mutations.md': 2,
  'test-usability-team-io.md': 2,
  'test-usability-team-analytics.md': 2,
  'test-usability-team-core-read.md': 2,
  'test-usability-team-relationships.md': 2,
  'test-usability-team-search.md': 2
};

for (const [sf, parts] of Object.entries(splitFiles)) {
  const p = path.join(usabilityDir, sf);
  let content;
  if (fs.existsSync(p)) {
    content = fs.readFileSync(p, 'utf8');
    fs.unlinkSync(p);
  } else if (fs.existsSync(p.replace('.md', '-part1.md'))) {
    content = fs.readFileSync(p.replace('.md', '-part1.md'), 'utf8');
  }
  if (content) {
    for (let i = 1; i <= parts; i++) {
        fs.writeFileSync(path.join(usabilityDir, sf.replace('.md', `-part${i}.md`)), content);
    }
  }
}


const files = fs.readdirSync(usabilityDir).filter(f => f.endsWith('.md') && f.startsWith('test-'));

let updated = 0;

for (const file of files) {
  const filePath = path.join(usabilityDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  let targetPrefix = 'Use the `mj_execute_code` tool to interact with the following tools in this test pass:';
  let idx = lines.findIndex(l => l.includes(targetPrefix));
  if (idx === -1) {
    targetPrefix = 'Use the following tools in this test pass:';
    idx = lines.findIndex(l => l.includes(targetPrefix));
  }
  if (idx === -1) {
    targetPrefix = 'Use direct tool calls to interact with tools that accept workspace contextualization (e.g., `search_entries`, `get_recent_entries`, `get_statistics`) in this test pass.';
    idx = lines.findIndex(l => l.includes(targetPrefix));
  }
  if (idx === -1) {
    targetPrefix = 'Use direct tool calls to interact with tools that accept workspace contextualization in this test pass:';
    idx = lines.findIndex(l => l.includes(targetPrefix));
  }
  
  if (idx !== -1) {
    // Fix logic flaw: usability tests should test tools directly, not via Code Mode
    if (lines[idx].includes('`mj_execute_code`')) {
      lines[idx] = 'Use the following tools in this test pass:';
    }
    if (lines[idx].includes('workspace contextualization')) {
      lines[idx] = 'Use direct tool calls to interact with tools that accept workspace contextualization in this test pass:';
    }
    
    const assignedTools = reverseMap[file] || [];
    // Format the tools line as backticked, comma-separated list
    const toolsLine = assignedTools.map(t => `\`${t}\``).join(', ');
    
    // Clean up empty lines and old tools lines
    while (idx + 1 < lines.length && (lines[idx + 1].trim() === '' || lines[idx + 1].startsWith('`') || lines[idx + 1].includes('`'))) {
        lines.splice(idx + 1, 1);
    }
    
    // Insert an empty line, the tools line, and another empty line
    if (toolsLine) {
        lines.splice(idx + 1, 0, '', toolsLine, '');
    } else {
        lines.splice(idx + 1, 0, '');
    }
  }
  
  let updatedContent = lines.join('\n');
  
  // Fix logic flaw: replace "using Code Mode (`mj_execute_code`)"
  updatedContent = updatedContent.replace(/using Code Mode \(`mj_execute_code`\)/g, 'using direct tool calls');
  
  // Fix logic flaw: edit generator script instead of markdown file directly
  updatedContent = updatedContent.replace(/edit this markdown file directly/g, 'edit the generator scripts directly');
  
  
  // Fix logic flaw: remove any lingering '(including `mj_execute_code`)' since usability tests don't use Code Mode
  updatedContent = updatedContent.replace(/\(including `mj_execute_code`\)/g, '');
  
  // Fix hallucinated parameter drift in mutation tests
  updatedContent = updatedContent.replace(/ or `permanent: true`/g, '');
  
  // Fix hallucinated skill file path to the correct MCP prompt
  updatedContent = updatedContent.replace(/skills\/mj-mcp-heal\/SKILL\.md/g, '/mcp:memory-journal-mcp:mcp-heal prompt');
  
  // Fix logic flaw: remove parameter drift hallucination (use_test_db)
  updatedContent = updatedContent.replace(/\n>\s*\n> \*\*CRITICAL:\*\* You MUST pass `use_test_db: true`[\s\S]*?instead of production\./g, '');
  updatedContent = updatedContent.replace(/- \*\*CRITICAL:\*\* You MUST pass `use_test_db: true`[\s\S]*?instead of production\.\r?\n/g, '');
  
  updatedContent = updatedContent.replace(/\bDEFAULT_PROJECT_NUMBER\b/g, 'DEFAULT_WORKSPACE_ID');
  updatedContent = updatedContent.replace(/project #5/gi, 'workspace test-ws');
  
  // Fix logic flaw: replace git add and git commit with commit.ts
  updatedContent = updatedContent.replace(/Run `git add \.` and `git commit -m "[^"]+"` to save your changes locally\./g, 'Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "test(usability): optimize tool usage" --impact 0.5 --confidence 1.0 --validation passed --journal --add .` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow.');
  
  // Catch already replaced ones
  updatedContent = updatedContent.replace(/Immediately commit passing changes using the `bun [^`]+` utility\. Do NOT use raw `git commit`\.(?! WARNING:)/g, 'Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "test(usability): optimize tool usage" --impact 0.5 --confidence 1.0 --validation passed --journal --add .` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow.');

  updatedContent = updatedContent.replace(/`bun \.\/\.agents\/scripts\/commit\.ts/g, '`bun ./.agents/scripts/commit.ts');
  
  // Fix hallucinated project admin parameters
  updatedContent = updatedContent.replace(/project_number: <new_project_number>/g, 'name: "test-proj"');
  updatedContent = updatedContent.replace(/project_name: "updated-proj", is_active: false/g, 'new_name: "updated-proj", is_active: false');
  updatedContent = updatedContent.replace(/project_number: 999999, project_name: "ghost"/g, 'name: "ghost"');
  updatedContent = updatedContent.replace(/project_name: "test-proj"/g, 'name: "test-proj"');
  updatedContent = updatedContent.replace(/project_name: "ghost"/g, 'name: "ghost"');
  

  updatedContent = fixHallucinations(updatedContent);
  updatedContent = fixFormatting(updatedContent);
  
  if (content !== updatedContent) {
    fs.writeFileSync(filePath, updatedContent);
    updated++;
  }
}

const standardDir = path.join(__dirname, '..', 'standard');

const teamFilePath = path.join(standardDir, 'test-tool-group-team.md');
if (fs.existsSync(teamFilePath)) {
  const content = fs.readFileSync(teamFilePath, 'utf8');
  fs.writeFileSync(path.join(standardDir, 'test-tool-group-team-part1.md'), content);
  fs.writeFileSync(path.join(standardDir, 'test-tool-group-team-part2.md'), content);
  fs.writeFileSync(path.join(standardDir, 'test-tool-group-team-part3.md'), content);
  fs.writeFileSync(path.join(standardDir, 'test-tool-group-team-part4.md'), content);
  fs.unlinkSync(teamFilePath);
}

const splitGroups = { core: 2, search: 2, git: 2, io: 2, backup: 2, analytics: 2, relationships: 2, admin: 4, github: 2 };
for (const [grp, parts] of Object.entries(splitGroups)) {
  const fp = path.join(standardDir, `test-tool-group-${grp}.md`);
  let content;
  if (fs.existsSync(fp)) {
    content = fs.readFileSync(fp, 'utf8');
    fs.unlinkSync(fp);
  } else if (fs.existsSync(fp.replace('.md', '-part1.md'))) {
    content = fs.readFileSync(fp.replace('.md', '-part1.md'), 'utf8');
  }
  if (content) {
    for (let i = 1; i <= parts; i++) {
        fs.writeFileSync(path.join(standardDir, `test-tool-group-${grp}-part${i}.md`), content);
    }
  }
}


const splitStandardFiles = {
  'test-core-admin-backup.md': 2,
  'test-core-admin-batch.md': 2,
  'test-core-admin-system.md': 2,
  'test-core-semantic.md': 3,
  'test-payload-optimization.md': 4,
  'test-resources.md': 2,
  'test-github-read.md': 2
};

for (const [sf, parts] of Object.entries(splitStandardFiles)) {
  const p = path.join(standardDir, sf);
  let content;
  if (fs.existsSync(p)) {
    content = fs.readFileSync(p, 'utf8');
    fs.unlinkSync(p);
  } else if (fs.existsSync(p.replace('.md', '-part1.md'))) {
    content = fs.readFileSync(p.replace('.md', '-part1.md'), 'utf8');
  }
  if (content) {
    for (let i = 1; i <= parts; i++) {
        fs.writeFileSync(path.join(standardDir, sf.replace('.md', `-part${i}.md`)), content);
    }
  }
}

const standardFiles = fs.readdirSync(standardDir).filter(f => f.endsWith('.md') && f !== 'README.md' && f !== 'coordinator-workflow.md' && f !== 'tool-group-requirements.md');

for (const file of standardFiles) {
  const filePath = path.join(standardDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  const assignedTools = reverseMap[file] || [];
  
  let fixedContent = fixHallucinations(content);
  // Fix standard IO part2 hallucination
  if (file === 'test-tool-group-io-part2.md') {
    fixedContent = fixedContent.replace(/\| `export_entries` \| [^\n]+\n/g, '');
  }
  // Fix analytics part2
  if (file === 'test-tool-group-analytics-part2.md') {
    fixedContent = fixedContent.replace(/get_statistics/g, 'get_cross_project_insights');
  }
  // Fix relationships part2
  if (file === 'test-tool-group-relationships-part2.md') {
    fixedContent = fixedContent.replace(/\| `link_entries` \| [^\n]+\n/g, '');
  }

  
  // Fix hallucinated project admin parameters
  fixedContent = fixedContent.replace(/name: "test-proj", default_owner: "dev", github_repo: "user\/test-proj"/g, 'name: "test-proj", absolute_path: "/tmp/test-proj"');
  fixedContent = fixedContent.replace(/name: "test-proj", default_owner: "dev"/g, 'name: "test-proj", absolute_path: "/tmp/test-proj"');
  fixedContent = fixedContent.replace(/project_number: <new_project_number>/g, 'name: "test-proj"');
  fixedContent = fixedContent.replace(/project_name: "updated-proj", is_active: false/g, 'new_name: "updated-proj", is_active: false');
  fixedContent = fixedContent.replace(/project_number: 999999, project_name: "ghost"/g, 'name: "ghost"');
  fixedContent = fixedContent.replace(/project_name: "test-proj"/g, 'name: "test-proj"');
  fixedContent = fixedContent.replace(/project_name: "ghost"/g, 'name: "ghost"');
  
  
  // Fix logic flaw: remove parameter drift hallucination (use_test_db)
  fixedContent = fixedContent.replace(/\n>\s*\n> \*\*CRITICAL:\*\* You MUST pass `use_test_db: true`[\s\S]*?instead of production\./g, '');
  fixedContent = fixedContent.replace(/- \*\*CRITICAL:\*\* You MUST pass `use_test_db: true`[\s\S]*?instead of production\.\r?\n/g, '');
  fixedContent = fixedContent.replace(/> \*\*CRITICAL:\*\* You MUST pass `use_test_db: true`[\s\S]*?instead of production\./g, '');

  fixedContent = fixedContent.replace(/\bDEFAULT_PROJECT_NUMBER\b/g, 'DEFAULT_WORKSPACE_ID');
  fixedContent = fixedContent.replace(/project #5/gi, 'workspace test-ws');

  // Fix standard parameter hallucinations
  fixedContent = fixedContent.replace(/\bstart_date\b/g, 'fromDate');
  fixedContent = fixedContent.replace(/\bend_date\b/g, 'toDate');
  fixedContent = fixedContent.replace(/\binclude_archived\b/g, 'includeArchived');
  fixedContent = fixedContent.replace(/\bis_archived\b/g, 'isArchived');
  fixedContent = fixedContent.replace(/\bis_personal\b/g, 'isPersonal');
  fixedContent = fixedContent.replace(/\bissue_number\b/g, 'issueNumber');
  fixedContent = fixedContent.replace(/\bpr_status\b/g, 'prStatus');
  fixedContent = fixedContent.replace(/\bpr_number\b/g, 'prNumber');
  fixedContent = fixedContent.replace(/\btrust_score\b/g, 'trustScore');
  fixedContent = fixedContent.replace(/\bimpact_score\b/g, 'impactScore');
  fixedContent = fixedContent.replace(/\bexpected_version\b/g, 'expectedVersion');
  fixedContent = fixedContent.replace(/\bworkflow_run_id\b/g, 'workflowRunId');
  fixedContent = fixedContent.replace(/\bfts_weight\b/g, 'ftsWeight');
  fixedContent = fixedContent.replace(/\bsemantic_weight\b/g, 'semanticWeight');
  fixedContent = fixedContent.replace(/\bfuzzy_match\b/g, 'fuzzyMatch');
  fixedContent = fixedContent.replace(/\bsimilarity_threshold\b/g, 'similarityThreshold');
  fixedContent = fixedContent.replace(/\bsort_by\b/g, 'sortBy');
  fixedContent = fixedContent.replace(/\bnext_cursor\b/g, 'nextCursor');
  fixedContent = fixedContent.replace(/\bactive_days\b/g, 'activeDays');
  fixedContent = fixedContent.replace(/\btime_distribution\b/g, 'timeDistribution');
  fixedContent = fixedContent.replace(/\bfirst_entry\b/g, 'firstEntry');
  fixedContent = fixedContent.replace(/\blast_entry\b/g, 'lastEntry');
  fixedContent = fixedContent.replace(/\bentry_count\b/g, 'entryCount');
  fixedContent = fixedContent.replace(/\brelationship_count\b/g, 'relationshipCount');
  fixedContent = fixedContent.replace(/\bexported_count\b/g, 'exportedCount');
  fixedContent = fixedContent.replace(/\btop_tags\b/g, 'topTags');
  fixedContent = fixedContent.replace(/\bentry_type\b/g, 'type');
  fixedContent = fixedContent.replace(/\bentry_id\b/g, 'id');
  fixedContent = fixedContent.replace(/\berror_type\b/g, 'code');
  fixedContent = fixedContent.replace(/\baggregated_errors\b/g, 'aggregatedErrors');
  fixedContent = fixedContent.replace(/\bblocked_by\b/g, 'blockedBy');
  fixedContent = fixedContent.replace(/\bmax_ms\b/g, 'maxMs');
  fixedContent = fixedContent.replace(/\bmin_ms\b/g, 'minMs');
  fixedContent = fixedContent.replace(/\bp50_ms\b/g, 'p50Ms');
  fixedContent = fixedContent.replace(/\bp95_ms\b/g, 'p95Ms');
  fixedContent = fixedContent.replace(/\bp99_ms\b/g, 'p99Ms');

  // Fix legacy hallucinated note in admin tests (add to standardDir loop)
  fixedContent = fixedContent.replace(/> \*\*Note:\*\* `?registerProject`? is an Admin method but is intentionally exposed exclusively via Code Mode API[^\n]*\n(?:> [^\n]*\n)*/g, '');

  fixedContent = fixFormatting(fixedContent);
  
  // Fix double workspace_id in test-workspace-isolation.md
  fixedContent = fixedContent.replace(/team_create_entry\(workspace_id: "alpha", content: "Team alpha plan", workspace_id: "test-ws"\)/g, 'team_create_entry(workspace_id: "alpha", content: "Team alpha plan")');

  // Inject boilerplate from prompt-template.md
  const templatePath = path.join(__dirname, 'prompt-template.md');
  if (fs.existsSync(templatePath)) {
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    // Replace everything from **Prerequisites:** up to the first --- separator
    fixedContent = fixedContent.replace(/\*\*Prerequisites:\*\*[\s\S]*?(?=\n---)/, templateContent.trim());
  }

  if (assignedTools.length > 0 && file.startsWith('test-tool-group-')) {
    const toolsString = assignedTools.map(t => `\`${t}\``).join(', ');
    
    const regex = /\*\*Scope:\*\* Deterministic verification of the (.*?) tool group \((.*?)\) against the strict error handling matrix\./;
    if (regex.test(content)) {
      fixedContent = fixedContent.replace(regex, `**Scope:** Deterministic verification of the $1 tool group (${toolsString}) against the strict error handling matrix.`);
      updated++;
    }
    
    const lines = fixedContent.split('\n');
    const resultLines = [];
    const foundTools = new Set();
    for (const line of lines) {
      if (line.trim().startsWith('|') && !line.includes('Tool') && !line.includes('---') && !line.includes('All Team Tools') && !line.includes('All Admin Tools') && !line.includes('All GitHub Tools')) {
        const match = line.match(/`([^`]+)`/);
        if (match) {
          if (!assignedTools.includes(match[1])) {
            continue;
          }
          foundTools.add(match[1]);
        }
      }
      resultLines.push(line);
    }
    const missingTools = assignedTools.filter(t => !foundTools.has(t));
    if (missingTools.length > 0) {
      let insertIndex = resultLines.findIndex(l => l.startsWith('### Specific Domain Checks'));
      if (insertIndex === -1) insertIndex = resultLines.findIndex(l => l.startsWith('## Success Criteria'));
      if (insertIndex === -1) insertIndex = resultLines.length;
      while (insertIndex > 0 && resultLines[insertIndex - 1].trim() === '') insertIndex--;
      const addedLines = missingTools.map(t => `| \`${t}\` | Auto-injected missing test | ⚠️ Should return validation error | \`param: "abc"\` |`);
      resultLines.splice(insertIndex, 0, ...addedLines);
      updated++;
    }
    fixedContent = resultLines.join('\n');
  }

  if (content !== fixedContent || assignedTools.length > 0) {
    fs.writeFileSync(filePath, fixedContent);
  }
}

const codemodeDir = path.join(__dirname, '..', 'codemode');

const cmSplits = [
  { file: 'test-cm-search.md', marker: '### 21.3 Cross-DB Search', phase: 'Phase 21' },
  { file: 'test-cm-team-crud.md', marker: '### 28.2 Team Error Paths', phase: 'Phase 28' },
  { file: 'test-cm-payload-optimization.md', marker: '### 30.3 MAX_QUERY_LIMIT & Cursor Pagination', phase: 'Phase 30' },
  { file: 'test-cm-sandbox-basics.md', marker: '### 16.4 Timeout Handling', phase: 'Phase 16' },
  { file: 'test-cm-hallucination-smoothing.md', marker: '### 31.3 Cross-Group Constructor Wiring', phase: 'Phase 31' },
  { file: 'test-cm-crud-part-1.md', marker: '### 20.4 Get Entry By ID — Details', phase: 'Phase 20' },
  { file: 'test-cm-crud-part-2.md', marker: '### 20.8 Get Recent Entries — Filters', phase: 'Phase 20' },
  { file: 'test-cm-crud-advanced-part-1.md', marker: '### 20.14 Soft-Delete Recovery, Archiving & Cursor Pagination', phase: 'Phase 20B' },
  { file: 'test-cm-search-advanced-part-2.md', marker: '### 21.10 Keyset Pagination & Archiving in Search', phase: 'Phase 21B' },
  { file: 'test-cm-error-matrix-part-1.md', marker: '### 29.2 Search Group — Empty Params & Type Mismatches', phase: 'Phase 29' },
  { file: 'test-cm-error-matrix-part-2.md', marker: '### 29.5 Backup Group — Empty Params & Security', phase: 'Phase 29B' },
  { file: 'test-cm-github-part-2.md', marker: '### 25.4', phase: 'Phase 25C' }
];

for (const splitInfo of cmSplits) {
  const filePath = path.join(codemodeDir, splitInfo.file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    const sections = content.split(splitInfo.marker);
    if (sections.length === 2) {
      let part1 = sections[0].trim();
      const matchCriteria = content.match(/## Success Criteria[\s\S]*/);
      if (matchCriteria) {
        part1 += '\n\n' + matchCriteria[0].replace(/- .*/g, '').trim() + '\n- See part 2 for remaining success criteria.\n';
      }

      let header = sections[0].substring(0, sections[0].indexOf('### '));
      const part2 = header.replace(splitInfo.phase, `${splitInfo.phase} (Part 2)`).trim() + '\n\n' + splitInfo.marker + sections[1];
      
      const nameWithoutExt = splitInfo.file.replace('.md', '');
      let outName1 = `${nameWithoutExt}-part-1.md`;
      let outName2 = `${nameWithoutExt}-part-2.md`;
      if (nameWithoutExt.includes('-part-1')) {
         outName1 = nameWithoutExt.replace('-part-1', '-part-1a') + '.md';
         outName2 = nameWithoutExt.replace('-part-1', '-part-1b') + '.md';
      } else if (nameWithoutExt.includes('-part-2')) {
         outName1 = nameWithoutExt.replace('-part-2', '-part-2a') + '.md';
         outName2 = nameWithoutExt.replace('-part-2', '-part-2b') + '.md';
      }
      fs.writeFileSync(path.join(codemodeDir, outName1), part1);
      fs.writeFileSync(path.join(codemodeDir, outName2), part2);
      fs.unlinkSync(filePath);
    }
  }
}

const codemodeFiles = fs.readdirSync(codemodeDir).filter(f => f.endsWith('.md'));


const codemodeHallucinationFixes = {
  'mj.admin.bulkCreate': 'mj.admin.batchCreateEntries',
  'mj.admin.bulkUpdate': 'mj.admin.batchUpdateEntries',
  'mj.admin.batchUpdate': 'mj.admin.batchUpdateEntries',
  'mj.admin.bulkDelete': 'mj.admin.batchDeleteEntries',
  'mj.admin.config': 'mj.admin.updateConfiguration',
  'mj.admin.listDeletedEntries': 'mj.search.listDeletedEntries',
  'mj.analytics.stats': 'mj.analytics.getStatistics',
  'mj.core.deleteEntry': 'mj.admin.deleteEntry',
  'mj.core.history': 'mj.core.getEntryHistory',
  'mj.core.recent': 'mj.core.getRecentEntries',
  'mj.core.get': 'mj.core.getEntryById',
  'mj.core.searchAuditLog': 'mj.admin.searchAuditLog',
  'mj.core.searchEntries': 'mj.search.searchEntries',
  'mj.core.semanticSearch': 'mj.search.semanticSearch',
  'mj.core.updateEntry': 'mj.admin.updateEntry',
  'mj.core.vectorStats': 'mj.search.getVectorIndexStats',
  'mj.core.listDeletedEntries': 'mj.search.listDeletedEntries',
  'mj.search.readQuery': 'mj.search.searchEntries',
  'mj.search.read_query': 'mj.search.searchEntries',
  'mj.semantic.semanticSearch': 'mj.search.semanticSearch',
  'mj.semantic.vectorStats': 'mj.search.getVectorIndexStats',
  'mj.team.bulkCreate': 'mj.team.teamBatchCreateEntries',
  'mj.team.bulkUpdate': 'mj.team.teamBatchUpdateEntries',
  'mj.team.bulkDelete': 'mj.team.teamBatchDeleteEntries',
  'mj.team.aliases': 'mj.team.teamListAuthorAliases',
  'mj.team.setRole': 'mj.team.teamUpdateMemberRole',
  'mj.team.createEntry': 'mj.team.teamCreateEntry',
  'mj.team.deleteEntry': 'mj.team.teamDeleteEntry',
  'mj.team.updateEntry': 'mj.team.teamUpdateEntry',
};

for (const file of codemodeFiles) {
  const filePath = path.join(codemodeDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  let fixedContent = content;
  
  for (const [bad, good] of Object.entries(codemodeHallucinationFixes)) {
    fixedContent = fixedContent.replace(new RegExp('\\b' + bad.replace(/\./g, '\\.') + '\\b', 'g'), good);
  }

  // Fix PowerShell here-string corruption and unescaped characters in markdown files
  fixedContent = fixedContent.replace(/"@\r?\n\r?\n\s*=\s*@"\r?\n/g, '');
  
  // Strip control characters (excluding newline/carriage return/tab) that corrupted the file
  fixedContent = fixedContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, '');
  
  // Fix specific typos caused by previous corruption (idempotent)
  fixedContent = fixedContent.replace(/\b(?:f+)?uzzy_match\b/g, 'fuzzy_match');
  fixedContent = fixedContent.replace(/\b(?:e+)?xact_match\b/g, 'exact_match');
  fixedContent = fixedContent.replace(/\b(?:e+)?ntry_type\b/g, 'entry_type');
  fixedContent = fixedContent.replace(/\b(?:e+)?nd_date\b/g, 'end_date');
  fixedContent = fixedContent.replace(/\(\s*(?:e+)?ntry_id\)/g, '(entry_id)');
  fixedContent = fixedContent.replace(/ext_cursor\) works reliably across FTS, semantic, and date range searches via Code Mode scripts \/ - See part 2 for remaining success criteria\./g, 'next_cursor) works reliably across FTS, semantic, and date range searches via Code Mode scripts.');
  
  // Clean up overzealous regex damage from previous passes
  fixedContent = fixedContent.replace(/vectorAa*vailable/g, 'vectorAvailable');
  fixedContent = fixedContent.replace(/contextAa*vailable/g, 'contextAvailable');
  fixedContent = fixedContent.replace(/unaa*vailable/g, 'unavailable');
  fixedContent = fixedContent.replace(/aa*vailableStatuses/g, 'availableStatuses');
  fixedContent = fixedContent.replace(/team_r*ebuild_vector_index/g, 'team_rebuild_vector_index');
  fixedContent = fixedContent.replace(/team_a*dd_to_vector_index/g, 'team_add_to_vector_index');
  
  // Fix hallucinated project admin parameters
  fixedContent = fixedContent.replace(/repo_name: 'test-codemode-project',/g, "name: 'test-codemode-project',");
  fixedContent = fixedContent.replace(/metadata: \\{ framework: 'react' \\}/g, "absolute_path: '/tmp/test-codemode-project'");
  fixedContent = fixedContent.replace(/metadata: \\{ framework: 'nextjs' \\}/g, "new_name: 'test-codemode-project-updated'");
  fixedContent = fixedContent.replace(/project_number: <new_project_number>/g, 'name: "test-proj"');
  fixedContent = fixedContent.replace(/project_name: "updated-proj", is_active: false/g, 'new_name: "updated-proj", is_active: false');
  fixedContent = fixedContent.replace(/project_number: 999999, project_name: "ghost"/g, 'name: "ghost"');
  fixedContent = fixedContent.replace(/project_name: "test-proj"/g, 'name: "test-proj"');
  fixedContent = fixedContent.replace(/project_name: "ghost"/g, 'name: "ghost"');
  fixedContent = fixedContent.replace(/All 16 GitHub tools callable/g, 'All 18 GitHub tools callable');
  
  
  // Fix logic flaw: remove parameter drift hallucination (use_test_db)
  fixedContent = fixedContent.replace(/\n>\s*\n> \*\*CRITICAL:\*\* You MUST pass `use_test_db: true`[\s\S]*?instead of production\./g, '');
  fixedContent = fixedContent.replace(/- \*\*CRITICAL:\*\* You MUST pass `use_test_db: true`[\s\S]*?instead of production\.\r?\n/g, '');
  fixedContent = fixedContent.replace(/\n> \*\*CRITICAL:\*\* You MUST pass `use_test_db: true`[\s\S]*?instead of production\./g, '');
  
  // Fix project_number: pNum in getProject/updateProject/deleteProject
  fixedContent = fixedContent.replace(/project_number: pNum/g, 'name: pNum');

  // Fix Code Mode wrapper parameter hallucination
  fixedContent = fixedContent.replace(/outer `project_number` parameter/g, 'outer `workspace_id` parameter');
  fixedContent = fixedContent.replace(/String-based `project_number` parameters \(`"5"`\) auto-resolve to numeric safely/g, 'Number-based `workspace_id` parameters (`5`) auto-resolve to string safely');
  fixedContent = fixedContent.replace(/filters by project_number/g, 'filters by workspace_id');
  fixedContent = fixedContent.replace(/\bDEFAULT_PROJECT_NUMBER\b/g, 'DEFAULT_WORKSPACE_ID');
  fixedContent = fixedContent.replace(/project #5/gi, 'workspace test-ws');

  // Fix Codemode admin projects hallucinated properties and returns
  fixedContent = fixedContent.replace(/repo_name:\s*'test-codemode-project',\s*metadata:\s*\{\s*framework:\s*'react'\s*\}/g, "name: 'test-codemode-project',\n  absolute_path: '/tmp/test-codemode-project'");
  fixedContent = fixedContent.replace(/metadata:\s*\{\s*framework:\s*'nextjs'\s*\}/g, "absolute_path: '/tmp/test-codemode-project-v2'");
  fixedContent = fixedContent.replace(/const pNum = register\.projectNumber/g, "const pNum = register.project?.name");

  
  fixedContent = fixedContent.replace(
    /3\. If you made code changes\/fixes, update `UNRELEASED\.md` and commit without pushing\. If tests pass cleanly, do NOT update `UNRELEASED\.md`\. Then, stop so the \*\*USER\*\* can verify with `pnpm run lint` and `npx tsc --noEmit`\.\r?\n4\. After user completes verification, re-test fixes with direct MCP calls\./g,
    '3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.\n4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.'
  );

  fixedContent = fixedContent.replace(/Immediately commit passing changes using the `bun [^`]+` utility\. Do NOT use raw `git commit`\.(?! WARNING:)/g, 'Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow.');


  fixedContent = fixedContent.replace(
    /2\. \*\*Local Verification\*\*: If you or a subagent modifies the codebase, you MUST run the linter and typechecker \(`pnpm run lint` and `npx tsc --noEmit`\) locally and fix any issues BEFORE committing\. Pay strict attention to ESLint and TypeScript compiler outputs\. You MUST fix all validation issues prior to committing\. Do NOT ignore warnings or errors\. Follow strict TypeScript guidelines: NEVER use `any` \(use `unknown` with type guards\), avoid unsafe typecasts, and ensure explicit return types\.\n3\. \*\*Commit\*\*: Immediately commit passing changes using the `bun \.\/\.agents\/scripts\/commit\.ts` utility\. Do NOT use raw `git commit`\. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous\.\n3\. Provide a very brief/g,
    '2. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.\n3. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.\n4. Provide a very brief'
  );

  fixedContent = fixedContent.replace(
    /2\. If you made code changes\/fixes, update `UNRELEASED\.md` and commit without pushing\. Then, stop so the \*\*USER\*\* can verify with `pnpm run lint` and `npx tsc --noEmit`\.\n3\. Provide a very brief/g,
    '2. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.\n3. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.\n4. Provide a very brief'
  );


  fixedContent = fixedContent.replace(
    /including changes to `(?:src\/)?constants\/server-instructions\.ts`(?: or this file\.)? \*\*If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code \(e\.g\., `(?:src\/filtering\/tool-filter\.ts|codemode\.ts)`\) so future agents succeed automatically\.\*\*/g,
    'including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**'
  );

  // Fix test-git.md and test-config-reload.md boilerplate
  fixedContent = fixedContent.replace(
    /1\. Create a plan to fix any issues found\.\r?\n2\. If code changes made, commit without pushing\.\r?\n3\. Stop for \*\*USER\*\* verification\.\r?\n4\. Re-test\.\r?\n5\. Provide brief final summary including Total Token Estimate\./g,
    '1. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.\n2. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.\n3. Provide brief final summary including Total Token Estimate.'
  );

  fixedContent = fixedContent.replace(/`bun \.\/\.agents\/scripts\/commit\.ts`/g, '`bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>`');
  fixedContent = fixedContent.replace(/`bun \.\/\.agents\/scripts\/commit\.ts --msg/g, '`bun ./.agents/scripts/commit.ts --msg');


  fixedContent = fixFormatting(fixedContent);
  
  if (content !== fixedContent) {
    fs.writeFileSync(filePath, fixedContent);
    updated++;
  }
}

console.log(`Standardized ${updated} test prompt files based on tool-map.json.`);
