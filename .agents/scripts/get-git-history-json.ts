import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { inspect } from 'node:util';
import type { z } from 'zod';
import { parseArguments, showHelpAndExit, type CliArgs } from './lib-git-history/cli.js';
import { getGitTagRange, buildGitBaseArgs, streamGitRecords, cleanupProcesses, RECORD_SEPARATOR, FIELD_SEPARATOR } from './lib-git-history/git-runner.js';
import { parseGitRecord, processBatch, type RawCommitBatchItem } from './lib-git-history/parser.js';
import type { entrySchema } from './lib-git-history/schema.js';
import { buildMarkdownChangelog } from './lib-git-history/formatters/markdown.js';
import { buildSlackChangelog } from './lib-git-history/formatters/slack.js';
import { insertCommits, queryCommits } from './lib-git-history/cache.js';

process.on('SIGINT', () => { cleanupProcesses(); process.exit(130); });
process.on('SIGTERM', () => { cleanupProcesses(); process.exit(143); });

process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
    process.exit(0);
  }
});

async function* streamGitHistory(args: CliArgs, targetRange: string | undefined, headSha: string, explicitLimit?: number): AsyncGenerator<z.infer<typeof entrySchema>> {
  const limit = explicitLimit;
  let yieldedCount = 0;

  const baseArgs = buildGitBaseArgs(args, targetRange);
  const lockedArgs = baseArgs.map((arg: string) => {
    if (arg === 'HEAD') return headSha;
    if (arg.endsWith('..HEAD')) return arg.slice(0, -4) + headSha;
    return arg;
  });

  const formattingFlags: string[] = [];
  let inPath = false;
  for (const a of lockedArgs) {
    if (a === '--') {
      inPath = true;
      formattingFlags.push(a);
    } else if (inPath) {
      formattingFlags.push(a);
    } else if (a === '--full-diff' || a.startsWith('--diff-filter=') || a.startsWith('-G') || a.startsWith('-U') || a === '-i' || ['--cc', '--no-merges', '--first-parent', '-c', '-m', '--pickaxe-all', '-E', '--extended-regexp'].includes(a)) {
      formattingFlags.push(a);
    }
  }

  const mainArgs = [
    '-c', 'core.quotePath=false',
    ...(args.mailmap ? ['-c', `mailmap.file=${args.mailmap}`] : []),
    'log',
    '-z',
    ...(args['no-body'] ? [] : ['--name-status']),
    `--pretty=format:${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%D${FIELD_SEPARATOR}${args.mailmap ? '%aN' : '%an'}${FIELD_SEPARATOR}${args.mailmap ? '%aE' : '%ae'}${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}${args.mailmap ? '%cN' : '%cn'}${FIELD_SEPARATOR}${args.mailmap ? '%cE' : '%ce'}${FIELD_SEPARATOR}%cI${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}${args['no-body'] ? '' : '%b'}${FIELD_SEPARATOR}${args['no-body'] ? '' : '%(trailers)'}${FIELD_SEPARATOR}${args['no-body'] ? '' : '%(trailers:separator=%x1C)'}${FIELD_SEPARATOR}%P`,
    ...(args.mailmap ? ['--use-mailmap'] : []),
    ...lockedArgs
  ];

  const parsedMaxBody = args['max-body-length'];
  const maxBody = (parsedMaxBody !== undefined && !Number.isNaN(parsedMaxBody) && parsedMaxBody >= 0) ? parsedMaxBody : 100 * 1024 * 1024;
  const maxBufferLimit = maxBody + (50 * 1024 * 1024);

  let batch: RawCommitBatchItem[] = [];
  let lastSeenSha: string | null = null;
  let lastWasCached = false;

  for await (const commitBlock of streamGitRecords(mainArgs, process.cwd(), maxBufferLimit)) {
    const record = parseGitRecord(commitBlock, args);
    if (!record) continue;

    if (record.sha === lastSeenSha) {
      if (!lastWasCached && batch.length > 0 && batch[batch.length - 1].sha === record.sha) {
        batch[batch.length - 1].rawFiles.push(...record.rawFiles);
      }
      continue;
    }

    lastSeenSha = record.sha;
    lastWasCached = false;
    if (args.cache) {
      const cached = queryCommits({ commit: record.sha });
      if (cached.length > 0) {
        if (args['issue-tracker']) {
          const tracker = args['issue-tracker'];
          for (const c of cached) {
             if (c.associatedIssues) {
                c.associatedIssues = c.associatedIssues.map(a => {
                  let finalIssue = a.issue;
                  if (finalIssue.startsWith('#')) {
                    finalIssue = tracker + (tracker.endsWith('/') ? '' : '') + finalIssue.slice(1);
                  } else if (!finalIssue.startsWith('http')) {
                    finalIssue = tracker.endsWith('/') ? tracker + finalIssue : tracker + '/' + finalIssue;
                  }
                  return { ...a, issue: finalIssue };
                });
             }
          }
        }
        if (batch.length > 0) {
          const processed = await processBatch(batch, args, formattingFlags);
          if (args.cache) insertCommits(processed);
          for (const p of processed) {
            if (limit !== undefined && yieldedCount >= limit) break;
            yield p;
            yieldedCount++;
          }
          batch = [];
        }
        if (limit !== undefined && yieldedCount >= limit) break;
        yield cached[0];
        yieldedCount++;
        if (limit !== undefined && yieldedCount >= limit) break;
        lastWasCached = true;
        continue;
      }
    }

    batch.push(record);

    const batchSize = limit !== undefined ? Math.min(50, limit - yieldedCount) : 50;

    if (batch.length >= batchSize) {
      const processed = await processBatch(batch, args, formattingFlags);
      if (args.cache) insertCommits(processed);
      for (const p of processed) {
        if (limit !== undefined && yieldedCount >= limit) break;
        yield p;
        yieldedCount++;
      }
      batch = [];
      if (limit !== undefined && yieldedCount >= limit) break;
    }
  }

  if (batch.length > 0 && (limit === undefined || yieldedCount < limit)) {
    const processed = await processBatch(batch, args, formattingFlags);
    if (args.cache) insertCommits(processed);
    for (const p of processed) {
      if (limit !== undefined && yieldedCount >= limit) break;
      yield p;
      yieldedCount++;
    }
  }
}
let outStream: NodeJS.WritableStream = process.stdout;
const asyncWrite = (str: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    try {
      if (!outStream.write(str)) {
        const onDrain = () => {
          outStream.removeListener('error', onError);
          resolve();
        };
        const onError = (err: Error) => {
          outStream.removeListener('drain', onDrain);
          reject(err);
        };
        outStream.once('drain', onDrain);
        outStream.once('error', onError);
      } else {
        resolve();
      }
    } catch (err) {
      reject(err);
    }
  });
};

