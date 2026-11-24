import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { init, Types, RayTimespan } from './dist/index.js';
const rf = await init({ singleton: false });
assert.equal(rf.version, '0.0.0');
assert.equal(Types.TIMESPAN, 16);
const minimum = -(1n << 63n);
for (const n of [0n, 1n, -1n, 9007199254740993n, -9007199254740993n, (1n << 63n) - 1n, minimum]) {
  const a = rf.timespan(n);
  assert.ok(a instanceof RayTimespan);
  assert.equal(a.type, -16);
  assert.equal(a.value, n);
  assert.equal(a.isNull, n === minimum);
  assert.equal(a.toJS(), n === minimum ? null : n);
  a.drop();
}
assert.throws(() => rf.timespan(9007199254740992), TypeError);
assert.throws(() => rf.timespan(1n << 63n), RangeError);
assert.throws(() => rf.timespan(-1.5), TypeError);
const values = [1n, -1n, 9007199254740993n, null];
const v = rf.vector(Types.TIMESPAN, values);
assert.deepEqual(v.toJS(), values);
assert.equal(v.at(2), values[2]);
assert.equal(v.at(3), null);
assert.equal(v.at(3, true), minimum);
assert.deepEqual([...v.typedArray], [1n, -1n, 9007199254740993n, minimum]);
rf.set('W6Input', v);
assert.equal(rf.eval('(sum (nil? W6Input))').toJS(), 1);
const oldView = v.typedArray;
v.set(0, null);
assert.equal(v.at(0), null);
assert.equal(oldView[0], 1n); // the bound original keeps its backing alive
assert.equal(rf.eval('(sum (nil? W6Input))').toJS(), 1);
rf.set('W6Changed', v);
assert.equal(rf.eval('(sum (nil? W6Changed))').toJS(), 2);
v.set(0, 2n);
assert.equal(v.at(0), 2n);
v.drop();
const indexedSpan = rf.eval("(.idx.hash (as 'TIMESPAN [1 2 1]))");
assert.equal(indexedSpan.isError, false);
rf.set('W6IndexedOriginal', indexedSpan);
indexedSpan.set(0, 3n);
rf.set('W6IndexedChanged', indexedSpan);
assert.equal(rf.eval("(nil? (find W6IndexedOriginal (as 'TIMESPAN 3)))").toJS(), true);
assert.equal(rf.eval("(find W6IndexedChanged (as 'TIMESPAN 3))").toJS(), 0);
indexedSpan.drop();
const empty = rf.vector(Types.TIMESPAN, []);
assert.deepEqual(empty.toJS(), []);
empty.drop();
for (const [expr, expected] of [
  ['0D00:00:00.000000001', 1n],
  ['(- 2026.01.01D00:00:00.000000002 2026.01.01D00:00:00.000000001)', 1n],
  ["(as 'TIMESPAN 9007199254740993)", 9007199254740993n],
]) {
  const a = rf.eval(expr);
  assert.equal(a.isError, false, expr);
  assert.equal(a.type, -16, expr);
  assert.equal(a.toJS(), expected, expr);
  a.drop();
}
// Duration null survives the engine/wrapper boundary without changing type.
const durationNull = rf.eval("(as 'TIMESPAN 0Nl)");
assert.equal(durationNull.type, -16);
assert.equal(durationNull.toJS(), null);
durationNull.drop();
// These are real native x86_64 frames generated with ray_ser from the pinned
// tag, not self-roundtrips or altered version bytes.
const fixture = JSON.parse(readFileSync(new URL('./test/fixtures/core-v3.0.2-wire.json', import.meta.url)));
assert.equal(fixture.wire, 3);
const expected = [1, 1n, 9007199254740993n, null,
  [1n, -1n, 9007199254740993n, null],
  [{ duration: 1n }, { duration: -1n }, { duration: 9007199254740993n }, { duration: null }]];
