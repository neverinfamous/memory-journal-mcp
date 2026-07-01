// @ts-nocheck
import { ProcessController } from './process-controller.js';
import { ExecPayload } from './schema.js';

export function executeCommand(
  payload: ExecPayload,
  cwd: string,
  cmd: string,
  args: string[],
  env: Record<string, string | undefined>,
  tempScriptPath?: string | null,
  isJson: boolean = false
) {
  if (payload.target === 'wsl2') {
    const hasUuid = args.some(a => typeof a === 'string' && a.startsWith('AGENT_EXEC_WSL_UUID='));
    if (!hasUuid) {
      if (isJson) {
         console.log(JSON.stringify({ status: "error", message: `Execution Error: Target is 'wsl2', but AGENT_EXEC_WSL_UUID was not found in the execution arguments. You MUST route WSL2 execution through 'buildCommand' to prevent zombie processes.` }));
      } else {
         console.error(`❌ Execution Error: Target is 'wsl2', but AGENT_EXEC_WSL_UUID was not found in the execution arguments. You MUST route WSL2 execution through 'buildCommand' to prevent zombie processes.`);
      }
      process.exit(1);
    }
  }
  const controller = new ProcessController(
    payload,
    cwd,
    cmd,
    args,
    env,
    tempScriptPath || null,
    isJson
  );
  
  controller.start();
}
