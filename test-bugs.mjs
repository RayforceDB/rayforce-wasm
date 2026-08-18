// Regression tests for the SDK bugs reported against 0.2.1.
//
//   Bug 1 - int64_t params in non-final position silently return RAY_NULL.
//           `-s WASM_BIGINT=0` legalizes every int64_t parameter into two i32
//           words, but the cwrap arg lists for `vec_set_idx` / `vec_insert`
//           declare only three args, so `val` is eaten as the index high word
//           and the real `val` arrives as 0.
//   Bug 2 - Dict.toJS() and the dict iterator wrap an already-decoded symbol
//           string in Number(), collapsing every key to "".
//   Bug 3 - list/dict/table construction retained every element twice.
//   Bug 4 - the reader family dropped the owned handles it read through.
//   Bug 5 - the f64 index/length params introduced by the bug 1 fix were
//           narrowed with an unchecked cast, so a negative length reached
//           memcpy as a ~4 GiB byte count.
//
// Each group failed against 0.2.1 and passes against a fixed build. Cases
// marked "control" passed all along and are here to keep the diagnosis
// honest: they pin down the paths that are *not* broken, so a fix that
// regresses them is caught.
//
// Run with: node test-bugs.mjs

import assert from 'node:assert/strict';
import { init, Types } from './dist/index.js';

const rf = await init({ singleton: false });

const results = [];

function check(bug, name, fn) {
  try {
    fn();
    results.push({ bug, name, ok: true });
  } catch (error) {
    results.push({ bug, name, ok: false, error });
  }
}

// ============================================================================
// Bug 1 - list / dict construction
// ============================================================================

check('bug1', 'control: rf.list([]) builds an empty list', () => {
  const list = rf.list([]);
  assert.equal(list.type, Types.LIST);
  assert.equal(rf.format(list), '()');
});

check('bug1', 'control: (list 1 2.5) via eval builds a list', () => {
  const list = rf.eval('(list 1 2.5)');
  assert.equal(list.type, Types.LIST);
  assert.equal(rf.format(list), '(1 2.5)');
});

check('bug1', 'rf.list([1, 2.5]) returns a LIST, not RAY_NULL', () => {
  const list = rf.list([1, 2.5]);
  assert.equal(list.type, Types.LIST, `got ${rf.typeName(list.type)} (${list.type})`);
  assert.equal(rf.format(list), '(1 2.5)');
});

check('bug1', 'rf.list([1, "two", 3.0]) preserves mixed types', () => {
  const list = rf.list([1, 'two', 3.0]);
  assert.equal(list.type, Types.LIST);
  assert.equal(list.length, 3);
  assert.deepEqual(list.toJS(), [1, 'two', 3.0]);
});

check('bug1', 'control: List.push() appends (no int64_t param on vec_push)', () => {
  const list = rf.list([]);
  list.push(1);
  list.push(2.5);
  assert.equal(list.type, Types.LIST);
  assert.equal(rf.format(list), '(1 2.5)');
});

check('bug1', 'List.set() replaces an element instead of destroying the list', () => {
  const list = rf.eval('(list 1 2)');
  list.set(0, rf.i64(9));
  assert.equal(list.type, Types.LIST, `got ${rf.typeName(list.type)} (${list.type})`);
  assert.equal(rf.format(list), '(9 2)');
});

check('bug1', 'List.set() with a negative index writes from the end', () => {
  const list = rf.eval('(list 1 2)');
  list.set(-1, rf.i64(9));
  assert.equal(rf.format(list), '(1 9)');
});

check('bug1', 'rf.dict({x:1, y:2.5}) has non-null values', () => {
  const dict = rf.dict({ x: 1, y: 2.5 });
  assert.equal(rf.format(dict), '{x:1 y:2.5}');
});

check('bug1', 'Dict.values() of a natively built dict is a List', () => {
  const dict = rf.dict({ x: 1, y: 2.5 });
  const vals = dict.values();
  assert.equal(vals.type, Types.LIST, `got ${rf.typeName(vals.type)} (${vals.type})`);
  assert.deepEqual(vals.toJS(), [1, 2.5]);
});

check('bug1', 'Dict.toJS() of a natively built dict round-trips', () => {
  // Currently throws TypeError: vals.at is not a function, because values()
  // is a RayNull rather than a List.
  assert.deepEqual(rf.dict({ x: 1, y: 2.5 }).toJS(), { x: 1, y: 2.5 });
});

