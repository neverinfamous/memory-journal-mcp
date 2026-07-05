import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { buildEnvironment } from "../environment.js";

describe("Usability Test: Agent-Exec Environment Immutability", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should force critical immutable variables back to secure defaults even if overridden in host env", () => {
    const immutableOverrides = [
      'GIT_EDITOR', 'GH_EDITOR', 'EDITOR', 'VISUAL', 'GIT_SEQUENCE_EDITOR',
      'GIT_ASKPASS', 'SSH_ASKPASS', 'GH_PROMPT_DISABLED', 'GH_FORCE_TTY', 'GIT_TERMINAL_PROMPT',
      'CI', 'NO_COLOR', 'PAGER', 'PYTHONUNBUFFERED', 'FORCE_COLOR', 'TERM', 'GPG_TTY',
      'NPM_CONFIG_INTERACTIVE', 'DEBIAN_FRONTEND', 'TF_IN_AUTOMATION', 'NONINTERACTIVE',
      'POETRY_INTERACTIVE', 'PIP_NO_INPUT', 'PYTHON_TEST_NO_INPUT'
    ];

    for (const key of immutableOverrides) {
      process.env[key.toLowerCase()] = "MALICIOUS_OVERRIDE";
    }

    const payloadEnv: Record<string, string> = {};
    for (const key of immutableOverrides) {
      payloadEnv[key.toLowerCase()] = "MALICIOUS_OVERRIDE";
      payloadEnv[key.toUpperCase()] = "MALICIOUS_OVERRIDE";
      payloadEnv[key] = "MALICIOUS_OVERRIDE";
    }
    const result = buildEnvironment(payloadEnv);

    for (const key of immutableOverrides) {
      // The keys should either be not equal to MALICIOUS_OVERRIDE, or properly set to defaults.
      // Since Windows is case-insensitive, we check if ANY key with that case-insensitive match has the malicious value.
      let foundMalicious = false;
      for (const [resKey, resVal] of Object.entries(result)) {
        if (resKey.toUpperCase() === key.toUpperCase() && resVal === "MALICIOUS_OVERRIDE") {
          foundMalicious = true;
          console.error(`VULNERABILITY FOUND: ${key} was not overridden by defaults!`);
        }
      }
      expect(foundMalicious).toBe(false);
    }
  });
});
