/**
 * Worker Prototype Hardening — outer-realm and inner-VM prototype freezing
 * to prevent dynamic constructor chain escapes (`fn['con'+'structor']`).
 */

import * as nodePath from 'node:path'
import * as vm from 'node:vm'
import { isCallable, isObjectOrFunction } from './result-proxy-aliases.js'

export const OPTIONAL_RUNTIME_GLOBALS = [
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
    'Intl',
    'WebAssembly',
    'Float16Array',
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

const MAX_NAMESPACE_FREEZE_DEPTH = 4

function freezeNamespaceMembers(
    ns: object,
    failures: string[],
    label: string,
    seen = new WeakSet(),
    depth = 0
): void {
    if (seen.has(ns) || depth > MAX_NAMESPACE_FREEZE_DEPTH) return
    seen.add(ns)
    for (const prop of Object.getOwnPropertyNames(ns)) {
        let member: unknown
        try {
            member = Reflect.get(ns, prop)
        } catch {
            continue
        }
        if (typeof member === 'function') {
            const proto = Reflect.get(member, 'prototype') as unknown
            if ((typeof proto === 'object' && proto !== null) || typeof proto === 'function') {
                try {
                    Object.freeze(proto)
                } catch {
                    failures.push(`freeze-prototype:${label}.${prop}`)
                }
            }
            try {
                Object.freeze(member)
            } catch {
                failures.push(`freeze:${label}.${prop}`)
            }
        } else if (typeof member === 'object' && member !== null) {
            freezeNamespaceMembers(member, failures, `${label}.${prop}`, seen, depth + 1)
            try {
                Object.freeze(member)
            } catch {
                failures.push(`freeze:${label}.${prop}`)
            }
        }
    }
}

function safeGetPrototypeOf(val: unknown): object | null {
    return isObjectOrFunction(val) ? Reflect.getPrototypeOf(val) : null
}

function getPrototypeProp(target: object | null): object | null {
    if (target === null) return null
    const proto: unknown = Reflect.get(target, 'prototype')
    return isObjectOrFunction(proto) ? proto : null
}

function collectOuterNodeErrorPrototypes(): object[] {
    const out: object[] = []
    const triggers: (() => unknown)[] = [
        () => {
            void Reflect.apply(nodePath.posix.basename, nodePath.posix, ['a', 123])
        },
        () => new URL('invalid://[').href,
        () => {
            if (typeof Buffer === 'function') Buffer.alloc(1).writeInt8(0, 99)
        },
    ]
    for (const trigger of triggers) {
        try {
            trigger()
        } catch (err: unknown) {
            if (typeof err === 'object' && err !== null) {
                let cur: object | null = Reflect.getPrototypeOf(err)
                while (cur !== null && cur !== Error.prototype && cur !== Object.prototype) {
                    out.push(cur)
                    cur = Reflect.getPrototypeOf(cur)
                }
            }
        }
    }
    return out
}

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
        } else if (typeof B === 'object' && B !== null) {
            freezeNamespaceMembers(B, failures, label)
        }
        try {
            Object.freeze(B)
        } catch {
            failures.push(`freeze:${label}`)
        }
    }
}

function collectIteratorHelperPrototypes(GlobalIter: object | undefined): (object | null)[] {
    if (GlobalIter === undefined) return []
    const fromFn: unknown = Reflect.get(GlobalIter, 'from')
    if (!isCallable(fromFn)) return []
    const out: (object | null)[] = []
    try {
        const iterObj: unknown = fromFn.call(GlobalIter, [])
        const mapFn: unknown = isObjectOrFunction(iterObj) ? Reflect.get(iterObj, 'map') : undefined
        const mapped: unknown = isCallable(mapFn) ? mapFn.call(iterObj, (x: unknown) => x) : undefined
        if (mapped !== undefined && mapped !== null) {
            out.push(safeGetPrototypeOf(mapped))
        }
    } catch {
        // Iterator helpers unavailable
    }
    try {
        const wrapped: unknown = fromFn.call(GlobalIter, {
            next: () => ({ done: true, value: undefined }),
        })
        if (wrapped !== undefined && wrapped !== null) {
            out.push(safeGetPrototypeOf(wrapped))
        }
    } catch {
        // WrapForValidIteratorPrototype unavailable
    }
    return out
}