// --- Binding-level proof: the legalized wasm signature takes four i32 args. ---

const wasm = rf._wasm;

check('bug1', 'raw vec_set_idx(obj, idx, val) is not mis-legalized', () => {
  // The SDK calls the export this way (3 args). With WASM_BIGINT=0 the wasm
  // signature is (obj, idx_lo, idx_hi, val), so `val` lands in idx_hi and the
  // `if (!obj || !val) return RAY_NULL_OBJ;` guard in main.c fires.
  const ptr = wasm._vec_set_idx(rf._initList(2), 0, rf.i64(7)._ptr);
  assert.notEqual(rf._getObjType(ptr), Types.NULL, 'vec_set_idx returned RAY_NULL');
  assert.equal(rf.format(ptr), '(7 null)');
});

check('bug1', 'vec_set_idx takes exactly one arg per C parameter', () => {
  // The pre-fix ABI needed the index split into (lo, hi). Now that the index
  // is a single f64 there is no high word, so the old 4-arg call shifts `val`
  // off the end. Pinning this keeps a future WASM_BIGINT change from silently
  // reintroducing the split.
  const ptr = wasm._vec_set_idx(rf._initList(2), 0, 0, rf.i64(7)._ptr);
  assert.equal(rf._getObjType(ptr), Types.NULL, 'the split-index form should no longer apply');
});

check('bug1', 'an out-of-range index errors instead of wrapping to 0', () => {
  // The truncation this replaces was the dangerous part: index 2^32 used to
  // alias index 0 and silently overwrite the wrong element.
  const set = wasm._vec_set_idx(rf._initList(2), 2 ** 32, rf.i64(7)._ptr);
  assert.equal(rf._getObjType(set), Types.ERR, `got ${rf.format(set)}`);
  const insert = wasm._vec_insert(rf.eval('(list 1 2)')._ptr, 2 ** 32, rf.i64(9)._ptr);
  assert.equal(rf._getObjType(insert), Types.ERR, `got ${rf.format(insert)}`);
});

check('bug1', 'raw vec_insert(obj, idx, val) is not mis-legalized', () => {
  const ptr = wasm._vec_insert(rf.eval('(list 1 2)')._ptr, 1, rf.i64(9)._ptr);
  assert.notEqual(rf._getObjType(ptr), Types.NULL, 'vec_insert returned RAY_NULL');
  assert.equal(rf.format(ptr), '(1 9 2)');
});

check('bug1', 'List.set() surfaces a failed COW rebind instead of nulling itself', () => {
  // The guard added alongside the binding fix: a list must never be silently
  // replaced by null or an error object.
  const list = rf.eval('(list 1 2)');
  assert.throws(() => list.set(2 ** 32, rf.i64(9)), /List\.set\(\) failed/);
  assert.equal(rf.format(list), '(1 2)', 'the list survived the failed set');
});

check('bug1', 'a trailing index param is not truncated to 32 bits', () => {
  // vec_at_idx takes its index last, so the pre-fix int64_t signature appeared
  // to work: the omitted high word defaulted to 0. Index 2^32 truncated to 0
  // and returned element 0 instead of null.
  // (Vector.at() bounds-checks in JS, so this only shows at the export level.)
  const list = rf.eval('(list 10 20)')._ptr;
  assert.equal(rf.format(wasm._vec_at_idx(list, 0)), '10');
  assert.equal(rf.format(wasm._vec_at_idx(list, 2)), 'null');
  assert.equal(
    rf.format(wasm._vec_at_idx(list, 2 ** 32)),
    'null',
    'index 2^32 truncated to 0 - the high word is being dropped',
  );
});

// ============================================================================
// Bug 2 - Dict.toJS() and the dict iterator return empty keys
// ============================================================================

const dict = rf.eval('(dict [x y] (list 1 2.5))');

check('bug2', 'control: the dict itself formats correctly', () => {
  assert.equal(rf.format(dict), '{x:1 y:2.5}');
});

check('bug2', 'control: Dict.keys().toJS() decodes symbols to strings', () => {
  assert.deepEqual(dict.keys().toJS(), ['x', 'y']);
});

check('bug2', 'control: Dict.values().toJS() is correct', () => {
  assert.deepEqual(dict.values().toJS(), [1, 2.5]);
});

