/**
 * Worker Prototype Hardening — outer-realm and inner-VM prototype freezing
 * to prevent dynamic constructor chain escapes (`fn['con'+'structor']`).
 */

import * as vm from 'node:vm'

const OPTIONAL_RUNTIME_GLOBALS = [
    'AggregateError',
    'Buffer',
    'Symbol',
    'BigInt',
    'SharedArrayBuffer',
    'Atomics',
    'WeakRef',
    'FinalizationRegistry',
    'SuppressedError',
    'DisposableStack',
    'AsyncDisposableStack',
    'Temporal',
] as const

function collectOptionalOuterBuiltins(): unknown[] {
    const out: unknown[] = []
    const g = globalThis as Record<string, unknown>
    for (const name of OPTIONAL_RUNTIME_GLOBALS) {
        if (g[name] !== undefined) out.push(g[name])
    }
    return out
}

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
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
    JSON,
    Math,
    ...collectOptionalOuterBuiltins(),
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
function collectGeneratorAndIteratorPrototypes(): (object | null)[] {
    const AsyncFnProto = Object.getPrototypeOf(async function () {
        /* noop */
    }) as object | null
    const GenFnProto = Object.getPrototypeOf(function* () {
        /* noop */
    }) as { prototype?: object | null } | null
    const AsyncGenFnProto = Object.getPrototypeOf(async function* () {
        /* noop */
    }) as { prototype?: object | null } | null
    const GenProto = GenFnProto?.prototype ?? null
    const AsyncGenProto = AsyncGenFnProto?.prototype ?? null
    const IterProto = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())) as object | null
    const AsyncIterProto =
        AsyncGenProto !== null ? (Object.getPrototypeOf(AsyncGenProto) as object | null) : null
    const TypedArrayCtor = Object.getPrototypeOf(Uint8Array) as { prototype?: object | null } | null
    const TypedArrayProto = TypedArrayCtor?.prototype ?? null
    const GlobalIter = (globalThis as { Iterator?: { prototype?: object | null } }).Iterator
    return [
        Object.prototype,
        Function.prototype,
        AsyncFnProto,
        GenFnProto,
        AsyncGenFnProto,
        GenProto,
        AsyncGenProto,
        IterProto,
        AsyncIterProto,
        TypedArrayCtor ?? null,
        TypedArrayProto,
        GlobalIter ?? null,
        GlobalIter?.prototype ?? null,
    ]
}

export function hardenOuterFunctionPrototypes(): string[] {
    const failures: string[] = []
    const noopConstructor = Object.freeze(function ForbiddenConstructor(): never {
        throw new Error('Dynamic code generation is disabled in sandbox')
    })
    const protos = collectGeneratorAndIteratorPrototypes()
    const [objProto, fnProto, asyncFnProto, genFnProto, asyncGenFnProto, genProto, asyncGenProto] = protos

    for (const [index, proto] of [objProto, fnProto, asyncFnProto, genFnProto, asyncGenFnProto, genProto, asyncGenProto].entries()) {
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
    const GenProto = GenFnProto && GenFnProto.prototype;
    const AsyncGenProto = AsyncGenFnProto && AsyncGenFnProto.prototype;
    const IterProto = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
    const AsyncIterProto = AsyncGenProto ? Object.getPrototypeOf(AsyncGenProto) : null;
    const TypedArrayCtor = Object.getPrototypeOf(Uint8Array);
    const TypedArrayProto = TypedArrayCtor && TypedArrayCtor.prototype;
    const GlobalIter = typeof Iterator !== "undefined" ? Iterator : null;
    for (const proto of [Function.prototype, AsyncFnProto, GenFnProto, AsyncGenFnProto, GenProto, AsyncGenProto]) {
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
    if (typeof AggregateError !== "undefined") builtins.push(AggregateError);
    if (typeof Symbol !== "undefined") builtins.push(Symbol);
    if (typeof BigInt !== "undefined") builtins.push(BigInt);
    if (typeof SharedArrayBuffer !== "undefined") builtins.push(SharedArrayBuffer);
    if (typeof Atomics !== "undefined") builtins.push(Atomics);
    if (typeof WeakRef !== "undefined") builtins.push(WeakRef);
    if (typeof FinalizationRegistry !== "undefined") builtins.push(FinalizationRegistry);
    if (typeof SuppressedError !== "undefined") builtins.push(SuppressedError);
    if (typeof DisposableStack !== "undefined") builtins.push(DisposableStack);
    if (typeof AsyncDisposableStack !== "undefined") builtins.push(AsyncDisposableStack);
    if (typeof Temporal !== "undefined") builtins.push(Temporal);
    if (TypedArrayCtor) builtins.push(TypedArrayCtor);
    if (GlobalIter) builtins.push(GlobalIter);
    for (const B of builtins) {
        if (B && typeof B === "function" && B.prototype) {
            try { Object.freeze(B.prototype); } catch(e) { /* already frozen or non-extensible */ }
        }
        try { Object.freeze(B); } catch(e) { /* already frozen or non-extensible */ }
    }
    for (const proto of [
        Object.prototype, Function.prototype, AsyncFnProto, GenFnProto,
        AsyncGenFnProto, GenProto, AsyncGenProto, IterProto, AsyncIterProto, TypedArrayProto,
    ]) {
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
