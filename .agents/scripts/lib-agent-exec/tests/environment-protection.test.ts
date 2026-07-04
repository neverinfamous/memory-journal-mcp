import { expect, test, describe } from 'bun:test';
import { $ } from 'bun';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const AGENT_EXEC_PATH = "C:/Users/chris/Desktop/adamic/.agents/scripts/agent-exec.ts";

describe("Environment Protection Leak", () => {
  test("Child process environment is protected from host environment overrides", async () => {
      const outPath = path.join(os.tmpdir(), `env-test-${Date.now()}.json`);
      const payloadPath = path.join(os.tmpdir(), `payload-${Date.now()}.json`);
      
      try {
        const payload = {
          type: "command",
          command: "node",
          bypassInterceptors: true,
          args: ["-e", `require('fs').writeFileSync('${outPath.replace(/\\/g, '\\\\')}', JSON.stringify(process.env))` ]
        };
        
        fs.writeFileSync(payloadPath, JSON.stringify(payload));
        
        await $`bun ${AGENT_EXEC_PATH} ${payloadPath}`
            .env({ ...process.env, CI: "0", GIT_ASKPASS: "prompt", EDITOR: "vim", NO_COLOR: "0" })
            .nothrow().quiet();
        
        let exists = false;
        for (let i = 0; i < 50; i++) {
            if (fs.existsSync(outPath)) {
                exists = true;
                break;
            }
            await new Promise(r => setTimeout(r, 100));
        }
        
        expect(exists).toBe(true);
        const childEnv = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        
        expect(childEnv.CI).toBe("1");
        expect(childEnv.GIT_ASKPASS).toBe("agent-exec-blocked");
        expect(childEnv.EDITOR).toBe("true");
        expect(childEnv.NO_COLOR).toBe("1");
      } finally {
        if (fs.existsSync(outPath)) if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        if (fs.existsSync(payloadPath)) if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      }
  });

  test("Child process environment is protected from payload environment overrides for all DEFAULT_ENV_VARS", async () => {
      const outPath = path.join(os.tmpdir(), `env-test-payload-${Date.now()}.json`);
      const payloadPath = path.join(os.tmpdir(), `payload-payload-${Date.now()}.json`);
      
      try {
        const payload = {
          type: "command",
          command: "node",
          bypassInterceptors: true,
          env: { GIT_PAGER: "less", WSLENV: "malicious" },
          args: ["-e", `require('fs').writeFileSync('${outPath.replace(/\\/g, '\\\\')}', JSON.stringify(process.env))` ]
        };
        
        fs.writeFileSync(payloadPath, JSON.stringify(payload));
        
        await $`bun ${AGENT_EXEC_PATH} ${payloadPath}`.nothrow().quiet();
        
        let exists = false;
        for (let i = 0; i < 50; i++) {
            if (fs.existsSync(outPath)) {
                exists = true;
                break;
            }
            await new Promise(r => setTimeout(r, 100));
        }
        
        expect(exists).toBe(true);
        const childEnv = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        
        expect(childEnv.GIT_PAGER).toBe(process.platform === 'win32' ? '' : 'cat');
        expect(childEnv.WSLENV).toBe("");
      } finally {
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        if (fs.existsSync(payloadPath)) fs.unlinkSync(payloadPath);
      }
  });
});