for (const [i, entry] of fixture.cases.entries()) {
  const decoded = rf.eval(`(de (as 'U8 [${[...Buffer.from(entry.hex, 'hex')].join(' ')}]))`);
  assert.equal(decoded.isError, false, entry.expr);
  assert.deepEqual(i === 5 ? decoded.toRows() : decoded.toJS(), expected[i], entry.expr);
  decoded.drop();
}
// Real native exact-fa9 frames, not a mutated version byte.
const dev = JSON.parse(readFileSync(new URL('./test/fixtures/core-fa9bccfd-wire.json', import.meta.url)));
assert.equal(dev.core, 'dev/fa9bccfd7f96b9248a39b23994f39a15d001b42c');
assert.equal(dev.wire, 4);
for (const [i, entry] of dev.cases.entries()) {
  const bytes = Buffer.from(entry.hex, 'hex');
  assert.equal(bytes[4], 4);
  const decoded = rf.eval(`(de (as 'U8 [${[...bytes].join(' ')}]))`);
  if (i === 6) {
    assert.equal(decoded.isError, true);
    assert.equal(decoded.code, 'domain');
    assert.equal(decoded.message, 'wire4 exact diagnostic');
  } else {
    assert.equal(decoded.isError, false, entry.expr);
    assert.deepEqual(i === 5 ? decoded.toRows() : decoded.toJS(), expected[i], entry.expr);
  }
  decoded.drop();
}
const oldWithError = JSON.parse(readFileSync(new URL('./test/fixtures/core-v3.0.2-wire-with-error.json', import.meta.url)));
assert.equal(oldWithError.wire, 3);
const oldErrorBytes = Buffer.from(oldWithError.cases[6].hex, 'hex');
assert.equal(oldErrorBytes[4], 3); assert.equal(oldErrorBytes.length, 25);
const previous = rf.eval('(+ 1)'); assert.equal(previous.code, 'arity');
const oldError = rf.eval(`(de (as 'U8 [${[...oldErrorBytes].join(' ')}]))`);
assert.equal(oldError.isError, true); assert.equal(oldError.code, 'domain');
assert.equal(oldError.message, ''); oldError.drop(); previous.drop();

const own = rf.eval('(ser 1)');
assert.equal(own.isError, false);
assert.equal(own.typedArray[4], 4);
own.drop();
// Reader range refusal is distinct from actual native v4 interoperability.
const unsupported = Buffer.from(dev.cases[0].hex, 'hex'); unsupported[4] = 5;
const refused = rf.eval(`(de (as 'U8 [${[...unsupported].join(' ')}]))`);
assert.equal(refused.isError, true); assert.equal(refused.code, 'version'); refused.drop();
for (const [expr, expectedRows] of [
  ['(find (.idx.hash [1 2 1]) [2 1])', [1, 0]],
  ["(find (.idx.hash ['a 'b 'a]) ['b 'a])", [1, 0]],
]) {
  const indexed = rf.eval(expr);
  assert.equal(indexed.isError, false, expr);
  assert.deepEqual(indexed.toJS(), expectedRows, expr);
  indexed.drop();
}
// An x86_64 inline index is not a wasm32 pointer layout. Its column remains
// readable but its accelerator must be ignored before examining child offsets.
const nativeIndex = JSON.parse(readFileSync(new URL('./test/fixtures/native-v3.0.2-index.json', import.meta.url)));
rf._wasm.FS.mkdirTree('/tmp/w6-native-index');
for (const [name, base64] of Object.entries(nativeIndex.files)) {
  rf._wasm.FS.writeFile(`/tmp/w6-native-index/${name}`, Buffer.from(base64, 'base64'));
}
const imported = rf.eval('(set W6NativeIndex (.db.splayed.get "/tmp/w6-native-index"))');
assert.equal(imported.isError, false);
imported.drop();
assert.deepEqual(rf.eval("(at W6NativeIndex 'v)").toJS(), [10, 20, 10]);
assert.equal(rf.eval("(.idx.has? (at W6NativeIndex 'v))").toJS(), false);
assert.equal(rf.eval("(find (at W6NativeIndex 'v) 20)").toJS(), 1);
const savedIndex = rf.eval('(.db.splayed.set "/tmp/w6-own-index" (table [v] (list (.idx.hash [10 20 10]))))');
assert.equal(savedIndex.isError, false);
savedIndex.drop();
const ownColumn = rf._wasm.FS.readFile('/tmp/w6-own-index/v');
// 32-byte column header + 24-byte values, aligned to 64, then index order at +17.
assert.ok([129, 130, 131].includes(ownColumn[81]));
const loadedIndex = rf.eval('(set W6OwnIndex (.db.splayed.get "/tmp/w6-own-index"))');
assert.equal(loadedIndex.isError, false);
loadedIndex.drop();
assert.equal(rf.eval("(.idx.has? (at W6OwnIndex 'v))").toJS(), true);
assert.equal(rf.eval("(find (at W6OwnIndex 'v) 20)").toJS(), 1);
console.log('private exact-fa9 TIMESPAN, native v3/v4 frames and writer-v4 checks passed');
