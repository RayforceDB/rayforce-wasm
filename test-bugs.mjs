// Regression tests for the two SDK bugs reported against 0.2.1.
//
//   Bug 1 - int64_t params in non-final position silently return RAY_NULL.
//           `-s WASM_BIGINT=0` legalizes every int64_t parameter into two i32
//           words, but the cwrap arg lists for `vec_set_idx` / `vec_insert`
//           declare only three args, so `val` is eaten as the index high word
//           and the real `val` arrives as 0.
//   Bug 2 - Dict.toJS() and the dict iterator wrap an already-decoded symbol
//           string in Number(), collapsing every key to "".
//
// These are expected to FAIL until the bindings are fixed. Cases marked
// "control" already pass and are here to keep the diagnosis honest: they pin
// down the paths that are *not* broken, so a fix that regresses them is caught.
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
  `bug2: ${failed.filter(r => r.bug === 'bug2').length})`,
);

if (failed.length > 0) process.exitCode = 1;
