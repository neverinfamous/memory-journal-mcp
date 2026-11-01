/**
 * Worker Prototype Hardening — outer-realm and inner-VM prototype freezing
 * to prevent dynamic constructor chain escapes (`fn['con'+'structor']`).
 */

import * as vm from 'node:vm'

/**
 * Neuters `.constructor` on all outer function prototypes so untrusted scripts
 * inside `vm` cannot traverse `fn['con'+'structor']` to reach the outer realm's
 * Function/AsyncFunction/GeneratorFunction constructors.
 */
export function hardenOuterFunctionPrototypes(): void {
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

    for (const proto of [Object.prototype, Function.prototype, AsyncFnProto, GenFnProto, AsyncGenFnProto]) {
        if (proto !== null && proto !== undefined) {
            try {
                Object.defineProperty(proto, 'constructor', {
                    value: noopConstructor,
                    writable: false,
                    configurable: false,
                })
            } catch {
                // ignore if already non-configurable
            }
        }
    }

    const outerBuiltins: unknown[] = [
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
    for (const B of outerBuiltins) {
        if (typeof B === 'function' && B.prototype !== undefined && B.prototype !== null) {
            try {
                Object.freeze(B.prototype)
            } catch {
                // ignore
            }
        }
        try {
            Object.freeze(B)
        } catch {
            // ignore
        }
    }
    for (const proto of [Object.prototype, Function.prototype, AsyncFnProto, GenFnProto, AsyncGenFnProto]) {
        if (proto !== null && proto !== undefined) {
            try {
                Object.freeze(proto)
            } catch {
                // ignore
            }
        }
    }
}

/**
 * Freezes built-in prototypes and neuters Function constructors inside the
 * VM context to prevent dynamic constructor chain escapes like:
 *   `const c = 'con'+'structor'; Error()[c][c]('return process')()`
 */
export function freezeInnerVmContext(context: vm.Context): void {
    vm.runInContext(
        `(function() {
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
                    } catch(e) {}
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
                    try { Object.freeze(B.prototype); } catch(e) {}
                }
                try { Object.freeze(B); } catch(e) {}
            }
            for (const proto of [Object.prototype, Function.prototype, AsyncFnProto, GenFnProto, AsyncGenFnProto]) {
                if (proto) {
                    try { Object.freeze(proto); } catch(e) {}
                }
            }
        })()`,
        context
    )
}
