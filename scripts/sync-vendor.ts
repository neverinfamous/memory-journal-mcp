import { parseArgs } from 'util';
import { readFileSync, writeFileSync, cpSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { execSync } from 'child_process';

const args = parseArgs({
  options: {
    lib: { type: 'string' },
    'adamic-root': { type: 'string', default: '../adamic' },
    test: { type: 'boolean', default: false },
  },
});

const vendorJsonPath = join(process.cwd(), 'src', 'vendor', 'VENDOR.json');
const vendorData = JSON.parse(readFileSync(vendorJsonPath, 'utf8'));

const adamicRoot = resolve(process.cwd(), args.values['adamic-root'] as string);

try {
  // Check if adamicRoot exists
  const headSha = execSync('git rev-parse HEAD', { cwd: adamicRoot, encoding: 'utf8' }).trim();

  let libsToSync = Object.keys(vendorData.libs);
  if (args.values.lib) {
    if (!libsToSync.includes(args.values.lib as string)) {
      console.error(`Library ${args.values.lib} not found in VENDOR.json`);
      process.exit(1);
    }
    libsToSync = [args.values.lib as string];
  }

  for (const lib of libsToSync) {
    const libConfig = vendorData.libs[lib];
    console.log(`\nSyncing ${lib}...`);
    
    const sourceDir = join(adamicRoot, libConfig.source);
    const destDir = join(process.cwd(), 'src', 'vendor', lib);
    
    mkdirSync(destDir, { recursive: true });
    
    let syncedCount = 0;
    for (const file of libConfig.files) {
      const srcFile = join(sourceDir, file);
      const destFile = join(destDir, file);
      
      mkdirSync(dirname(destFile), { recursive: true });
      
      if (file.endsWith('.ts')) {
        const content = readFileSync(srcFile, 'utf8');
        writeFileSync(destFile, '// @ts-nocheck\n' + content);
      } else {
        cpSync(srcFile, destFile);
      }
      
      syncedCount++;
    }
    
    console.log(`Synced ${syncedCount} files from ${libConfig.source}`);
    
    libConfig.syncedAt = new Date().toISOString();
    libConfig.syncedFromCommit = headSha;
  }

  writeFileSync(vendorJsonPath, JSON.stringify(vendorData, null, 2) + '\n');
  console.log('\nUpdated VENDOR.json');

  if (args.values.test) {
    console.log('\nRunning tests...');
    execSync('bun test src/vendor/ --pass-with-no-tests', { stdio: 'inherit' });
  }
} catch (err: any) {
  console.error('\nSync failed:', err.message);
  process.exit(1);
}