async function main() {
  try {
    const args = parseArguments();
    if (args.format) args.format = args.format.replace(/^["']|["']$/g, '');
    if (args.help) showHelpAndExit();
    
    if (args['stream-to-file']) {
      const fs = await import('node:fs');
      outStream = fs.createWriteStream(path.resolve(process.cwd(), args['stream-to-file'])) as NodeJS.WritableStream;
    }

    console.error(`💡 AGENT HINT: Executing deterministic git history extraction. For architecture context or troubleshooting, reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/AGENT_README.md)`);

    const tagRangeInfo = getGitTagRange();
    const headSha = tagRangeInfo.headSha;
    const hasContentFilters = args.limit || args.author || args.search || args.grep || args['patch-search'] || args.path || args.since || args.until || args.category || args.type || args.breaking || args.impact || args.confidence || args['diff-filter'] || args.all;
    let targetRange = args.range;
    if (!targetRange && !hasContentFilters) targetRange = tagRangeInfo.range;

    let isTruncated = false;
    let limit = args.limit;

    if (limit === 0) {
      if (args.jsonl) return;
      if (args.format === 'markdown') {
        await asyncWrite('# Changelog\n\n');
        return;
      }
      if (args.format === 'slack') {
        await asyncWrite(JSON.stringify({ blocks: [{ type: 'header', text: { type: 'plain_text', text: 'Changelog', emoji: true } }] }, null, 2) + '\n');
        return;
      }
      if (args.format && args.format !== 'json') {
        return; // Empty for custom formats
      }
      if (args.format === 'json') {
        await asyncWrite('[\n]\n');
      } else {
        await asyncWrite('{\n  "commits": []\n}\n');
      }
      return;
    }

    const hasTsFilters = args.category || args.type || args.breaking || args['changelog-only'] || args.impact || args.confidence;
    const hasNativeFilters = args.author || args.search || args.grep || args['patch-search'] || args.path || args.since || args.until || args['diff-filter'];
    if ((!targetRange || targetRange === 'HEAD') && args.limit === undefined && !args.all && (!args.format || args.format === 'json') && !hasTsFilters && !hasNativeFilters) {
      isTruncated = true;
      limit = 100;
    }

    if (args.format && args.format !== 'json') {
      const versionMap = new Map<string, Map<string, z.infer<typeof entrySchema>[]>>();
      let currentVersion = 'Unreleased';
      let repoPath = path.basename(process.cwd());
      let repoHost = 'github.com';
      try {
        const originUrl = execFileSync('git', ['--no-pager', 'config', '--get', 'remote.origin.url'], { encoding: 'utf-8', stdio: 'pipe', timeout: 5000, windowsHide: true }).trim();
        const match = originUrl.match(/(github\.com|gitlab\.com|bitbucket\.org)[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
        if (match) {
           repoHost = match[1];
           repoPath = match[2];
        }
      } catch { /* ignore */ }
      const streamArgs = args['changelog-only'] ? { ...args, 'changelog-only': false } as typeof args : args;
      for await (const entry of streamGitHistory(streamArgs, targetRange, headSha, limit)) {
        if (entry.tags && entry.tags.length > 0) {
           currentVersion = entry.tags[0];
        }

        if (args['changelog-only']) {
          const type = entry.type || '';
          const isBreaking = entry.isBreaking || false;
          const entriesParsed = entry.metadata?.entry || [];
          if (entriesParsed.length === 0 && !(['feat', 'fix', 'perf', 'revert'].includes(type) || isBreaking)) {
            continue;
          }
        }

        delete entry.body;
        delete entry.files;
        delete entry.patch;

        let categories = entry.metadata?.category;
        if (!categories || categories.length === 0) {
          categories = entry.type ? [entry.type.charAt(0).toUpperCase() + entry.type.slice(1)] : ['Uncategorized'];
        }

        if (!versionMap.has(currentVersion)) versionMap.set(currentVersion, new Map());
        const categoryMap = versionMap.get(currentVersion)!;

        for (const cat of categories) {
          if (!categoryMap.has(cat)) categoryMap.set(cat, []);
          categoryMap.get(cat)!.push(entry);
        }
      }
      
      let outputChangelog = '';
      if (args.format === 'slack') {
        outputChangelog = buildSlackChangelog(versionMap, repoHost, repoPath, args);
      } else if (args.format === 'markdown') {
        outputChangelog = buildMarkdownChangelog(versionMap, repoHost, repoPath, args);
      } else {
        const path = await import('node:path');
        const customFormatPath = path.resolve(args.format!);
        
        if (customFormatPath.endsWith('.ts') || customFormatPath.endsWith('.js') || customFormatPath.endsWith('.mjs') || customFormatPath.endsWith('.cjs')) {
          const { pathToFileURL } = await import('node:url');
          const customFormatter = await import(pathToFileURL(customFormatPath).href);
          if (typeof customFormatter.default === 'function') {
            outputChangelog = await customFormatter.default(versionMap, repoHost, repoPath, args);
          } else if (typeof customFormatter.format === 'function') {
            outputChangelog = await customFormatter.format(versionMap, repoHost, repoPath, args);
          } else {
            throw new Error('Custom formatter must export a default function or a format function');
          }
        } else {
          const fs = await import('node:fs/promises');
          const Handlebars = (await import('handlebars')).default || await import('handlebars');
          const templateStr = await fs.readFile(customFormatPath, 'utf8');
          const template = Handlebars.compile(templateStr);
          
          const commits: z.infer<typeof entrySchema>[] = [];
          for (const categoryMap of versionMap.values()) {
            for (const entries of categoryMap.values()) {
               commits.push(...entries);
            }
          }
          
          outputChangelog = template({
            versionMap: Object.fromEntries(
              Array.from(versionMap.entries()).map(([k, v]) => [
                k, 
                Object.fromEntries(Array.from(v.entries()))
              ])
            ),
            commits,
            repoHost,
            repoPath,
            args
          });
        }
      }
      await asyncWrite(outputChangelog);
    } else if (args.jsonl) {
      for await (const entry of streamGitHistory(args, targetRange, headSha, limit)) {
        if (args['no-body']) {
          delete entry.body;
          delete entry.patch;
          delete entry.files;
          delete entry.fileCount;
          delete entry.totalInsertions;
          delete entry.totalDeletions;
          delete entry.isFilesTruncated;
          delete entry.metadata;
          delete entry.trailersObj;

          delete entry.references;
          delete entry.coAuthors;
          delete entry.reviewers;
          delete entry.size;
        }

        if (args.summary) {
          const summaryEntry: Record<string, unknown> = { ...entry };
          delete summaryEntry.body;
          delete summaryEntry.patch;
          delete summaryEntry.files;
          await asyncWrite(JSON.stringify(summaryEntry) + '\n');
        } else if (args.stats) {
          const statsEntry: Record<string, unknown> = { ...entry };
          delete statsEntry.body;
          delete statsEntry.patch;
          await asyncWrite(JSON.stringify(statsEntry) + '\n');
        } else {
          await asyncWrite(JSON.stringify(entry) + '\n');
        }
      }
    } else {
      const metadata: Record<string, unknown> = {};
      if (isTruncated) {
        metadata.truncated = true;
        metadata.implicitLimit = limit;
      }
      metadata.resolvedRange = targetRange;
      if (!args.range && !hasContentFilters) {
        metadata.isFallbackRange = tagRangeInfo.isFallback;
      }
      if (args['package-version']) {
        try {
          const fs = await import('node:fs/promises');
          const pkgJsonPath = path.resolve(process.cwd(), 'package.json');
          const pkgJsonRaw = await fs.readFile(pkgJsonPath, 'utf8');
          const pkgJson = JSON.parse(pkgJsonRaw);
          if (pkgJson.version) {
            metadata.packageVersion = pkgJson.version;
          }
        } catch {
          // ignore
        }
      }
      const hasMetadata = Object.keys(metadata).length > 0;
      const isFormatJson = args.format === 'json';
      
      if (!isFormatJson) {
        await asyncWrite('{\n');
        if (hasMetadata) {
          await asyncWrite(`  "metadata": ${JSON.stringify(metadata)},\n`);
        }
        await asyncWrite('  "commits": [\n');
      } else {
        await asyncWrite('[\n');
      }
      
      let first = true;
      for await (const entry of streamGitHistory(args, targetRange, headSha, limit)) {
        if (!first) await asyncWrite(',\n');
        first = false;
        if (args['no-body']) {
          delete entry.body;
          delete entry.patch;
          delete entry.files;
          delete entry.fileCount;
          delete entry.totalInsertions;
          delete entry.totalDeletions;
          delete entry.isFilesTruncated;
          delete entry.metadata;
          delete entry.trailersObj;

          delete entry.references;
          delete entry.coAuthors;
          delete entry.reviewers;
          delete entry.size;
        }

        if (args.summary) {
          const summaryEntry: Record<string, unknown> = { ...entry };
          delete summaryEntry.body;
          delete summaryEntry.patch;
          delete summaryEntry.files;
          await asyncWrite('    ' + JSON.stringify(summaryEntry, null, 2).replace(/\n/g, '\n    '));
        } else if (args.stats) {
          const statsEntry: Record<string, unknown> = { ...entry };
          delete statsEntry.body;
          delete statsEntry.patch;
          await asyncWrite('    ' + JSON.stringify(statsEntry, null, 2).replace(/\n/g, '\n    '));
        } else {
          await asyncWrite('    ' + JSON.stringify(entry, null, 2).replace(/\n/g, '\n    '));
        }
      }
      
      if (!isFormatJson) {
        await asyncWrite('\n  ]\n}\n');
      } else {
        await asyncWrite('\n]\n');
      }
    }
    if (outStream !== process.stdout) {
      await new Promise<void>(resolve => outStream.end(() => resolve()));
    }
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error) {
      const code = (error as Record<string, unknown>).code;
      if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED') process.exit(0);
    }
    const isJsonl = process.argv.includes('--jsonl');
    const errMessage = error instanceof Error ? error.stack || error.message : (typeof error === 'object' && error !== null ? inspect(error) : String(error));
    const payload = {
      error: 'Failed to generate git history json',
      message: errMessage,
      instruction: 'If you encounter this error while extracting git history, you MUST autonomously investigate, debug, and heal the git history parser script (get-git-history-json.ts) and its dependencies before continuing. (Reference: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/AGENT_README.md))'
    };
    if (isJsonl) {
      console.error(JSON.stringify(payload));
    } else {
      console.error(JSON.stringify(payload, null, 2));
    }
    process.exit(1);
  }
}

main();
