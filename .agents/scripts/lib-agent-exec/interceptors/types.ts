import { ExecPayload } from '../schema.js';

export interface ExecutionContext {
  cmdBasename: string;
  args: string[];
  envOverrides: Record<string, string>;
  payload: ExecPayload;
}

export type Interceptor = (ctx: ExecutionContext) => void;