function collectIntlSegmentPrototypes(): [object | null, object | null] {
    const rawIntl: unknown = Reflect.get(globalThis, 'Intl')
    if (!isObjectOrFunction(rawIntl)) return [null, null]
    const segmenterCtor: unknown = Reflect.get(rawIntl, 'Segmenter')
    if (typeof segmenterCtor !== 'function') return [null, null]
    try {
        const segInstance: unknown = Reflect.construct(segmenterCtor, [])
        if (!isObjectOrFunction(segInstance)) return [null, null]
        const segFn: unknown = Reflect.get(segInstance, 'segment')
        if (!isCallable(segFn)) return [null, null]
        const segments: unknown = segFn.call(segInstance, 'a')
        const segmentsProto = safeGetPrototypeOf(segments)
        let segmentIterProto: object | null = null
        if (isObjectOrFunction(segments)) {
            const iterFn: unknown = Reflect.get(segments, Symbol.iterator)
            if (isCallable(iterFn)) {
                segmentIterProto = safeGetPrototypeOf(iterFn.call(segments))
            }
        }
        return [segmentsProto, segmentIterProto]
    } catch {
        return [null, null]
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
    const AsyncFnProto = Reflect.getPrototypeOf(async function () {
        /* noop */
    })
    const GenFnProto = Reflect.getPrototypeOf(function* () {
        /* noop */
    })
    const AsyncGenFnProto = Reflect.getPrototypeOf(async function* () {
        /* noop */
    })
    const GenProto = getPrototypeProp(GenFnProto)
    const AsyncGenProto = getPrototypeProp(AsyncGenFnProto)
    const ArrayIterProto = Reflect.getPrototypeOf([][Symbol.iterator]())
    const IterProto = ArrayIterProto !== null ? Reflect.getPrototypeOf(ArrayIterProto) : null
    const StringIterProto = Reflect.getPrototypeOf(''[Symbol.iterator]())
    const MapIterProto = Reflect.getPrototypeOf(new Map()[Symbol.iterator]())
    const SetIterProto = Reflect.getPrototypeOf(new Set()[Symbol.iterator]())
    const RegExpStringIterProto = Reflect.getPrototypeOf(/a/[Symbol.matchAll](''))
    const AsyncIterProto = AsyncGenProto !== null ? Reflect.getPrototypeOf(AsyncGenProto) : null
    const TypedArrayCtor = Reflect.getPrototypeOf(Uint8Array)
    const TypedArrayProto = getPrototypeProp(TypedArrayCtor)
    const rawGlobalIter: unknown = Reflect.get(globalThis, 'Iterator')
    const GlobalIter = isObjectOrFunction(rawGlobalIter) ? rawGlobalIter : undefined
    return [
        Object.prototype,
        Function.prototype,
        AsyncFnProto,
        GenFnProto,
        AsyncGenFnProto,
        GenProto,
        AsyncGenProto,
        IterProto,
        ArrayIterProto,
        StringIterProto,
        MapIterProto,
        SetIterProto,
        RegExpStringIterProto,
        ...collectIteratorHelperPrototypes(GlobalIter),
        ...collectIntlSegmentPrototypes(),
        AsyncIterProto,
        TypedArrayCtor,
        TypedArrayProto,
        GlobalIter ?? null,
        getPrototypeProp(GlobalIter ?? null),
        ...collectOuterNodeErrorPrototypes(),
    ]
}

export function hardenOuterFunctionPrototypes(): string[] {
    const failures: string[] = []
    const noopConstructor = Object.freeze((): never => {
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

    try {
        Reflect.deleteProperty(Object.prototype, '__proto__')
    } catch {
        failures.push('delete-proto-accessor')
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
    const noopCtor = Object.freeze(() => {
        throw new Error("Dynamic code generation is disabled in sandbox");
    });
    const AsyncFnProto = Object.getPrototypeOf(async function() {});
    const GenFnProto = Object.getPrototypeOf(function*() {});
    const AsyncGenFnProto = Object.getPrototypeOf(async function*() {});
    const GenProto = GenFnProto && GenFnProto.prototype;
    const AsyncGenProto = AsyncGenFnProto && AsyncGenFnProto.prototype;
    const ArrayIterProto = Object.getPrototypeOf([][Symbol.iterator]());
    const IterProto = ArrayIterProto ? Object.getPrototypeOf(ArrayIterProto) : null;
    const StringIterProto = Object.getPrototypeOf(""[Symbol.iterator]());
    const MapIterProto = Object.getPrototypeOf(new Map()[Symbol.iterator]());
    const SetIterProto = Object.getPrototypeOf(new Set()[Symbol.iterator]());
    const RegExpStringIterProto = Object.getPrototypeOf(/a/[Symbol.matchAll](""));
    const AsyncIterProto = AsyncGenProto ? Object.getPrototypeOf(AsyncGenProto) : null;
    const TypedArrayCtor = Object.getPrototypeOf(Uint8Array);
    const TypedArrayProto = TypedArrayCtor && TypedArrayCtor.prototype;
    const GlobalIter = typeof Iterator !== "undefined" ? Iterator : null;
    let IterHelperProto = null;
    let WrapIterProto = null;
    if (GlobalIter && typeof GlobalIter.from === "function") {
        try { IterHelperProto = Object.getPrototypeOf(GlobalIter.from([]).map(function(x) { return x; })); } catch(e) {}
        try { WrapIterProto = Object.getPrototypeOf(GlobalIter.from({ next: function() { return { done: true, value: undefined }; } })); } catch(e) {}
    }
    let SegmentsProto = null;
    let SegmentIterProto = null;
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
        try {
            const segs = new Intl.Segmenter().segment("a");
            SegmentsProto = Object.getPrototypeOf(segs);
            SegmentIterProto = Object.getPrototypeOf(segs[Symbol.iterator]());
        } catch(e) {}
    }
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
    try { delete Object.prototype.__proto__; } catch(e) {}
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
    if (typeof Float16Array !== "undefined") builtins.push(Float16Array);
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
    if (typeof Intl !== "undefined") builtins.push(Intl);
    if (typeof WebAssembly !== "undefined") builtins.push(WebAssembly);
    if (TypedArrayCtor) builtins.push(TypedArrayCtor);
    if (GlobalIter) builtins.push(GlobalIter);
    const seenNs = new WeakSet();
    function freezeNs(ns, depth) {
        if (seenNs.has(ns) || depth > 4) return;
        seenNs.add(ns);
        for (const prop of Object.getOwnPropertyNames(ns)) {
            let member;
            try { member = ns[prop]; } catch(e) { continue; }
            if (typeof member === "function" && member.prototype) {
                try { Object.freeze(member.prototype); } catch(e) {}
            } else if (typeof member === "object" && member !== null) {
                freezeNs(member, depth + 1);
            }
            if ((typeof member === "object" && member !== null) || typeof member === "function") {
                try { Object.freeze(member); } catch(e) {}
            }
        }
    }
    for (const B of builtins) {
        if (B && typeof B === "function" && B.prototype) {
            try { Object.freeze(B.prototype); } catch(e) { /* already frozen or non-extensible */ }
        } else if (B && typeof B === "object") {
            freezeNs(B, 0);
        }
        try { Object.freeze(B); } catch(e) { /* already frozen or non-extensible */ }
    }
    for (const proto of [
        Object.prototype, Function.prototype, AsyncFnProto, GenFnProto,
        AsyncGenFnProto, GenProto, AsyncGenProto, IterProto, ArrayIterProto,
        StringIterProto, MapIterProto, SetIterProto, RegExpStringIterProto,
        IterHelperProto, WrapIterProto, SegmentsProto, SegmentIterProto, AsyncIterProto, TypedArrayProto,
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