check('bug2', 'Dict.toJS() keeps the keys', () => {
  // Vector.at() on a SYM vector already returns a string; toJS() re-wraps it
  // in Number(), so every key becomes symbol_to_str(NaN) === "".
  assert.deepEqual(dict.toJS(), { x: 1, y: 2.5 });
});

check('bug2', 'Dict.toJS() does not collapse distinct keys into one entry', () => {
  const wide = rf.eval('(dict [a b c] (list 1 2 3))');
  assert.equal(Object.keys(wide.toJS()).length, 3);
});

check('bug2', 'the dict iterator yields real keys', () => {
  assert.deepEqual(
    [...dict].map(([key, value]) => [key, value.toJS()]),
    [['x', 1], ['y', 2.5]],
  );
});

check('bug2', 'Dict.get() still resolves a key read back from toJS()', () => {
  const [key] = Object.keys(dict.toJS());
  assert.equal(dict.get(key).toJS(), 1);
});

check('bug2', 'Dict.toJS() round-trips a __proto__ key', () => {
  // Plain `result[key] = value` hits Object.prototype's __proto__ setter
  // instead of defining an own property, so the entry vanished - and an
  // object-valued one silently re-pointed the result's prototype.
  const proto = rf.eval('(dict [__proto__ x] (list 1 2))');
  const js = proto.toJS();
  assert.deepEqual(Object.keys(js), ['__proto__', 'x']);
  assert.equal(js.__proto__, 1);
  assert.equal(Object.getPrototypeOf(js), Object.prototype);
});

check('bug2', 'an object-valued __proto__ entry does not re-point the prototype', () => {
  const proto = rf.eval('(dict [__proto__ x] (list (dict [a] (list 1)) 2))');
  const js = proto.toJS();
  assert.equal(Object.getPrototypeOf(js), Object.prototype);
  assert.deepEqual(js.__proto__, { a: 1 });
});

check('bug2', 'Table.toJS()/toRows() round-trip a __proto__ column', () => {
  const table = rf.eval('(table [__proto__ x] (list [1 2] [3 4]))');
  assert.deepEqual(Object.keys(table.toJS()), ['__proto__', 'x']);
  const rows = table.toRows();
  assert.deepEqual(rows.map(row => Object.keys(row)), [['__proto__', 'x'], ['__proto__', 'x']]);
  assert.equal(rows[0].__proto__, 1);
  assert.equal(Object.getPrototypeOf(rows[0]), Object.prototype);
});

// ============================================================================
// Bug 3 - every list/dict element was retained twice
//
//   vec_set_idx / vec_push / vec_insert called ray_retain(val) before handing
//   the item to ray_list_set / _append / _insert_at, which retain it too.  An
//   element therefore went 1 -> 3, and dropping both the list and the caller's
//   handle left one ref stranded forever.  The SDK compounded it by minting
//   temporary wrappers for raw JS values and never dropping them.
// ============================================================================

check('bug3', 'a list takes exactly one ref on push', () => {
  const atom = rf.i64(42);
  assert.equal(atom.refCount, 1, 'fresh atom should start at rc=1');
  const list = rf.list();
  list.push(atom);
  assert.equal(atom.refCount, 2, 'list should hold exactly one ref');
  list.drop();
  assert.equal(atom.refCount, 1, 'dropping the list should return the ref');
  atom.drop();
});

check('bug3', 'a list takes exactly one ref on set', () => {
  const atom = rf.i64(7);
  const list = rf.list([0, 0]);
  list.set(0, atom);
  assert.equal(atom.refCount, 2);
  list.drop();
  assert.equal(atom.refCount, 1);
  atom.drop();
});

check('bug3', 'push does not steal the caller\'s ref', () => {
  const atom = rf.i64(1);
  const list = rf.list();
  list.push(atom);
  list.drop();
  assert.equal(Number(atom.value), 1, 'the caller\'s handle must stay alive');
  atom.drop();
});

// The engine grows the WASM heap in large steps, so a leak only shows after
// enough cycles to exhaust the current slack.  Pre-fix these loops took the
// heap from 68 MB to 320 MB; 50k iterations alone showed nothing, so keep the
// counts high enough to stay diagnostic.
const CYCLES = 400_000;

