import path from 'node:path';
import { ExecPayload } from './schema.js';
import { recordAgentIssue } from './utils.js';


export const DEFAULT_ENV_VARS: Record<string, string> = {
    CI: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_EDITOR: 'true',
    GIT_SEQUENCE_EDITOR: 'true',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
    GIT_OPTIONAL_LOCKS: '0',
    GH_PROMPT_DISABLED: '1',
    GH_FORCE_TTY: '0',
    GH_EDITOR: 'true',
    GH_PAGER: '',
    GH_NO_UPDATE_NOTIFIER: '1',
    GIT_PAGER: process.platform === 'win32' ? '' : 'cat',
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'core.pager',
    GIT_CONFIG_VALUE_0: '',
    GIT_CONFIG_KEY_1: 'core.editor',
    GIT_CONFIG_VALUE_1: 'true',
    GIT_CONFIG_KEY_2: 'color.ui',
    GIT_CONFIG_VALUE_2: 'never',
    GIT_CONFIG_KEY_3: 'init.defaultBranch',
    GIT_CONFIG_VALUE_3: 'main',
    PAGER: '',
    BUILDKIT_PROGRESS: 'plain',
    BUILDKIT_COLORS: '0',
    DOCKER_BUILDKIT: '1',
    DOCKER_CLI_HINTS: 'false',
    DOCKER_SCAN_SUGGEST: 'false',
    COMPOSE_PROGRESS: 'plain',
    COMPOSE_INTERACTIVE_NO_CLI: '1',
    COMPOSE_ANSI: 'never',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    CLICOLOR: '0',
    CLICOLOR_FORCE: '0',
    TERM: 'dumb',
    PYTHONUNBUFFERED: '1',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    PNPM_UPDATE_NOTIFIER: '0',
    BUN_NO_UPDATE_NOTIFIER: '1',
    NO_UPDATE_NOTIFIER: '1',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_PROGRESS: 'false',
    NPM_CONFIG_YES: 'true',
    npm_config_yes: 'true',
    NPM_CONFIG_COLOR: 'false',
    NPM_CONFIG_INTERACTIVE: 'false',
    YARN_NON_INTERACTIVE: '1',
    NPM_CONFIG_AUDIT: 'false',
    GCM_INTERACTIVE: 'false',
    GCM_CREDENTIAL_STORE: 'cache',
    GCM_AUTHORITY: 'basic',
    GIT_ASKPASS: 'agent-exec-blocked',
    SSH_ASKPASS: 'agent-exec-blocked',
    SSH_ASKPASS_REQUIRE: 'force',
    NODE_NO_WARNINGS: '1',
    npm_config_foreground_scripts: 'false',
    NODE_OPTIONS: '--no-warnings --disable-warning=ExperimentalWarning',
    DEBIAN_FRONTEND: 'noninteractive',
    EDITOR: 'true',
    VISUAL: 'true',
    NPM_CONFIG_LOGLEVEL: 'warn',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONFAULTHANDLER: '1',
    PYTHON_KEYRING_BACKEND: 'keyring.backends.null.Keyring',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PIP_NO_COLOR: '1',
    PIP_NO_INPUT: '1',
    PYTHON_TEST_NO_INPUT: '1',
    DOCKER_CONTENT_TRUST_PASS_OS_ENV: '1',
    WRANGLER_SEND_METRICS: 'false',
    ASTRO_TELEMETRY_DISABLED: '1',
    COLUMNS: '1000',
    LINES: '1000',
    AWS_PAGER: '',
    BAT_PAGER: '',
    SYSTEMD_PAGER: '',
    KUBECTL_PAGER: '',
    DELTA_PAGER: '',
    MANPAGER: '',
    FORCE_INTERACTIVE: '0',
    GIT_MERGE_AUTOEDIT: 'no',
    GIT_CORE_PAGER: '',
    PNPM_INTERACTIVE: 'false',
    COREPACK_ENABLE_STRICT: '0',
    PNPM_DLX_YES: '1',
    TF_IN_AUTOMATION: '1',
    CONTINUOUS_INTEGRATION: 'true',
    NONINTERACTIVE: '1',
    CLI_NOPROMPT: '1',
    POETRY_INTERACTIVE: '0',
    CARGO_TERM_COLOR: 'never',
    GPG_TTY: '',
    VITE_CJS_IGNORE_WARNING: 'true',
    NEXT_TELEMETRY_DISABLED: '1',
    NUXT_TELEMETRY_DISABLED: '1',
    GATSBY_TELEMETRY_DISABLED: '1',
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    DOTNET_NOLOGO: '1',
    WSLENV: '',
    CHOCOLATEY_YEP: '1',
    DO_NOT_TRACK: '1',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    HOMEBREW_NO_INTERACTIVE: '1',
    DENO_NO_PROMPT: '1',
    UV_NO_PROGRESS: '1',
    POWERSHELL_TELEMETRY_OPTOUT: '1',
    GOTELEMETRY: 'off',
    STORYBOOK_DISABLE_TELEMETRY: '1',
    TURBO_TELEMETRY_DISABLED: '1',
    AZURE_CORE_COLLECT_TELEMETRY: '0'
};

