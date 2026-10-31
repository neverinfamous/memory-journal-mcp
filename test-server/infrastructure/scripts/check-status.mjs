import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const execCommand = (cmd, args, ignoreError = false) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', stdio: 'pipe', cwd: REPO_ROOT });
  } catch (e) {
    if (!ignoreError) {
      console.error(`Error: ${e.message}`);
    }
    return null;
  }
};

// Dynamically discover expected containers from docker-compose.yml
const isWindows = process.platform === 'win32';
const dockerCmd = isWindows ? 'wsl' : 'docker';
const dockerArgs = isWindows ? ['docker', 'compose'] : ['compose'];

let servicesRaw = execCommand(dockerCmd, [...dockerArgs, 'config', '--services'], true);
if (!servicesRaw) {
    servicesRaw = execCommand(isWindows ? 'wsl' : 'docker-compose', isWindows ? ['docker-compose', 'config', '--services'] : ['config', '--services'], true);
}

let containers = [];
if (servicesRaw) {
    containers = servicesRaw.trim().split('\n').filter(Boolean).sort();
} else {
    // Ultimate fallback: manually parse docker-compose.yml
    try {
        let yamlContent = fs.readFileSync('docker-compose.yml', 'utf-8');
        let lines = yamlContent.split('\n');
        let inServices = false;
        for (let line of lines) {
            if (line.startsWith('services:')) {
                inServices = true;
                continue;
            }
            if (inServices) {
                if (line.match(/^[a-zA-Z]/)) break; // Next top-level block
                let match = line.match(/^  ([a-zA-Z0-9_-]+):/);
                if (match) {
                    containers.push(match[1]);
                }
            }
        }
        containers.sort();
    } catch (e) {
        console.error('Failed to read docker-compose.yml services. Are you in the infrastructure directory?');
        process.exit(1);
    }
    
    if (containers.length === 0) {
        console.error('Failed to parse any services from docker-compose.yml. Are you in the infrastructure directory?');
        process.exit(1);
    }
}

console.log('=== Ecosystem Status Check ===\n');

console.log(`Container Status (${containers.length} services):`);
console.log('----------------------------------------');
let allUp = true;

const psOutput = execCommand(dockerCmd, isWindows ? ['docker', 'ps', '-a', '--format', '{{.Names}},{{.State}},{{.Status}}'] : ['ps', '-a', '--format', '{{.Names}},{{.State}},{{.Status}}'], false);
if (!psOutput) {
    console.error(`Error: Failed to execute docker ps. Docker daemon might not be running.`);
    process.exit(1);
}

const runningContainers = psOutput.trim().split('\n').reduce((acc, line) => {
    const [name, state, status] = line.split(',');
    if (name) {
        acc[name] = { state, status };
    }
    return acc;
}, {});

for (const name of containers) {
    const info = runningContainers[name];
    if (info) {
        let displayStatus = info.status;
        let icon = '✅';
        if (info.state !== 'running') {
            if (name === 'datadog-unified') {
                icon = '⚠️';
                displayStatus = `Down (${info.state}) - Expected without DD_API_KEY`;
            } else {
                icon = '❌';
                displayStatus = `Down (${info.state})`;
                allUp = false;
            }
        } else if (info.status.includes('unhealthy')) {
            icon = '⚠️';
            allUp = false;
        } else if (info.status.includes('health: starting')) {
            icon = '⏳';
            allUp = false;
        }
        console.log(`${icon} ${name.padEnd(20)} : ${displayStatus}`);
    } else {
        if (name === 'datadog-unified') {
            console.log(`⚠️ ${name.padEnd(20)} : Not Found (Expected without DD_API_KEY)`);
        } else {
            console.log(`❌ ${name.padEnd(20)} : Not Found / Offline`);
            allUp = false;
        }
    }
}

console.log('\n========================================');
if (allUp) {
    console.log('🎉 Ecosystem is fully healthy and ready for testing!');
} else {
    console.log('⚠️ Ecosystem has issues. Please resolve them before testing.');
    process.exit(1);
}