check('bug3', 'building and dropping lists does not grow the heap', () => {
  for (let i = 0; i < 10_000; i++) rf.list([i, i + 1, 'tag']).drop();  // settle
  const before = rf._wasm.HEAPU8.length;
  for (let i = 0; i < CYCLES; i++) rf.list([i, i + 1, 'tag']).drop();
  assert.equal(rf._wasm.HEAPU8.length, before, `heap grew across ${CYCLES} cycles`);
});

check('bug3', 'building and dropping dicts does not grow the heap', () => {
  for (let i = 0; i < 10_000; i++) rf.dict({ a: i, b: i + 0.5 }).drop();
  const before = rf._wasm.HEAPU8.length;
  for (let i = 0; i < CYCLES; i++) rf.dict({ a: i, b: i + 0.5 }).drop();
  assert.equal(rf._wasm.HEAPU8.length, before, `heap grew across ${CYCLES} cycles`);
});

check('bug3', 'building and dropping tables does not grow the heap', () => {
  const build = i => rf.table({ id: [i, i + 1], name: ['a', 'b'] });
  for (let i = 0; i < 10_000; i++) build(i).drop();
  const before = rf._wasm.HEAPU8.length;
  for (let i = 0; i < CYCLES; i++) build(i).drop();
  assert.equal(rf._wasm.HEAPU8.length, before, `heap grew across ${CYCLES} cycles`);
});

// rf.set() and Dict.get()/has() minted symbol wrappers for their string
// arguments and dropped none of them; ray_env_set and ray_dict_get both take
// their own refs, so every call stranded one.
check('bug3', 'rf.set() does not leak its symbol/value wrappers', () => {
  for (let i = 0; i < 10_000; i++) rf.set('g', i);
  const before = rf._wasm.HEAPU8.length;
  for (let i = 0; i < CYCLES; i++) rf.set('g', i);
  assert.equal(rf._wasm.HEAPU8.length, before, `heap grew across ${CYCLES} cycles`);
  assert.equal(Number(rf.eval('g').toJS()), CYCLES - 1, 'the binding must still be readable');
});

check('bug3', 'rf.set() keeps a caller-supplied value alive', () => {
  const atom = rf.i64(99);
  rf.set('kept', atom);
  assert.equal(Number(atom.value), 99, 'the caller\'s handle must survive set()');
  assert.equal(Number(rf.eval('kept').toJS()), 99);
  atom.drop();
  assert.equal(Number(rf.eval('kept').toJS()), 99, 'the binding holds its own ref');
});

check('bug3', 'Dict.get()/has() do not leak the looked-up key or value', () => {
  const dict3 = rf.dict({ a: 1, b: 2 });
  for (let i = 0; i < 10_000; i++) { dict3.get('a').drop(); dict3.has('b'); }
  const before = rf._wasm.HEAPU8.length;
  for (let i = 0; i < CYCLES; i++) { dict3.get('a').drop(); dict3.has('b'); }
  assert.equal(rf._wasm.HEAPU8.length, before, `heap grew across ${CYCLES} cycles`);
  assert.equal(dict3.get('a').toJS(), 1, 'lookups must still work');
  assert.equal(dict3.has('b'), true);
  assert.equal(dict3.has('zz'), false);
  dict3.drop();
});

// ============================================================================
// Bug 4 - readers discarded the owned handles they read through
//
//   dict_keys/dict_vals/table_keys/table_vals/table_col/vec_at_idx all hand
//   back an owned ref.  The toJS()/iterator/columnNames() family read one
//   field off each and dropped it on the floor, so simply *inspecting* a
//   container leaked.  Table.toRows() was worst: one column ref per cell.
//
//   Separately, SelectQuery.execute() bound the table to a fresh __rfq_N
//   global per call and never unbound it.  The env table is a fixed 1024
//   slots, so this pinned every queried table and then broke queries outright.
// ============================================================================

// These readers hand back refs to objects that already exist, so a leaked
// handle strands a refcount without allocating anything — a heap probe cannot
// see it (an earlier version of these tests passed against the unfixed SDK for
// exactly that reason).  Probe the refcount of the underlying object instead:
// take a handle, read its rc, drop it.  A reader that leaks moves that number.
function rcProbe(makeHandle) {
  return () => {
    const h = makeHandle();
    try { return h.refCount; } finally { h.drop(); }
  };
}

