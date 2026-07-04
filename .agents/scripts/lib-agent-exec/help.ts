import pc from 'picocolors';

const manualData = {
  description: "Agent Execution Bridge - deterministic execution substrate for AI agents.",
  rules: {
    pipeline: "PowerShell 5.1 does NOT support && or ||. You MUST leverage WSL2 execution by using 'target': 'wsl2' in your JSON payload to use POSIX shell features.",
    scratchWorkspace: "STRICT SCRATCH FILE POLICY: ALWAYS write temporary files exclusively to <appDataDir>\\brain\\<conversation-id>\\scratch\\. NEVER leave payload JSONs in the workspace.",
    interactiveBypasses: [
      "Per-Command Flag: Append --agent-bypass to any command",
      "Native Passthrough Alias: Prepend 'native' to any command",
      "Session-Wide Toggle: Disable-AgentExec / Enable-AgentExec"
    ],
    powershellHallucinations: [
      "curl & wget: PowerShell aliases these to Invoke-WebRequest. Use native read_url_content tool instead.",
      "cat, ls, grep: Do NOT use these aliases. Use view_file, list_dir, grep_search tools.",
      "node -e: Fails often due to quoting bugs. Use an 'eval' payload with 'interpreter': 'node'.",
      "gh run view --log: Exits 1 if still running. Use 'schedule' tool, do not poll in a loop."
    ]
  },
  baseOptions: {
    "I/O & Environment": {
      cwd: "Optional working directory.",
      env: "Optional environment variables object.",
      stdin: "Optional string to write to standard input.",
      stdoutFile: "Optional path to redirect stdout.",
      stderrFile: "Optional path to redirect stderr."
    },
    "Execution Limits": {
      timeoutMs: "Maximum execution time in milliseconds.",
      stallTimeoutMs: "Maximum stall time (no output) in milliseconds.",
      maxBuffer: "Maximum stdout/stderr buffer size in bytes.",
      truncateOutputLength: "Length to truncate output to if it exceeds limits."
    },
    "Integrations": {
      integrationContext: "Optional context object for template substitution.",
      templateOverride: "Optional template string for overriding args/env.",
      expectJsonEnvelope: "If true, actively parses the last line of stdout as a JSON envelope.",
      target: "Execution target platform: 'windows' or 'wsl2'."
    },
    "Webhooks": {
      webhookPayloadTemplate: "Template string for the webhook body.",
      webhookMethod: "HTTP method for webhook (default: POST).",
      webhookHeaders: "Optional headers for webhook request.",
      onSuccess: "Webhook URL to call on successful exit.",
      onFailure: "Webhook URL to call on failure or timeout."
    }
  },
  payloadSchemas: {
    command: { type: "command", command: "git", args: ["log", "-n", "5"] },
    script: { type: "script", scriptPath: "C:\\path\\to\\script.ts", args: ["--flag", "value"] },
    eval: { type: "eval", code: "console.log('Hello');", interpreter: "bun" }
  }
};

export function showUsageError(message: string, asJson?: boolean): never {
  if (asJson) {
    console.log(JSON.stringify({ status: "error", message }));
    process.exit(1);
  }
  console.error(pc.red(`❌ Error: ${message}`));
  console.error(`Usage: ${pc.bold('bun agent-exec.ts [options] <payload.json>')}`);
  console.error(`Run ${pc.bold('bun agent-exec.ts --help')} for the comprehensive CLI manual.`);
  process.exit(1);
}

export function showHelp(asJson: boolean): never {
  if (asJson) {
    console.log(JSON.stringify({
      status: "success",
      data: manualData
    }, null, 2));
    process.exit(0);
  }

  console.error(pc.bold(pc.bgBlue(pc.white(' 🚀 Agent Execution Bridge (lib-agent-exec) '))));
  console.error(pc.dim(`${manualData.description}\n`));

  console.error(pc.bold('Usage:'));
  console.error(`  bun agent-exec.ts [options] <payload.json>\n`);

  console.error(pc.bold('Options:'));
  console.error(`  --interceptors <path>    Path to a custom interceptor module`);
  console.error(`  --payloadPath <path>     Explicit path to the payload JSON file`);
  console.error(`  -h, --help               Show this manual`);
  console.error(`  --json                   Output this manual as structured JSON\n`);

  console.error(pc.bold(pc.yellow('⚠️ The `&&` Pipeline Chaining Rule')));
  console.error(manualData.rules.pipeline + '\n');

  console.error(pc.bold(pc.red('🧹 Scratch Workspace Protocol')));
  console.error(manualData.rules.scratchWorkspace + '\n');

  console.error(pc.bold(pc.cyan('🚪 Interactive Mode Bypasses')));
  manualData.rules.interactiveBypasses.forEach(b => console.error(`  - ${b}`));
  console.error();

  console.error(pc.bold(pc.bgMagenta(pc.white(' 🤖 AI AGENT INSTRUCTIONS: Anti-Hallucination Guardrails '))));
  manualData.rules.powershellHallucinations.forEach(h => console.error(`  - ${h}`));
  console.error();

  console.error(pc.bold(pc.green('Base Options (Available in ALL payloads)')));
  for (const [category, options] of Object.entries(manualData.baseOptions)) {
    console.error(`  ${pc.underline(category)}:`);
    for (const [key, desc] of Object.entries(options)) {
      console.error(`    ${pc.cyan(key)}: ${pc.dim(desc)}`);
    }
  }
  console.error();

  console.error(pc.bold(pc.green('Payload Schemas (Examples)')));
  for (const [key, val] of Object.entries(manualData.payloadSchemas)) {
    console.error(`  ${pc.underline(key)} Payload:`);
    console.error(pc.dim(JSON.stringify(val, null, 2).replace(/^/gm, '    ')));
    console.error();
  }

  process.exit(0);
}
