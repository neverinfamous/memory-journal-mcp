import fs from 'fs';

const toolMap = JSON.parse(fs.readFileSync('c:\\Users\\chris\\Desktop\\memory-journal-mcp\\test-server\\scripts\\tool-map.json', 'utf8'));

const reverseMap = {};

for (const [tool, files] of Object.entries(toolMap.toolMap)) {
    for (const file of files) {
        if (!reverseMap[file]) {
            reverseMap[file] = [];
        }
        reverseMap[file].push(tool);
    }
}

const usabilityFiles = Object.keys(reverseMap).filter(f => f.startsWith('test-usability-'));

const counts = usabilityFiles.map(f => ({ file: f, count: reverseMap[f].length })).sort((a, b) => b.count - a.count);

console.log("Usability file tool counts:");
for (const {file, count} of counts) {
    if (count > 5) {
        console.log(`${file}: ${count} tools`);
    }
}
