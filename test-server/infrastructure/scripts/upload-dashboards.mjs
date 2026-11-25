/**
 * Upload portable Datadog dashboards for memory-journal-mcp via the `pup` CLI.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configDir = join(__dirname, '..', 'config');

const DASHBOARDS = [
    { id: 'my6-q9k-682', file: 'datadog-dashboard.json' },
    { id: '79q-b3r-jhu', file: 'datadog-ai-dashboard.json' },
];

for (const dashboard of DASHBOARDS) {
    const sourceFile = join(configDir, dashboard.file);
    if (!existsSync(sourceFile)) {
        console.error(`Error: Dashboard file not found: ${sourceFile}`);
        process.exit(1);
    }

    console.log(`Uploading dashboard ${dashboard.file} (${dashboard.id})...`);
    try {
        execFileSync(
            'pup',
            ['dashboards', 'update', dashboard.id, '--file', sourceFile, '-y'],
            { stdio: 'inherit' }
        );
        console.log('  -> Successfully uploaded.');
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`  -> Failed to upload ${dashboard.file}: ${msg}`);
        process.exit(1);
    }
}

console.log('Dashboard upload complete.');
