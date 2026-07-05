import { test, expect, spyOn } from 'bun:test';
import type { ExecPayload } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/schema.ts";
import { replTuiInterceptor } from "C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/interceptors/repl-tui-interceptor.ts";

function setupExitSpy() {
  let exitCode: number | undefined;
  const spy = spyOn(process, "exit").mockImplementation((code?: number | string | null) => {
    exitCode = typeof code === "number" ? code : undefined;
    throw new Error(`process.exit called with code ${code}`);
  });
  return {
    spy,
    getExitCode: () => exitCode,
    restore: () => spy.mockRestore()
  };
}

test("replTuiInterceptor - vim.exe throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "vim.exe",
    args: [],
    envOverrides: {},
    payload: { type: "command", command: "vim.exe", args: [] } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - pwsh wrapper with obfuscated tail -f throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "pwsh",
    args: ["-c", "\"tail -f package.json\""],
    envOverrides: {},
    payload: { type: "command", command: "pwsh", args: ["-c", "\"tail -f package.json\""] } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - eval payload with vim throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "pwsh.exe",
    args: ["-ExecutionPolicy", "Bypass", "-NonInteractive", "-NoProfile", "-File", "agent-eval-123.ps1"],
    envOverrides: {},
    payload: { type: "eval", interpreter: "pwsh", code: "vim" } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - eval payload with sh -c python throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "pwsh.exe",
    args: ["-ExecutionPolicy", "Bypass", "-NonInteractive", "-NoProfile", "-File", "agent-eval-123.ps1"],
    envOverrides: {},
    payload: { type: "eval", interpreter: "pwsh", code: "sh -c 'python'" } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - command payload with sh -c python throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "sh",
    args: ["-c", "python"],
    envOverrides: {},
    payload: { type: "command", command: "sh", args: ["-c", "python"] } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - command payload with tail -f fails properly", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "tail.exe",
    args: ["-f", "package.json"],
    envOverrides: {},
    payload: { type: "command", command: "tail", args: ["-f", "package.json"] } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - eval payload with tail -f fails properly", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "pwsh.exe",
    args: [],
    envOverrides: {},
    payload: { type: "eval", interpreter: "pwsh", code: "tail -f package.json" } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - eval payload with python with spaces fails properly", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "bash",
    args: [],
    envOverrides: {},
    payload: { type: "eval", interpreter: "bash", code: "  python  " } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - eval payload with python -i fails properly", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "bash",
    args: [],
    envOverrides: {},
    payload: { type: "eval", interpreter: "bash", code: "python -i" } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - eval payload with sh -c 'python' blocks properly with unwrapping", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "pwsh.exe",
    args: [],
    envOverrides: {},
    payload: { type: "eval", interpreter: "pwsh", code: "sh -c 'python'" } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - wsl wrapper with vim throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "wsl.exe",
    args: ["--cd", "...", "-e", "env", "vim"],
    envOverrides: {},
    payload: { type: "command", command: "wsl.exe", args: ["--cd", "...", "-e", "env", "vim"] } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - bash with no args throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "bash",
    args: [],
    envOverrides: {},
    payload: { type: "command", command: "bash", args: [] } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - watch command throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "watch",
    args: ["ls"],
    envOverrides: {},
    payload: { type: "command", command: "watch", args: ["ls"] } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - wsl watch ls command throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "wsl",
    args: ["watch", "ls"],
    envOverrides: {},
    payload: { type: "command", command: "wsl", args: ["watch", "ls"] } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - npx node throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "npx",
    args: ["node"],
    envOverrides: {},
    payload: { type: "command", command: "npx", args: ["node"] } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - eval payload with echo 1 | python does not throw", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "bash",
    args: [],
    envOverrides: {},
    payload: { type: "eval", interpreter: "bash", code: "echo 1 | python" } as unknown as ExecPayload,
  };

  try {
    // Should NOT throw
    expect(() => replTuiInterceptor(context)).not.toThrow();
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - docker logs -f throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "docker",
    args: ["logs", "-f", "mycontainer"],
    envOverrides: {},
    payload: { type: "command", command: "docker", args: ["logs", "-f", "mycontainer"] } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - docker-compose logs --follow throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "docker-compose",
    args: ["logs", "--follow"],
    envOverrides: {},
    payload: { type: "command", command: "docker-compose", args: ["logs", "--follow"] } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - eval payload with /usr/bin/python throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "bash",
    args: [],
    envOverrides: {},
    payload: { type: "eval", interpreter: "bash", code: "/usr/bin/python" } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - eval payload with C:\\Python39\\python.exe throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "pwsh.exe",
    args: [],
    envOverrides: {},
    payload: { type: "eval", interpreter: "pwsh", code: "C:\\Python39\\python.exe" } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - eval payload with ./bash throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "bash",
    args: [],
    envOverrides: {},
    payload: { type: "eval", interpreter: "bash", code: "./bash" } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - python -E hangs properly throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "python",
    args: ["-E"],
    envOverrides: {},
    payload: { type: "command", command: "python", args: ["-E"] } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - bash --login hangs properly throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "bash",
    args: ["--login"],
    envOverrides: {},
    payload: { type: "command", command: "bash", args: ["--login"] } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - node --experimental-repl-await hangs properly throws", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "node",
    args: ["--experimental-repl-await"],
    envOverrides: {},
    payload: { type: "command", command: "node", args: ["--experimental-repl-await"] } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).toThrow("process.exit");
    expect(exitSpy.getExitCode()).toBe(1);
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - node script.js does not throw", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "node",
    args: ["script.js"],
    envOverrides: {},
    payload: { type: "command", command: "node", args: ["script.js"] } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).not.toThrow();
  } finally {
    exitSpy.restore();
  }
});

test("replTuiInterceptor - python -c 'print(1)' does not throw", () => {
  const exitSpy = setupExitSpy();
  const context = {
    cmdBasename: "python",
    args: ["-c", "print(1)"],
    envOverrides: {},
    payload: { type: "command", command: "python", args: ["-c", "print(1)"] } as unknown as ExecPayload,
  };

  try {
    expect(() => replTuiInterceptor(context)).not.toThrow();
  } finally {
    exitSpy.restore();
  }
});