export function buildEnvironment(payloadEnv: ExecPayload['env']) {
  const env: Record<string, string | undefined> = {};
  const isWin = process.platform === 'win32';
  const upperKeysMap = new Map<string, string>();

  const findKey = (key: string) => {
    if (!isWin) return key;
    const upper = key.toUpperCase();
    return upperKeysMap.get(upper) || key;
  };

  const setEnv = (key: string, value: string | undefined) => {
    const actualKey = findKey(key);
    env[actualKey] = value;
    if (isWin) upperKeysMap.set(actualKey.toUpperCase(), actualKey);
    return actualKey;
  };
  
  for (const [key, value] of Object.entries(process.env)) {
    // 🛠️ AUTONOMOUS HEALING: Strip the AntiGravity dummy token from the host environment
    // so that native tools like `git` and `gh` fall back to the user's keychain instead of failing.
    if (key.toUpperCase() === 'GITHUB_TOKEN' && value === 'github_pat_antigravitydummytoken') {
      continue;
    }
    setEnv(key, value);
  }

  for (const [key, value] of Object.entries(DEFAULT_ENV_VARS)) {
    setEnv(key, value);
  }


  const immutableOverrides = new Set([
    'GIT_EDITOR', 'GH_EDITOR', 'EDITOR', 'VISUAL', 'GIT_SEQUENCE_EDITOR',
    'GIT_ASKPASS', 'SSH_ASKPASS', 'GH_PROMPT_DISABLED', 'GH_FORCE_TTY', 'GIT_TERMINAL_PROMPT',
    'CI', 'NO_COLOR', 'PAGER', 'PYTHONUNBUFFERED', 'FORCE_COLOR', 'TERM', 'GPG_TTY',
    'NPM_CONFIG_INTERACTIVE', 'DEBIAN_FRONTEND', 'TF_IN_AUTOMATION', 'NONINTERACTIVE',
    'POETRY_INTERACTIVE', 'PIP_NO_INPUT', 'PYTHON_TEST_NO_INPUT'
  ]);

  if (payloadEnv) {
    for (const [key, value] of Object.entries(payloadEnv)) {
      if (immutableOverrides.has(key.toUpperCase())) {
        recordAgentIssue('IMMUTABLE_ENV_OVERRIDE', `Agent attempted to override immutable env var: ${key}`, { key, value });
        console.error(`\n   💡 AGENT HINT: The environment variable '${key}' is immutable to prevent hanging and cannot be overridden.`);
        continue;
      }

      const valStr = String(value);
      const actualKey = findKey(key);
      const isNodeOpts = isWin ? actualKey.toUpperCase() === 'NODE_OPTIONS' : actualKey === 'NODE_OPTIONS';
      const isPath = isWin ? actualKey.toUpperCase() === 'PATH' : actualKey === 'PATH';

      if (isNodeOpts && env[actualKey] && valStr) {
        setEnv(actualKey, `${env[actualKey]} ${valStr}`);
      } else if (isPath && env[actualKey] && valStr) {
        setEnv(actualKey, `${valStr}${path.delimiter}${env[actualKey]}`);
      } else {
        setEnv(actualKey, valStr);
      }
    }
  }

  return env;
}
