/**
 * Worker Prototype Hardening — outer-realm and inner-VM prototype freezing
 * to prevent dynamic constructor chain escapes (`fn['con'+'structor']`).
 */

import * as vm from 'node:vm'

const OUTER_BUILTIN_CTORS: readonly unknown[] = [
    Object,
    Function,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    TypeError,
    RangeError,
    ReferenceError,
    SyntaxError,
    URIError,
    EvalError,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Date,
    ArrayBuffer,
    DataView,
    JSON,
    Math,
]

function freezeOuterBuiltinCtors(failures: string[]): void {
    for (const B of OUTER_BUILTIN_CTORS) {
        const label = typeof B === 'function' && B.name !== '' ? B.name : 'builtin'
        if (typeof B === 'function') {
            const proto = Reflect.get(B, 'prototype') as unknown
            try {
                if ((typeof proto === 'object' && proto !== null) || typeof proto === 'function') {
                    Object.freeze(proto)
                }
            } catch {
                failures.push(`freeze-prototype:${label}`)
            }
        }
        try {
            Object.freeze(B)
        } catch {
            failures.push(`freeze:${label}`)
        }
    }
}

/**
 * Neuters `.constructor` on all outer function prototypes so untrusted scripts
 * inside `vm` cannot traverse `fn['con'+'structor']` to reach the outer realm's
 * Function/AsyncFunction/GeneratorFunction constructors.
 *
 * Returns the labels of hardening steps that failed (empty when all succeeded).
 * A single warning is written to stderr because the worker has no logger.
 */
export function hardenOuterFunctionPrototypes(): string[] {
    const failures: string[] = []
    const noopConstructor = Object.freeze(function ForbiddenConstructor(): never {
        throw new Error('Dynamic code generation is disabled in sandbox')
    })
    const AsyncFnProto = Object.getPrototypeOf(async function () {
        /* noop */
    }) as object | null
    const GenFnProto = Object.getPrototypeOf(function* () {
        /* noop */
    }) as object | null
    const AsyncGenFnProto = Object.getPrototypeOf(async function* () {
        /* noop */
    }) as object | null

    const protos = [Object.prototype, Function.prototype, AsyncFnProto, GenFnProto, AsyncGenFnProto]
    for (const [index, proto] of protos.entries()) {
        if (proto === null || proto === undefined) continue
        try {
            Object.defineProperty(proto, 'constructor', {
                value: noopConstructor,
                writable: false,
                configurable: false,
            })
        } catch {
            failures.push(`neuter-constructor[${String(index)}]`)
        }
    }

    freezeOuterBuiltinCtors(failures)

    for (const [index, proto] of protos.entries()) {
        if (proto === null || proto === undefined) continue
        try {
            Object.freeze(proto)
        } catch {
            failures.push(`freeze-proto[${String(index)}]`)
        }
    }

    if (failures.length > 0) {
        process.stderr.write(
            `[codemode] Prototype hardening steps failed: ${failures.join(', ')}\n`
        )
    }
    return failures
}

const FREEZE_INNER_CONTEXT_SCRIPT = new vm.Script(`(function() {
    "use strict";
    const noopCtor = Object.freeze(function ForbiddenConstructor() {
        throw new Error("Dynamic code generation is disabled in sandbox");
    });
    const AsyncFnProto = Object.getPrototypeOf(async function() {});
    const GenFnProto = Object.getPrototypeOf(function*() {});
    const AsyncGenFnProto = Object.getPrototypeOf(async function*() {});
    for (const proto of [Function.prototype, AsyncFnProto, GenFnProto, AsyncGenFnProto]) {
        if (proto) {
            try {
                Object.defineProperty(proto, "constructor", {
                    value: noopCtor,
                    writable: false,
                    configurable: false,
                });
            } catch(e) { /* non-configurable in some V8 versions; safe to ignore */ }
        }
    }
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
            try { Object.freeze(B.prototype); } catch(e) { /* already frozen or non-extensible */ }
        }
        try { Object.freeze(B); } catch(e) { /* already frozen or non-extensible */ }
    }
    for (const proto of [Object.prototype, Function.prototype, AsyncFnProto, GenFnProto, AsyncGenFnProto]) {
        if (proto) {
            try { Object.freeze(proto); } catch(e) { /* already frozen or non-extensible */ }
        }
    }
})()`)

/**
 * Freezes built-in prototypes and neuters Function constructors inside the
 * VM context to prevent dynamic constructor chain escapes like:
 *   `const c = 'con'+'structor'; Error()[c][c]('return process')()`
 */
export function freezeInnerVmContext(context: vm.Context): void {
    FREEZE_INNER_CONTEXT_SCRIPT.runInContext(context)
}
