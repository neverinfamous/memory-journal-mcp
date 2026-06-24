import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mdDir = 'src/constants/server-instructions';
const files = readdirSync(mdDir).filter(f => f.endsWith('.md'));

for (const file of files) {
    const path = resolve(mdDir, file);
    let content = readFileSync(path, 'utf-8');
    
    content = content.replace(/\\`/g, '`');
    content = content.replace(/\\\$\{/g, '${');
    content = content.replace(/\\\\/g, '\\');
    
    writeFileSync(path, content, 'utf-8');
    console.log('Fixed ' + file);
}
