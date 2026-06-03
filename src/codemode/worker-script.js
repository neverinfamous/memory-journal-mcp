// src/codemode/worker-script.ts
import { parentPort } from "node:worker_threads";
import * as vm from "node:vm";

// src/codemode/auto-return.ts
var NON_RETURNABLE = /^\s*(return|throw|const |let |var |if\b|else\b|for\b|while\b|do\b|switch\b|try\b|catch\b|finally\b|class |function |\/\/|\/\*|\{|\})/;
function transformAutoReturn(code) {
  const trimmed = code.trimEnd();
  if (!trimmed) return code;
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
  if (!lastStmt) return code;
  if (NON_RETURNABLE.test(lastStmt)) return code;
  if (splitIndex >= 0) {
    const before = trimmed.slice(0, splitIndex + 1);
    return `${before}
return ${lastStmt}`;
  }
  return `return ${trimmed}`;
}

// src/codemode/worker-script.ts
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
function wrapResult(result) {
  if (result !== null && result !== void 0 && typeof result === "object" && "success" in result && result["success"] === false) {
    const failedResult = result;
    return new Proxy(failedResult, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === "string" && prop !== "then" && prop !== "catch" && prop !== "finally" && prop !== "constructor" && prop !== "prototype" && prop !== "toJSON") {
          const errVal = target["error"];
          const errorMsg = typeof errVal === "string" ? errVal : "Unknown error";
          throw new Error(
            `Attempted to access missing property '${prop}' on a failed operation. API Error: ${errorMsg}`
          );
        }
        return void 0;
      }
    });
  }
  return result;
}
function buildApiProxy(methods, schemas, readonlyMode) {
  const api = {};
  for (const [group, methodNames] of Object.entries(methods)) {
    if (group === "_topLevel") {
      for (const methodName of methodNames) {
        const proxyFn = async (...args) => {
          const result = await rpcCall("_topLevel", methodName, args);
          return wrapResult(result);
        };
        Object.assign(proxyFn, {
          schema: () => Promise.resolve(schemas?.["_topLevel"]?.[methodName] ?? "any")
        });
        api[methodName] = proxyFn;
      }
      continue;
    }
    const groupProxy = {};
    for (const methodName of methodNames) {
      const proxyFn = async (...args) => {
        const result = await rpcCall(group, methodName, args);
        return wrapResult(result);
      };
      Object.assign(proxyFn, {
        schema: () => Promise.resolve(schemas?.[group]?.[methodName] ?? "any")
      });
      groupProxy[methodName] = proxyFn;
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
        const reason = readonlyMode ? `Operation '${key}' is blocked in readonly mode. Read operations only.` : methodNames.length === 0 ? `Operation '${key}' is not available \u2014 this group has no methods (read-only mode?). Available: ${available}.` : `Operation '${key}' is not found in group. Available: ${available}.`;
        return (..._args) => {
          throw new Error(reason);
        };
      }
    });
    api[group] = groupProxyWrapped;
  }
  api["help"] = () => {
    const groups = Object.keys(methods).filter(
      (g) => g !== "_topLevel" && g !== "memory" && g !== "entries"
    );
    let totalMethods = 0;
    for (const group of groups) {
      totalMethods += methods[group]?.length ?? 0;
    }
    return Promise.resolve({
      groups,
      totalMethods,
      usage: "Use mj.<group>.help() for group details. Use mj.<group>.<method>.schema() for parameter details."
    });
  };
  return new Proxy(api, {
    get(target, prop) {
      if (typeof prop === "symbol") return void 0;
      if (prop in target) return target[prop];
      if (prop === "then") return void 0;
      const available = Object.keys(methods).filter((k) => k !== "_topLevel").join(", ");
      const reason = `Group or property '${prop}' is not found on 'mj'. Available groups: ${available}. Use mj.help() for more info.`;
      return new Proxy(
        () => {
        },
        {
          apply() {
            throw new Error(reason);
          },
          get(_t, subProp) {
            if (typeof subProp === "symbol") return void 0;
            if (subProp === "then") return void 0;
            return (..._args) => {
              throw new Error(
                `${reason} (Attempted to access 'mj.${prop}.${subProp}')`
              );
            };
          }
        }
      );
    }
  });
}
async function executeCode(code, methodList, schemaList, timeoutMs, contextObj, readonlyMode) {
  const startCpu = process.cpuUsage();
  const startTime = performance.now();
  try {
    const mjApi = buildApiProxy(methodList, schemaList, readonlyMode);
    const shimMj = new Proxy(mjApi, {
      get(target, prop) {
        if (prop === "mj" || prop === "journal" || prop === "memory") return shimMj;
        if (prop === "executeCode") {
          if ("codemode" in target) {
            const codemodeGroup = target["codemode"];
            return codemodeGroup["mjExecuteCode"] ?? codemodeGroup["executeCode"];
          }
          return () => Promise.reject(
            new Error(
              "You are already inside Code Mode execution. You do not need to call executeCode again. Just write your logic directly (e.g., return await mj.core.createEntry(...))."
            )
          );
        }
        if (prop === "readResource") {
          return () => Promise.reject(
            new Error(
              "Code Mode cannot directly read MCP resources using mj.readResource(). Please use the appropriate mj.* tools (e.g., mj.team.teamListFlags) to query data, or read the resource via standard MCP resource requests outside of Code Mode."
            )
          );
        }
        if (prop === "addEntry" && "core" in target) {
          const coreGroup = target["core"];
          return coreGroup["createEntry"];
        }
        if (prop === "append" && "core" in target) {
          const coreGroup = target["core"];
          const createEntry = coreGroup["createEntry"];
          return (arg1, arg2, arg3) => {
            const tags = Array.isArray(arg1) ? arg1 : [typeof arg1 === "string" ? arg1 : "test"];
            const content = typeof arg2 === "string" ? arg2 : arg2 != null ? JSON.stringify(arg2) : "";
            const metadata = typeof arg3 === "object" && arg3 !== null ? { ...arg3 } : void 0;
            const typeVal = metadata?.["type"];
            const type = typeof typeVal === "string" && typeVal !== "" ? typeVal : "test_entry";
            if (metadata && "type" in metadata) delete metadata["type"];
            return createEntry({ type, tags, content, metadata });
          };
        }
        if (typeof prop === "string") {
          const DB_TO_JOURNAL = {
            listTables: ["analytics", "getStatistics"],
            describeTable: ["analytics", "getStatistics"],
            count: ["analytics", "getStatistics"],
            analyze: ["analytics", "getStatistics"],
            vacuum: ["analytics", "getStatistics"],
            integrityCheck: ["analytics", "getStatistics"],
            exists: ["core", "getEntryById"],
            upsert: ["core", "createEntry"],
            batchInsert: ["core", "createEntry"],
            readQuery: ["search", "searchEntries"]
          };
          const mapping = DB_TO_JOURNAL[prop];
          if (mapping !== void 0) {
            const [group, method] = mapping;
            if (group in target) {
              return target[group][method];
            }
          }
        }
        return Reflect.get(target, prop);
      }
    });
    const sandbox = {
      mj: shimMj,
      journal: shimMj,
      sqlite: shimMj,
      postgres: shimMj,
      mysql: shimMj,
      db: shimMj,
      memory: shimMj,
      // Unified with shimMj to catch memory.append and memory.journal
      sqlite_journal_add_entry: shimMj["core"]?.["createEntry"],
      context: contextObj ?? {},
      console: {
        log: (...args) => args,
        warn: (...args) => args,
        error: (...args) => args,
        info: (...args) => args,
        debug: (...args) => args
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5e3))),
      setTimeout: (cb, ms, ...args) => setTimeout(cb, Math.min(ms ?? 0, 5e3), ...args),
      setInterval: void 0,
      setImmediate: void 0,
      process: void 0,
      require: void 0,
      __dirname: void 0,
      __filename: void 0,
      global: void 0,
      globalThis: void 0,
      Proxy: void 0
    };
    for (const key of Object.keys(mjApi)) {
      if (key in sandbox) continue;
      const val = shimMj[key];
      if (typeof val === "function") {
        sandbox[key] = val;
      }
    }
    const context = vm.createContext(sandbox, {
      name: "codemode-worker-sandbox",
      codeGeneration: {
        strings: false,
        wasm: false
      }
    });
    vm.runInContext(
      `(function() {
                "use strict";
                const builtins = [
                    Object, Function, Array, String, Number, Boolean, RegExp,
                    Error, TypeError, RangeError, ReferenceError, SyntaxError,
                    URIError, EvalError, Map, Set, WeakMap, WeakSet,
                    Promise, Date, ArrayBuffer, DataView,
                    Int8Array, Uint8Array, Uint8ClampedArray,
                    Int16Array, Uint16Array, Int32Array, Uint32Array,
                    Float32Array, Float64Array, BigInt64Array, BigUint64Array,
                    JSON, Math,
                ];
                for (const B of builtins) {
                    if (B && typeof B === "function" && B.prototype) {
                        try { Object.freeze(B.prototype); } catch(e) {}
                    }
                    try { Object.freeze(B); } catch(e) {}
                }
                try { Object.freeze(Object.prototype); } catch(e) {}
                try { Object.freeze(Function.prototype); } catch(e) {}
            })()`,
      context
    );
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
    };
    return { success: true, result, metrics };
  } catch (err) {
    const endTime = performance.now();
    const endCpu = process.cpuUsage(startCpu);
    const error = err instanceof Error ? err : new Error(String(err));
    if (error instanceof SyntaxError && error.message.includes("missing ) after argument list")) {
      error.message += "\n\n\u{1F4A1} Tip: When passing long multi-line strings or markdown with embedded quotes, use template literals (backticks `) instead of single/double quotes to avoid escaping SyntaxErrors.";
    }
    return {
      success: false,
      error: error.message,
      stack: error.stack,
      metrics: {
        wallTimeMs: Math.round(endTime - startTime),
        cpuTimeMs: Math.round((endCpu.user + endCpu.system) / 1e3),
        memoryUsedMb: 0
      }
    };
  }
}
parentPort?.on("message", (msg) => {
  void (async () => {
    if (msg !== null && msg !== void 0 && typeof msg === "object" && "type" in msg && msg.type === "EXECUTE") {
      const executeMsg = msg;
      const {
        id,
        code,
        methodList,
        schemaList,
        timeoutMs,
        maxResultSize,
        rpcPort: newRpcPort,
        contextObj,
        readonlyMode
      } = executeMsg;
      rpcPort = newRpcPort;
      rpcIdCounter = 0;
      pendingRpcRequests.clear();
      rpcPort?.on("message", (response) => {
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
      const result = await executeCode(
        code,
        methodList,
        schemaList,
        timeoutMs ?? 3e4,
        contextObj,
        readonlyMode
      );
      if (result.success) {
        try {
          const egressLimit = maxResultSize ?? 100 * 1024;
          let bytes = 0;
          const cache = /* @__PURE__ */ new Set();
          const resultJson = JSON.stringify(
            result.result,
            (_key, value) => {
              if (typeof value === "object" && value !== null) {
                if (cache.has(value)) return "[Circular]";
                cache.add(value);
              }
              if (typeof value === "string") {
                bytes += Buffer.byteLength(value, "utf8") + 2;
              } else if (typeof value === "number" || typeof value === "boolean") {
                bytes += Buffer.byteLength(String(value), "utf8");
              } else {
                bytes += 5;
              }
              if (bytes > egressLimit) {
                throw new Error(`EgressLimitExceeded:${bytes}`);
              }
              return value;
            }
          );
          if (resultJson !== void 0) {
            const byteLength = Buffer.byteLength(resultJson, "utf8");
            if (byteLength > egressLimit) {
              throw new Error(`EgressLimitExceeded:${byteLength}`);
            }
            result.result = JSON.parse(resultJson);
          } else {
            result.result = void 0;
          }
        } catch (err) {
          result.success = false;
          const egressLimit = maxResultSize ?? 100 * 1024;
          if (err instanceof Error && err.message.startsWith("EgressLimitExceeded:")) {
            const actualBytesStr = err.message.split(":")[1];
            const actualBytes = actualBytesStr !== void 0 ? Number(actualBytesStr) : egressLimit + 1;
            const actualKb = (actualBytes / 1024).toFixed(1);
            result.error = `Output limit exceeded: Result serialization exceeded the ${Math.round(egressLimit / 1024)}KB boundary (Actual size: >${actualKb}KB). Please aggregate or filter your results to reduce the payload size.`;
          } else {
            result.error = `Result could not be serialized or exceeded memory limits: ${err instanceof Error ? err.message : String(err)}`;
          }
          result.result = void 0;
        }
      }
      rpcPort?.close();
      rpcPort = null;
      parentPort?.postMessage({ type: "RESULT", id, result });
    }
  })();
});