function assertNoLeak(label, probe, fn, iterations = 200) {
  const before = probe();
  for (let i = 0; i < iterations; i++) fn();
  assert.equal(probe(), before, `${label} stranded a ref (+${probe() - before})`);
}

// Fresh-allocation paths (table_keys/table_vals build new objects) can still
// be checked by heap growth, which catches leaks refcounts alone would miss.
function assertNoGrowth(label, fn, iterations = 100_000) {
  for (let i = 0; i < 10_000; i++) fn();  // settle
  const before = rf._wasm.HEAPU8.length;
  for (let i = 0; i < iterations; i++) fn();
  assert.equal(rf._wasm.HEAPU8.length, before, `${label} grew the heap`);
}

check('bug4', 'List.toJS() does not leak its elements', () => {
  const list = rf.list([1, 'two', 3.5]);
  assertNoLeak('List.toJS()', rcProbe(() => list.at(0)), () => list.toJS());
  assert.deepEqual(list.toJS(), [1, 'two', 3.5]);
  list.drop();
});

check('bug4', 'Dict.toJS() and its iterator do not leak keys/values', () => {
  const d = rf.dict({ a: 1, b: 2.5 });
  const valsRc = rcProbe(() => d.values());
  const keysRc = rcProbe(() => d.keys());
  const elemRc = rcProbe(() => d.values().at(0));

  assertNoLeak('Dict.toJS() vals', valsRc, () => d.toJS());
  assertNoLeak('Dict.toJS() keys', keysRc, () => d.toJS());
  assertNoLeak('Dict.toJS() elements', elemRc, () => d.toJS());
  assertNoLeak('Dict iterator', valsRc, () => { for (const [, v] of d) v.drop(); });

  assert.deepEqual(d.toJS(), { a: 1, b: 2.5 });
  d.drop();
});

check('bug4', 'abandoning the Dict iterator early still releases it', () => {
  const d = rf.dict({ a: 1, b: 2, c: 3 });
  assertNoLeak('abandoned Dict iterator', rcProbe(() => d.values()), () => {
    for (const [, v] of d) { v.drop(); break; }
  });
  d.drop();
});

