import { expect, test } from "bun:test";
import { dockerInterceptor } from "../interceptors/docker-interceptor.js";
import { ExecutionContext } from "../interceptors/types.js";

test("docker exec -it strips tty flags", () => {
  const ctx: ExecutionContext = {
    cmdBasename: "docker",
    args: ["exec", "-it", "my_container", "ls"],
    envOverrides: {},
    payload: { type: "command", command: "docker", args: ["exec", "-it", "my_container", "ls"], env: {} }
  };
  dockerInterceptor(ctx);
  expect(ctx.args).toEqual(["exec", "my_container", "ls"]);
});

test("docker run -it blocks interactive sh", () => {
  const originalExit = process.exit;
  process.exit = ((code?: number) => {
    throw new Error(`process.exit called with code ${code}`);
  }) as unknown as typeof process.exit;

  const ctx: ExecutionContext = {
    cmdBasename: "docker",
    args: ["run", "-it", "ubuntu", "bash"],
    envOverrides: {},
    payload: { type: "command", command: "docker", args: ["run", "-it", "ubuntu", "bash"], env: {} }
  };

  try {
    expect(() => dockerInterceptor(ctx)).toThrow("process.exit called with code 1");
  } finally {
    process.exit = originalExit;
  }
});
