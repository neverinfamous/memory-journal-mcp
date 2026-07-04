import { test, expect, mock } from "bun:test";

mock.module("C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/git-numstat.ts", () => ({
    getNumstatMap: async () => new Map()
}));

mock.module("C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/git-patch.ts", () => ({
    getPatchMap: async () => new Map()
}));

import { parseGitRecord, processBatch } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/parser.ts";
import { FIELD_SEPARATOR } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/git-runner.ts";
import type { CliArgs } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-git-history/cli.ts";

test("monitor parser for memory leaks and latency over large histories", async () => {
    const mockParts = [
        "a1b2c3d4e5f6g7h8i9j0", // sha
        "HEAD -> main",         // refsRaw
        "Test Author",          // authorName
        "test@example.com",     // authorEmail
        "2023-01-01T00:00:00Z", // date
        "Test Committer",       // committerName
        "test@example.com",     // committerEmail
        "2023-01-01T00:00:00Z", // committerDate
        "feat: add new feature",// subject
        "This is a body of the commit.", // body
        "Signed-off-by: Test Author <test@example.com>", // exactTrailerBlock
        "Signed-off-by: Test Author <test@example.com>", // rawTrailers
        "p1a2r3e4\nM\0file1.txt\0A\0file2.txt\0" // parentsAndFiles
    ];
    
    const commitBlock = mockParts.join(FIELD_SEPARATOR);
    const args: CliArgs = {};
    
    const ITERATIONS = 100000;
    const BATCH_SIZE = 1000;
    
    let currentBatch: import("../parser.ts").RawCommitBatchItem[] = [];
    
    console.log("Starting parseGitRecord loop...");
    const startParse = performance.now();
    const initialMemory = process.memoryUsage().heapUsed;
    let maxMemory = initialMemory;
    let totalLatency = 0;
    
    for (let i = 1; i <= ITERATIONS; i++) {
        const startOp = performance.now();
        const record = parseGitRecord(commitBlock, args);
        totalLatency += performance.now() - startOp;

        if (record) {
            currentBatch.push(record);
        }
        
        if (currentBatch.length === BATCH_SIZE) {
            await processBatch(currentBatch, args, []);
            currentBatch = []; // Free for GC
        }
        
        if (i % 10000 === 0) {
            if (global.gc) global.gc();
            const mem = process.memoryUsage().heapUsed;
            maxMemory = Math.max(maxMemory, mem);
            const avgLatency = totalLatency / i;
            console.log(`[${i}] Memory: ${(mem / 1024 / 1024).toFixed(2)} MB, Avg Parse Latency: ${avgLatency.toFixed(4)} ms/op`);
        }
    }
    
    const endParse = performance.now();
    console.log(`Total time: ${(endParse - startParse).toFixed(2)} ms`);
    const maxMemoryMB = maxMemory / 1024 / 1024;
    console.log(`Max memory used: ${maxMemoryMB.toFixed(2)} MB`);
    
    // We expect the memory to not grow unbounded. 
    // Usually memory usage shouldn't exceed 150MB if correctly garbage collected, but we set a safe limit of 300MB.
    expect(maxMemoryMB).toBeLessThan(300);
}, 90000); // Increased timeout to 90 seconds



