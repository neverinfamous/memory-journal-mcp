// @ts-nocheck
import { encodeInlinePwshInvocation, guardDirectCommandMode } from './repl-command-guards.js';
import { scanExtractedScriptBody } from './repl-script-scanner.js';
import type { ExecutionContext } from './types.js';

/** [INTENT]: Orchestrate REPL/TUI command blocking, Windows pwsh encoding, and inline body scanning. */
export function replTuiInterceptor(ctx: ExecutionContext): void {
  guardDirectCommandMode(ctx);
  scanExtractedScriptBody(ctx);
  encodeInlinePwshInvocation(ctx);
}
