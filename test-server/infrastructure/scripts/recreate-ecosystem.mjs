import { execSync } from 'child_process';
import { setTimeout } from 'timers/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = join(__dirname, '..');
const MAX_RETRIES = 60;
const RETRY_DELAY_MS = 2000;

function run(command) {
    console.log(`\n> ${command}`);
    execSync(command, { stdio: 'inherit', cwd: REPO_ROOT });
}

function runQuiet(command) {
    try {
        return execSync(command, { encoding: 'utf-8', cwd: REPO_ROOT, stdio: 'pipe' });
    } catch {
        return '';
    }
}

console.log('=== Recreating Unified Monitoring Ecosystem ===');

try {
    // ── Phase 1: Cleanup ──────────────────────────────────────────────
    console.log('\n[1/3] Discovering containers from docker-compose.yml...');
    const services = runQuiet('docker compose config --services').trim().split('\n').filter(Boolean);
    if (services.length === 0) {
        throw new Error('No services found in docker-compose.yml. Is the file valid?');
    }
    console.log(`  Found ${services.length} services: ${services.join(', ')}`);

    console.log('\n[2/3] Cleaning up old containers and volumes...');
    for (const name of services) {
        runQuiet(`docker rm -f ${name}`);
    }
    run('docker compose down -v --remove-orphans');
    console.log('  Giving Docker daemon time to flush networks...');
    await setTimeout(5000);

    // ── Phase 2: Start ecosystem ──────────────────────────
    console.log('\n[3/3] Starting ecosystem containers...');
    run('docker compose up -d');

    console.log('\n✅ Unified Monitoring Ecosystem Successfully Recreated.');
} catch (error) {
    console.error('\n❌ Ecosystem recreation failed:', error.message);
    process.exit(1);
}
