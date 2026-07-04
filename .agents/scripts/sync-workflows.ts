import { cp, mkdir, rm, readdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

const DESKTOP_DIR = "C:\\Users\\chris\\Desktop";
const SOURCE_DIR = join(DESKTOP_DIR, "adamic", ".agents");

const TARGET_REPOS = [
  "adamic-blog",
  "wiki-search-worker",
  "memory-journal-mcp",
  "mysql-mcp",
  "db-mcp",
  "postgres-mcp",
  "d1-manager",
  "do-manager",
  "kv-manager",
  "R2-Manager-Worker",
  "container-manager",
  "worker-manager",
];

async function syncWorkflows() {
  console.log(`Starting agent ecosystem sync from: ${SOURCE_DIR}`);

  if (!existsSync(SOURCE_DIR)) {
    console.error(`Source directory does not exist: ${SOURCE_DIR}`);
    process.exit(1);
  }

  for (const repo of TARGET_REPOS) {
    const targetRepoDir = join(DESKTOP_DIR, repo);
    
    // Skip if the repo doesn't exist
    if (!existsSync(targetRepoDir)) {
      console.warn(`Skipping ${repo} - repository directory does not exist: ${targetRepoDir}`);
      continue;
    }

    const targetPath = join(targetRepoDir, ".agents");
    
    console.log(`Syncing agent ecosystem to: ${repo}`);
    try {
      if (existsSync(targetPath)) {
        await rm(targetPath, { recursive: true, force: true });
      }
      await mkdir(targetPath, { recursive: true });

      await cp(SOURCE_DIR, targetPath, { recursive: true, force: true });

      async function makeReadOnly(dir: string) {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            await makeReadOnly(fullPath);
          } else {
            await chmod(fullPath, 0o444);
          }
        }
      }
      await makeReadOnly(targetPath);
    } catch (error) {
      console.error(`Failed to sync to ${repo}:`, error);
    }
  }

  console.log("Agent ecosystem sync completed successfully.");
}

syncWorkflows().catch(console.error);
