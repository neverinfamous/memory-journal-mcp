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
if (fs.existsSync(isolationFilePath)) {
  let isoContent = fs.readFileSync(isolationFilePath, 'utf8');
  fs.writeFileSync(path.join(usabilityDir, 'test-usability-workspace-isolation-part1.md'), isoContent);
  fs.writeFileSync(path.join(usabilityDir, 'test-usability-workspace-isolation-part2.md'), isoContent);
  fs.unlinkSync(isolationFilePath);
}

const splitFiles = [
  'test-usability-admin-projects.md',
  'test-usability-github-read.md',
  'test-usability-github-milestones.md',
  'test-usability-team-members.md',
  'test-usability-team-aliases.md'
];

for (const sf of splitFiles) {
  const p = path.join(usabilityDir, sf);
  if (fs.existsSync(p)) {
    const content = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(path.join(usabilityDir, sf.replace('.md', '-part1.md')), content);
    fs.writeFileSync(path.join(usabilityDir, sf.replace('.md', '-part2.md')), content);
    fs.unlinkSync(p);
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
  
  // Fix logic flaw: remove parameter drift hallucination (use_test_db)
  updatedContent = updatedContent.replace(/\n>\s*\n> \*\*CRITICAL:\*\* You MUST pass `use_test_db: true`[\s\S]*?instead of production\./g, '');
  updatedContent = updatedContent.replace(/- \*\*CRITICAL:\*\* You MUST pass `use_test_db: true`[\s\S]*?instead of production\.\r?\n/g, '');
  
  // Fix logic flaw: replace git add and git commit with commit.ts
  updatedContent = updatedContent.replace(/Run `git add \.` and `git commit -m "[^"]+"` to save your changes locally\./g, 'Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "test(usability): optimize tool usage" --impact 0.5 --confidence 1.0 --validation passed --journal --add .` utility. Do NOT use raw `git commit`.');
  updatedContent = updatedContent.replace(/`bun \.\\\\\.agents\\\\scripts\\\\commit\.ts/g, '`bun ./.agents/scripts/commit.ts');
  
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

const adminFilePath = path.join(standardDir, 'test-tool-group-admin.md');
if (fs.existsSync(adminFilePath)) {
  const content = fs.readFileSync(adminFilePath, 'utf8');
  fs.writeFileSync(path.join(standardDir, 'test-tool-group-admin-part1.md'), content);
  fs.writeFileSync(path.join(standardDir, 'test-tool-group-admin-part2.md'), content);
  fs.unlinkSync(adminFilePath);
}

const githubFilePath = path.join(standardDir, 'test-tool-group-github.md');
if (fs.existsSync(githubFilePath)) {
  const content = fs.readFileSync(githubFilePath, 'utf8');
  fs.writeFileSync(path.join(standardDir, 'test-tool-group-github-part1.md'), content);
  fs.writeFileSync(path.join(standardDir, 'test-tool-group-github-part2.md'), content);
  fs.unlinkSync(githubFilePath);
}

const standardFiles = fs.readdirSync(standardDir).filter(f => f.endsWith('.md') && f !== 'README.md' && f !== 'coordinator-workflow.md' && f !== 'tool-group-requirements.md');

for (const file of standardFiles) {
  const filePath = path.join(standardDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  const assignedTools = reverseMap[file] || [];
  
  let fixedContent = fixHallucinations(content);
  
  // Fix hallucinated project admin parameters
  fixedContent = fixedContent.replace(/project_number: <new_project_number>/g, 'name: "test-proj"');
  fixedContent = fixedContent.replace(/project_name: "updated-proj", is_active: false/g, 'new_name: "updated-proj", is_active: false');
  fixedContent = fixedContent.replace(/project_number: 999999, project_name: "ghost"/g, 'name: "ghost"');
  fixedContent = fixedContent.replace(/project_name: "test-proj"/g, 'name: "test-proj"');
  fixedContent = fixedContent.replace(/project_name: "ghost"/g, 'name: "ghost"');
  
  
  // Fix logic flaw: remove parameter drift hallucination (use_test_db)
  fixedContent = fixedContent.replace(/\n>\s*\n> \*\*CRITICAL:\*\* You MUST pass `use_test_db: true`[\s\S]*?instead of production\./g, '');
  fixedContent = fixedContent.replace(/- \*\*CRITICAL:\*\* You MUST pass `use_test_db: true`[\s\S]*?instead of production\.\r?\n/g, '');
  fixedContent = fixedContent.replace(/> \*\*CRITICAL:\*\* You MUST pass `use_test_db: true`[\s\S]*?instead of production\./g, '');

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
  { file: 'test-cm-sandbox-basics.md', marker: '### 16.4 Timeout Handling', phase: 'Phase 16' }
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
      fs.writeFileSync(path.join(codemodeDir, `${nameWithoutExt}-part-1.md`), part1);
      fs.writeFileSync(path.join(codemodeDir, `${nameWithoutExt}-part-2.md`), part2);
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
  
  // Clean up overzealous regex damage from previous passes
  fixedContent = fixedContent.replace(/vectorAa*vailable/g, 'vectorAvailable');
  fixedContent = fixedContent.replace(/contextAa*vailable/g, 'contextAvailable');
  fixedContent = fixedContent.replace(/unaa*vailable/g, 'unavailable');
  fixedContent = fixedContent.replace(/aa*vailableStatuses/g, 'availableStatuses');
  fixedContent = fixedContent.replace(/team_r*ebuild_vector_index/g, 'team_rebuild_vector_index');
  fixedContent = fixedContent.replace(/team_a*dd_to_vector_index/g, 'team_add_to_vector_index');
  
  // Fix hallucinated project admin parameters
  fixedContent = fixedContent.replace(/project_number: <new_project_number>/g, 'name: "test-proj"');
  fixedContent = fixedContent.replace(/project_name: "updated-proj", is_active: false/g, 'new_name: "updated-proj", is_active: false');
  fixedContent = fixedContent.replace(/project_number: 999999, project_name: "ghost"/g, 'name: "ghost"');
  fixedContent = fixedContent.replace(/project_name: "test-proj"/g, 'name: "test-proj"');
  fixedContent = fixedContent.replace(/project_name: "ghost"/g, 'name: "ghost"');
  
  
  // Fix logic flaw: remove parameter drift hallucination (use_test_db)
  fixedContent = fixedContent.replace(/\n>\s*\n> \*\*CRITICAL:\*\* You MUST pass `use_test_db: true`[\s\S]*?instead of production\./g, '');
  fixedContent = fixedContent.replace(/- \*\*CRITICAL:\*\* You MUST pass `use_test_db: true`[\s\S]*?instead of production\.\r?\n/g, '');
  
  // Fix project_number: pNum in getProject/updateProject/deleteProject
  fixedContent = fixedContent.replace(/project_number: pNum/g, 'name: pNum');

  // Fix Code Mode wrapper parameter hallucination
  fixedContent = fixedContent.replace(/outer `project_number` parameter/g, 'outer `workspace_id` parameter');
  fixedContent = fixedContent.replace(/String-based `project_number` parameters \(`"5"`\) auto-resolve to numeric safely/g, 'Number-based `workspace_id` parameters (`5`) auto-resolve to string safely');
  fixedContent = fixedContent.replace(/workflow_run_id, project_number, is_personal/g, 'workflow_run_id, workspace_id, is_personal');
  fixedContent = fixedContent.replace(/filters by project_number/g, 'filters by workspace_id');

  
  // Fix boilerplate for codemode tests to align with autonomous verification
  fixedContent = fixedContent.replace(
    /3\. If you made code changes\/fixes, update `UNRELEASED\.md` and commit without pushing\. If tests pass cleanly, do NOT update `UNRELEASED\.md`\. Then, stop so the \*\*USER\*\* can verify with `pnpm run check`\.\r?\n4\. After user completes verification, re-test fixes with direct MCP calls\./g,
    '3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.\n4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.'
  );

  fixedContent = fixedContent.replace(
    /2\. \*\*Local Verification\*\*: If you or a subagent modifies the codebase, you MUST run the full validation pipeline \(`pnpm run check`\) locally and fix any issues BEFORE committing\. Pay strict attention to ESLint and TypeScript compiler outputs\. You MUST fix all validation issues prior to committing\. Do NOT ignore warnings or errors\. Follow strict TypeScript guidelines: NEVER use `any` \(use `unknown` with type guards\), avoid unsafe typecasts, and ensure explicit return types\.\n3\. \*\*Commit\*\*: Immediately commit passing changes using the `bun \.\/\.agents\/scripts\/commit\.ts` utility\. Do NOT use raw `git commit`\. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous\.\n3\. Provide a very brief/g,
    '2. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.\n3. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.\n4. Provide a very brief'
  );

  fixedContent = fixedContent.replace(
    /2\. If you made code changes\/fixes, update `UNRELEASED\.md` and commit without pushing\. Then, stop so the \*\*USER\*\* can verify with `pnpm run check`\.\n3\. Provide a very brief/g,
    '2. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.\n3. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.\n4. Provide a very brief'
  );


  fixedContent = fixedContent.replace(
    /including changes to `(?:src\/)?constants\/server-instructions\.ts`(?: or this file\.)? \*\*If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code \(e\.g\., `(?:src\/filtering\/tool-filter\.ts|codemode\.ts)`\) so future agents succeed automatically\.\*\*/g,
    'including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**'
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
