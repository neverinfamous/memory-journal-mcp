// @ts-nocheck
import { ExecPayload } from '../schema.js';

export interface ExecutionContext {
  cmdBasename: string;
  args: string[];
  envOverrides: Record<string, string>;
  payload: ExecPayload;
}

export type Interceptor = (ctx: ExecutionContext) => void;

export const AGENT_NATIVE_TOOLS = [
  'grep_search', 'view_file', 'list_dir', 'replace_file_content',
  'multi_replace_file_content', 'read_url_content', 'run_command',
  'write_to_file', 'find_by_name', 'manage_task', 'ask_question',
  'invoke_subagent', 'define_subagent', 'manage_subagents', 'schedule',
  'read_resource', 'list_resources', 'call_mcp_tool', 'generate_image',
  'read_browser_page'
] as const;

export const ECOSYSTEM_MCP_TOOLS = [
  'sqlite_execute_code', 'mysql_execute_code', 'mj_execute_code',
  'server_info', 'server_health', 'list_adapters', 'update_configuration'
] as const;
