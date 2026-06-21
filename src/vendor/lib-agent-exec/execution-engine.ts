import { ProcessController } from './process-controller.js';
import { ExecPayload } from './schema.js';

export function executeCommand(
  payload: ExecPayload,
  cwd: string,
  cmd: string,
  args: string[],
  env: Record<string, string | undefined>,
  tempScriptPath?: string | null
) {
  const controller = new ProcessController(
    payload,
    cwd,
    cmd,
    args,
    env,
    tempScriptPath || null
  );
  
  controller.start();
}
