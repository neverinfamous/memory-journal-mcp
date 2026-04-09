// src/codemode/worker-script.ts
import { parentPort, workerData } from "node:worker_threads";
import * as vm from "node:vm";

// src/codemode/auto-return.ts
var NON_RETURNABLE = /^\s*(return|throw|const |let |var |if\b|else\b|for\b|while\b|do\b|switch\b|try\b|catch\b|finally\b|class |function |\/\/|\/\*|\{|\})/;
function transformAutoReturn(code2) {
  const trimmed = code2.trimEnd();
  if (!trimmed) return code2;
  let depth = 0;
  let splitIndex = -1;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const ch = trimmed.charAt(i);
    if (ch === "}" || ch === "]" || ch === ")") depth++;
    else if (ch === "{" || ch === "[" || ch === "(") depth--;
    if (depth === 0 && (ch === ";" || ch === "\n")) {
      splitIndex = i;
      break;
    }
  }
  const lastStmt = (splitIndex >= 0 ? trimmed.slice(splitIndex + 1) : trimmed).trim();
  if (!lastStmt) return code2;
  if (NON_RETURNABLE.test(lastStmt)) return code2;
  if (splitIndex >= 0) {
    const before = trimmed.slice(0, splitIndex + 1);
    return `${before}
return ${lastStmt}`;
  }
  return `return ${trimmed}`;
}

// src/codemode/worker-script.ts
var { code, methodList, timeoutMs, rpcPort: workerRpcPort } = workerData;
var rpcPort = null;
var rpcIdCounter = 0;
var pendingRpcRequests = /* @__PURE__ */ new Map();
function rpcCall(group, method, args) {
  return new Promise((resolve, reject) => {
    if (!rpcPort) {
      reject(new Error("RPC port not initialized"));
      return;
    }
    const id = ++rpcIdCounter;
    pendingRpcRequests.set(id, { resolve, reject });
    const request = { id, group, method, args };
    rpcPort.postMessage(request);
  });
}
function buildApiProxy(methods) {
  const api = {};
  for (const [group, methodNames] of Object.entries(methods)) {
    if (group === "_topLevel") {
      for (const methodName of methodNames) {
        api[methodName] = (...args) => rpcCall("_topLevel", methodName, args);
      }
      continue;
    }
    const groupProxy = {};
    for (const methodName of methodNames) {
      groupProxy[methodName] = (...args) => rpcCall(group, methodName, args);
    }
    groupProxy["help"] = () => Promise.resolve({
      group,
      methods: methodNames
    });
    const groupProxyWrapped = new Proxy(groupProxy, {
      get(target, prop) {
        if (typeof prop === "symbol") return void 0;
        const key = prop;
        if (key in target) return target[key];
        if (key === "then") return void 0;
        const available = methodNames.join(", ") || "none";
        const reason = methodNames.length === 0 ? `Operation '${key}' is not available \u2014 this group has no methods (read-only mode?). Available: ${available}.` : `Operation '${key}' is not found in group. Available: ${available}.`;
        return (..._args) => Promise.reject(new Error(reason));
      }
    });
    api[group] = groupProxyWrapped;
  }
  api["help"] = () => {
    const groups = Object.keys(methods).filter((g) => g !== "_topLevel");
    let totalMethods = 0;
    for (const group of groups) {
      totalMethods += methods[group]?.length ?? 0;
    }
    return Promise.resolve({
      groups,
      totalMethods,
      usage: "Use mj.<group>.help() for group details. Example: mj.core.help()"
    });
  };
  return api;
}
async function executeCode() {
  const startCpu = process.cpuUsage();
  const startTime = performance.now();
  try {
    const mjApi = buildApiProxy(methodList);
    const sandbox = {
      mj: mjApi,
      console: {
        log: (...args) => args,
        warn: (...args) => args,
        error: (...args) => args,
        info: (...args) => args,
        debug: (...args) => args
      },
      // Nulled globals
      setTimeout: void 0,
      setInterval: void 0,
      setImmediate: void 0,
      process: void 0,
      require: void 0,
      __dirname: void 0,
      __filename: void 0,
      global: void 0,
      globalThis: void 0
    };
    const context = vm.createContext(sandbox, {
      name: "codemode-worker-sandbox"
    });
    const wrappedCode = `(async () => { ${transformAutoReturn(code)} })()`;
    const script = new vm.Script(wrappedCode, {
      filename: "codemode-execution.js"
    });
    const resultPromise = script.runInContext(context, {
      timeout: timeoutMs
    });
    const result = await resultPromise;
    const endTime = performance.now();
    const endCpu = process.cpuUsage(startCpu);
    const metrics = {
      wallTimeMs: Math.round(endTime - startTime),
      cpuTimeMs: Math.round((endCpu.user + endCpu.system) / 1e3),
      memoryUsedMb: 0
      // Measured on host side via RSS delta
    };
    return { success: true, result, metrics };
  } catch (err) {
    const endTime = performance.now();
    const endCpu = process.cpuUsage(startCpu);
    const error = err instanceof Error ? err : new Error(String(err));
    const metrics = {
      wallTimeMs: Math.round(endTime - startTime),
      cpuTimeMs: Math.round((endCpu.user + endCpu.system) / 1e3),
      memoryUsedMb: 0
    };
    return {
      success: false,
      error: error.message,
      stack: error.stack,
      metrics
    };
  }
}
rpcPort = workerRpcPort;
rpcPort.ref();
rpcPort.on("message", (response) => {
  const pending = pendingRpcRequests.get(response.id);
  if (pending) {
    pendingRpcRequests.delete(response.id);
    if (response.error) {
      pending.reject(new Error(response.error));
    } else {
      pending.resolve(response.result);
    }
  }
});
void executeCode().then((result) => {
  rpcPort?.unref();
  rpcPort?.close();
  parentPort?.postMessage(result);
});
