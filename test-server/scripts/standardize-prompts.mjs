import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const toolMapPath = path.join(__dirname, 'tool-map.json');
const toolMapData = JSON.parse(fs.readFileSync(toolMapPath, 'utf8'));
const reverseMap = {};

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
  
  if (content !== updatedContent) {
    fs.writeFileSync(filePath, updatedContent);
    updated++;
  }
}

const standardDir = path.join(__dirname, '..', 'standard');
const standardFiles = fs.readdirSync(standardDir).filter(f => f.endsWith('.md') && f.startsWith('test-tool-group-'));

for (const file of standardFiles) {
  const filePath = path.join(standardDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  const assignedTools = reverseMap[file] || [];
  
  if (assignedTools.length > 0) {
    const toolsString = assignedTools.map(t => `\`${t}\``).join(', ');
    
    const regex = /\*\*Scope:\*\* Deterministic verification of the (.*?) tool group \((.*?)\) against the strict error handling matrix\./;
    if (regex.test(content)) {
      content = content.replace(regex, `**Scope:** Deterministic verification of the $1 tool group (${toolsString}) against the strict error handling matrix.`);
      fs.writeFileSync(filePath, content);
      updated++;
    }
  }
}

console.log(`Standardized ${updated} test prompt files based on tool-map.json.`);
