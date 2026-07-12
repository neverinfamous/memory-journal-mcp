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

// Build reverse map: file -> tools
for (const [tool, files] of Object.entries(toolMapData.toolMap)) {
  if (tool === 'mj_execute_code') continue;
  for (const file of files) {
    if (!reverseMap[file]) {
      reverseMap[file] = [];
    }
    reverseMap[file].push(tool);
  }
}

const usabilityDir = path.join(__dirname, '..', 'usability');
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
  
  if (idx !== -1 && idx + 1 < lines.length) {
    // Fix logic flaw: usability tests should test tools directly, not via Code Mode
    if (lines[idx].includes('`mj_execute_code`')) {
      lines[idx] = 'Use the following tools in this test pass:';
    }
    
    const assignedTools = reverseMap[file] || [];
    // Format the tools line as backticked, comma-separated list
    const toolsLine = assignedTools.map(t => `\`${t}\``).join(', ');
    
    // Replace the next line with the new tools list
    lines[idx + 1] = toolsLine;
  }
  
  let updatedContent = lines.join('\n');
  
  // Fix logic flaw: replace "using Code Mode (`mj_execute_code`)"
  updatedContent = updatedContent.replace(/using Code Mode \(`mj_execute_code`\)/g, 'using direct tool calls');
  
  // Fix logic flaw: edit generator script instead of markdown file directly
  updatedContent = updatedContent.replace(/edit this markdown file directly/g, 'edit the generator scripts directly');
  
  // Fix logic flaw: workspace isolation test also needs mj_execute_code removed
  updatedContent = updatedContent.replace(
    /Use the `mj_execute_code` tool to interact with tools that accept workspace contextualization/g,
    'Use direct tool calls to interact with tools that accept workspace contextualization'
  );
  
  updatedContent = fixHallucinations(updatedContent);
  
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
    for (const line of lines) {
      if (line.trim().startsWith('|') && !line.includes('Tool') && !line.includes('---') && !line.includes('All Team Tools') && !line.includes('All Admin Tools') && !line.includes('All GitHub Tools')) {
        const match = line.match(/`([^`]+)`/);
        if (match && !assignedTools.includes(match[1])) {
          continue;
        }
      }
      resultLines.push(line);
    }
    fixedContent = resultLines.join('\n');
  }

  if (content !== fixedContent || assignedTools.length > 0) {
    fs.writeFileSync(filePath, fixedContent);
  }
}

const codemodeDir = path.join(__dirname, '..', 'codemode');
const codemodeFiles = fs.readdirSync(codemodeDir).filter(f => f.endsWith('.md'));

const codemodeHallucinationFixes = {
  'mj.admin.bulkCreate': 'mj.admin.batchCreateEntries',
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
  
  if (content !== fixedContent) {
    fs.writeFileSync(filePath, fixedContent);
    updated++;
  }
}

console.log(`Standardized ${updated} test prompt files based on tool-map.json.`);