check('bug4', 'Table.columnNames()/toJS()/toRows() do not leak', () => {
  const t = rf.table({ id: [1, 2, 3], name: ['a', 'b', 'c'] });
  const colRc = rcProbe(() => t.col('id'));

  // toRows() leaked one column ref per cell; toJS()/columnNames() leaked the
  // fresh sym-vector and list that table_keys/table_vals allocate.
  assertNoLeak('Table.toRows()', colRc, () => t.toRows());
  assertNoLeak('Table.toJS()', colRc, () => t.toJS());
  assertNoGrowth('columnNames()', () => t.columnNames());
  assertNoGrowth('Table.toJS()', () => t.toJS());
  assertNoGrowth('Table.toRows()', () => t.toRows());

  assert.deepEqual(t.columnNames(), ['id', 'name']);
  assert.deepEqual(t.toJS(), { id: [1, 2, 3], name: ['a', 'b', 'c'] });
  assert.deepEqual(t.toRows(), [
    { id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' },
  ]);
  t.drop();
});

check('bug4', 'repeated queries do not exhaust the 1024-slot global env', () => {
  const t = rf.table({ id: [1, 2, 3, 4, 5], v: [10, 20, 30, 40, 50] });
  for (let i = 0; i < 3000; i++) {
    const result = t.where(rf.col('v').gt(20)).execute();
    assert.equal(result.isError, false, `query #${i} failed: ${result.toString()}`);
    if (i === 2999) assert.equal(result.rowCount, 3, 'query must still be correct');
    result.drop();
  }
  t.drop();
});

check('bug4', 'rf.unset() removes a binding and releases its value', () => {
  // NB: eval() returns an owned ref — an env lookup retains the bound value,
  // so holding one of these would itself show up in refCount below.
  const read = name => { const r = rf.eval(name); try { return r.toJS(); } finally { r.drop(); } };
  const isUnbound = name => { const r = rf.eval(name); try { return r.isError; } finally { r.drop(); } };

  const atom = rf.i64(5);
  rf.set('tmpbind', atom);
  assert.equal(Number(read('tmpbind')), 5);
  assert.equal(atom.refCount, 2, 'the binding should hold one ref');
  rf.unset('tmpbind');
  assert.equal(atom.refCount, 1, 'unset must release the binding\'s ref');
  assert.equal(isUnbound('tmpbind'), true, 'the name should be gone');
  rf.unset('tmpbind');  // deleting an absent name is a no-op
  atom.drop();
});

// ============================================================================
// Bug 5 - f64 index/length params were narrowed without validation
//
//   The fix for bug 1 moved every index/length parameter to `double`
//   (ray_jsidx_t) to dodge i64 legalization, but each one was then narrowed
//   with a bare `(int64_t)` cast.  A double that is negative, fractional, NaN
//   or Infinity has no defined narrowing, and a negative length reached
//   memcpy as a byte count that wraps to nearly UINT32_MAX on wasm32:
//   `_fill_i32_vec(vec, buf, -1)` was a linear-memory overwrite.
//
//   The SDK normalizes and bounds-checks indices before it calls in, so these
//   only bite at the export level - which is exactly where an embedder or a
//   fuzzer reaches.  Every export must now reject the value instead of
//   narrowing it: no trap, no corruption, no garbage handle.
// ============================================================================

// Everything JS can put in a `double` that is not a usable index or length.
const BAD_IDX = [-1, NaN, Infinity, -Infinity, 2.5, -0.5, 2 ** 53 + 2];

// Copy a JS string into a NUL-terminated buffer, as cwrap's 'string' does.
function withCStr(s, fn) {
  const size = wasm.lengthBytesUTF8(s) + 1;
  const p = wasm._malloc(size);
  wasm.stringToUTF8(s, p, size);
  try { return fn(p); } finally { wasm._free(p); }
}

for (const [name, fn, type, cell] of [
  ['fill_i64_vec', '_fill_i64_vec', Types.I64, 7n],
  ['fill_i32_vec', '_fill_i32_vec', Types.I32, 7],
  ['fill_f64_vec', '_fill_f64_vec', Types.F64, 7],
]) {
  check('bug5', `${name}() with a bogus length is a no-op, not a wrapped memcpy`, () => {
    for (const bad of BAD_IDX) {
      const vec = rf.vector(type, [cell, cell, cell, cell]);
      const before = String(Array.from(vec.typedArray));
      const scratch = wasm._malloc(64);
      wasm[fn](vec._ptr, scratch, bad);
      assert.equal(
        String(Array.from(vec.typedArray)), before,
        `length ${bad} wrote through to the vector`,
      );
      wasm._free(scratch);
      vec.drop();
    }
  });
}

check('bug5', 'control: the heap is intact after the fill probes', () => {
  // A canary, not a diagnostic: pre-fix this passed too, because on this
  // Emscripten runtime the ~4 GiB copy trapped ("memory access out of
  // bounds") before it could scribble. A runtime that clamps instead of
  // trapping would corrupt linear memory here rather than throwing above.
  assert.equal(rf.eval('(sum (til 100))').toJS(), 4950);
});

check('bug5', 'init_vector() / init_list() reject a bogus length', () => {
  for (const bad of BAD_IDX) {
    const vec = wasm._init_vector(Types.I64, bad);
    assert.equal(wasm._is_obj_error(vec), 1, `init_vector accepted length ${bad}`);
    const list = wasm._init_list(bad);
    assert.equal(wasm._is_obj_error(list), 1, `init_list accepted length ${bad}`);
  }
});

check('bug5', 'the string constructors reject a bogus length', () => {
  withCStr('hello', p => {
    for (const bad of BAD_IDX) {
      assert.equal(
        wasm._is_obj_error(wasm._init_string_str(p, bad)), 1,
        `init_string_str accepted length ${bad}`,
      );
      assert.equal(
        wasm._is_obj_error(wasm._init_symbol_str(p, bad)), 1,
        `init_symbol_str accepted length ${bad}`,
      );
      assert.equal(wasm._intern_symbol(p, bad), -1, `intern_symbol accepted length ${bad}`);
    }
  });
});

check('bug5', 'an overlong string length clamps to the NUL instead of over-reading', () => {
  // Every call site marshals through cwrap's 'string', so the buffer is
  // NUL-terminated and the real extent is knowable.
  withCStr('hi', p => {
    const atom = wasm._init_string_str(p, 4096);
    assert.equal(wasm._is_obj_error(atom), 0, 'a merely-too-large length is still usable');
    assert.equal(wasm.UTF8ToString(wasm._str_atom_ptr(atom)), 'hi');
    assert.equal(wasm._str_atom_len(atom), 2, 'the length must be the clamped one');
  });
});

check('bug5', 'the string readers return "" for a bogus index', () => {
  const syms = rf.vector(Types.SYM, ['a', 'b']);
  const strs = rf.eval('("aa";"bb")');
  for (const bad of BAD_IDX) {
    assert.equal(wasm.UTF8ToString(wasm._symbol_to_str(bad)), '', `symbol_to_str(${bad})`);
    assert.equal(
      wasm.UTF8ToString(wasm._symbol_vec_get(syms._ptr, bad)), '',
      `symbol_vec_get(${bad})`,
    );
    assert.equal(
      wasm.UTF8ToString(wasm._str_vec_get(strs._ptr, bad)), '',
      `str_vec_get(${bad})`,
    );
  }
  syms.drop();
  strs.drop();
});

check('bug5', 'the index ops reject a bogus index and leave the vector intact', () => {
  const vec = rf.vector(Types.I64, [1n, 2n, 3n]);
  const val = rf.i64(9);
  for (const bad of BAD_IDX) {
    assert.equal(wasm._is_obj_null(wasm._vec_at_idx(vec._ptr, bad)), 1, `vec_at_idx(${bad})`);
    assert.equal(
      wasm._is_obj_error(wasm._vec_set_idx(vec._ptr, bad, val._ptr)), 1,
      `vec_set_idx(${bad})`,
    );
    assert.equal(
      wasm._is_obj_error(wasm._vec_insert(vec._ptr, bad, val._ptr)), 1,
      `vec_insert(${bad})`,
    );
  }
  assert.equal(String(Array.from(vec.typedArray)), '1,2,3', 'the vector was mutated');
  vec.drop();
  val.drop();
});

check('bug5', 'table_row() / table_col() reject a bogus index', () => {
  const t = rf.table({ id: [1, 2, 3], name: ['a', 'b', 'c'] });
  for (const bad of BAD_IDX) {
    // table_row forwards its index to vec_at_idx per column: without its own
    // check it would return a dict of nulls rather than fail.
    assert.equal(wasm._is_obj_null(wasm._table_row(t._ptr, bad)), 1, `table_row(${bad})`);
    withCStr('id', p => {
      assert.equal(wasm._is_obj_null(wasm._table_col(t._ptr, p, bad)), 1, `table_col(${bad})`);
    });
  }
  t.drop();
});

check('bug5', 'control: the validated paths still work', () => {
  const vec = rf.vector(Types.I64, [1n, 2n, 3n]);
  assert.equal(vec.at(1), 2);
  assert.equal(rf.format(wasm._vec_at_idx(vec._ptr, 2)), '3');
  vec.drop();

  const t = rf.table({ id: [1, 2, 3], name: ['a', 'b', 'c'] });
  assert.deepEqual(t.toRows()[2], { id: 3, name: 'c' });
  assert.deepEqual(t.col('name').toJS(), ['a', 'b', 'c']);
  t.drop();

  assert.deepEqual(rf.vector(Types.SYM, ['x', 'y']).toJS(), ['x', 'y']);
  assert.equal(rf.string('hello').toJS(), 'hello');
  assert.equal(rf.eval('(sum (til 1000))').toJS(), 499500);
});

// ============================================================================
// Report
// ============================================================================

const failed = results.filter(r => !r.ok);

for (const { bug, name, ok, error } of results) {
  if (ok) {
    console.log(`  ok   [${bug}] ${name}`);
  } else {
    console.log(`  FAIL [${bug}] ${name}`);
    console.log(`         ${String(error.message).split('\n').join('\n         ')}`);
  }
}

console.log(
  `\n${results.length - failed.length}/${results.length} passed, ${failed.length} failed ` +
  `(bug1: ${failed.filter(r => r.bug === 'bug1').length}, ` +
  `bug2: ${failed.filter(r => r.bug === 'bug2').length}, ` +
  `bug3: ${failed.filter(r => r.bug === 'bug3').length}, ` +
  `bug4: ${failed.filter(r => r.bug === 'bug4').length}, ` +
  `bug5: ${failed.filter(r => r.bug === 'bug5').length})`,
);

if (failed.length > 0) process.exitCode = 1;
